// Turns pasted notes or extracted PDF text into short, scrollable cards.
// Paragraphs are kept intact where possible: short ones are merged, long ones
// are split at sentence boundaries. Heading-like lines become the card title
// for every card in their section.

export interface CardDraft {
  title?: string;
  text: string;
}

const MAX_CHARS = 420;
const MIN_CHARS = 140;

const BULLET = /^\s*([-–•*▪●◦]|\d+[.)])\s+/;

function isHeading(line: string): boolean {
  const t = line.trim();
  return (
    t.length > 0 &&
    t.length <= 70 &&
    t.split(/\s+/).length <= 10 &&
    !BULLET.test(t) &&
    !/[.,;:!?…]$/.test(t) &&
    /\p{L}/u.test(t)
  );
}

const endsSentence = (line: string) => /[.!?…:]["'”’)\]]*$/.test(line.trim());
const startsUpper = (line: string) => /^\s*[\p{Lu}\d]/u.test(line);

type Unit = { kind: "heading"; text: string } | { kind: "para"; text: string };

// Splits raw text into headings and paragraphs, re-joining lines that a PDF
// or a narrow text column wrapped mid-sentence.
function toUnits(raw: string): Unit[] {
  const units: Unit[] = [];
  const blocks = raw
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "")
    .split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    let para = "";
    const flush = () => {
      if (para.trim()) units.push({ kind: "para", text: para.trim() });
      para = "";
    };

    lines.forEach((line, i) => {
      const prev = lines[i - 1];
      const next = lines[i + 1];
      const headingHere =
        isHeading(line) &&
        (lines.length === 1 || ((!prev || endsSentence(prev)) && (!next || startsUpper(next))));

      if (headingHere) {
        flush();
        units.push({ kind: "heading", text: line });
      } else if (BULLET.test(line)) {
        para += (para ? "\n" : "") + line;
      } else if (para.endsWith("-") && /^\p{Ll}/u.test(line)) {
        // Hyphenated word broken across lines
        para = para.slice(0, -1) + line;
      } else if (para && BULLET.test(para.split("\n").pop() ?? "") && !startsUpper(line)) {
        // Continuation of a wrapped bullet
        para += " " + line;
      } else if (para && BULLET.test(para.split("\n").pop() ?? "")) {
        para += "\n" + line;
      } else {
        para += (para ? " " : "") + line;
      }
    });
    flush();
  }
  return units;
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  // Bullet lists split between items, prose between sentences
  const pieces = text.includes("\n")
    ? text.split("\n")
    : text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/gu) ?? [text];

  const out: string[] = [];
  let current = "";
  const sep = text.includes("\n") ? "\n" : " ";
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    if (piece.length > MAX_CHARS) {
      // A single huge sentence: fall back to word boundaries
      if (current) out.push(current);
      current = "";
      let chunk = "";
      for (const word of piece.split(/\s+/)) {
        if ((chunk + " " + word).trim().length > MAX_CHARS && chunk) {
          out.push(chunk);
          chunk = word;
        } else {
          chunk = (chunk + " " + word).trim();
        }
      }
      if (chunk) current = chunk;
      continue;
    }
    if (current && (current + sep + piece).length > MAX_CHARS) {
      out.push(current);
      current = piece;
    } else {
      current = current ? current + sep + piece : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

export function splitIntoCards(raw: string): CardDraft[] {
  const cards: CardDraft[] = [];
  let title: string | undefined;
  let pending: string | null = null;

  const pushPending = () => {
    if (pending) cards.push({ title, text: pending });
    pending = null;
  };

  for (const unit of toUnits(raw)) {
    if (unit.kind === "heading") {
      pushPending();
      title = unit.text;
      continue;
    }
    for (const piece of splitLong(unit.text)) {
      if (pending === null) {
        pending = piece;
      } else if (pending.length < MIN_CHARS && (pending + "\n\n" + piece).length <= MAX_CHARS) {
        pending = pending + "\n\n" + piece;
      } else {
        pushPending();
        pending = piece;
      }
    }
  }
  pushPending();

  // A section that was only a heading still deserves a card
  return cards.length > 0 || !title ? cards : [{ text: title }];
}
