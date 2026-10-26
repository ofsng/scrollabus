import { createClient } from "@/lib/supabase/server";
import { writeConversationMemory, recallMemory, formatMemoryContext } from "@/lib/hydra";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_MODEL } from "@/lib/constants";

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const body = await req.json();
  const messages: ChatMessage[] = body.messages ?? [];

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  // Fetch persona for its system prompt
  const { data: persona, error } = await supabase
    .from("personas")
    .select("name, system_prompt, description")
    .eq("slug", slug)
    .single();

  if (error || !persona) {
    return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
  }

  // Recall learner memory to personalize the response
  const lastUserMessage = messages[messages.length - 1];
  const memories = await recallMemory({
    userId: user.id,
    query: `What does this student know and struggle with? ${lastUserMessage.content}`,
    maxResults: 8,
    recencyBias: 0.4,
  });
  const memoryContext = formatMemoryContext(memories);

  // Build a DM-specific system prompt — keep the persona voice but adapt to conversation mode
  const systemInstruction = `${persona.system_prompt}

You are now in a direct message conversation with a student. Respond conversationally as ${persona.name} — stay in character but adapt to a chat format: no need to return JSON. Just reply naturally as yourself. Keep responses focused, helpful, and true to your personality. The student may ask you anything about their studies, or just chat.${memoryContext}`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
  });

  // Convert messages to Gemini history format (all except the last user message)
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  if (lastUserMessage.role !== "user") {
    return NextResponse.json({ error: "Last message must be from user" }, { status: 400 });
  }

  let reply: string;
  try {
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastUserMessage.content);
    reply = result.response.text();
  } catch (err) {
    console.error("[dm] Gemini error:", err);
    return NextResponse.json({ error: "AI error" }, { status: 500 });
  }

  // Fire-and-forget: write conversation pair to learner memory
  writeConversationMemory({
    userId: user.id,
    userMessage: lastUserMessage.content,
    assistantMessage: reply,
  }).catch(() => {});

  return NextResponse.json({ reply });
}
