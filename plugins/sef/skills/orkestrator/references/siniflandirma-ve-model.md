# Sınıflandırma ve model yönlendirme

Neden: 1M token başına çıktı fiyatı Haiku 5.5'te $0.50, Sonnet 5.5'te $10, Opus 5.5'te $20 (girdi $0.10 / $2 / $4). Bir işi gereğinden güçlü modele vermek 20–40 kat pahalıdır. Gereğinden zayıf modele vermek de tekrar turu ve doğrulama yükü getirir. Hedef, iş başına toplam maliyeti (tekrarlar dahil) en düşük tutmak.

## 1. Ağırlık ölçütleri
Her satırda eşleşen sütunu bul; **en yüksek** sütun kazanır.

| | Basit | Orta | Karmaşık |
|---|---|---|---|
| Kapsam | 1–2 dosya | 3–8 dosya ya da tek alan (ekran, modül, uç nokta grubu) | birden çok alan; ortak kod + tüketicileri |
| Karar | yok; ne ve nasıl tam belli | birkaç yerel karar (bileşen yapısı, ad, küçük API) | tasarım / mimari kararı, birden çok makul yol |
| Belirsizlik | kalıbı kodda var, uyarlanır | gereksinim net, uygulama yolu açık | gereksinim ya da kök neden belirsiz, araştırma gerekir |
| Hata ayıklama | yok ya da hatanın yeri belli | yeniden üretilebilir, yeri tahmin edilebilir | aralıklı, çok katmanlı, yeri bilinmiyor |
| Test | mevcut testi güncelle | yeni birim testleri | yeni test altyapısı, uçtan uca senaryolar |

Örnekler:
- **Basit:** metin / renk / ikon değişikliği, bir alanı kaldırmak, lint düzeltmesi, tek fonksiyona parametre eklemek.
- **Orta:** bir ekranı toparlamak, bir uç nokta ve testi, bir bileşeni ayırmak.
- **Karmaşık:** durum yönetimini değiştirmek, yeni modül, performans darboğazı, çok ekranlı akış, yarış koşulu.

**Keşif** (kod değiştirmeyen arama, envanter, özet; örn. "X nerede kullanılıyor"): oturum açılmaz. Haiku `Explore` alt ajanına verilir (`Agent`, `model: "haiku"`, `name` verilmez) ve sonuç özet olarak döner.

## 2. Kritik bayrağı (bir eşleşme yeter)
- kimlik doğrulama, yetki, oturum / token, rol ve sahiplik kontrolleri
- ödeme, faturalama, para ve kota hesapları
- veri silme, migration, şema değişikliği, toplu güncelleme, yedek / geri yükleme
- canlı ortam, dağıtım ayarları, ortam değişkenleri, gizli bilgiler
- güvenlik yüzeyi: girdi doğrulama, dosya yükleme, dış istek, şifreleme, CORS / CSP
- kullanıcıya açık ve geri alınamaz eylemler (e-posta / bildirim gönderimi, yayın)
- yasal ya da gizlilik etkisi olan değişiklik (KVKK metni, sözleşme, veri saklama)

Bayrağın etkisi:
- Model bir basamak yukarı çıkar.
- Ayrı **inceleme işçisi** açılır (`dogrulama-listesi.md` §2).
- Doğrulama listesinin "kritik" satırı uygulanır.
- Final raporda iş ayrıca işaretlenir.

## 3. Yönlendirme tablosu

| Sınıf | `model` | `effort` | Brif | Zaman kutusu |
|---|---|---|---|---|
| Keşif | `Agent` + `model: "haiku"`, `subagent_type: "Explore"` | — | birkaç satır | kısa |
| Basit | `claude-haiku-5-5` | medium | ~15 satır | ~20 dk |
| Basit + kritik | `claude-sonnet-5-5` | medium | ~20 satır | ~30 dk |
| Orta | `claude-sonnet-5-5` | medium | ~35 satır | ~45 dk |
| Orta + kritik | `claude-opus-5-5` | high | ~40 satır | ~45 dk |
| Karmaşık (± kritik) | `claude-opus-5-5` | high | tam şablon (≤ ~80 satır) | ~60 dk |
| İnceleme (kritik iş) | `claude-sonnet-5-5` | high | şablon (`dogrulama-listesi.md`) | ~20 dk |
| Ortam işçisi | `claude-haiku-5-5` | low | komutlar belli | ~15 dk |
| Ortam işçisi (ilk kurulum / hata ayıklama) | `claude-sonnet-5-5` | medium | | ~30 dk |
| Birleştirme (onaydan sonra) | `claude-haiku-5-5` | medium; çakışma varsa Sonnet | | ~15 dk |

Kısıtlar:
- `start_session` şeften üstün modeli ve şefin effort'undan yüksek effort'u kabul etmez.
- Şef Opus 5.5'teyken işçiye Fable verilemez. Opus iki kez başarısız olursa Fable'lı bir oturum öner; bu bir para kararıdır, kullanıcıya sor.
- Opus işçide `model`'i boş bırakmak (şeften miras) ile `claude-opus-5-5` vermek aynı sonucu verir.

## 4. Karar adımları (her parça için)
1. Kod değişiyor mu? Hayır → Keşif.
2. Ağırlık tablosunda en yüksek eşleşen sütunu bul.
3. Kritik listesinde eşleşme var mı? Varsa bir basamak yukarı çık ve inceleme ekle.
4. Emin değilsen bir üst sınıfı seç: alta düşmek tekrar turu demektir. Ama "her ihtimale karşı Opus" yok.
5. Plan tablosuna tek satır yaz: `o-izin-api | O! | opus/high | gerekçe: izin onayında yetki kontrolü`.

## 5. Haiku'nun sınırı
Haiku'ya yalnız kalıbı belli ve kabul ölçütü bir komutla doğrulanabilen iş ver. Tasarım yargısı, görsel incelik, çok adımlı hata ayıklama ve belirsiz gereksinim Sonnet'e gider.

## 6. Yükseltme ve düşürme
- **Yükselt:** işçi model yetisinden kaynaklanan bir engel bildirirse (yanlış anlama, döngü, aynı hatayı tekrarlama) ya da şefin doğrulaması aynı bulguda iki kez başarısız olursa. Bir üst modelle yeni oturum aç. Eski işçiden ≤ 15 satırlık devir notu al: ne denedi, nerede kaldı, ne kaldı. Kısmi değişiklik değerliyse eski işçi `git diff`'i bir yama dosyasına yazar ve yeni brif bu yolu verir; değilse yeni işçi temiz başlar. Sonra eskisini arşivle (worktree kuralına uy).
- **Erken yükselt:** Haiku ilk ara raporda açıkça zorlanıyorsa zaman kutusunu bekleme.
- **Düşür:** aynı türden işler bir sınıfta birkaç kez tek turda temiz geçtiyse, benzerlerini bir alt sınıfa vermeyi dene ve raporda belirt. Kritik iş hiç düşürülmez.
