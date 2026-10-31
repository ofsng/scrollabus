// Writes new reading decks with Gemini and adds them to content/index.json.
// Run daily by .github/workflows/daily-content.yml; the mobile app picks the
// new decks up from GitHub on its next launch.
//
//   GEMINI_API_KEY=... node content/generate.mjs
//
// Optional env: GEMINI_MODEL (default gemini-flash-latest; there is no time
// limit here, so the slower but better model is worth it),
// DECKS_PER_RUN (default 3), CATEGORY (only that category id).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
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

function buildPrompt(category, titles, cardTitles) {
  return `Sen insanların hayatında gerçekten işe yarayan, kısa okuma kartları yazan bir Türkçe içerik editörüsün.
Okuyucu sosyal medyada kaydırır gibi okuyor; boş, klişe ya da genel geçer cümlelere tahammülü yok.
Kategori: ${category.name}

Bu kategoride daha önce yazılmış başlıklar (bunları ve çok benzerlerini TEKRARLAMA):
${titles.length ? titles.map((t) => `- ${t}`).join("\n") : "- (henüz yok)"}

Bu kategoride daha önce anlatılmış kavramlar (bunları TEKRAR ANLATMA, yeni şeyler öğret):
${cardTitles.length ? cardTitles.join(", ") : "(henüz yok)"}

Bu kategoride yeni ve belirli bir konu seç ve 5 kartlık bir okuma parçası yaz.

Her kart:
- Tek başına anlaşılır, somut bir fikir öğretsin: isimli bir kavram, iyi bilinen bir araştırma, bir yöntem, bir çerçeve ya da gerçek bir örnek.
- Merak uyandıran bir cümleyle başlasın; somut bir örnek, sayı ya da gündelik hayattan bir sahne içersin.
- "text" alanı 220-380 karakter olsun.
- "action" alanında okuyucunun BUGÜN uygulayabileceği tek bir somut adım olsun (en fazla 160 karakter): ne yapacağı, ne zaman ve nasıl açıkça belli olsun. Örnek: "Yarın sabah e-postaya bakmadan önce 25 dakikalık sayaç kur ve en zor işine başla."

Yasaklar:
- "Kendine inan", "pozitif düşün", "hedeflerine odaklan", "önemlidir" gibi içi boş, genel tavsiyeler.
- Uydurma istatistik, sahte alıntı ya da emin olmadığın isim/tarih. Einstein'a atfedilen "bileşik faiz dünyanın sekizinci harikasıdır" gibi kaynağı belirsiz popüler alıntıları kullanma. Bir kişiden, kitaptan ya da araştırmadan bahsedeceksen yalnızca iyi bilinen ve doğru olduğundan emin olduklarını kullan; tartışmalı bilgiyi tartışmalı olarak belirt.

Kart başlıkları kısa olsun (en fazla 6 kelime). Doğal, akıcı bir Türkçe kullan.

Yalnızca şu JSON'u döndür:
{"title": "Okuma parçasının başlığı", "cards": [{"title": "Kart başlığı", "text": "Kart metni", "action": "Bugün uygulanacak adım"}]}`;
}

// Anything outside Latin script (e.g. stray Thai or CJK tokens) means a garbled answer
const FOREIGN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

function validate(raw) {
  const data = JSON.parse(raw);
  if (FOREIGN.test(raw.replace(/\s/g, ""))) throw new Error("Response contains non-Turkish characters");
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  const cards = (Array.isArray(data?.cards) ? data.cards : [])
    .filter(
      (c) =>
        typeof c?.text === "string" &&
        c.text.trim().length >= 80 &&
        c.text.trim().length <= 700 &&
        typeof c?.action === "string" &&
        c.action.trim().length >= 20
    )
    .map((c) => ({
      title: typeof c.title === "string" ? c.title.trim() : undefined,
      text: c.text.trim(),
      action: c.action.trim(),
    }));
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
  const decksInCategory = index.decks.filter((d) => d.category === category.id);
  const titles = decksInCategory.map((d) => d.title);
  const cardTitles = [];
  for (const d of decksInCategory) {
    try {
      const file = JSON.parse(await readFile(join(DIR, "decks", `${d.id}.json`), "utf8"));
      for (const c of file.cards) if (c.title) cardTitles.push(c.title);
    } catch {
      // A missing deck file only weakens de-duplication
    }
  }
  try {
    // One retry for a garbled or incomplete answer
    let deck;
    for (let attempt = 1; !deck; attempt++) {
      try {
        deck = validate(await gemini(buildPrompt(category, titles, cardTitles)));
      } catch (err) {
        if (attempt >= 2) throw err;
        console.warn(`  retrying ${category.name}: ${err.message}`);
      }
    }
    const { title, cards } = deck;
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
