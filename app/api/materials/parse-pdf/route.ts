import { NextRequest, NextResponse } from "next/server";
import { GEMINI_MODEL } from "@/lib/constants";

const VISION_PROMPT = `Extract ALL content from this PDF for use as study material. This may include typed text, handwritten notes, and visual elements.

Follow these rules exactly:
1. Extract all printed/typed text verbatim, preserving structure and flow.
2. OCR and transcribe any handwritten text, prefixing it with [Handwritten: ...].
3. For each chart, graph, diagram, or figure, write a detailed description capturing key data, trends, axes, and insights — prefix with [Visual: ...].
4. For tables, extract the data in a readable format — prefix with [Table: ...].
5. Do NOT add commentary, summaries, or meta-text. Output only the extracted content.

The output will be used directly as study material for generating personalized learning posts.`;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const smart = formData.get("smart") !== "false";

  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "PDF file required" }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Primary: Gemini vision — handles typed text, handwriting OCR, and image analysis
  if (smart && process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const base64Data = buffer.toString("base64");

      const result = await genai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            parts: [
              { inlineData: { mimeType: "application/pdf", data: base64Data } },
              { text: VISION_PROMPT },
            ],
          },
        ],
      });

      const text = (result.text ?? "").trim();
      return NextResponse.json({ text, pages: null, method: "vision" });
    } catch (err) {
      console.error("[parse-pdf] Gemini vision failed, falling back to pdf-parse:", err);
    }
  }

  // Fallback: basic text extraction (no handwriting OCR or image analysis)
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);

    return NextResponse.json({
      text: result.text.trim(),
      pages: result.numpages,
      method: "text",
    });
  } catch (err) {
    console.error("[parse-pdf]", err);
    return NextResponse.json({ error: "Failed to parse PDF" }, { status: 500 });
  }
}
