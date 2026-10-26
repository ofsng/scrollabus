import { createClient } from "@/lib/supabase/server";
import { writeConversationMemory, recallMemory, formatMemoryContext } from "@/lib/hydra";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Quiz, QuizOption } from "@/lib/types";
import { GEMINI_MODEL } from "@/lib/constants";

// GET /api/quiz-chat?quiz_id=xxx
// Returns the persisted chat history for this user + quiz
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const quizId = req.nextUrl.searchParams.get("quiz_id");
  if (!quizId) {
    return NextResponse.json({ error: "quiz_id required" }, { status: 400 });
  }

  const { data: messages, error } = await supabase
    .from("quiz_messages")
    .select("*")
    .eq("quiz_id", quizId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [] });
}

// POST /api/quiz-chat
// Send a message to a persona about a quiz question.
// Guardrail: persona gives hints only if user hasn't answered; full explanation if they have.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { quiz_id, persona_slug, message } = body;

  if (!quiz_id || !persona_slug || !message?.trim()) {
    return NextResponse.json({ error: "quiz_id, persona_slug, and message are required" }, { status: 400 });
  }

  // Fetch quiz (verify ownership via material join)
  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .select(`
      *,
      material:materials!inner(user_id)
    `)
    .eq("id", quiz_id)
    .single();

  if (quizError || !quiz) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  if (quiz.material?.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch persona
  const { data: persona, error: personaError } = await supabase
    .from("personas")
    .select("name, system_prompt, description")
    .eq("slug", persona_slug)
    .single();

  if (personaError || !persona) {
    return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  }

  // Check if user has already answered this quiz
  const { data: existingResponse } = await supabase
    .from("quiz_responses")
    .select("answer, is_correct")
    .eq("quiz_id", quiz_id)
    .eq("user_id", user.id)
    .single();

  const hasAnswered = !!existingResponse;

  // Load previous chat history for this quiz session
  const { data: history } = await supabase
    .from("quiz_messages")
    .select("role, body, persona_slug")
    .eq("quiz_id", quiz_id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  // Recall learner memory for misconceptions on this topic
  const typedQuiz = quiz as Quiz & { material: { user_id: string } };
  const memories = await recallMemory({
    userId: user.id,
    query: `misconceptions and struggles: ${typedQuiz.question}`,
    maxResults: 6,
    recencyBias: 0.2,
  });
  const memoryContext = formatMemoryContext(memories);

  // Build the quiz context for the persona
  let optionsText = "";
  if (typedQuiz.options && Array.isArray(typedQuiz.options)) {
    optionsText = "\nOptions:\n" + (typedQuiz.options as QuizOption[])
      .map((o) => `  ${o.id}) ${o.text}`)
      .join("\n");
  }

  const quizContext = `Quiz question (${typedQuiz.question_type.replace("_", " ")}):
"${typedQuiz.question}"${optionsText}`;

  // Build guardrailed system prompt
  let quizInstruction: string;

  if (!hasAnswered) {
    quizInstruction = `You are helping a student who has NOT yet answered the following quiz question. 

${quizContext}

IMPORTANT GUARDRAILS — you MUST follow these strictly:
- Do NOT reveal the correct answer or correct option ID(s) under any circumstances.
- Do NOT confirm or deny whether any specific option is correct.
- Use the Socratic method: ask guiding questions, help the student reason through the concept.
- You MAY give hints about the underlying concept, point to relevant principles, or help narrow thinking.
- If the student directly asks for the answer, gently decline and redirect with a hint.
- Keep responses concise and encouraging — stay true to your persona's voice.`;
  } else {
    const userAnswer = existingResponse.answer;
    const isCorrect = existingResponse.is_correct;
    const correctAnswer = typedQuiz.correct_answer;

    quizInstruction = `You are helping a student who HAS already answered the following quiz question.

${quizContext}

The student's answer: ${JSON.stringify(userAnswer)}
Result: ${isCorrect === null ? "subjective (free response)" : isCorrect ? "CORRECT ✓" : "INCORRECT ✗"}
Correct answer: ${JSON.stringify(correctAnswer)}
Explanation: ${typedQuiz.explanation}

Now you can:
- Explain why the correct answer is right.
- Explain why wrong answers are wrong (if applicable).
- Go deeper into the underlying concept.
- Help the student understand any gaps in their knowledge.
- Stay true to your persona's voice and teaching style.`;
  }

  const systemInstruction = `${persona.system_prompt}

You are now in a quiz help session with a student. Respond as ${persona.name} in a conversational chat format — no JSON needed. Stay in character.

${quizInstruction}${memoryContext}`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
  });

  // Build Gemini chat history from persisted messages
  const geminiHistory = (history ?? []).map((m: { role: string; body: string }) => ({
    role: m.role === "persona" ? "model" : "user",
    parts: [{ text: m.body }],
  }));

  let reply: string;
  try {
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message.trim());
    reply = result.response.text();
  } catch (err) {
    console.error("[quiz-chat] Gemini error:", err);
    return NextResponse.json({ error: "AI error" }, { status: 500 });
  }

  // Persist both the user message and the persona reply
  const { error: insertError } = await supabase.from("quiz_messages").insert([
    {
      quiz_id,
      user_id: user.id,
      persona_slug: null,
      role: "user",
      body: message.trim(),
    },
    {
      quiz_id,
      user_id: user.id,
      persona_slug,
      role: "persona",
      body: reply,
    },
  ]);

  if (insertError) {
    console.error("[quiz-chat] Failed to persist messages:", insertError);
    // Still return the reply — don't fail the user experience over logging
  }

  // Fire-and-forget: write quiz discussion to learner memory
  writeConversationMemory({
    userId: user.id,
    userMessage: message.trim(),
    assistantMessage: reply,
  }).catch(() => {});

  return NextResponse.json({ reply, persona_slug });
}
