import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { createServiceClient } from "@/lib/supabase/service";
import type { PostType } from "@/lib/types";
import { GEMINI_MODEL, GEMINI_FAST_MODEL } from "@/lib/constants";

// In-app replacement for the n8n text pipelines (Workflow 1a + Workflow 2).
// Used when no n8n webhook URL is configured, so the whole app runs on the
// Gemini free tier with a single API key. Text posts only — no paid image,
// audio or video generation.

// Each persona writes one post per chunk; capped to keep requests fast.
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

function getModel(systemInstruction: string, json: boolean, model = GEMINI_MODEL) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model,
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

// Retries once on rate-limit / overload errors, waiting as long as Gemini asks (capped).
async function generateWithRetry(model: GenerativeModel, prompt: string) {
  try {
    return await model.generateContent(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded/i.test(msg)) throw err;
    const asked = Number(msg.match(/retry in ([\d.]+)s/i)?.[1] ?? msg.match(/"retryDelay":"(\d+)s"/)?.[1]);
    const waitMs = Math.min(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 8000, 20_000);
    await new Promise((r) => setTimeout(r, waitMs));
    return model.generateContent(prompt);
  }
}

// Stores the outcome on the material so /api/health can show why a feed stayed empty
async function recordGeneration(material_id: string, generation: Record<string, unknown>) {
  const supabase = createServiceClient();
  const { data } = await supabase.from("materials").select("teaching_plan").eq("id", material_id).single();
  await supabase
    .from("materials")
    .update({ teaching_plan: { ...(data?.teaching_plan ?? {}), generation: { ...generation, at: new Date().toISOString() } } })
    .eq("id", material_id);
}

export interface GenerationResult {
  inserted: number;
  error?: string;
}

export async function generateAndSavePosts(input: {
  material_id: string;
  raw_text: string;
  title: string;
  enabled_personas?: string[];
  priority_personas?: string[];
  emphasis?: string;
}): Promise<GenerationResult> {
  let result: GenerationResult;
  try {
    result = await generatePosts(input);
  } catch (err) {
    result = { inserted: 0, error: err instanceof Error ? err.message : String(err) };
  }
  if (result.error) console.error(`[posts] Generation failed for ${input.material_id}:`, result.error);
  else console.log(`[posts] Inserted ${result.inserted} posts for material ${input.material_id}`);
  await recordGeneration(input.material_id, { posts: result.inserted, error: result.error ?? null }).catch(() => {});
  return result;
}

async function generatePosts({
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
}): Promise<GenerationResult> {
  if (!process.env.GEMINI_API_KEY) return { inserted: 0, error: "GEMINI_API_KEY not configured" };

  const supabase = createServiceClient();
  const slugs = enabled_personas?.length ? enabled_personas : ["lecture-bestie", "exam-gremlin", "problem-grinder"];
  const { data: personaRows, error: personaError } = await supabase
    .from("personas")
    .select("id, slug, name, system_prompt")
    .in("slug", slugs);

  if (personaError || !personaRows?.length) {
    return { inserted: 0, error: `Could not load personas: ${personaError?.message ?? "none found"}` };
  }

  const prioritySet = new Set(priority_personas ?? []);
  const personas = (personaRows as PersonaRow[]).sort(
    (a, b) => Number(prioritySet.has(b.slug)) - Number(prioritySet.has(a.slug))
  );
  const chunks = splitIntoChunks(raw_text);
  const roster = personas.map((p) => `@${p.name}`).join(", ");
  const sections = chunks.map((c, i) => `### Section ${i + 1}\n${c}`).join("\n\n");
  const emphasisBlock = emphasis
    ? `\n\nThe student's teaching plan highlights this emphasis: "${emphasis}". Lean into this angle.`
    : "";

  // One fast request per persona, in parallel; each persona's posts are saved as
  // soon as they arrive so a slow persona can't hold back the rest of the feed.
  const results = await Promise.allSettled(
    personas.map(async (persona, pi) => {
      const model = getModel(persona.system_prompt, true, GEMINI_FAST_MODEL);
      if (!model) throw new Error("GEMINI_API_KEY not configured");

      const prompt = `Study material titled "${title}":

${sections}${emphasisBlock}

Other creators in this feed: ${roster}. You MAY mention one by @name if it feels natural; never force it.

Write exactly ${chunks.length} short educational posts, one per section, each about that section's main concept.
Write in the same language as the study material.
Return ONLY a JSON array of objects with fields "title" (string) and "body" (string).`;

      const response = await generateWithRetry(model, prompt);
      const raw = JSON.parse(response.response.text());
      // Gemini occasionally wraps the array, e.g. { "posts": [...] }
      const parsed: unknown[] = Array.isArray(raw) ? raw : (Object.values(raw ?? {}).find(Array.isArray) as unknown[]) ?? [];

      const postType = PERSONA_POST_TYPES[persona.slug] ?? "concept";
      const posts = parsed
        .filter((p): p is { title?: string; body: string } =>
          typeof (p as { body?: unknown })?.body === "string" && (p as { body: string }).body.trim().length > 0)
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
      if (posts.length === 0) throw new Error("Gemini returned no usable posts");

      const { error } = await supabase.from("posts").insert(posts);
      if (error) throw new Error(`DB insert error: ${error.message}`);
      return posts.length;
    })
  );

  const inserted = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
  const errors = results.flatMap((r, i) =>
    r.status === "rejected" ? [`${personas[i].slug}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : []
  );
  return { inserted, error: errors.length ? errors.join(" | ") : undefined };
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
