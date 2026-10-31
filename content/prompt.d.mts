export interface GeneratedDeck {
  title: string;
  cards: { title?: string; text: string; action: string }[];
}

export const DEFAULT_MODEL: string;
export function buildDeckPrompt(categoryName: string, titles: string[], cardTitles: string[]): string;
export function parseDeck(raw: string): GeneratedDeck;
export class GeminiError extends Error {
  status: number;
  constructor(status: number, message: string);
}
export function generateDeck(options: {
  apiKey: string;
  model?: string;
  categoryName: string;
  titles?: string[];
  cardTitles?: string[];
  onRetry?: (message: string) => void;
  busyRetries?: number;
}): Promise<GeneratedDeck>;
