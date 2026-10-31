// Writes new reading decks with Gemini and adds them to content/index.json.
// Run daily by .github/workflows/daily-content.yml; the mobile app picks the
// new decks up from GitHub on its next launch.
//
//   GEMINI_API_KEY=... node content/generate.mjs
//
// Optional env: GEMINI_MODEL (default gemini-flash-lite-latest),
// DECKS_PER_RUN (default 3), CATEGORY (only that category id).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const PER_RUN = Number(process.env.DECKS_PER_RUN || 3);

if (!KEY) {
  console.error("GEMINI_API_KEY is not set. Add it under Settings → Secrets and variables → Actions.");
  process.exit(1);
}

const slug = (s) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" })[c])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
  });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      const json = await res.json();
      return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    }
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 15_000 * attempt;
      console.warn(`Gemini ${res.status}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
  }
}

function buildPrompt(category, titles) {
  return `Sen kısa, öğretici okuma kartları yazan bir Türkçe içerik editörüsün.
Kategori: ${category.name}

Bu kategoride daha önce yazılmış başlıklar (bunları ve çok benzerlerini TEKRARLAMA):
${titles.length ? titles.map((t) => `- ${t}`).join("\n") : "- (henüz yok)"}

Bu kategoride yeni bir konu seç ve o konu hakkında 5 kartlık bir okuma parçası yaz.
Kurallar:
- Her kart tek başına anlaşılır olsun: bir kavram, iyi bilinen bir araştırma, bir yöntem ya da uygulanabilir bir öneri.
- Her kartın metni 220-400 karakter olsun; sade, akıcı ve doğal bir Türkçe kullan.
- Uydurma istatistik, sahte alıntı ya da emin olmadığın isim/tarih KULLANMA. Bir kişiden, kitaptan ya da araştırmadan bahsedeceksen yalnızca iyi bilinen ve doğru olduğundan emin olduklarını kullan. Tartışmalı bir bilgi varsa bunu belirt.
- Kart başlıkları kısa olsun (en fazla 6 kelime).

Yalnızca şu JSON'u döndür:
{"title": "Okuma parçasının başlığı", "cards": [{"title": "Kart başlığı", "text": "Kart metni"}]}`;
}

function validate(raw) {
  const data = JSON.parse(raw);
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  const cards = (Array.isArray(data?.cards) ? data.cards : [])
    .filter((c) => typeof c?.text === "string" && c.text.trim().length >= 80 && c.text.trim().length <= 700)
    .map((c) => ({ title: typeof c.title === "string" ? c.title.trim() : undefined, text: c.text.trim() }));
  if (!title || cards.length < 3) throw new Error(`Unusable response: ${raw.slice(0, 200)}`);
  return { title, cards: cards.slice(0, 8) };
}

const indexPath = join(DIR, "index.json");
const index = JSON.parse(await readFile(indexPath, "utf8"));

// Grow the categories with the fewest decks first, so the library stays balanced
const counts = new Map(index.categories.map((c) => [c.id, 0]));
for (const d of index.decks) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
const targets = index.categories
  .filter((c) => !process.env.CATEGORY || c.id === process.env.CATEGORY)
  .sort((a, b) => counts.get(a.id) - counts.get(b.id))
  .slice(0, PER_RUN);

const today = new Date().toISOString().slice(0, 10);
const ids = new Set(index.decks.map((d) => d.id));
let created = 0;

for (const category of targets) {
  const titles = index.decks.filter((d) => d.category === category.id).map((d) => d.title);
  try {
    const { title, cards } = validate(await gemini(buildPrompt(category, titles)));
    let id = `${category.id}--${slug(title)}`;
    for (let n = 2; ids.has(id); n++) id = `${category.id}--${slug(title)}-${n}`;
    ids.add(id);

    await writeFile(join(DIR, "decks", `${id}.json`), JSON.stringify({ id, category: category.id, title, cards }, null, 1) + "\n");
    index.decks.push({ id, category: category.id, title, date: today });
    created++;
    console.log(`+ ${category.name}: ${title} (${cards.length} cards)`);
  } catch (err) {
    console.error(`! ${category.name}: ${err.message}`);
  }
}

await writeFile(indexPath, JSON.stringify(index, null, 1) + "\n");
console.log(`Created ${created} deck(s).`);
if (created === 0) process.exit(1);
