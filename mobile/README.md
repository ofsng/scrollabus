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
- **Kaydet:** karta çift dokun veya kalbe bas → *Kaydedilenler*.
- **Kütüphane:** notlarını ve okuma parçalarını kategoriye göre gör, aç, kategorisini
  değiştir veya sil. **+ Kategori** ile kendi kategorini ekle.
- Akışın üstündeki kategori şeridinden tek bir kategoriyi kaydırabilirsin.

## Hazır okuma parçaları ve günlük yeni içerik

Uygulama 15 kategoride 30 okuma parçasıyla (150 kart) gelir. Yeni parçalar her sabah
GitHub Actions (`.github/workflows/daily-content.yml`) tarafından Gemini ile yazılır,
`content/` klasörüne eklenir; uygulama açıldığında (veya Kütüphane'deki yenile
butonuna basınca) internetten indirilir. Sunucu gerekmez.

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
