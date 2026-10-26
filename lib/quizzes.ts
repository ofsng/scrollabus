import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServiceClient } from "@/lib/supabase/service";
import { QUIZZES_PER_MATERIAL } from "@/lib/constants";

interface RawQuizOption {
  id: string;
  text: string;
}

interface RawQuiz {
  question_type: "multiple_choice" | "multiple_response" | "free_text";
  question: string;
  options?: RawQuizOption[];
  correct_answer: string[] | { text: string };
  explanation: string;
}

// ─── Per-persona quiz strategies ─────────────────────────────────────────────
// Each persona has a teaching style that extends to how they quiz students.
// The strategy text is injected into the generation prompt alongside the
// persona's voice to produce quiz questions that feel authored by that creator.

const PERSONA_QUIZ_STRATEGIES: Record<string, { voice: string; strategy: string }> = {
  "exam-gremlin": {
    voice: "You are Exam Gremlin — a mischievous but helpful study persona who LIVES for exposing exam traps.",
    strategy: `Focus on trick questions, common misconceptions, and classic exam traps.
Write questions where the wrong answers represent what students TYPICALLY get wrong.
Include at least one question that starts with "Don't fall for this:" or targets a common mistake.
Make the distractors (wrong options) plausible — they should feel almost right.
The explanation should reveal WHY students fall for the trap.`,
  },
  "problem-grinder": {
    voice: "You are Problem Grinder — a methodical, no-nonsense study persona who believes in step-by-step working.",
    strategy: `Focus on application and worked-process questions, not pure recall.
Prefer free_text questions where the student must show their reasoning steps.
For MCQ questions, test whether the student can apply a method to a new example.
Explanations should reference the correct procedure explicitly — "the method is..."
At least one question should require multi-step reasoning.`,
  },
  "lecture-bestie": {
    voice: "You are Lecture Bestie — a warm, encouraging study persona who wants students to feel capable.",
    strategy: `Write friendly, confidence-building check-your-understanding questions.
Questions should feel approachable, not scary. Use relatable language and everyday contexts.
Mix question types. Start with an easier question to build momentum.
Explanations should be warm and affirming: "Great — here's why this is right..." or "No worries, here's what's happening..."
End each explanation with a helpful tip or analogy.`,
  },
  "meme-lord": {
    voice: "You are Meme Lord — a chaotic-good study persona who explains everything through internet culture.",
    strategy: `Write quiz questions with a meme-flavoured twist — use pop culture references, relatable student struggles, or internet-style phrasing where it helps understanding.
Questions should still be academically valid but fun to read.
For multiple_choice, the wrong options can have a bit of comedic self-awareness (e.g. "just vibing", "I panic-guessed") while still representing real misconceptions.
Explanations can be punchy and meme-aware: "okay real talk, here's why..." or "this one gets everyone..."`,
  },
  "doodle-prof": {
    voice: "You are Doodle Prof — a quirky study persona who explains concepts through visual imagination.",
    strategy: `Write questions that encourage visual thinking and spatial reasoning.
Ask students to imagine diagrams, flows, or cause-and-effect relationships.
Questions can describe a scenario or diagram and ask what it represents.
Explanations should reference how you'd draw or visualise this concept.
Include at least one question that asks "if you had to draw this, what would you show?"`,
  },
  "study-bard": {
    voice: "You are Study Bard — a musical genius who encodes knowledge in lyrics and rhythms.",
    strategy: `Write quiz questions connected to memory, association, and pattern recognition.
Include at least one "fill in the lyric / complete the pattern" style question where the blank is a key concept.
For MCQ, the options can be worded rhythmically to make the correct one feel more memorable.
Explanations should highlight how you'd remember this concept mnemonically.
Questions should feel like they're testing whether the concept "stuck" not just whether it was read.`,
  },
};

// Generic fallback for any persona slug not in the map above
const GENERIC_STRATEGY = {
  voice: "You are an expert educator who creates high-quality quiz questions.",
  strategy: `Mix question types: include at least one multiple_choice, and distribute among multiple_response and free_text as well.
Questions must be directly answerable from the provided material.
Options should be plausible; wrong answers should represent common misconceptions, not be obviously wrong.
Questions should vary in difficulty.`,
};

function buildSystemPrompt(
  personaSlug: string | null,
  quizCount: number
): string {
  const ps = personaSlug ? PERSONA_QUIZ_STRATEGIES[personaSlug] ?? GENERIC_STRATEGY : GENERIC_STRATEGY;

  return `${ps.voice}

Given a piece of study material, generate exactly ${quizCount} quiz questions that test student understanding.

Teaching approach:
${ps.strategy}

Rules for all question types:
- For multiple_choice: provide 4 options (ids: "a", "b", "c", "d"), exactly one correct answer.
- For multiple_response: provide 4-5 options (ids: "a", "b", "c", "d", optionally "e"), 2-3 correct answers.
- For free_text: provide a model answer that clearly explains the correct response.
- The explanation should be 1-3 sentences — clear, educational, and in YOUR voice.
- Questions must be directly answerable from the provided material.

Return ONLY a valid JSON array of quiz objects. No markdown fences, no extra text.

Each object must match this structure:
{
  "question_type": "multiple_choice" | "multiple_response" | "free_text",
  "question": "...",
  "options": [{ "id": "a", "text": "..." }, ...] | null,
  "correct_answer": ["a"] | ["a", "c"] | { "text": "model answer here" },
  "explanation": "..."
}`;
}

// ─── Validation helper ────────────────────────────────────────────────────────

function isValidQuiz(q: RawQuiz): boolean {
  if (!q.question_type || !q.question || !q.correct_answer || !q.explanation) return false;
  if (!["multiple_choice", "multiple_response", "free_text"].includes(q.question_type)) return false;
  if (q.question_type !== "free_text" && (!Array.isArray(q.options) || q.options.length < 2)) return false;
  return true;
}

// ─── Per-persona generation ───────────────────────────────────────────────────

async function generateQuizzesForPersona(
  model: ReturnType<InstanceType<typeof GoogleGenerativeAI>["getGenerativeModel"]>,
  personaSlug: string | null,
  material_id: string,
  raw_text: string,
  title: string,
  quizCount: number
): Promise<Array<Record<string, unknown>>> {
  const systemInstruction = buildSystemPrompt(personaSlug, quizCount);

  const truncated = raw_text.length > 4000 ? raw_text.slice(0, 4000) + "..." : raw_text;
  const userPrompt = `Title: ${title}

Study material:
${truncated}

Generate ${quizCount} quiz questions based on this material. Return ONLY a valid JSON array.`;

  try {
    // Clone model config with updated system instruction
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const personaModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction,
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await personaModel.generateContent(userPrompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return (parsed as RawQuiz[])
      .filter(isValidQuiz)
      .map((q) => ({
        material_id,
        persona_slug: personaSlug,
        question_type: q.question_type,
        question: q.question,
        options: q.options ?? null,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
      }));
  } catch (err) {
    console.error(`[quiz] Gemini error for persona ${personaSlug ?? "generic"}:`, err);
    return [];
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAndSaveQuizzes({
  material_id,
  raw_text,
  title,
  enabled_personas,
}: {
  material_id: string;
  raw_text: string;
  title: string;
  enabled_personas?: string[];
}): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[quiz] GEMINI_API_KEY not configured — skipping quiz generation");
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // Base model used only as a factory reference; each persona call creates its own instance
  const baseModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const allValidSlugs = Object.keys(PERSONA_QUIZ_STRATEGIES);
  const personas = enabled_personas
    ? enabled_personas.filter((s) => allValidSlugs.includes(s))
    : allValidSlugs;

  // Distribute QUIZZES_PER_MATERIAL across active personas, minimum 1 per persona.
  // If there are more personas than quiz slots, each enabled persona still gets 1 quiz.
  const quizPerPersona = Math.max(1, Math.floor(QUIZZES_PER_MATERIAL / Math.max(personas.length, 1)));
  const remainder = QUIZZES_PER_MATERIAL - quizPerPersona * personas.length;

  // Generate in parallel across personas (each call is independent)
  const results = await Promise.allSettled(
    personas.map((slug, i) =>
      generateQuizzesForPersona(
        baseModel,
        slug,
        material_id,
        raw_text,
        title,
        quizPerPersona + (i === 0 ? remainder : 0) // give any remainder to the first persona
      )
    )
  );

  const allQuizzes = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  if (allQuizzes.length === 0) {
    console.error("[quiz] No valid quizzes generated across all personas — skipping DB insert");
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("quizzes").insert(allQuizzes);
  if (error) {
    console.error("[quiz] DB insert error:", error);
  } else {
    console.log(`[quiz] Inserted ${allQuizzes.length} persona-voiced quizzes for material ${material_id}`);
  }
}
