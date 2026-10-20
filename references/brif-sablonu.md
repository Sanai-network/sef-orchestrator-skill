# Brif şablonları

İşçi şefin bağlamını görmez; görevini yalnız brif'ten öğrenir. Eksik brif tekrar turu, gereğinden uzun brif boşa token demektir. Yazdıktan sonra işçinin yerine geçip oku: "Bunu bilmeden işe başlayabilir miyim?" Ortak kuralları ve rapor biçimini brif'e yazma, `isci-kurallari.md` yolunu ver.

## 1. Alanlar

**Her brif'te** (bu sırayla):
1. `ROL: İŞÇİ - oturum açma, sef-orkestrator'u uygulama, kendi görevini yap.` İşçi koruması bu satırı arar.
2. `BRİF KİMLİĞİ: <kısa-benzersiz-metin>`. `son-rapor.mjs`, `maliyet.mjs` ve `baglam.mjs` işçiyi bununla bulur.
   Hemen altına: `İŞÇİ DURUM DOSYASI: ~/.claude/sef-durum/<proje>/<name>.md`. İşçi bu dosyayı yalnız bağlamı sıkıştırılırsa ya da şef yenileme isterse yazar; sıkıştırma hook'u dosyayı bu satırdan bulur.
3. `SINIF: <B|O|K>[!] · <model> · <effort>`. İşçi kendi bütçesini bilir.
4. `ORTAK KURALLAR VE RAPOR: ~/.claude/skills/sef-orkestrator/references/isci-kurallari.md dosyasını oku ve uy.`
5. **GÖREV:** tek paragraf. Ne yapılacak, kullanıcının isteği (varsa kelimesi kelimesine), neden istendiği.
6. **SAHİP / SALT-OKUNUR:** glob'larla.
7. **BİTTİ:** somut ve komutla doğrulanabilir kabul ölçütleri.
8. **ZAMAN KUTUSU:** "~N dk; uzarsa ara rapor yaz ve dur."
9. **ŞEF:** adı ya da `local_…` kimliği (`SendMessage` için).

**Orta ve karmaşık işte ek:**
- **BAĞLAM:** projenin `CLAUDE.md`'de olmayan yönü, üst hedef, hafızadaki ek kurallar, diğer işçiler ve sahiplikleri, ortam işçisi ve adresi.
- **KARARLAR / KAPSAM DIŞI:** şefin verdiği ürün ve kapsam kararları. İşçi bunları değiştirmez; gerekçesi varsa raporda yazar.
- **ODAK:** bilinen sorunlar ve yeniden üretme adımları (komut + beklenen / görülen).
- **GİRDİ:** bağımlı işse devir notu.
- **NASIL ÇALIŞ:** kullanılacak komutlar (derleme, tip, lint, test, ekran görüntüsü aracı).

**Karmaşık işte ek:** riskler; ara bildirim noktaları ("X hazır olunca şefe kısa bildirim"); kenar durumları şef kendi betiğiyle sınayacaksa sabit API adları.

**Kritik işte ek satır:** `KRİTİK: ayrı inceleme yapılacak. Değişikliği küçük ve gözden geçirilebilir tut; güvenlik ve veri varsayımlarını raporda yaz.`

## 2. Basit örnek (~15 satır)
```
ROL: İŞÇİ - oturum açma, sef-orkestrator'u uygulama, kendi görevini yap.
BRİF KİMLİĞİ: his-karti-kaldir-20261015
İŞÇİ DURUM DOSYASI: ~/.claude/sef-durum/fitchemy/b-his-karti.md
SINIF: B · claude-haiku-5-5 · medium
ORTAK KURALLAR VE RAPOR: ~/.claude/skills/sef-orkestrator/references/isci-kurallari.md dosyasını oku ve uy.
GÖREV: Antrenman özeti ve geçmiş detay ekranlarındaki "NASIL HİSSETTİN?" (1–5 zorluk puanı) kartını tamamen kaldır. Kullanıcı: "bu alanı kaldırır mısın".
SAHİP: src/app/workout/summary.tsx, src/app/progress/log/[id].tsx, src/store/history.ts (feel alanı), src/data/demo/core.ts.
BİTTİ: iki ekranda kart yok, düzen bozulmamış; kullanılmayan import / alan kalmamış; typecheck + eslint + test önce de sonra da temiz; `feel` / "hissettin" taraması temiz.
ZAMAN KUTUSU: ~20 dk.
ŞEF: <şefin adı ya da local_… kimliği>
```

## 3. Orta / karmaşık iskelet
```
ROL: İŞÇİ - oturum açma, sef-orkestrator'u uygulama, kendi görevini yap.
BRİF KİMLİĞİ: izin-api-20261016
İŞÇİ DURUM DOSYASI: ~/.claude/sef-durum/mesai-sosyal/o-izin-api-kr.md
SINIF: O! · claude-opus-5-5 · high   (Orta + kritik: izin onayında yetki kontrolü)
ORTAK KURALLAR VE RAPOR: ~/.claude/skills/sef-orkestrator/references/isci-kurallari.md dosyasını oku ve uy.
GÖREV: ...
BAĞLAM: ... Ortam: ortam-yerel işçisi, web http://localhost:3000, API :4000. Diğer işçiler: o-izin-ekran (apps/web/src/izin/**).
SAHİP: apps/api/src/izin/**   SALT-OKUNUR: packages/shared/**, docs/**
KARARLAR / KAPSAM DIŞI: ...
ODAK: 1) ... (yeniden üret: `komut` → görülen / beklenen)
GİRDİ: —
NASIL ÇALIŞ: `npm test -- izin` · `npm run typecheck`
BİTTİ: ...
DEVİR: bağımlı iş o-izin-ekran için sözleşmeyi raporun 6. maddesine yaz.
KRİTİK: ayrı inceleme yapılacak. Değişikliği küçük ve gözden geçirilebilir tut; güvenlik ve veri varsayımlarını raporda yaz.
ZAMAN KUTUSU: ~45 dk; uzarsa ara rapor yaz ve dur.
ŞEF: ...
```

## 4. `start_session` parametreleri
- `initiation: "user_asked"`, `context: "fresh"`.
- `background`: ≥ 80 karakter ama kısa (projenin amacı + bu parçanın yeri).
- `prompt`: brif.
- `model`: sınıf tablosundan (`claude-haiku-5-5`, `claude-sonnet-5-5`; Opus'ta boş bırak ya da `claude-opus-5-5` ver). Şeften üstün model yok sayılır.
- `effort`: sınıf tablosundan. Şefin effort'undan yüksek bir değer verilemez.
- `name`: `<b|o|k>-<alan>[-kr]`, yalnız `[a-z0-9-]`, ≤ 24 karakter. `title`: `[O] Profil ekranını toparla`, ≤ 60 karakter.
- `use_worktree`: git varsa `true`, yoksa `false`. Bağımlı iş öncülün dalından başlayacaksa (öncül onayla commit edildikten sonra) `source_branch` ver.
- `permission_mode`: varsayılan olarak şefin modu miras kalır. Daha düşük bir mod her araç çağrısında kullanıcıya onay sordurur; yalnız gerekçe varsa kullan.
- `wake_when_done`: gerekmez; bağlı oturumlar bitince uygulama şefi zaten sürdürür. `true`, yalnız brif'in hiç iletilememesi ihtimaline karşı ek güvencedir.

## 5. Takip (ek iş) mesajı
İlk satır **tek başına anlaşılır** bir cümle olsun; alıcı yalnız onu önizler. Sonra sırayla: bulgu ve kanıt (rota, görüntü yolu), beklenen düzeltme, doğrulama komutu ve "bitirince tek satırlık rapor yaz". Örnek:

```
UI test taraması Beslenme sekmesinde gerçek bir sorun buldu: "Yiyecek ekle" yüzen düğmesi, öğün satırlarındaki "+" düğmelerini örtüyor.
Kanıt: .qa/final-dark/shots/tabs_nutrition__free__dark__390.png (ücretsiz 360 ve 390, Premium 430).
Düzelt: birincil eylemi içeriğin üstünde yüzdürme; sabit alt çubuk ya da akış içinde yap; tek Volt eylem kuralı korunsun.
Doğrula: `npm run ui-test -- --only nutrition`. Bitirince tek satırlık rapor yaz.
```

## 6. Ara bildirim isteği (ortak kod yayınlayan işçi için)
"Bu ikisi hazır olunca typecheck / lint'i temiz bırak ve şefe (kimlik) `SendMessage` ile kısa bir ara bildirim gönder: ilk satır net bir cümle, altında API ve kullanım örneği. Sonra devam et." Şef bunu alan işçilerine iletir: herkese aynı mesaj gider, gerekirse işe özel bir satır eklenir.

## 7. Devir notu ve inceleme brif'i
- Devir notu: `orkestrasyon-agi.md` §3.
- İnceleme işçisi brif'i: `dogrulama-listesi.md` §2.
