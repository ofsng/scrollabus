// Writes the daily reading with Gemini and adds it to content/index.json.
// Run by .github/workflows/daily-content.yml the evening before; the app
// downloads it and shows it from its date on (the 07:30 reminder opens it).
//
//   GEMINI_API_KEY=... node content/generate.mjs
//
// Optional env: GEMINI_MODEL (default gemini-flash-latest; there is no time
// limit here, so the slower but better model is worth it),
// DECKS_PER_RUN (default 1: one reading a day), CATEGORY (only that category id),
// FORCE=1 (write even if the day already has its reading).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL, generateDeck, reviewDeck } from "./prompt.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const PER_RUN = Number(process.env.DECKS_PER_RUN || 1);

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

// The reading belongs to the day of the next 07:30 reminder in Turkey (UTC+3),
// so a run in the evening prepares tomorrow's reading
const turkeyNow = new Date(Date.now() + 3 * 60 * 60 * 1000);
if (turkeyNow.getUTCHours() * 60 + turkeyNow.getUTCMinutes() >= 7 * 60 + 30) turkeyNow.setUTCDate(turkeyNow.getUTCDate() + 1);
const forDate = turkeyNow.toISOString().slice(0, 10);

// Several runs a day guard against GitHub's delayed schedules; only the first writes
if (!process.env.FORCE && index.decks.some((d) => d.daily && d.date === forDate)) {
  console.log(`The reading for ${forDate} already exists; nothing to do.`);
  process.exit(0);
}

// Take turns: the category that has waited longest for a new reading goes next
// (index.decks is in publication order, so a later position means more recent)
const lastWritten = new Map(index.categories.map((c) => [c.id, -1]));
index.decks.forEach((d, i) => lastWritten.set(d.category, i));
const targets = index.categories
  .filter((c) => !process.env.CATEGORY || c.id === process.env.CATEGORY)
  .sort((a, b) => lastWritten.get(a.id) - lastWritten.get(b.id))
  .slice(0, PER_RUN);

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
    const onRetry = (msg) => console.warn(`  ${msg}`);
    const draft = await generateDeck({ apiKey: KEY, model: MODEL, categoryName: category.name, titles, cardTitles, onRetry });
    const { title, cards } = await reviewDeck({ apiKey: KEY, model: MODEL, deck: draft, onRetry });
    let id = `${category.id}--${slug(title)}`;
    for (let n = 2; ids.has(id); n++) id = `${category.id}--${slug(title)}-${n}`;
    ids.add(id);

    await writeFile(join(DIR, "decks", `${id}.json`), JSON.stringify({ id, category: category.id, title, cards }, null, 1) + "\n");
    index.decks.push({ id, category: category.id, title, date: forDate, daily: true });
    created++;
    console.log(`+ ${forDate} ${category.name}: ${title} (${cards.length} cards)`);
  } catch (err) {
    console.error(`! ${category.name}: ${err.message}`);
  }
}

await writeFile(indexPath, JSON.stringify(index, null, 1) + "\n");
console.log(`Created ${created} deck(s).`);
if (created === 0) process.exit(1);
