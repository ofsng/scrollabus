/**
 * Photon iMessage/SMS study companion client.
 *
 * The @photon-ai/imessage-kit SDK requires macOS with Messages.app running.
 * For production, use Photon Spectrum (https://photon.codes/spectrum) which
 * provides a remote edge-network gateway — configure PHOTON_API_KEY.
 *
 * This wrapper gracefully no-ops when the SDK isn't available (e.g. in CI,
 * Linux servers) so the app keeps working.
 */

export interface PhotonMessage {
  phoneNumber: string;
  text: string;
}

/**
 * Send an outbound iMessage/SMS to a student's phone number.
 * Fire-and-forget safe — logs but does not throw on failure.
 */
export async function sendStudyNudge({
  phoneNumber,
  text,
}: PhotonMessage): Promise<boolean> {
  const apiKey = process.env.PHOTON_API_KEY;
  if (!apiKey) {
    console.warn("[photon] PHOTON_API_KEY not configured — skipping send");
    return false;
  }

  try {
    // Try the @photon-ai/imessage-kit SDK first (macOS local mode)
    // Dynamic import so it doesn't crash on non-macOS servers
    // Optional macOS-only dependency; webpackIgnore keeps the build from requiring it
    const pkg = "@photon-ai/imessage-kit";
    const { IMessageSDK } = await import(/* webpackIgnore: true */ pkg);
    const sdk = new IMessageSDK();
    await sdk.send(phoneNumber, text);
    await sdk.close();
    console.log(`[photon] Sent nudge to ${phoneNumber}`);
    return true;
  } catch (sdkErr) {
    // Fall back to Photon Spectrum HTTP gateway (works on any platform)
    try {
      const res = await fetch("https://api.photon.codes/v1/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ to: phoneNumber, text }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[photon] Spectrum API error (${res.status}):`, body);
        return false;
      }
      console.log(`[photon] Sent nudge via Spectrum to ${phoneNumber}`);
      return true;
    } catch (httpErr) {
      console.error("[photon] Both SDK and Spectrum gateway failed:", sdkErr, httpErr);
      return false;
    }
  }
}

/**
 * Parse an inbound Photon webhook payload.
 * Normalizes across iMessage and SMS events.
 */
export interface InboundPhotonMessage {
  phoneNumber: string;
  text: string;
  platform: "imessage" | "sms" | "rcs" | "unknown";
  timestamp: string;
}

export function parsePhotonWebhook(body: unknown): InboundPhotonMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const phoneNumber =
    (b.from as string) ?? (b.sender as string) ?? (b.phone_number as string);
  const text =
    (b.text as string) ?? (b.message as string) ?? (b.body as string);

  if (!phoneNumber || !text) return null;

  return {
    phoneNumber,
    text: text.trim(),
    platform: (b.platform as InboundPhotonMessage["platform"]) ?? "unknown",
    timestamp: (b.timestamp as string) ?? new Date().toISOString(),
  };
}

/**
 * Classify a student's inbound reply into an intent.
 * Used by the webhook handler to route the message to the correct action.
 */
export type StudyIntent =
  | "quiz_me"
  | "explain_simpler"
  | "voice_note"
  | "make_meme"
  | "recap"
  | "general_question";

export function classifyStudyIntent(text: string): StudyIntent {
  const lower = text.toLowerCase().trim();

  if (/\bquiz\b/.test(lower) || lower === "go") return "quiz_me";
  if (/simpler|easier|explain|eli5/.test(lower)) return "explain_simpler";
  if (/voice|audio|sing|song|bard/.test(lower)) return "voice_note";
  if (/meme|funny|comic|doodle/.test(lower)) return "make_meme";
  if (/recap|summary|review|refresh/.test(lower)) return "recap";
  return "general_question";
}
