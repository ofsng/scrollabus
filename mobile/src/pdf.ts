// Offline PDF text extraction with pdf.js (legacy build for older Android WebViews).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Line {
  text: string;
  y: number;
}

export async function pdfToText(file: File, onProgress?: (page: number, total: number) => void): Promise<string> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const lines: Line[] = [];
    let text = "";
    let y: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      if (y === null) y = item.transform[5];
      text += item.str;
      if (item.hasEOL) {
        lines.push({ text, y: y ?? 0 });
        text = "";
        y = null;
      }
    }
    if (text) lines.push({ text, y: y ?? 0 });

    // A vertical gap clearly larger than the usual line spacing marks a new paragraph
    const gaps = lines.slice(1).map((l, i) => Math.abs(lines[i].y - l.y)).filter((g) => g > 0);
    const typical = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
    const out: string[] = [];
    lines.forEach((line, i) => {
      if (i > 0 && typical > 0 && Math.abs(lines[i - 1].y - line.y) > typical * 1.6) out.push("");
      out.push(line.text);
    });
    pages.push(out.join("\n"));
    page.cleanup();
  }

  await task.destroy();
  return pages.join("\n\n");
}
