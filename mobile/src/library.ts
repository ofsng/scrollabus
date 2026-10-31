// Reading library: decks bundled with the app plus new ones published to
// content/ on GitHub (written daily by .github/workflows/daily-content.yml).
import bundledIndex from "../../content/index.json";
import type { Category, Deck } from "./store";

const CONTENT_URL = "https://raw.githubusercontent.com/ofsng/scrollabus/main/content";

interface LibraryIndex {
  categories: Category[];
  decks: { id: string; category: string; title: string; date: string }[];
}

interface LibraryDeckFile {
  id: string;
  category: string;
  title: string;
  cards: { title?: string; text: string }[];
}

const bundledFiles = import.meta.glob<LibraryDeckFile>("../../content/decks/*.json", { eager: true, import: "default" });

export const bundledCategories: Category[] = (bundledIndex as LibraryIndex).categories;

function toDeck(file: LibraryDeckFile, date: string): Deck {
  return {
    id: file.id,
    title: file.title,
    createdAt: Date.parse(date) || Date.now(),
    categoryId: file.category,
    fromLibrary: true,
    // Stable card ids keep saves working across reinstalls of the same deck
    cards: file.cards.map((c, i) => ({ id: `${file.id}#${i}`, title: c.title, text: c.text })),
  };
}

export function bundledDecksNotIn(known: Set<string>): Deck[] {
  return (bundledIndex as LibraryIndex).decks
    .filter((d) => !known.has(d.id))
    .flatMap((d) => {
      const file = bundledFiles[`../../content/decks/${d.id}.json`];
      return file ? [toDeck(file, d.date)] : [];
    });
}

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// Downloads decks published after this app version was built
export async function fetchNewLibraryDecks(known: Set<string>): Promise<{ categories: Category[]; decks: Deck[] }> {
  const index = await getJson<LibraryIndex>(`${CONTENT_URL}/index.json`);
  const missing = index.decks.filter((d) => !known.has(d.id));
  const decks: Deck[] = [];
  for (const entry of missing) {
    try {
      decks.push(toDeck(await getJson<LibraryDeckFile>(`${CONTENT_URL}/decks/${entry.id}.json`), entry.date));
    } catch {
      // Skip a deck that fails to download; it is retried on the next sync
    }
  }
  return { categories: index.categories, decks };
}
