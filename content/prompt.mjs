// Shared by the daily GitHub job (content/generate.mjs) and the mobile app's
// on-device generation, so both write reading decks the same way.

export const DEFAULT_MODEL = "gemini-flash-latest";

export function buildDeckPrompt(categoryName, titles, cardTitles) {
  return `Sen insanların hayatında gerçekten işe yarayan, kısa okuma kartları yazan bir Türkçe içerik editörüsün.
Okuyucu sosyal medyada kaydırır gibi okuyor; boş, klişe ya da genel geçer cümlelere tahammülü yok.
Kategori: ${categoryName}

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

export function parseDeck(raw) {
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

export class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function callGemini(apiKey, model, prompt, onRetry, busyRetries) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
    if ((res.status === 429 || res.status >= 500) && attempt <= busyRetries) {
      const wait = 15_000 * attempt;
      onRetry?.(`Gemini ${res.status}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new GeminiError(res.status, `Gemini ${res.status}: ${text.slice(0, 300)}`);
  }
}

// Writes one validated deck; retries once on a garbled or incomplete answer.
// busyRetries: waits (15 s, 30 s, …) on rate limits or overload; the app passes
// 0 so the user gets an answer right away instead of a minute-long spinner.
export async function generateDeck({
  apiKey,
  model = DEFAULT_MODEL,
  categoryName,
  titles = [],
  cardTitles = [],
  onRetry,
  busyRetries = 3,
}) {
  const prompt = buildDeckPrompt(categoryName, titles, cardTitles);
  for (let attempt = 1; ; attempt++) {
    try {
      return parseDeck(await callGemini(apiKey, model, prompt, onRetry, busyRetries));
    } catch (err) {
      if (attempt >= 2 || err instanceof GeminiError) throw err;
      onRetry?.(`retrying ${categoryName}: ${err.message}`);
    }
  }
}
