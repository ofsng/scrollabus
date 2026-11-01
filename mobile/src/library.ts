// Reading library: decks bundled with the app plus new ones published to
// content/ on GitHub (written daily by .github/workflows/daily-content.yml).
import bundledIndex from "../../content/index.json";
import type { Category, Deck } from "./store";

const CONTENT_URL = "https://raw.githubusercontent.com/ofsng/scrollabus/main/content";

interface IndexEntry {
  id: string;
  category: string;
  title: string;
  date: string;
  version?: number;
}

interface LibraryIndex {
  categories: Category[];
  decks: IndexEntry[];
}

interface LibraryDeckFile {
  id: string;
  category: string;
  title: string;
  version?: number;
  cards: { title?: string; text: string; action?: string }[];
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
    version: file.version ?? 1,
    // Stable card ids keep saves working when a deck is updated
    cards: file.cards.map((c, i) => ({ id: `${file.id}#${i}`, title: c.title, text: c.text, action: c.action })),
  };
}

export function bundledLibraryDecks(): Deck[] {
  return (bundledIndex as LibraryIndex).decks.flatMap((d) => {
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

// Downloads decks that are new or have a newer version than the copy on the phone
export async function fetchLibraryUpdates(
  needs: (id: string, version: number) => boolean
): Promise<{ categories: Category[]; decks: Deck[] }> {
  const index = await getJson<LibraryIndex>(`${CONTENT_URL}/index.json`);
  const decks: Deck[] = [];
  for (const entry of index.decks.filter((d) => needs(d.id, d.version ?? 1))) {
    try {
      decks.push(toDeck(await getJson<LibraryDeckFile>(`${CONTENT_URL}/decks/${entry.id}.json`), entry.date));
    } catch {
      // Skip a deck that fails to download; it is retried on the next sync
    }
  }
  return { categories: index.categories, decks };
}

// Adds decks never seen before and refreshes outdated library decks in place,
// keeping the user's category choice. Decks the user deleted stay deleted.
// stampArrival: mark added decks as just arrived (downloaded ones); decks that
// ship inside the app keep their publication date so they don't all look new.
export function mergeLibrary(current: Deck[], incoming: Deck[], known: Set<string>, stampArrival = true) {
  const byId = new Map(current.map((d) => [d.id, d]));
  let added = 0;
  let updated = 0;
  const next = current.map((deck) => {
    const fresh = incoming.find((d) => d.id === deck.id);
    if (!fresh || !deck.fromLibrary || (fresh.version ?? 1) <= (deck.version ?? 1)) return deck;
    updated++;
    return { ...fresh, categoryId: deck.categoryId, title: deck.renamed ? deck.title : fresh.title, renamed: deck.renamed };
  });
  // Arrival time orders the library; later entries in the index are newer, so
  // they get a slightly later stamp
  const arrived = Date.now();
  for (const deck of incoming) {
    if (byId.has(deck.id) || known.has(deck.id)) continue;
    next.push(stampArrival ? { ...deck, addedAt: arrived + added } : deck);
    known.add(deck.id);
    added++;
  }
  return { decks: next, added, updated };
}
