# Sınıflandırma ve model yönlendirme

Neden: bir işi gereğinden güçlü modele vermek 20–40 kat pahalıdır (fiyatlar: `token-yonetimi.md` §6). Gereğinden zayıf modele vermek de tekrar turu ve doğrulama yükü getirir. Hedef, iş başına toplam maliyeti (tekrarlar dahil) en düşük tutmak.

## 1. Ağırlık ölçütleri
Her satırda eşleşen sütunu bul; **en yüksek** sütun kazanır.

| | Basit | Orta | Karmaşık |
|---|---|---|---|
| Kapsam | 1–2 dosya | 3–8 dosya ya da tek alan (ekran, modül, uç nokta grubu) | birden çok alan; ortak kod + tüketicileri |
| Karar | yok; ne ve nasıl tam belli | birkaç yerel karar (bileşen yapısı, ad, küçük API) | tasarım / mimari kararı, birden çok makul yol |
| Belirsizlik | kalıbı kodda var, uyarlanır | gereksinim net, uygulama yolu açık | gereksinim ya da kök neden belirsiz |
| Hata ayıklama | yok ya da yeri belli | yeniden üretilebilir, yeri tahmin edilebilir | aralıklı, çok katmanlı, yeri bilinmiyor |
| Test | mevcut testi güncelle | yeni birim testleri | yeni test altyapısı, uçtan uca senaryolar |

Örnekler:
- **Basit:** metin / renk / ikon değişikliği, bir alanı kaldırmak, lint düzeltmesi, tek fonksiyona parametre.
- **Orta:** bir ekranı toparlamak, bir uç nokta ve testi, bir bileşeni ayırmak.
- **Karmaşık:** durum yönetimini değiştirmek, yeni modül, performans darboğazı, çok ekranlı akış, yarış koşulu.

**Keşif** (kod değiştirmeyen arama, envanter, özet): oturum açılmaz. Haiku `Explore` alt ajanına verilir (`Agent`, `model: "haiku"`, `name` verilmez); sonuç özet olarak döner.

## 2. Kritik bayrağı (bir eşleşme yeter)
- kimlik doğrulama, yetki, oturum / token, rol ve sahiplik kontrolleri
- ödeme, faturalama, para ve kota hesapları
- veri silme, migration, şema değişikliği, toplu güncelleme, yedek / geri yükleme
- canlı ortam, dağıtım ayarları, ortam değişkenleri, gizli bilgiler
- güvenlik yüzeyi: girdi doğrulama, dosya yükleme, dış istek, şifreleme, CORS / CSP
- kullanıcıya açık ve geri alınamaz eylemler (e-posta / bildirim gönderimi, yayın)
- yasal ya da gizlilik etkisi olan değişiklik (KVKK metni, sözleşme, veri saklama)

Bayrağın etkisi: model bir basamak yukarı çıkar; ayrı **inceleme işçisi** açılır (`dogrulama-listesi.md` §2); brif "önce plan" ister; final raporda iş ayrıca işaretlenir. Bayrak listesi kısa ve somuttur; her şeyi kritik saymak maliyeti patlatır.

## 3. Yönlendirme tablosu

| Sınıf | `model` | `effort` | Brif | Zaman kutusu |
|---|---|---|---|---|
| Keşif | `Agent` + `model: "haiku"`, `subagent_type: "Explore"` | — | birkaç satır | kısa |
| Basit | `claude-haiku-5-5` | medium | ~15 satır | ~20 dk |
| Basit + kritik | `claude-sonnet-5-5` | medium | ~20 satır | ~30 dk |
| Orta | `claude-sonnet-5-5` | medium | ~35 satır | ~45 dk |
| Orta + kritik | `claude-opus-5-5` | high | ~40 satır | ~45 dk |
| Karmaşık (± kritik) | `claude-opus-5-5` | high | tam şablon (≤ ~80 satır) | ~60 dk |
| İnceleme (kritik iş) | `claude-sonnet-5-5` | high | `dogrulama-listesi.md` §2 | ~20 dk |
| Ortam işçisi (şef ortamı devrederse) | `claude-haiku-5-5`; ilk kurulum / hata ayıklamada Sonnet | low / medium | komutlar belli | ~15–30 dk |
| Birleştirme (onaydan sonra) | `claude-sonnet-5-5` (push eder) | medium | | ~15 dk |

Kısıtlar:
- `start_session` şeften üstün modeli ve şefin effort'undan yüksek effort'u kabul etmez. Model ve effort'u açıkça ver; verilmezse işçi şefinkini miras alır.
- Şef Opus'tayken işçiye Fable verilemez. Opus iki kez başarısız olursa Fable'lı bir oturum öner; bu bir para kararıdır, kullanıcıya sor.

## 4. Emniyet kuralları
- **Haiku yalnız** kalıbı belli ve kabul ölçütü bir komutla doğrulanabilen işte. Tasarım yargısı, görsel incelik, çok adımlı hata ayıklama ve belirsiz gereksinim Sonnet'e gider. Haiku işçisinin brif'i ve zaman kutusu kısa kalır: 100K token'ı aşan istem Haiku'da çok daha pahalıdır.
- **PR kipinde push edip PR açan yazıcı en az Sonnet.** Haiku'ya düşen işte ya sınıfı Sonnet'e çıkar ya da Haiku yalnız yazsın, push ve PR'ı Sonnet birleştirme işçisi yapsın.
- **Emin değilsen bir üst sınıf;** alta düşmek tekrar turu demektir. Ama "her ihtimale karşı Opus" yok.
- **İki başarısızlıkta yükselt** (§6).

## 5. Karar adımları (her parça için)
1. Kod değişiyor mu? Hayır → Keşif.
2. Ağırlık tablosunda en yüksek eşleşen sütunu bul.
3. Kritik listesinde eşleşme var mı? Varsa bir basamak yukarı çık ve inceleme ekle.
4. Emniyet kurallarını uygula (§4).
5. Plan tablosuna tek satır yaz: `o-izin-api-kr | O! | opus/high | gerekçe: izin onayında yetki kontrolü`.

## 6. Yükseltme ve düşürme
- **Yükselt:** işçi model yetisinden kaynaklanan bir engel bildirirse (yanlış anlama, döngü, aynı hatayı tekrarlama) ya da şefin doğrulaması aynı bulguda iki kez başarısız olursa. Bir üst modelle yeni oturum aç; eski işçiden ≤ 15 satırlık devir notu al (ne denedi, nerede kaldı, ne kaldı). Kısmi değişiklik değerliyse eski işçi `git diff`'i bir yama dosyasına yazar, yeni brif bu yolu verir. Önceden açılmış bir işçinin modelini `set_session_model` ile yükseltmek mümkün görünüyor ama doğrulanmadı; olmazsa yeni oturum. Olay turunda yeni oturum açılamaz: öneri kartı aç ve kullanıcıya "karta tıkla" de.
- **Erken yükselt:** Haiku ilk ara raporda açıkça zorlanıyorsa zaman kutusunu bekleme.
- **Düşür:** aynı türden işler bir sınıfta birkaç kez tek turda temiz geçtiyse benzerlerini bir alt sınıfa vermeyi dene ve raporda belirt. Kritik iş hiç düşürülmez.
