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
- **Kütüphane:** notlarını gör, aç veya sil.

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
