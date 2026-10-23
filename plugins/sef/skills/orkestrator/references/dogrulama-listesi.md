# Bağımsız doğrulama listesi

Doğrulama şefin işidir ve işçiden bağımsız yapılır. Neden: işçi kendi işini kendi bağlamında "temiz" görür; aynı komutu sen çalıştırıp sonucu kendi gözünle gördüğünde gerçek ortaya çıkar. Bir turda bir oturum "typecheck temiz" dedi ama testinde tip hatası vardı; başka biri "emülatörde bakmadım" diyerek native sorunları saklı bıraktı. İşçinin kendi doğrulama döngüsü şefinkinin yerine geçmez.

## 0. Derinlik sınıfa göre

| Sınıf | En az |
|---|---|
| Basit | raporu oku, diff'i gör, hedefli testi çalıştır |
| Orta | + projenin bütün A sınıfı kapıları (derleme, tip, lint, test) |
| Karmaşık | + kullanıcıya görünen sonucu gerçek ortamda dene; önce / sonra karşılaştır |
| Kritik (+ herhangi bir sınıf) | + ayrı inceleme işçisi (§2); gerçek bulguları kapanmadan iş "bitti" sayılmaz |
| Hızlı yol (şef yaptı) | kapılar + diff'i baştan oku; davranış değişiyorsa salt-okunur `Agent` ikinci göz |

Komut çıktısının yalnız özetini ve sonunu oku (`| tail -n 30`, kısa raporlayıcı).

## 1. Her işçi bittiğinde
1. **Raporu oku** (§3).
2. **Kapıları kendin, doğru yerde çalıştır** (`<eklenti kökü>/katmanlar/gelistirme/git-akisi.md` → "Kapıları doğru yerde çalıştır"). İşçinin yazdığı sonucu değil kendi çıktını esas al. Başka oturumların yarım dosyaları hata verebilir: hatanın kimin dosyasında olduğuna bak. B sınıfını yalnız sen, C sınıfını yalnız onayla çalıştır.
3. **Değişen yerleri gör** (§4). Silinmesi ve kalması gereken adları tara.
4. **Her satır isteğe bağlanıyor mu?** Değişen her satır isteğe ya da onun doğrulamasına bağlanmalı. Komşu koda "iyileştirme", biçim değişikliği ya da yeni soyutlama varsa sahibine geri gönder.
5. **Yetim kimin?** Kullanılmayan import, değişken, fonksiyon: işçinin değişikliği mi bıraktı, önceden mi vardı? İlki düzeltilir, ikincisi yan iş önerisidir.
6. **Test dosyası değiştiyse** brif bunu gerektiriyor muydu? Gerekçesiz assertion gevşetmesi gerçek bulgudur.
7. **Kapsam dışı değişiklik var mı?** Sahiplik sınırı aşıldı mı, ortak dokümana yazıldı mı, biçimlendirici başka dosyalara dokundu mu?
8. **Kullanıcıya görünen sonucu gör** (karmaşık işte zorunlu): ekran görüntüsü, tarayıcı, emülatör ya da çalıştırıp dene.
9. **İddiayı gerçekle eşle:** "0 hata", "216/216 test" gibi sayıları kendi çıktınla doğrula.
10. **Eksikleri not et:** işçinin doğrulayamadığı şeyleri listeye al; sahibine ver ya da son doğrulamada kapat.

## 2. Kritik iş: ayrı inceleme işçisi
Yazıcı bitince salt-okunur bir inceleme işçisi çalışır (Sonnet, high). Ağın başında önceden açılır, yazıcı doğrulanınca "BAŞLA" alır. İnceleyen yazanla aynı bağlamı paylaşmaz; körlüğü bu yüzden farklıdır.

```
ROL: İŞÇİ - oturum açma, sef:orkestrator'u uygulama, kendi görevini yap.
BRİF KİMLİĞİ: inceleme-<iş>-<tarih>
BAŞLANGIÇ: …
SINIF: inceleme · claude-sonnet-5-5 · high · SALT-OKUNUR (hiçbir dosyayı değiştirme)
KURALLAR: <eklenti kökü>/shared/isci-kurallari.md dosyasını oku ve uy.
GÖREV: <yol> içindeki değişikliği incele: `git -C <yol> diff <taban>` (git yoksa: <dosya listesi>). Odak: doğruluk, yetki atlatma, veri kaybı, girdi doğrulama, hata yolları, gizli bilgi sızıntısı, geri alınamaz yan etkiler.
BAĞLAM: işin amacı 2–3 cümle; kabul ölçütleri.
HAZIRLIK: diff hazır olunca "BAŞLA" gelecek; o zamana kadar yalnız bağlamı oku.
BİTTİ: bulgu listesi (dosya:satır, ciddiyet, kanıt, önerilen düzeltme) ya da "bulgu yok" + neye baktığın.
ZAMAN KUTUSU: ~20 dk.
ŞEF: …
```

Şef bulguları gerçek / yanlış pozitif diye ayırır, gerçekleri yazıcıya iletir. Düzeltmeden sonra yalnız ilgili bulguları yeniden kontrol eder.

## 3. Rapor bulma
1. **İşçinin tur sonu notu** (ilk ~400 karakter) ya da `list_events`.
2. **Kısalmışsa betik:** `node "<eklenti kökü>/scripts/son-rapor.mjs" --bul "<BRİF KİMLİĞİ>"`. Geçerli projede, worktree kardeşlerinde ve proje klasörlerinde arar; eşleşmeyi ilk kullanıcı mesajında aradığı için şefin transkriptini eler. Ek: `--liste`, `--min N`, `--proje <klasör>`. Çıkış kodu 0 bulundu, 1 yok.
3. Transkript klasörü: `~/.claude/projects/<ad>`; ad, cwd'nin harf ve rakam dışı karakterleri `-` yapılmış hâlidir. Worktree işçisi ayrı klasöre düşer (`<proje>--claude-worktrees-<ad>`).

## 4. Kapsam kontrolü
- **Git'li proje:** başlamadan not alınan tabana karşı `git diff <taban> --stat` + `git status --porcelain` (yeni dosyalar). PR kipinde `gh pr diff`. Kullanıcının taban öncesi değişikliklerini işçiye yazma.
- **Git'siz proje:** taban kopyasına karşı `diff -ru --exclude=node_modules <taban> <proje>`.
- Ayrıntı: `<eklenti kökü>/katmanlar/gelistirme/git-akisi.md`.

## 5. Dalga sonunda: otomatik tarama
- İş büyükse bir test / tarama aracı yazdır (ayrı işçi, Orta). İlkeler:
  - her kuralın bir tanımı ve gerçekten yakaladığı bir örneği olsun (selftest);
  - yanlış pozitifler gerekçeli izin listesine girer, gerçek hatalar gizlenmez;
  - hızlı matris günlük işte, tam matris dalga sonunda; zaman kutusu koy;
  - çıktı: özet + ihlal başına kanıt; hata varsa çıkış kodu ≠ 0.
- Bulguları dağıtmadan önce kendin bak: gerçek mi, yanlış pozitif mi, yapısal mı? Düzeltmelerden sonra yeniden tara (en çok iki tur).

## 6. En kötü koşulda gerçek ortam
Web ya da simülatör çoğu şeyi kanıtlar, hepsini değil. Son geçişi gerçek ortamda, en zor ayarlarla yap; ortamı atılabilir biçimde kullan.
- **Mobil:** en küçük ekran, büyütülmüş yazı, koyu + açık tema, boş veri, açık klavye, ücretsiz ve ücretli hesap.
- **Web:** kırılma noktaları, geniş ekran, klavye ile gezinme.
- **API / arka uç:** boş, hatalı ve aşırı büyük girdiler; hata yanıtlarının arayüze yansıması.
- Düzeltmeden sonra sorunun bulunduğu **aynı ortamda** yeniden doğrula.

## 7. Kanıt standardı ve rapor
- "Yaptım / geçti" yerine **komut → sonuç**: "`npm test` → 218/218 geçti". Görsel iddia için görüntü yolu. Görmediysen "kodda doğruladım, görsel doğrulamadım" de.
- Doğruladıklarını, doğrulayamadıklarını ve kendi kararlarını ayrı listele.
- Kalan uyarının neden kalabildiğini bir cümleyle açıkla.
- İşçi raporlarındaki tasarım ve kapsam sapmalarını proje dokümanına yaz (tek yazar şeftir).
