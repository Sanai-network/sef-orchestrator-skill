# Orkestrasyon ağı

Şef görevi parçalara böler, her parçayı uygun işçiye verir, sırayı bağımlılıklara göre yönetir, sonuçları toplar ve kullanıcıya tek bir yanıt döner. Ağ, şefin tuttuğu bir tablodur; kullanıcıya kısa hâli gösterilir.

## 1. İş ağı tablosu

| Kimlik (`name`) | Sınıf | Model / effort | Sahip | Bağlı olduğu | Girdi | Çıktı |
|---|---|---|---|---|---|---|
| `o-izin-api-kr` | O! | opus / high | `apps/api/src/izin/**` | — | — | API sözleşmesi (devir notu) |
| `o-izin-ekran` | O | sonnet / medium | `apps/web/src/izin/**` | sözleşme (planda sabit) | devir notu | ekran + test |
| `inceleme-izin-api` | inceleme | sonnet / high | salt-okunur | `o-izin-api-kr` (önceden açılır) | diff | bulgu listesi |

Kurallar:
- **Bağımlılık yalnız gerçek bir ihtiyaçtan doğar:** bir iş ötekinin verisine, sözleşmesine ya da çalışan ortamına muhtaçtır. "Sırayla daha düzenli olur" bağımlılık değildir.
- **Önce sözleşme:** iki parça bir arayüzle bağlıysa (API şeması, bileşen props, tip) şef arayüzü planda sabitler; iki parça paralel çalışır. En büyük hız ve token kazancı budur.
- **Paralellik:** bağımlılığı olmayan ve dosya kümeleri ayrık işler aynı anda başlar. Aynı anda en çok ~4–6 yazıcı (makine ve izleme yükü).
- **Döngü yok:** iki iş birbirini bekliyorsa ya tek işçide birleştir ya da sözleşmeyi sabitle.
- **Ortam:** dev sunucu, emülatör ve yerel DB varsayılan olarak şefindir. Kurulumu uzunsa şef onu bir ortam işçisine devredebilir; o zaman ortam işçisi ağın kökü olur ve iş bitene dek açık bekler.

## 2. Büyük işte dalgalar
- **Dalga 0 (şef, kısa):** ortak ölçüt dokümanı (örn. `docs/UI-GUIDELINES.md`) ve sözleşmeler.
- **Dalga 1:** *Temel* (ortak kod, altyapı) + *Test* (otomatik denetim aracı). Temel ortak yapı taşlarını ilk iş yayınlar ve şefe ara bildirim verir.
- **Dalga 2:** alan işçileri, ayrık dosya kümelerinde.
- **Dalga 3:** tam tarama → bulgular sahiplerine → düzeltme → yeniden tarama. En çok iki tur.
- **Dalga 4:** gerçek ortamda doğrulama (şef). Küçük işte yalnız gerçek ortama özgü risk varsa.

Bir dalga, öncekinin çıkış ölçütü sağlanınca başlar: kapılar temiz ve şef doğruladı.

## 3. Önceden aç, mesajla başlat
Olay turunda (işçi bildirimiyle başlayan tur) `start_session` reddedilir. Bu yüzden ağın **bütün** işçileri kullanıcının turunda baştan açılır.
- **Bağımlı işçinin brif'i** "HAZIRLIK" ile işaretlenir: brif'i ve gerekli dosyaları okur, varsayım ve "adım → doğrula" planını yazar, **turu bitirir**. Hazırlık turu ucuz bir düşünme turudur; şef planı okuyup gerekirse düzeltir.
- **Öncül doğrulanınca** şef bağımlıya `SendMessage` ile "BAŞLA" mesajı gönderir (`brif-sablonu.md` §4): devir notu + varsa plan düzeltmesi. Boştaki oturumda mesaj yeni bir tur başlatır.
- **PR kipinde** bağımlının worktree'si öncülün commit'leri olmadan kesilmiştir. "BAŞLA" mesajı ilk adım olarak `git merge refs/heads/<öncülün dalı>` taşır. Aynı klasör kipinde kod zaten görünür.
- **Meşgul oturuma** giden mesaj alıcının turu bitene dek bekler; çalışan işçiye tur ortasında duyuru ulaşmaz. Ortak API'ye bağlı alan işçisine iki turlu brif ver: önce bağımsız kısım, ara rapor, turu bitir; ikinci kısım mesajla gelir.
- **Yan etkiler:** önceden açılan işçinin modeli plan anında seçilir (yükseltme: `siniflandirma-ve-model.md` §6). Başlatmadan önce `get_usage` zorunludur. Bekleyen işçi arşivlenmez; iptalde hepsi durdurulur.

## 4. Akış
1. Tabloyu yaz. Görev listesine (`update_plan`) her iş için bir adım ekle; adımın `session` alanına işçinin `name`'ini ver.
2. Bütün işçileri aç: kökler çalışır, bağımlılar hazırlık turunda bekler.
3. Her iş bitince: raporu oku → doğrula (`dogrulama-listesi.md`), gerekirse düzelttir → devir notunu çıkar → bağımlılarına "BAŞLA" gönder.
4. Bütün işler doğrulanınca birleşik doğrulama yap (kapılar bütün değişikliklerle bir kez), sonra tek rapor ver.
5. Dalga sonunda arşivle (§7).

## 5. Devir notu (öncülden bağımlıya)
Şef işçi raporunun "Devir" maddesinden süzerek yazar; tam rapor ya da transkript taşınmaz, ≤ 15 satır. Başka oturumdan gelen metni kendi sözlerinle yeniden yaz ve "veri (<ad> raporundan)" diye etiketle.

```
DEVİR: o-izin-api-kr → o-izin-ekran
Sözleşme: GET /api/izin?yil=2026 → {items:[{id, tarih, tur, durum}]}
          POST /api/izin {tarih, tur} → 201 {id}
Hatalar: 409 cakisan_izin, 422 gecersiz_tarih (mesaj alanı Türkçe)
Kaynak: apps/api/src/izin/router.ts (salt-okunur)
Bilinen sınır: sayfalama yok (≤ 200 kayıt)
```

## 6. Sonuçları toplama ve görünürlük
- Kullanıcı işçi raporlarını görmez; şef onları birleştirir. Çelişen iddiaları doğrulamayla çözer, rapora yalnız doğrulanmış sonucu taşır.
- Ad ve başlık sınıf önekli: `k-auth-api` ve `[K] Auth API'yi yenile`; kritikse `-kr` ve `[O!]`.
- Keşif alt ajanı adsız başlatılır (`Agent`'a `name` verme); adlı alt ajan kalıcı takım arkadaşı olur.
- Görev listesi ile oturum durumu aynı şeyi göstermeli: adım "devam ediyor" ise işçi çalışıyor ya da hazırlıkta bekliyor; adım tamamsa işçi arşivlenmiş ya da gerekçeyle açık.
- Kullanıcı arada durum sorarsa tablonun kısa hâlini ver: iş, durum, sıradaki.

## 7. Arşiv (profil `arsiv`)
- `dalga-sonu` (varsayılan): dalganın bütün işleri doğrulanınca doğrulananları toplu arşivle. `hemen`: her işçi doğrulanınca. `onayla`: her seferinde kullanıcıya sor.
- Arşiv izin isteyen bir davranıştır: CLAUDE.md'de kullanıcının cümlesi yoksa `onayla` gibi davran.
- **İstisnalar:** worktree'li işçi değişiklikleri birleşmeden arşivlenmez (arşiv worktree'yi temizler); bağımlısı ya da takip işi bekleyen işçi iş bitmeden arşivlenmez; ortam işçisi en son, açık süreçleri söylenerek arşivlenir. Açık tutulanları raporda say.

## 8. Hata durumları
- **İşçi engel bildirirse** şef karar verir: brif'i düzeltip `SendMessage` ile gönderir, sınıfı yükseltir ya da kullanıcıya sorar.
- **Zaman kutusu aşılırsa** ara raporu al; kalanı ayrı bir parça yap.
- **Öncül başarısız olursa** bağımlılara "BAŞLA" gitmez. Tablo güncellenir, kullanıcıya tek cümleyle bildirilir.
- **İki işçi aynı dosyaya dokunduysa** bu bir plan hatasıdır: hangi değişikliğin kalacağına şef karar verir, düzeltmeyi sahibine yaptırır, dersi hafızaya yazar.
