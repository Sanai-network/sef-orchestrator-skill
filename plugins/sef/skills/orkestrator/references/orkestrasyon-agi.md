# Orkestrasyon ağı

Şef görevi parçalara böler, her parçayı uygun işçiye verir, sırayı bağımlılıklara göre yönetir, sonuçları toplar ve kullanıcıya tek bir yanıt döner. Ağ, şefin tuttuğu bir tablodur. Kullanıcıya bu tablonun kısa hâli gösterilir.

## 1. İş ağı tablosu

| Kimlik (`name`) | Sınıf | Model / effort | Sahip | Bağlı olduğu | Girdi | Çıktı |
|---|---|---|---|---|---|---|
| `ortam-yerel` | B | haiku / low | dev sunucu, yerel DB | — | proje komutları | çalışan ortam + adresler |
| `o-izin-api-kr` | O! | opus / high | `apps/api/src/izin/**` | `ortam-yerel` | — | API sözleşmesi (devir notu) |
| `o-izin-ekran` | O | sonnet / medium | `apps/web/src/izin/**` | sözleşme (planda sabit) | devir notu | ekran + test |
| `inceleme-izin-api` | inceleme | sonnet / high | salt-okunur | `o-izin-api-kr` | diff | bulgu listesi |

Kurallar:
- **Bağımlılık yalnız gerçek bir ihtiyaçtan doğar:** bir iş ötekinin verisine, sözleşmesine ya da çalışan ortamına muhtaçtır. "Sırayla daha düzenli olur" bağımlılık değildir.
- **Önce sözleşme:** iki parça bir arayüzle bağlıysa (API şeması, bileşen props, tip), şef arayüzü planda sabitler; iki parça da paralel çalışır. Bu, en büyük hız ve token kazancıdır.
- **Paralellik:** bağımlılığı olmayan ve dosya kümeleri ayrık işler aynı anda başlar. Aynı anda en çok ~4–6 yazıcı çalışır (makine ve izleme yükü).
- **Döngü yok:** iki iş birbirini bekliyorsa ya tek işçide birleştir ya da sözleşmeyi sabitle.
- **Worktree'de kod bağımlılığı:** bağımlı işçi öncülün **kodunu** görmez, çünkü öncül commit edilmemiştir. Sözleşme yetiyorsa devir notuyla başlat. Kod gerekiyorsa üç yol var:
  - iki parçayı tek işçiye ver;
  - kullanıcıdan öncül için commit onayı al ve bağımlıyı `source_branch: <öncülün dalı>` ile başlat;
  - öncülü önce birleştirt.

## 2. Akış
1. Tabloyu yaz. Görev listesine (`update_plan`) her iş için bir adım ekle ve adımın `session` alanına işçinin `name`'ini ver. Adım sırası tablonun sırasıdır.
2. Kökleri, yani bağımlılığı olmayan işleri başlat. Ortam gerekiyorsa ortam işçisi ilk başlar.
3. Her iş bitince:
   1. raporu oku;
   2. doğrula (`dogrulama-listesi.md`), gerekirse düzelttir;
   3. devir notunu çıkar;
   4. bağımlılarını hemen başlat;
   5. doğrulanan işçiyi arşivle (SKILL.md §9'daki istisnalar).
4. Bütün işler doğrulanınca birleşik doğrulama yap (kapı komutları bütün değişikliklerle birlikte bir kez), sonra tek bir rapor ver.
5. Commit ve birleştirme kullanıcı onayından sonra bir birleştirme işçisine verilir. Şef birleşik sonucu yeniden doğrular, ardından worktree'li işçileri arşivler.

## 3. Devir notu (öncülden bağımlıya)
Şef, işçi raporunun 6. maddesinden süzerek yazar. Tam rapor ya da transkript taşınmaz; ≤ 15 satırdır.

```
DEVİR: o-izin-api-kr → o-izin-ekran
Sözleşme: GET /api/izin?yil=2026 → {items:[{id, tarih, tur, durum}]}
          POST /api/izin {tarih, tur} → 201 {id}
Hatalar: 409 cakisan_izin, 422 gecersiz_tarih (mesaj alanı Türkçe)
Kaynak: apps/api/src/izin/router.ts (salt-okunur)
Bilinen sınır: sayfalama yok (≤ 200 kayıt)
```

## 4. Sonuçları toplama: tek yanıt
- Kullanıcı işçi raporlarını görmez; şef onları birleştirir. İş başına bir satır yazar. Çelişen iddiaları doğrulamayla çözer, rapora yalnız doğrulanmış sonucu taşır.
- Rapor bölümleri için SKILL.md §9'a bak. Maliyet satırı `scripts/maliyet.mjs`'den gelir.
- Kullanıcı arada durum sorarsa tablonun kısa hâlini ver: iş, durum, sıradaki.

## 5. Görünürlük: Desktop görev listesi ve kenar çubuğu
- **Görev listesi:** her işçi adımında `session: <name>` ver; Desktop adımda işçinin canlı durumunu gösterir. Adım sırası tablonun sırasıdır.
- **Ad ve başlık sınıf öneklidir:** `k-auth-api` ve `[K] Auth API'yi yenile`. Kenar çubuğunda sınıf bir bakışta okunur.
- **Keşif alt ajanı adsız başlatılır** (`Agent`'a `name` verme). Adlı alt ajan kalıcı takım arkadaşı olur; bunu yalnız uzun süren bir yardımcı için yap.
- **Biten işçi arşivlenir.** Kenar çubuğunda ve `list_sessions {linked:true}` çıktısında yalnız aktif ağ kalır. Bilerek açık tutulanları (ortam işçisi, birleştirme onayı bekleyen worktree işçileri) raporda say.
- **Görev listesi ile oturum durumu aynı şeyi göstermeli:** adım "devam ediyor" ise işçi çalışıyor olmalı; adım tamamlandıysa işçi arşivlenmiş ya da gerekçeyle açık tutulmuş olmalı.

## 6. Hata durumları
- **İşçi engel bildirirse** şef karar verir: brif'i düzeltip `SendMessage` ile gönderir, sınıfı yükseltir ya da kullanıcıya sorar.
- **Zaman kutusu aşılırsa** ara raporu al; kalanı ayrı bir parça yap.
- **Öncül başarısız olursa** bağımlılar başlatılmaz. Tablo güncellenir ve kullanıcıya tek cümleyle bildirilir.
- **İki işçi aynı dosyaya dokunduysa** (sahiplik ihlali) bu bir plan hatasıdır: hangisinin değişikliği kalacağına şef karar verir, düzeltmeyi sahibine yaptırır ve dersi hafızaya yazar.
