import { N8N_WEBHOOKS } from "./constants";
import { generateAndSavePosts, generateAndSaveCommentReply } from "./gemini-content";

interface N8NResponse {
  success: boolean;
  [key: string]: unknown;
}

async function callWebhook(url: string, payload: unknown): Promise<N8NResponse> {
  if (!url) {
    console.warn("[n8n] Webhook URL not configured — skipping");
    return { success: false, error: "not_configured" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n webhook failed (${res.status}): ${text}`);
  }

  const text = await res.text();
  if (!text) return { success: true };

  try {
    return JSON.parse(text);
  } catch {
    return { success: true, raw: text };
  }
}

export async function triggerMaterialToPost(payload: {
  material_id: string;
  raw_text: string;
  title: string;
  enabled_personas?: string[];
  enable_av_output?: boolean;
  priority_personas?: string[];
  emphasis?: string;
}) {
  // No n8n configured → generate text posts directly with Gemini
  if (!N8N_WEBHOOKS.materialToPost) {
    await generateAndSavePosts(payload);
    return { success: true, generator: "gemini" };
  }
  return callWebhook(N8N_WEBHOOKS.materialToPost, payload);
}

export async function triggerCommentReply(payload: {
  comment_id: string;
  post_id: string;
  comment_body: string;
  learner_context?: string;
}) {
  if (!N8N_WEBHOOKS.commentReply) {
    await generateAndSaveCommentReply(payload);
    return { success: true, generator: "gemini" };
  }
  return callWebhook(N8N_WEBHOOKS.commentReply, payload);
}
