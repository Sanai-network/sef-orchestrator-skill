# Bağımsız doğrulama listesi

Doğrulama şefin işidir ve işçiden bağımsız yapılır. Neden: işçi kendi işini kendi bağlamında "temiz" görür; aynı komutu sen çalıştırıp sonucu kendi gözünle gördüğünde gerçek ortaya çıkar. Bir turda bir oturum "typecheck temiz" dedi ama testinde tip hatası vardı; başka biri "emülatörde bakmadım" diyerek native sorunları saklı bıraktı.

## 0. Derinlik sınıfa göre

| Sınıf | En az |
|---|---|
| Basit | raporu oku, diff'i gör, hedefli testi çalıştır |
| Orta | + projenin bütün kapı komutları (derleme, tip, lint, test) |
| Karmaşık | + kullanıcıya görünen sonucu gerçek ortamda dene; önce / sonra karşılaştır |
| Kritik (+ herhangi bir sınıf) | + ayrı inceleme işçisi (§2); onun gerçek bulguları kapanmadan iş "bitti" sayılmaz |

Komut çıktısının yalnız özetini ve sonunu oku (`| tail -n 30`, kısa raporlayıcı); bütün çıktıyı bağlama dökme.

## 1. Her işçi bittiğinde
1. **Raporu oku.** Kısalmışsa `node ~/.claude/skills/sef-orkestrator/scripts/son-rapor.mjs --bul "<brif kimliği>"` ile transkriptten tamamını al (worktree işçileri de bulunur).
2. **Kapı komutlarını kendin çalıştır.** İşçinin yazdığı sonucu değil, kendi çıktını esas al. Başka oturumların yarım dosyaları hata verebilir: hatanın kimin dosyasında olduğuna bak.
3. **Değişen yerleri gör.** Worktree'li işçide `git -C <worktree yolu> diff`; git yoksa ilgili dosyaları oku ve anahtar kelime taraması yap (silinmesi gereken adlar, kalması gereken adlar). Kullanılmayan import, ölü kod var mı?
4. **Kapsam dışı değişiklik var mı?** Sahiplik sınırı aşıldı mı, ortak dokümana yazıldı mı?
5. **Kullanıcıya görünen sonucu gör** (karmaşık işte zorunlu): ekran görüntüsü, tarayıcı, emülatör ya da çalıştırıp dene. Ortamı ortam işçisi kurar; şef ona istemci olarak bağlanır (`preview_start` ile yalnız `url`).
6. **İddiayı gerçekle eşle:** "0 hata", "216/216 test" gibi sayıları kendi çıktınla doğrula.
7. **Eksikleri not et:** işçinin doğrulayamadığı şeyleri listeye al; ikinci dalgada işçiye ver, son doğrulamayı sen yap.

## 2. Kritik iş: ayrı inceleme işçisi
Kritik bayraklı her iş için, yazıcı bitince salt-okunur bir inceleme işçisi açılır (Sonnet 5.5, high). İnceleyen, yazanla aynı bağlamı paylaşmaz; körlüğü bu yüzden farklıdır.

```
ROL: İŞÇİ - oturum açma, sef-orkestrator'u uygulama, kendi görevini yap.
BRİF KİMLİĞİ: inceleme-<iş>-<tarih>
SINIF: inceleme · claude-sonnet-5-5 · high · SALT-OKUNUR (hiçbir dosyayı değiştirme)
ORTAK KURALLAR VE RAPOR: ~/.claude/skills/sef-orkestrator/references/isci-kurallari.md dosyasını oku ve uy.
GÖREV: <worktree yolu> içindeki değişikliği incele: `git -C <yol> diff` (git yoksa: <dosya listesi>). Odak: doğruluk, yetki atlatma, veri kaybı, girdi doğrulama, hata yolları, gizli bilgi sızıntısı, geri alınamaz yan etkiler. Gerekirse code-review skill'ini kullan.
BAĞLAM: işin amacı 2–3 cümle; kabul ölçütleri.
BİTTİ: bulgu listesi (dosya:satır, ciddiyet, kanıt, önerilen düzeltme) ya da "bulgu yok" + neye baktığın.
ZAMAN KUTUSU: ~20 dk.
ŞEF: ...
```

Şef, bulguları `gerçek / yanlış pozitif` diye ayırır ve gerçek olanları yazıcıya iletir. Düzeltmeden sonra yalnız ilgili bulguları yeniden kontrol eder; tam inceleme tekrarlanmaz.

## 3. Dalga sonunda: otomatik tarama
- İş büyükse bir **test / tarama aracı** yazdır (ayrı işçi, Orta sınıf, paralel çalışır). İlkeler:
  - Her kuralın bir tanımı ve **gerçekten yakaladığı bir örneği** olsun; kural kendi kendini sınasın (selftest).
  - Yanlış pozitifler **gerekçeli izin listesine** girer. Gerçek hatalar gizlenmez, düzeltilir.
  - Hızlı matris günlük işte, tam matris dalga sonunda, kullanıcı akışları uçtan uca çalışır.
  - Zaman kutusu koy: tam matris saatler sürebilir, hızlı olanı sık çalıştır.
  - Çıktı: özet + ihlal başına kanıt (görüntü yolu). Hata varsa çıkış kodu ≠ 0.
- Bulguları sahiplerine dağıtmadan önce **kendin** bak: gerçek mi, yanlış pozitif mi, yapısal mı?
- Düzeltmelerden sonra **yeniden tara** ve sonucu kendin oku. Kalan uyarıları nedenleriyle raporla.

## 4. En kötü koşulda gerçek ortam
Web ya da simülatör çoğu şeyi kanıtlar, hepsini değil. Son geçişi gerçek ortamda, en zor ayarlarla yap. Ortamı (örn. başsız, salt-okunur emülatör) ortam işçisi açar; şef onu sürer ve gözlemler.
- **Mobil:** en küçük ekran genişliği, büyütülmüş sistem yazı boyutu, koyu + açık tema, boş veri, açık klavye, ücretsiz ve ücretli hesap.
- **Web:** kırılma noktaları, geniş ekran, klavye ile gezinme.
- **API / arka uç:** boş, hatalı ve aşırı büyük girdiler; hata yanıtlarının arayüze yansıması.
- **Web'in kanıtlayamadıkları (mobilde):** yazı ölçekleme davranışı, güvenli alan, dokunma alanı uzatmaları (`hitSlop`), klavye, izinler, gerçek kamera / sensör.
- Gerçek ortamı **atılabilir** biçimde kullan; kullanıcının kendi verisini değiştirme.
- Düzeltmeden sonra, sorunun bulunduğu **aynı ortamda** yeniden doğrula.

## 5. Kanıt standardı
"Yaptım / geçti" yerine **komut + sonuç** yaz: "`npm test` → 218/218 geçti". Görsel iddia için görüntü yolu ver. Bir şeyi görmediysen "baktım" deme; "kodda doğruladım, görsel doğrulamadım" de.

## 6. Rapor ederken
- Doğruladıklarını, doğrulayamadıklarını ve kendi verdiğin kararları ayrı listele (kullanıcı kararlara itiraz edebilir).
- Kalan uyarının neden kalabildiğini bir cümleyle açıkla: "7 sütunlu takvimde hücre 44 dp'ye çıkamıyor; yapısal."
- İşçi raporlarındaki tasarım ve kapsam sapmalarını proje dokümanına tek tek yaz (tek yazar şeftir).
