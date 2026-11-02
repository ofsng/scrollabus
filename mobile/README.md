# Scrollabus Mobil (APK)

Notlarını kart kart kaydırdığın, tamamen telefonda çalışan sade uygulama.
Sunucu, giriş, yapay zekâ ya da API anahtarı yok; her şey telefonda saklanır.

## Telefona kurma

1. Telefonda şu bağlantıyı aç ve `Scrollabus.apk` dosyasını indir:
   `https://github.com/ofsng/scrollabus/releases/latest/download/Scrollabus.apk`
2. İndirilen dosyayı aç. Android "bilinmeyen kaynaklardan yükleme" izni isterse
   tarayıcına (Chrome vb.) izin ver ve **Yükle**'ye bas.
3. Yeni sürümler de aynı bağlantıdan indirilir ve eski sürümün **üzerine** kurulur;
   notların silinmez.

## Kullanım

- **Ekle:** metin yapıştır veya PDF/TXT seç → otomatik olarak kartlara bölünür.
- **Akış:** kartları yukarı kaydır. Üstte *Karışık* tüm notlarını karıştırır
  (tekrar basınca yeniden karıştırır), not adına basınca sadece o not gelir.
  Kaldığın yeri hatırlar.
- **Kaydır:** kartı **sağa** kaydır → kaydet (*Kaydedilenler*), **sola** kaydır → akışı
  karıştır. Kaydedilenler'de sola kaydırmak kartı çıkarır.
- **Kütüphane:** notlarını ve okuma parçalarını kategoriye göre gör, aç, kategorisini
  değiştir veya sil. **+ Kategori** ile kendi kategorini ekle.
- Akışın üstündeki kategori şeridinden tek bir kategoriyi kaydırabilirsin.
- **Okundu takibi:** bir kart ~2,5 saniye ekranda kalınca okundu sayılır ve akışa bir daha
  gelmez (kütüphaneden açtığın bir notta tüm kartlar görünür). **Geçmiş** sekmesinde
  okuduklarını gün gün görür, kaydedebilir ya da "okunmadı" yapabilirsin.
- **Hatırlatıcı:** her gün 07:30'da okunmamış bir yazıyı öneren bildirim gelir (telefonun
  kendisi planlar, sunucu yok). Saat ve aç/kapa: Kütüphane → 🔔.
- **Kendi kategorilerine içerik:** Kütüphane → Kategoriler'e Gemini anahtarını girersen
  uygulama kendi kategorilerine her gün (açılışta) otomatik bir okuma yazar; ✨ ile istediğin
  kategoriye hemen yazdırabilirsin. Anahtar yalnızca telefonda saklanır.

## Hazır okuma parçaları ve günlük yeni içerik

Her gün mevcut kategorilerden sıradakine makale tarzında yeni bir yazı eklenir.
GitHub Actions (`.github/workflows/daily-content.yml`) yazıyı bir önceki akşam Gemini
ile yazar, ikinci bir turda doğruluk ve dolgu kontrolünden geçirir ve `content/`
klasörüne ekler. Uygulama yazıyı indirir, kendi gününe kadar gizler; 07:30
bildirimine dokununca o günün yazısı açılır. Sunucu gerekmez.

Kurulum (bir kez): GitHub'da repo → **Settings → Secrets and variables → Actions →
New repository secret** → Name: `GEMINI_API_KEY`, Secret: Gemini anahtarın.
Elle denemek için: **Actions → Daily content → Run workflow** (kaç parça ve hangi
kategori olacağını seçebilirsin).

Not: Taranmış (fotoğraf) PDF'lerde metin olmadığı için kart çıkmaz.

## Geliştirme

```bash
cd mobile
npm install
npm run dev          # tarayıcıda dene
npm run build && npx cap sync android
```

APK, `main` dalına `mobile/` altında bir değişiklik push edildiğinde
GitHub Actions (`.github/workflows/android-apk.yml`) tarafından derlenir ve
"latest" sürümüne eklenir.
