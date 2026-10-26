import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServiceClient } from "@/lib/supabase/service";
import {
  parseTelegramUpdate,
  parseStartCommand,
  classifyStudyIntent,
  sendStudyNudge,
} from "@/lib/telegram";
import {
  recallMemory,
  writeMemory,
  writeConversationMemory,
  formatMemoryContext,
} from "@/lib/hydra";
import { NextRequest, NextResponse } from "next/server";
import { GEMINI_MODEL } from "@/lib/constants";

const SYSTEM_BASE = `You are Scrollabus, an enthusiastic and knowledgeable AI study companion on Telegram.
You help students learn by answering questions, explaining concepts, generating quizzes, and giving recaps.
Be warm, clear, and educational. Use short paragraphs. You can use emoji sparingly for friendliness.
When the student asks about a topic, give a real, substantive answer — don't redirect them to another app.
If the student's question is ambiguous, ask a quick clarifying question.
If you genuinely don't know something, say so honestly.`;

async function geminiChat(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
  });

  const chat = model.startChat({});
  const result = await chat.sendMessage(userMessage);
  return result.response.text();
}

/**
 * POST /api/telegram/webhook
 *
 * Receives updates from Telegram Bot API. The bot answers questions directly
 * using Gemini 2.5 Flash + learner memory context.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const inbound = parseTelegramUpdate(body);

  if (!inbound) {
    return NextResponse.json({ ok: true });
  }

  const { chatId, text, username } = inbound;
  const serviceClient = createServiceClient();

  // ─── /start deep-link account linking ───
  const linkToken = parseStartCommand(text);
  if (linkToken) {
    const { data: profile, error } = await serviceClient
      .from("profiles")
      .select("id, display_name")
      .eq("telegram_link_token", linkToken)
      .single();

    if (error || !profile) {
      await sendStudyNudge({
        chatId,
        text: "Hmm, that link doesn't seem valid. Try generating a new one from your Scrollabus profile.",
      });
      return NextResponse.json({ ok: true });
    }

    await serviceClient
      .from("profiles")
      .update({
        telegram_chat_id: String(chatId),
        telegram_username: username ?? null,
        telegram_enabled: true,
        telegram_link_token: null,
      })
      .eq("id", profile.id);

    const name = profile.display_name || "there";
    await sendStudyNudge({
      chatId,
      text: `Hey ${name}! 🎓 Your Scrollabus study companion is now connected.\n\nYou can message me anytime to:\n• Ask any study question — I'll answer right here\n• Say "quiz me" for a quick quiz on your material\n• Say "recap" for a summary of what you've been studying\n• Say "explain simpler" to break down a tough concept\n\nTry it — ask me something!`,
    });

    return NextResponse.json({ ok: true });
  }

  // ─── Slash commands ───
  if (text === "/start") {
    await sendStudyNudge({
      chatId,
      text: "Welcome to Scrollabus! 📚\n\nTo connect this bot to your account, go to your Scrollabus profile → Study Companion and tap the Telegram link button.",
    });
    return NextResponse.json({ ok: true });
  }

  if (text === "/help") {
    await sendStudyNudge({
      chatId,
      text: `Here's what I can do:\n\n📝 Ask any question — I'll explain it\n🧠 "quiz me" — quick quiz on your recent material\n🔄 "recap" — summary of your study sessions\n💡 "explain simpler" — re-explain in plain language\n📖 "explain [topic]" — deep dive on any topic\n\nOr just chat with me about whatever you're studying!`,
    });
    return NextResponse.json({ ok: true });
  }

  // ─── Regular message: look up user by chat_id ───
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id, display_name, telegram_enabled")
    .eq("telegram_chat_id", String(chatId))
    .single();

  if (profileError || !profile) {
    await sendStudyNudge({
      chatId,
      text: "I don't recognize this chat. Link your account first from your Scrollabus profile → Study Companion.",
    });
    return NextResponse.json({ ok: true });
  }

  if (!profile.telegram_enabled) {
    await sendStudyNudge({
      chatId,
      text: "Your study companion is paused. Turn it back on from your Scrollabus profile.",
    });
    return NextResponse.json({ ok: true });
  }

  const userId = profile.id as string;
  const displayName = (profile.display_name as string) || "there";
  const intent = classifyStudyIntent(text);

  writeMemory({
    userId,
    text: `Student messaged via Telegram: "${text}" (intent: ${intent})`,
    infer: true,
  }).catch(() => {});

  let replyText: string;

  try {
    switch (intent) {
      case "quiz_me": {
        const memories = await recallMemory({
          userId,
          query: "topics studied, material uploaded, recent concepts, weak areas",
          maxResults: 10,
          recencyBias: 0.5,
        });
        const memCtx = formatMemoryContext(memories);

        replyText = await geminiChat(
          `${SYSTEM_BASE}\n\nThe student wants a quiz. Generate exactly ONE multiple-choice question based on their study material and learning history. Format:\n\n[Question text]\n\nA) [option]\nB) [option]\nC) [option]\nD) [option]\n\nAfter the options, add a blank line then write "Reply with A, B, C, or D!" Do NOT reveal the answer yet — wait for them to reply.${memCtx}`,
          memories.length > 0
            ? "Quiz me on something I've been studying!"
            : text,
        );
        break;
      }

      case "explain_simpler": {
        const memories = await recallMemory({
          userId,
          query: "most recent concept studied, last topic reviewed, last question asked",
          maxResults: 8,
          recencyBias: 0.9,
        });
        const memCtx = formatMemoryContext(memories);

        replyText = await geminiChat(
          `${SYSTEM_BASE}\n\nThe student is asking you to explain something more simply. Use an analogy or everyday example. Break it into small pieces. Aim for a "lightbulb moment". If their memory context mentions a recent topic, re-explain that one.${memCtx}`,
          text,
        );
        break;
      }

      case "recap": {
        const memories = await recallMemory({
          userId,
          query: "recent study topics, concepts learned, quiz results, material uploads",
          maxResults: 12,
          recencyBias: 0.6,
        });
        const memCtx = formatMemoryContext(memories);

        replyText = await geminiChat(
          `${SYSTEM_BASE}\n\nGive ${displayName} a study recap. Organize it clearly:\n1. What they've been studying recently\n2. Key concepts covered\n3. Areas that might need more review\n4. A suggested next step\n\nBe specific — reference actual topics from their memory. If there's no memory context, let them know they should upload some study material on Scrollabus first and then come back for a personalized recap.${memCtx}`,
          "Give me a recap of what I've been studying.",
        );
        break;
      }

      case "make_meme": {
        const memories = await recallMemory({
          userId,
          query: "recent topic, concept, subject being studied",
          maxResults: 5,
          recencyBias: 0.7,
        });
        const memCtx = formatMemoryContext(memories);

        replyText = await geminiChat(
          `${SYSTEM_BASE}\n\nThe student wants a funny/meme-style explanation. Channel "Meme Lord" energy — explain the concept using humor, pop culture references, or a funny analogy. Make it memorable AND educational.${memCtx}`,
          text,
        );
        break;
      }

      case "voice_note": {
        const memories = await recallMemory({
          userId,
          query: "recent topic, concept being studied",
          maxResults: 5,
          recencyBias: 0.7,
        });
        const memCtx = formatMemoryContext(memories);

        replyText = await geminiChat(
          `${SYSTEM_BASE}\n\nThe student asked for an audio/song/bard-style explanation. Since we can't send audio here, write the explanation in a fun, lyrical, or storytelling style — as if Study Bard were narrating it. Make the concept stick through rhythm and narrative.${memCtx}`,
          text,
        );
        break;
      }

      default: {
        const memories = await recallMemory({
          userId,
          query: text,
          maxResults: 8,
          recencyBias: 0.3,
        });
        const memCtx = formatMemoryContext(memories);

        replyText = await geminiChat(
          `${SYSTEM_BASE}\n\nAnswer the student's question directly and thoroughly. If the question relates to their study material, weave in what you know from their learning history. Use examples when helpful. If they're asking something conversational (like "how are you"), be friendly and steer back to studying.${memCtx}`,
          text,
        );
      }
    }
  } catch (err) {
    console.error("[telegram/webhook] Gemini error:", err);
    replyText = "Sorry, I hit a snag processing that. Try asking again in a moment!";
  }

  await sendStudyNudge({ chatId, text: replyText });

  writeConversationMemory({
    userId,
    userMessage: text,
    assistantMessage: replyText,
  }).catch(() => {});

  return NextResponse.json({ ok: true, intent });
}
