# Ücretsiz Kurulum (Telefon için)

Bu rehberle Scrollabus'u **ücretsiz** olarak internete koyar ve telefonuna uygulama gibi eklersin.
Toplam süre yaklaşık 20–30 dakika. Kredi kartı gerekmez.

Kullanılan ücretsiz hizmetler:

| Hizmet | Ne için | Ücretsiz sınırı |
|---|---|---|
| **Supabase** | Veritabanı + e-postayla giriş | 500 MB veritabanı, 1 GB dosya alanı |
| **Google AI Studio (Gemini)** | Paylaşımları, quiz'leri, yorum yanıtlarını yazan yapay zekâ, PDF okuma | Dakika ve gün başına istek sınırı var (kişisel kullanıma yeter) |
| **Vercel** | Uygulamayı internette yayınlama | Hobby planı, kişisel kullanım için ücretsiz |
| **GitHub** | Kodun durduğu yer (fork'un zaten var) | Ücretsiz |

> **Önemli:** Anahtarları (API key) hiçbir yere, sohbet dahil, yapıştırma.
> Sadece aşağıda söylenen yerlere, yani Vercel ayarlarına gir.

---

## Adım 1 — Supabase projesi oluştur

1. <https://supabase.com> → **Start your project** → GitHub ile giriş yap.
2. **New project** → bir isim ver (ör. `scrollabus`), güçlü bir veritabanı şifresi belirle
   (bir yere not et), bölge olarak sana yakın olanı seç (ör. *Central EU (Frankfurt)*), **Free** plan.
3. Proje hazırlanırken (1–2 dk) bekle.

### 1a — Veritabanı tablolarını kur

1. Sol menüden **SQL Editor** → **New query**.
2. GitHub'daki fork'unda [`supabase/setup.sql`](../supabase/setup.sql) dosyasını aç → **Raw** →
   tümünü kopyala → SQL Editor'a yapıştır → **Run**.
3. "Success" görmelisin. (Sadece bir kez çalıştır.)

### 1b — Anahtarları not al

**Project Settings → API** (veya **Data API / API Keys**) sayfasından üç değeri kopyala:

| Supabase'deki adı | Vercel'e gireceğin isim |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_KEY` |

> `service_role` anahtarı tam yetkilidir; kimseyle paylaşma.

## Adım 2 — Gemini API anahtarı al

1. <https://aistudio.google.com/apikey> → Google hesabınla giriş yap.
2. **Create API key** → anahtarı kopyala. Bu `GEMINI_API_KEY` olacak.
3. Projene faturalandırma (billing) **ekleme**; eklemezsen ücretsiz katmanda kalırsın ve
   sınır dolduğunda sadece hata alırsın, para çekilmez.

## Adım 3 — Vercel'de yayınla

1. <https://vercel.com/signup> → **Hobby** → GitHub ile giriş yap.
2. **Add New… → Project** → `ofsng/scrollabus` reposunu **Import** et.
3. **Environment Variables** bölümüne şu 4 değişkeni ekle:

   ```
   NEXT_PUBLIC_SUPABASE_URL       = (Adım 1b)
   NEXT_PUBLIC_SUPABASE_ANON_KEY  = (Adım 1b)
   SUPABASE_SERVICE_KEY           = (Adım 1b)
   GEMINI_API_KEY                 = (Adım 2)
   ```

4. **Deploy** → bitince sana `https://scrollabus-xxxx.vercel.app` gibi bir adres verir. Bu adresi not al.

## Adım 4 — Supabase'e uygulama adresini tanıt (giriş için şart)

Giriş, e-postana gelen bir bağlantıyla (magic link) yapılır. Bağlantının çalışması için:

1. Supabase → **Authentication → URL Configuration**
   (bulamazsan: `https://supabase.com/dashboard/project/PROJE-KIMLIGIN/auth/url-configuration`).
2. **Site URL**: Vercel'in **Domains** altında verdiği sabit adres, ör. `https://scrollabus-xxxx.vercel.app` → Save.
3. **Redirect URLs** gerekmez; uygulama Site URL'ye dönen giriş bağlantısını kendisi tamamlar.

## Adım 5 — Telefonda kullan

1. Telefonda Vercel adresini aç → e-postanı yaz → gelen bağlantıya **aynı telefondan** tıkla.
2. Ana ekrana ekle:
   - **iPhone (Safari):** Paylaş → *Ana Ekrana Ekle*
   - **Android (Chrome):** ⋮ menü → *Ana ekrana ekle* / *Uygulamayı yükle*
3. **Upload** sekmesinden ders notunu yapıştır veya PDF yükle → 30–60 sn sonra feed dolar.

---

## Ücretsiz modda neler çalışır?

| Özellik | Durum |
|---|---|
| Metin/PDF yükleme, PDF'ten metin çıkarma | ✅ Gemini |
| Karakterlerin yazdığı feed paylaşımları | ✅ Gemini (metin paylaşımları) |
| Quiz'ler ve quiz yardım sohbeti | ✅ Gemini |
| Yorumlara karakterin yanıt vermesi | ✅ Gemini |
| Karakterlere DM | ✅ Gemini |
| Beğen, kaydet, koleksiyonlar, keşfet, topluluk | ✅ |
| Paylaşımı sesli okuma | ✅ Telefonun kendi sesiyle (ElevenLabs gerekmez) |
| Yapay zekâ görselleri, şarkı, video, slayt | ❌ Ücretli hizmetler gerektirir (n8n + Imagen/Kling) |
| Keşfet'te YouTube araması | İsteğe bağlı: ücretsiz `YOUTUBE_API_KEY` eklenebilir |
| Telegram, HydraDB hafıza, Dify | İsteğe bağlı; anahtar yoksa sessizce atlanır |

## Sorun giderme

- **Feed boş kalıyor:** Vercel → projen → **Logs**'ta `[posts]` satırlarına bak.
  `429` / `RESOURCE_EXHAUSTED` görürsen Gemini ücretsiz sınırı dolmuştur. Birkaç dakika bekle
  veya Vercel'e `GEMINI_MODEL = gemini-2.5-flash-lite` ekleyip yeniden deploy et (daha yüksek ücretsiz sınır).
- **Giriş bağlantısı çalışmıyor:** Adım 4'teki adresleri kontrol et. Supabase'in ücretsiz e-posta
  servisi saatte birkaç e-postayla sınırlıdır; art arda çok deneme yapma.
- **Bir değişkeni sonradan değiştirdim:** Vercel → **Deployments** → en üstteki → **Redeploy**.
