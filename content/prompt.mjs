// Shared by the daily GitHub job (content/generate.mjs) and the mobile app's
// on-device generation, so both write reading decks the same way.

export const DEFAULT_MODEL = "gemini-flash-latest";

export function buildDeckPrompt(categoryName, titles, cardTitles) {
  return `Sen okurlarına okuma alışkanlığı kazandırmak isteyen, derinlikli ve akıcı yazan bir Türkçe deneme ve popüler bilim yazarısın.
Okurun her gün bir yazı okuyor; amacı gerçekten bir şey öğrenmek ve kültürel birikimini artırmak. Yüzeysel, liste gibi ya da kişisel gelişim kitabı tonunda öğüt veren metinlerden hoşlanmıyor.

Kategori: ${categoryName}

Bu kategoride daha önce yazılmış yazılar (bunları ve çok benzerlerini TEKRARLAMA):
${titles.length ? titles.map((t) => `- ${t}`).join("\n") : "- (henüz yok)"}

Daha önce anlatılmış kavramlar (bunları yeniden anlatma):
${cardTitles.length ? cardTitles.join(", ") : "(henüz yok)"}

Bu kategoride belirli ve ilginç bir konu seç: bir kavramın tarihi, bir düşünürün fikri, önemli bir araştırmanın hikâyesi, bir olayın ya da buluşun arka planı gibi. Sonra onu bir kitap bölümü gibi derinlemesine anlat.

Yapı:
- Konu ne gerektiriyorsa o kadar kart yaz: 5 ile 9 arası, abartmadan.
- Kartlar sırayla okunur ve tek bir bütün oluşturur. İlk kart merak uyandırarak konuya girer; ortadaki kartlar konuyu adım adım derinleştirir (kökeni, kişiler, nasıl işlediği, örnekler, tartışmalar ve eleştiriler); son kart toparlar ve konunun bugünle bağını kurar.
- Her kartın metni 400-650 karakter olsun: bir ya da iki paragraf. Paragrafları boş satırla ayır.
- Kart başlıkları kısa olsun (en fazla 6 kelime), bir kitabın ara başlıkları gibi.

Üslup:
- Akıcı, sıcak ve anlatıcı yaz; somut sahneler, isimler, yerler, tarihler ve örnekler kullan.
- Okura emir verme ve öğüt verme ("şunu yap", "bunu dene", "unutma ki" gibi cümleler kurma).
- "action" alanını neredeyse hiç kullanma. Yalnızca yazının sonunda gerçekten anlamlı, küçük bir deneme önerisi varsa en fazla BİR karta ekle; çoğu yazıda hiç olmasın.

Doğruluk:
- Uydurma istatistik, sahte alıntı ya da emin olmadığın isim/tarih kullanma. Einstein'a atfedilen "bileşik faiz dünyanın sekizinci harikasıdır" gibi kaynağı belirsiz popüler alıntılardan kaçın.
- Yalnızca doğru olduğundan emin olduğun bilgileri kullan; tartışmalı ya da kesin olmayan bilgiyi öyle olduğunu belirterek anlat.

Doğal ve akıcı bir Türkçe kullan. Yalnızca şu JSON'u döndür:
{"title": "Yazının başlığı", "cards": [{"title": "Ara başlık", "text": "Kart metni"}]}`;
}

// Anything outside Latin script (e.g. stray Thai or CJK tokens) means a garbled answer
const FOREIGN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

export function parseDeck(raw) {
  const data = JSON.parse(raw);
  if (FOREIGN.test(raw.replace(/\s/g, ""))) throw new Error("Response contains non-Turkish characters");
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  let actionUsed = false;
  const cards = (Array.isArray(data?.cards) ? data.cards : [])
    .filter((c) => typeof c?.text === "string" && c.text.trim().length >= 150 && c.text.trim().length <= 900)
    .map((c) => {
      // At most one "try this" step per deck; reading, not homework
      const action = !actionUsed && typeof c.action === "string" && c.action.trim().length >= 20 ? c.action.trim() : undefined;
      if (action) actionUsed = true;
      return {
        title: typeof c.title === "string" ? c.title.trim() : undefined,
        text: c.text.trim(),
        ...(action ? { action } : {}),
      };
    });
  if (!title || cards.length < 4) throw new Error(`Unusable response: ${raw.slice(0, 200)}`);
  return { title, cards: cards.slice(0, 10) };
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
