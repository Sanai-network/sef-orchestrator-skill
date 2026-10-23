# Bağlam yönetimi

Amaç: şefin bağlamı pahalılaşınca bunu fark etmek, sıkıştırma olursa hiçbir kuralı ve kararı kaybetmeden devam etmek. Şefin bağlamı oturumların en uzun yaşayanıdır ve her turda yeniden okunur; maliyetin büyük kısmı buradan gelir.

## 1. Ne, nerede
| Ne | Nerede |
|---|---|
| Uyarı eşiği (mutlak, token) | profil → `baglamUyari` (varsayılan 400000). `node "<eklenti kökü>/scripts/profil.mjs"` ile gör. |
| Sıkıştırma eşiği | Harness'ın kendi ayarı (`autoCompactWindow`, `/autocompact`). Eklenti bu global ayara **dokunmaz**; kişisel tercihtir. |
| Ölçüm | `node "<eklenti kökü>/scripts/baglam.mjs" durum --sef` (şef); `--bul <brif kimliği>` ile işçi. Çalışan oturum için `get_usage {session_id}` da olur. |
| Durum dosyaları | `~/.claude/sef/durum/<proje>/` (repo dışında; worktree temizliğinden ve eklenti güncellemesinden etkilenmez) |
| Sıkıştırma sonrası geri yükleme | Eklentinin oturum hook'u (SessionStart, `compact`); yalnız şef ve işçi oturumlarında |

## 2. Teknik gerçekler
- **Sıkıştırmayı model tetikleyemez.** `/compact` kullanıcı komutudur; harness kendi eşiğinde, iki API çağrısı arasında sıkıştırır.
- **İşçinin bağlamı dışarıdan sıkıştırılamaz.** Uzun işçiye çare iş bölmektir (`token-yonetimi.md` §4).
- **Alt ajan** (`Agent`) canlı ölçülemez; uzun keşfi parçalara böl.
- Hızlı yol kararı da aynı ölçümü kullanır: şefin bağlamı `baglamUyari`'nın altında değilse hızlı yol yok.

## 3. Uyarının altında hiçbir şey değişmez
Şef bir işçi bildirimiyle uyandığında ve yeni bir işçi başlatmadan önce tek bir sessiz ölçüm yapar. Uyarının altındaysa hiçbir şey yazmaz.

## 4. Şef: uyarı (≥ `baglamUyari`)
1. Durum dosyasını yaz ya da güncelle (§6). İlk kez yazıyorsan yolunu kullanıcıya giden mesajda ayrı bir satır olarak yaz: `ŞEF DURUM DOSYASI: ~/.claude/sef/durum/<proje>/sef-<iş>.md`. Oturum hook'u şefin dosyasını bu satırdan bulur.
2. Kullanıcıya tek satır: "Bağlam <N>K'yı geçti, pahalılaştı; durum kaydedildi. İstersen temiz bir şef oturumuna devredebilirim."
3. Bundan sonra her kilometre taşında (işçi bitti, kullanıcı kararı geldi, yeni işçi başladı) durum dosyasını güncelle. Uzun çıktıyı bağlama dökme.

**Temiz şef oturumuna devir** (kullanıcı kabul ederse): en iyi zaman dalga sonudur, çünkü işçilerin tur sonu notları onları açan şefe gelir. Durum dosyasını son hâline getir; kullanıcıya yeni oturumda `/sef:orkestrator` yazıp "durum dosyasından devam et: <yol>" demesini söyle. Yeni şef dosyayı okur, işçileri `list_sessions` ile doğrular, sıradaki adımdan sürer. Eski şef yeni iş başlatmaz.

## 5. Sıkıştırma olduysa
- **Şef:** hook durum dosyasını ve kuralları bağlamın başına ekler. Kullanıcıya tek satır yaz ("Bağlam sıkıştırıldı, devam ediliyor"). Durum dosyasındaki kuralları ve kararları aynen uygula; bekleyen onayları onaylanmış sayma. İşçilerin gerçek durumunu `list_sessions {linked:true}` ile doğrula. Sıradaki adımdan devam et. Durum dosyası yoksa önce özetten yaz.
- **İşçi:** hook orijinal brif'i ve (varsa) `İŞÇİ DURUM DOSYASI`'nı geri koyar. İşçi tamamlanan adımları git ve durum dosyasıyla kontrol eder, tekrar yapmaz.
- **Döngü:** sıkıştırmadan kısa süre sonra bağlam yine doluyorsa ya da hook "döngü" diyorsa yeni iş başlatma; kullanıcıya bildir ve kararını bekle. Genellikle durum dosyası ya da brif fazla büyüktür; kısalt.

## 6. Durum dosyası şablonu (şef)
```
# Şef durumu: <proje> / <iş>
Son güncelleme: <tarih saat> · bağlam: <token>

## Hedef
<kullanıcının isteği, bitti tanımı>

## Değişmez kurallar ve kullanıcı kararları (kelimesi kelimesine)
- <kullanıcı kararı> (tarih)

## Bekleyen onaylar (sıkıştırma ya da devir sonrası onaylanmış sayma)
- <ne bekleniyor, ne zaman soruldu>

## İşçiler
| ad | sınıf / model | durum | brif kimliği | not |

## Tamamlanan adımlar (kanıtla)
## Açık işler / sıradaki adım
## Kritik dosya yolları
```
İşçi durum dosyası daha kısadır: tamamlanan adımlar (kanıtla), kalan adımlar, dokunulan dosyalar, verilen kararlar.

## 7. Görünürlük
Her olay kullanıcıya tek satırla bildirilir. Final rapora sıkıştırma ya da devir olduysa tek satır ekle.
