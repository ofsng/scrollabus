// On-device reading generation with the user's own Gemini key, using the same
// prompt and validation as the daily GitHub job (content/prompt.mjs).
import { GeminiError, generateDeck } from "../../content/prompt.mjs";
import { newId, type Category, type Deck } from "./store";

export async function writeDeckOnDevice(apiKey: string, category: Category, decks: Deck[]): Promise<Deck> {
  const inCategory = decks.filter((d) => d.categoryId === category.id);
  const result = await generateDeck({
    apiKey,
    categoryName: category.name,
    titles: inCategory.map((d) => d.title),
    // Recent concepts are enough to steer away from repeats and keep the prompt small
    cardTitles: inCategory.flatMap((d) => d.cards.map((c) => c.title ?? "")).filter(Boolean).slice(-150),
    busyRetries: 0,
  });
  const id = `gen-${newId()}`;
  return {
    id,
    title: result.title,
    createdAt: Date.now(),
    addedAt: Date.now(),
    categoryId: category.id,
    generated: true,
    cards: result.cards.map((c, i) => ({ id: `${id}#${i}`, ...c })),
  };
}

export function generationErrorMessage(err: unknown): string {
  if (err instanceof GeminiError) {
    if (err.status === 400 || err.status === 401 || err.status === 403) return "Gemini anahtarı geçersiz görünüyor.";
    if (err.status === 429) return "Gemini'nin ücretsiz kotası doldu, biraz sonra tekrar dene.";
    return "Gemini şu an cevap vermiyor, sonra tekrar dene.";
  }
  if (err instanceof TypeError) return "İnternet bağlantısı yok.";
  return "İçerik üretilemedi, tekrar dene.";
}
