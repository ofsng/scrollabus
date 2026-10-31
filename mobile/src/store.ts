// Everything lives on the phone, in IndexedDB.
import { get, set } from "idb-keyval";
import type { CardDraft } from "./split";

export interface Card extends CardDraft {
  id: string;
}

export interface Deck {
  id: string;
  title: string;
  createdAt: number;
  cards: Card[];
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const loadDecks = async () => (await get<Deck[]>("decks")) ?? [];
export const saveDecks = (decks: Deck[]) => set("decks", decks);

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
