// Everything lives on the phone, in IndexedDB.
import { get, set } from "idb-keyval";
import type { CardDraft } from "./split";

export interface Card extends CardDraft {
  id: string;
  // Concrete "try this today" step on reading cards
  action?: string;
}

export interface Deck {
  id: string;
  title: string;
  createdAt: number;
  cards: Card[];
  categoryId?: string;
  // Reading decks that came with the app or from the online library
  fromLibrary?: boolean;
  // Library content version; a newer one replaces the cards in place
  version?: number;
  // Set when the user renames a deck, so library updates keep their title
  renamed?: boolean;
  // Written on this phone with the user's own Gemini key
  generated?: boolean;
}

export interface Category {
  id: string;
  name: string;
  emoji?: string;
  custom?: boolean;
  // Hidden categories stay in the library but leave the feed
  hidden?: boolean;
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const loadDecks = async () => (await get<Deck[]>("decks")) ?? [];
export const saveDecks = (decks: Deck[]) => set("decks", decks);

// Categories the user created; built-in ones come from the content library
export const loadCustomCategories = async () => (await get<Category[]>("categories")) ?? [];
export const saveCustomCategories = (categories: Category[]) => set("categories", categories);

// Per-category overrides: renamed built-ins, custom emoji, hidden from the feed
export type CategoryPrefs = Record<string, { name?: string; emoji?: string; hidden?: boolean }>;
export const loadCategoryPrefs = async () => (await get<CategoryPrefs>("categoryPrefs")) ?? {};
export const saveCategoryPrefs = (prefs: CategoryPrefs) => set("categoryPrefs", prefs);

// Library deck ids already imported (or deleted), so they are never added twice
export const loadKnownLibrary = async () => new Set((await get<string[]>("knownLibrary")) ?? []);
export const saveKnownLibrary = (ids: Set<string>) => set("knownLibrary", [...ids]);

// Cards the user has read: card id → time read (ms). Read cards leave the feed.
export const loadRead = async () => new Map((await get<[string, number][]>("read")) ?? []);
export const saveRead = (read: Map<string, number>) => set("read", [...read]);

// The user's own Gemini key for on-device generation; never leaves the phone
// except in requests to Google
export const loadGeminiKey = async () => (await get<string>("geminiKey")) ?? "";
export const saveGeminiKey = (key: string) => set("geminiKey", key);

export const loadSaved = async () => new Set((await get<string[]>("saved")) ?? []);
export const saveSaved = (saved: Set<string>) => set("saved", [...saved]);

// Small per-viewer conveniences (last scroll position); losing them is harmless
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
