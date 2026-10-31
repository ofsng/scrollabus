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
import { DEFAULT_MODEL, generateDeck } from "./prompt.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;
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
    const { title, cards } = await generateDeck({
      apiKey: KEY,
      model: MODEL,
      categoryName: category.name,
      titles,
      cardTitles,
      onRetry: (msg) => console.warn(`  ${msg}`),
    });
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
