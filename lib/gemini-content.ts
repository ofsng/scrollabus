import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServiceClient } from "@/lib/supabase/service";
import type { PostType } from "@/lib/types";
import { GEMINI_MODEL } from "@/lib/constants";

// In-app replacement for the n8n text pipelines (Workflow 1a + Workflow 2).
// Used when no n8n webhook URL is configured, so the whole app runs on the
// Gemini free tier with a single API key. Text posts only — no paid image,
// audio or video generation.

// Each persona writes one post per chunk; capped to stay inside free-tier quotas.
const CHUNK_WORDS = 300;
const MAX_CHUNKS = 5;

const PERSONA_POST_TYPES: Record<string, PostType> = {
  "lecture-bestie": "concept",
  "exam-gremlin": "trap",
  "problem-grinder": "example",
  "doodle-prof": "concept",
  "meme-lord": "example",
  "study-bard": "recap",
};

const VALID_POST_TYPES: PostType[] = ["concept", "example", "trap", "review", "recap"];

function getModel(systemInstruction: string, json: boolean) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.8 } : { temperature: 0.8 },
  });
}

function splitIntoChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length && chunks.length < MAX_CHUNKS; i += CHUNK_WORDS) {
    chunks.push(words.slice(i, i + CHUNK_WORDS).join(" "));
  }
  return chunks;
}

interface PersonaRow {
  id: string;
  slug: string;
  name: string;
  system_prompt: string;
}

export async function generateAndSavePosts({
  material_id,
  raw_text,
  title,
  enabled_personas,
  priority_personas,
  emphasis,
}: {
  material_id: string;
  raw_text: string;
  title: string;
  enabled_personas?: string[];
  priority_personas?: string[];
  emphasis?: string;
}): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error("[posts] GEMINI_API_KEY not configured — skipping post generation");
    return;
  }

  const supabase = createServiceClient();
  const slugs = enabled_personas?.length ? enabled_personas : ["lecture-bestie", "exam-gremlin", "problem-grinder"];
  const { data: personaRows, error: personaError } = await supabase
    .from("personas")
    .select("id, slug, name, system_prompt")
    .in("slug", slugs);

  if (personaError || !personaRows?.length) {
    console.error("[posts] Could not load personas:", personaError);
    return;
  }

  const prioritySet = new Set(priority_personas ?? []);
  const personas = (personaRows as PersonaRow[]).sort(
    (a, b) => Number(prioritySet.has(b.slug)) - Number(prioritySet.has(a.slug))
  );
  const chunks = splitIntoChunks(raw_text);
  const roster = personas.map((p) => `@${p.name}`).join(", ");

  // One request per persona covering every chunk keeps request counts low
  // (free tier is rate-limited per minute and per day).
  const results = await Promise.allSettled(
    personas.map(async (persona, pi) => {
      const model = getModel(persona.system_prompt, true);
      if (!model) return [];

      const sections = chunks.map((c, i) => `### Section ${i + 1}\n${c}`).join("\n\n");
      const emphasisBlock = emphasis
        ? `\n\nThe student's teaching plan highlights this emphasis: "${emphasis}". Lean into this angle.`
        : "";
      const prompt = `Study material titled "${title}":

${sections}${emphasisBlock}

Other creators in this feed: ${roster}. You MAY mention one by @name if it feels natural; never force it.

Write exactly ${chunks.length} short educational posts, one per section, each about that section's main concept.
Write in the same language as the study material.
Return ONLY a JSON array of objects with fields "title" (string) and "body" (string).`;

      const result = await model.generateContent(prompt);
      const raw = JSON.parse(result.response.text());
      // Gemini occasionally wraps the array, e.g. { "posts": [...] }
      const parsed = Array.isArray(raw) ? raw : Object.values(raw ?? {}).find(Array.isArray);
      if (!Array.isArray(parsed)) return [];

      const postType = PERSONA_POST_TYPES[persona.slug] ?? "concept";
      return parsed
        .filter((p): p is { title?: string; body: string } => typeof p?.body === "string" && p.body.trim().length > 0)
        .slice(0, chunks.length)
        .map((p, ci) => ({
          material_id,
          persona_id: persona.id,
          post_type: VALID_POST_TYPES.includes(postType) ? postType : "concept",
          title: typeof p.title === "string" ? p.title : null,
          body: p.body.trim(),
          media_type: "text",
          media_url: null,
          // Interleave personas the same way the n8n orchestrator did
          sort_order: ci * personas.length + pi,
        }));
    })
  );

  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[posts] Gemini error for ${personas[i].slug}:`, r.reason);
  });

  const posts = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (posts.length === 0) {
    console.error("[posts] No posts generated — skipping DB insert");
    return;
  }

  const { error } = await supabase.from("posts").insert(posts);
  if (error) {
    console.error("[posts] DB insert error:", error);
  } else {
    console.log(`[posts] Inserted ${posts.length} posts for material ${material_id}`);
  }
}

export async function generateAndSaveCommentReply({
  comment_id,
  post_id,
  comment_body,
  learner_context,
}: {
  comment_id: string;
  post_id: string;
  comment_body: string;
  learner_context?: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { data: post } = await supabase
    .from("posts")
    .select("title, body, persona_id, personas(system_prompt)")
    .eq("id", post_id)
    .single();

  const persona = post?.personas as unknown as { system_prompt: string } | null;
  if (!post?.persona_id || !persona) return;

  const contextBlock = learner_context
    ? `\n\nLEARNER CONTEXT (what you know about this student):\n${learner_context}\nReference it naturally when relevant.`
    : "";
  const model = getModel(
    `${persona.system_prompt}

You are replying to a student comment on one of your posts. Keep your reply concise (2-4 sentences), in-character, and educationally useful. Reply in the same language as the student's comment.
Write plain conversational text only — no JSON.${contextBlock}`,
    false
  );
  if (!model) return;

  const result = await model.generateContent(
    `Your post:\nTitle: ${post.title ?? "(untitled)"}\nContent: ${post.body}\n\nStudent comment: "${comment_body}"\n\nWrite your reply.`
  );
  const reply = result.response.text().trim();
  if (!reply) return;

  const { error } = await supabase.from("comments").insert({
    post_id,
    persona_id: post.persona_id,
    parent_comment_id: comment_id,
    body: reply,
  });
  if (error) console.error("[comments] Reply insert error:", error);
}
