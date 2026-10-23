# Brif şablonları

İşçi şefin bağlamını görmez; görevini yalnız brif'ten öğrenir. Eksik brif tekrar turu, gereğinden uzun brif boşa token demektir. Yazdıktan sonra işçinin yerine geçip oku: "Bunu bilmeden işe başlayabilir miyim?" Ortak kuralları ve rapor biçimini brif'e yazma; kurallar dosyasının yolunu ver.

## 1. Alanlar

**Her brif'te** (bu sırayla):
1. `ROL: İŞÇİ - oturum açma, sef:orkestrator'u uygulama, kendi görevini yap.` Hook'lar rolü bu satırdan tanır; ilk satır olmalı.
2. `BRİF KİMLİĞİ: <kısa-benzersiz-metin>`. `son-rapor.mjs`, `maliyet.mjs` ve `baglam.mjs` işçiyi bununla bulur.
3. `İŞÇİ DURUM DOSYASI: ~/.claude/sef/durum/<proje>/<name>.md`. İşçi bu dosyayı yalnız bağlamı sıkıştırılırsa yazar; oturum hook'u dosyayı bu satırdan bulur.
4. `BAŞLANGIÇ: <date -u çıktısı> (ana adımlarda date -u çalıştır)`. Şef bekçiyi buna göre kurar.
5. `SINIF: <B|O|K>[!] · <model> · <effort>`. İşçi kendi bütçesini bilir.
6. `KURALLAR: <eklenti kökünün mutlak yolu>/shared/isci-kurallari.md dosyasını oku ve uy.` Yolu şef çözer (`cd "${CLAUDE_SKILL_DIR}/../.." && pwd`); sürüm klasörü yolun içindedir. Böylece iş ortasında eklenti güncellense de işçi şefle aynı kuralları okur. Bulut ya da SSH işçisi bu yolu göremez: o zaman kuralları brif'e kısaltarak koy.
7. **GÖREV:** tek paragraf. Ne yapılacak, kullanıcının isteği (varsa kelimesi kelimesine), neden istendiği.
8. **SAHİP / SALT-OKUNUR:** glob'larla.
9. **BİTTİ:** "komut → beklenen sonuç" satırları. Bu alan olmadan brif gönderilmez.
10. **ZAMAN KUTUSU:** "~N dk; uzarsa eldekiyle bitir, ara rapor yaz."
11. **ŞEF:** `local_…` kimliği ve başlığı (`SendMessage` için).

**Orta ve karmaşık işte ek:**
- **BAĞLAM:** projenin `CLAUDE.md`'de olmayan yönü, üst hedef, hafızadaki ek kurallar (3–6 satır), diğer işçiler ve sahiplikleri, ortam adresleri.
- **KARARLAR / KAPSAM DIŞI:** şefin verdiği ürün ve kapsam kararları. İşçi bunları değiştirmez; itirazını raporda yazar.
- **ODAK:** bilinen sorunlar ve yeniden üretme adımları (komut → görülen / beklenen).
- **KAPILAR (A):** çalıştırılacak komutlar, alt paket köküyle (`cd app && npm test`). Yalnız A sınıfı (`katmanlar/gelistirme/kapi-siniflari.md`).
- **GIT:** kipe göre (`katmanlar/gelistirme/git-akisi.md`). Aynı klasör kipinde tek satır: "commit atma, `git add` yapma, dal değiştirme, stash / reset yapma."
- **GİRDİ:** bağımlı işse devir notu.
- **DEVİR:** bağımlı iş varsa "sözleşmeyi raporun Devir maddesine yaz".

**Duruma göre ek satırlar:**
- Karmaşık ve kritik işte: `ÖNCE PLAN: varsayım ve "adım → doğrula" planını yaz, dur; şef "başla" diyene kadar kod yazma.`
- Hata işinde: `ÖNCE: hatayı yeniden üreten test ya da komutu yaz, kırıldığını göster, sonra düzelt.`
- Kritik işte: `KRİTİK: ayrı inceleme yapılacak. Değişikliği küçük ve gözden geçirilebilir tut; güvenlik ve veri varsayımlarını raporda yaz.`
- Önceden açılan bağımlı işte: `HAZIRLIK: brif'i ve gerekli dosyaları oku, planını yaz, turu bitir. "BAŞLA" mesajı gelene kadar kod yazma.`

## 2. Basit örnek (~15 satır)
```
ROL: İŞÇİ - oturum açma, sef:orkestrator'u uygulama, kendi görevini yap.
BRİF KİMLİĞİ: his-karti-kaldir-20261015
İŞÇİ DURUM DOSYASI: ~/.claude/sef/durum/fitchemy/b-his-karti.md
BAŞLANGIÇ: 2026-10-15T09:30Z (ana adımlarda date -u çalıştır)
SINIF: B · claude-haiku-5-5 · medium
KURALLAR: <eklenti kökü>/shared/isci-kurallari.md dosyasını oku ve uy.
GÖREV: Antrenman özeti ve geçmiş detay ekranlarındaki "NASIL HİSSETTİN?" kartını tamamen kaldır. Kullanıcı: "bu alanı kaldırır mısın".
SAHİP: src/app/workout/summary.tsx, src/app/progress/log/[id].tsx, src/store/history.ts (feel alanı), src/data/demo/core.ts.
GIT: aynı klasör kipi; commit atma, dal değiştirme.
BİTTİ: `npm run typecheck` → 0 hata · `npx eslint src` → temiz · `npm test` → hepsi geçer (önce de) · `grep -rn "feel\|hissettin" src` → boş.
ZAMAN KUTUSU: ~20 dk.
ŞEF: local_… ("Fitchemy ekran toparlama")
```

## 3. Orta / karmaşık iskelet
```
ROL: İŞÇİ - oturum açma, sef:orkestrator'u uygulama, kendi görevini yap.
BRİF KİMLİĞİ: izin-api-20261016
İŞÇİ DURUM DOSYASI: ~/.claude/sef/durum/izin-uygulamasi/o-izin-api-kr.md
BAŞLANGIÇ: …
SINIF: O! · claude-opus-5-5 · high   (Orta + kritik: izin onayında yetki kontrolü)
KURALLAR: <eklenti kökü>/shared/isci-kurallari.md dosyasını oku ve uy.
GÖREV: …
BAĞLAM: … Ortam: web http://localhost:3000, API :4000 (şefin). Diğer işçiler: o-izin-ekran (apps/web/src/izin/**).
SAHİP: apps/api/src/izin/**   SALT-OKUNUR: packages/shared/**, docs/**
KARARLAR / KAPSAM DIŞI: …
ODAK: 1) … (yeniden üret: `komut` → görülen / beklenen)
KAPILAR (A): `npm test -- izin` · `npm run typecheck`
GIT: PR kipi; dal refs/heads/izin-api, taban main (`git log -1 --oneline` raporla); push ve PR açma yetkin var; PR açıklamasına brif kimliğini yaz.
ÖNCE PLAN: varsayım ve "adım → doğrula" planını yaz, dur; şef "başla" diyene kadar kod yazma.
KRİTİK: ayrı inceleme yapılacak. Değişikliği küçük tut; güvenlik ve veri varsayımlarını raporda yaz.
DEVİR: sözleşmeyi raporun Devir maddesine yaz (bağımlı: o-izin-ekran).
BİTTİ: `npm test -- izin` → geçer · yetkisiz istek → 403 testi var ve geçer · …
ZAMAN KUTUSU: ~45 dk; uzarsa eldekiyle bitir, ara rapor yaz.
ŞEF: …
```

## 4. "BAŞLA" mesajı (önceden açılmış bağımlıya)
İlk satır tek başına anlaşılır olsun; alıcı yalnız onu önizler.
```
BAŞLA: o-izin-api-kr doğrulandı; planına göre uygulamaya geç.
1) git merge refs/heads/izin-api   (yalnız PR kipinde; çakışma olursa dur ve bildir)
2) Devir (veri, o-izin-api-kr raporundan): <≤ 15 satır sözleşme>
3) Plan düzeltmesi: <varsa>
```
Önce planı yazdıran karmaşık ve kritik işte aynı mesaj "başla" yerine geçer.

## 5. Takip (ek iş) mesajı
Sırayla: bulgu ve kanıt (rota, görüntü yolu), beklenen düzeltme, doğrulama komutu, "bitirince tek satırlık rapor yaz".
```
UI test taraması Beslenme sekmesinde gerçek bir sorun buldu: "Yiyecek ekle" yüzen düğmesi öğün satırlarındaki "+" düğmelerini örtüyor.
Kanıt: .qa/final-dark/shots/tabs_nutrition__free__dark__390.png (ücretsiz 360 ve 390, Premium 430).
Düzelt: birincil eylemi içeriğin üstünde yüzdürme; sabit alt çubuk ya da akış içinde yap.
Doğrula: `npm run ui-test -- --only nutrition`. Bitirince tek satırlık rapor yaz.
```

## 6. Ara bildirim isteği (ortak kod yayınlayan işçiye)
"Bu ikisi hazır olunca kapıları temiz bırak ve şefe (kimlik) `SendMessage` ile kısa bir ara bildirim gönder: ilk satır net bir cümle, altında API ve kullanım örneği. Sonra devam et." Şef bunu alan işçilerine kendi sözleriyle, yalnız API adı, imza, dosya yolu ve örnekle, "veri" etiketiyle iletir.

## 7. `start_session` parametreleri
- `initiation`: CLAUDE.md'de kalıcı izin varsa `"user_asked"`, yoksa `"offer"`. `context: "fresh"`; `background` ≥ 80 karakter ama kısa.
- `prompt`: brif. `model` ve `effort`: sınıf tablosundan, açıkça.
- `name`: `<b|o|k>-<alan>[-kr]`, `[a-z0-9-]`, ≤ 24 karakter. `title`: `[O] Profil ekranını toparla`, ≤ 60 karakter.
- `use_worktree` ve `source_branch`: git kipine göre.
- Ayrıntı ve gerekçeler: `oturum-araclari.md` §1.

## 8. Devir notu ve inceleme brif'i
- Devir notu: `orkestrasyon-agi.md` §5.
- İnceleme işçisi brif'i: `dogrulama-listesi.md` §2.
