# Bağlam yönetimi (otomatik sıkıştırma eşiği)

Amaç: şef ya da işçinin bağlamı eşiği aşınca sistem kendini yönetsin. Bağlam sıkıştırılır, iş kaldığı yerden devam eder, kuralların ve kararların hiçbiri kaybolmaz, kullanıcının müdahalesi gerekmez.

## 1. Ne, nerede (tek yer)
| Ne | Nerede |
|---|---|
| **Eşik** (harness bu değerde kendiliğinden sıkıştırır) | `~/.claude/settings.json` → `"autoCompactWindow": 600000`. Model başına geçersiz kılma: `modelSettings.<model>.autoCompactWindow`. İzin verilen aralık 100K–1M. |
| Uyarı oranı, döngü penceresi, işçi yenileme sınırı, durum klasörü | `~/.claude/skills/sef-orkestrator/baglam.json` |
| Geçerli değerleri görmek | `node ~/.claude/skills/sef-orkestrator/scripts/baglam.mjs ayar` |
| Durum dosyaları | `~/.claude/sef-durum/<proje>/` (repo dışında; worktree temizliğinden etkilenmez) |
| Günlük (her sıkıştırma ve yenileme) | `~/.claude/sef-durum/gunluk.jsonl` → okumak için `baglam.mjs gunluk` |
| Sıkıştırma sonrası geri yükleme | `settings.json` → `SessionStart` hook'u (matcher `compact`) → `scripts/baglam-hook.mjs` |

Eşik değerini metne, brif'e ya da koda yazma; her zaman `baglam.mjs ayar`'dan oku.

## 2. Teknik gerçekler (2026-10-20, Claude Code 2.1.299)
- **Sıkıştırmayı model tetikleyemez.** `/compact` kullanıcı komutudur. Sıkıştırmayı harness, eşikte kendisi yapar. Bunu iki API çağrısı arasında yapar, yani yarım araç çağrısı ya da yarım dosya yazımı ortasında sıkıştırma olmaz.
- **Ölçüm:**
  - Şef: `get_usage self` (kesin) ya da `baglam.mjs durum --sef`.
  - İşçi, çalışırken: `get_usage <id>`. İşçi boştayken bu değer döndürmez; `baglam.mjs durum --bul <kimlik>` transkriptteki son API çağrısının bağlam boyunu verir.
  - Alt ajan (`Agent`): canlı ölçülemez.
- **İşçinin bağlamı dışarıdan sıkıştırılamaz.** Şef, boştaki kendi işçisini `clear_session` ile sıfırlayabilir. Oturum, adı ve worktree'si kalır.
- **Hook'un davranışı:** `baglam-hook.mjs` yalnız şef ve işçi oturumunda çalışır. Diğer oturumlarda hiçbir şey yazmaz, bağlama hiçbir şey eklemez.
- **Döngü korumaları:** harness'ın kendi koruması, sıkıştırmadan hemen sonra bağlam 3 kez arka arkaya dolarsa devreye girer. Bizim korumamız da baglam.json'daki pencerede belirlenen sayıda sıkıştırma görünce uyarır.

## 3. Eşik aşılmadıkça hiçbir şey değişmez
Uyarı seviyesinin altında şefin ve işçinin davranışı aynıdır; tek ek, şefin sessiz ölçümüdür. Şef bir işçi bildirimiyle uyandığında ve yeni bir işçi başlatmadan önce tek bir komut çalıştırır:
```
node ~/.claude/skills/sef-orkestrator/scripts/baglam.mjs durum --sef --bul <aktif işçi kimlikleri>
```
Çıkış kodu 0 ise hiçbir şey yazmaz ve hiçbir şey yapmaz. 10 uyarı, 20 eşik ya da döngü demektir.

## 4. Şef
**Uyarı (≥ eşik × uyarı oranı; 600K için 480K):**
1. Durum dosyasını yaz ya da güncelle (§6 şablonu). İlk kez yazıyorsan yolunu kullanıcıya giden mesajda ayrı bir satır olarak yaz: `ŞEF DURUM DOSYASI: ~/.claude/sef-durum/<proje>/sef-<iş>.md`. Hook şefi ve dosyasını bu satırdan bulur.
2. Kullanıcıya tek satır yaz: "Bağlam 480K'yı geçti; durum kaydedildi, 600K'da otomatik sıkıştırılacak."
3. Bundan sonra her kilometre taşında (işçi bitti, kullanıcı kararı geldi, yeni işçi başladı) durum dosyasını güncelle. Uzun çıktıları bağlama dökme.

**Eşik (harness sıkıştırdı):** hook, durum dosyasını ve kuralları bağlamın başına ekler. Şef şunları yapar:
1. Kullanıcıya tek satır yazar: "Bağlam 600K'yı aştı, sıkıştırıldı, devam ediliyor."
2. Durum dosyasındaki kuralları ve kararları aynen uygular. Bekleyen onayları onaylanmış saymaz.
3. İşçilerin gerçek durumunu `list_sessions {linked:true}` ile doğrular.
4. "Sıradaki adım"dan devam eder.

Durum dosyası yoksa (bağlam bir turda uyarıyı atlayıp eşiği geçtiyse), önce özetten durum dosyasını yazar, sonra devam eder.

## 5. İşçi
- **İş ortasında eşik aşılırsa:** harness işçiyi kendisi sıkıştırır. Hook işçinin orijinal brif'ini ve (varsa) durum dosyasını bağlama geri koyar. İşçi tamamlanan adımları git ve durum dosyasıyla kontrol eder, tekrar yapmaz, kaldığı yerden devam eder. Şef bunu günlükten görür (`baglam.mjs gunluk`) ve kullanıcıya tek satır yazar: "<işçi> işçisinin bağlamı sıkıştırıldı, devam ediyor."
- **Boşta ve ≥ uyarı, iş bitmemişse: yenileme.** Güvenli nokta işçinin boşta olmasıdır: çalışan tur, kuyruktaki mesaj, yarım komut yoktur. Adımlar:
  1. Şef işçiye `SendMessage` gönderir (`notify_when_idle: true`): "Bağlam yenilemesi: işi güvenli bir noktada bırak (yarım dosya ya da komut kalmasın). İŞÇİ DURUM DOSYASI'nı güncelle: tamamlanan adımlar (kanıtla), kalan adımlar, dokunduğun dosyalar, verdiğin kararlar. Sonra yalnız 'YENİLEMEYE HAZIR' yaz ve dur."
  2. İşçi boşa düşünce şef kontrol eder: durum dosyası güncellenmiş mi, son mesajda "YENİLEMEYE HAZIR" var mı? Worktree'de `git -C <yol> status` ile beklenmeyen yarım iş var mı? Eksik varsa 1. adımı bir kez daha ister.
  3. Şef `clear_session <işçi>` ile bağlamı sıfırlar. Oturum açık ekranda ya da kuyruğunda mesaj varsa araç reddeder; o zaman bekler.
  4. Şef işçiye şunu gönderir: orijinal brif (`node baglam.mjs brif --bul <kimlik>`) + "DEVAM: önce İŞÇİ DURUM DOSYASI'nı oku; tamamlananları tekrar yapma (git diff ile doğrula); kalan adımlardan devam et."
  5. Şef `node baglam.mjs kaydet --olay yenileme --oturum <ad> --bag <token> --neden "uyarı seviyesi, iş sürüyor"` ile günlüğe yazar ve kullanıcıya tek satır bilgi verir.
- **Yenileme sınırı:** aynı iş için en çok `isciYenilemeSiniri` yenileme yapılır. Aşılırsa iş fazla büyüktür: şef işçiyi durdurmaz, yeni yenileme yapmaz, kullanıcıya bölme önerisiyle sorar.
- **Alt ajan:** sıkıştırılamaz, sıfırlanamaz. Uzun keşfi parçalara böl; sonucu özet olarak alırsın.

## 6. Durum dosyası şablonu (şef)
```
# Şef durumu: <proje> / <iş>
Son güncelleme: <tarih saat> · bağlam: <token>

## Hedef
<kullanıcının isteği, bitti tanımı>

## Değişmez kurallar ve kullanıcı kararları (kısaltma, özetleme; kelimesi kelimesine)
- Commit / push / deploy yalnız kullanıcının açık onayıyla.
- <kullanıcı kararı> (tarih)

## Bekleyen onaylar
- <ne bekleniyor, ne zaman soruldu>  (sıkıştırma sonrası onaylanmış sayma)

## İşçiler
| ad | sınıf / model | durum | brif kimliği | durum dosyası | not |

## Tamamlanan adımlar (kanıtla)
## Açık işler / sıradaki adım
## Kritik dosya yolları
```
İşçi durum dosyası daha kısadır: tamamlanan adımlar (kanıtla), kalan adımlar, dokunulan dosyalar, verilen kararlar, açık sorular.

## 7. Döngü ve maliyet koruması
- Hook, baglam.json'daki pencerede (`donguPencereDakika`) en az `donguSikistirmaSayisi` sıkıştırma görürse bağlama DÖNGÜ uyarısı ekler ve günlüğe `dongu` yazar.
  - **Şef** yeni iş başlatmaz ve kullanıcıya bildirip onun kararını bekler.
  - **İşçi** durum dosyasını güncelleyip şefe bildirir ve durur.
- `baglam.mjs durum`, sıkıştırmadan sonraki ilk bağlam boyu hâlâ uyarı seviyesindeyse de döngü der ("sıkıştırma etkisiz"). Bu, durum dosyası ya da brif'in fazla büyük olduğunu gösterir; dosyayı kısalt.
- Şef döngü gördüğünde işçiyi yenilemez. Durur ve kullanıcıya tek satırla bildirir.

## 8. Görünürlük
Her olay kullanıcıya tek satırla bildirilir; ayrıntı günlüktedir:
- uyarı: "Bağlam 480K'yı geçti; durum kaydedildi."
- sıkıştırma: "Bağlam 600K'yı aştı, sıkıştırıldı, devam ediliyor."
- işçi yenileme: "<işçi> yenilendi: temiz bağlamla devam ediyor."
- döngü: "Bağlam sıkıştırma döngüsü; durdum, kararını bekliyorum."

Final rapora sıkıştırma ve yenileme sayısını tek satırla ekle.
