# Örnek: Fitchemy "ekran toparlama + UI test" çalışması (2026-10-15)

Kalibrasyon için gerçek bir çalışma. Bu bir şablon değil; boyut ve ritim hissi vermek için.

Not: Bu çalışmada şef ortamı ve bir tip hatası düzeltmesini kendisi yaptı; işçilerin hepsi de şefin modeliyle çalıştı. Bugünkü kurala göre ortam, ortam işçisine; düzeltme, dosyanın sahibine gider; her işçi de sınıfına uygun modelle çalışır (`siniflandirma-ve-model.md`).

## İstek
Fitness uygulaması (Expo / TypeScript / Expo Router, git yok). Kullanıcı: "Ücretsizken sade, eksiksiz spor takibi; Premium'da detay + AI. Bazı ekranlar hâlâ karmaşık ve dağınık: toparla, responsive yap. Font ekle (yoksa), UI testi yap."

## Plan ve oturumlar (8 + sonra küçük ikinci dalga)
| Dalga | Oturum | Sahip olduğu |
|---|---|---|
| 0 (şef) | — | `docs/UI-GUIDELINES.md` (sade ekran ölçütü + responsive kurallar), ekran görüntüsü aracına `--plan free|premium` bayrağı |
| 1 | Temel (responsive + yazı tipi) | `src/theme`, `src/components/ui`, `src/components/nav`, `_layout.tsx` |
| 1 | UI test | `tools/qa/**` (otomatik denetim + 7 kullanıcı akışı) |
| 2 | Ana Sayfa + Antrenman | `(tabs)/index`, `(tabs)/train`, `workout/**`, `features/home`, `features/workout` |
| 2 | Programlar + Kütüphane + Kas haritası | `programs/**`, `library/**`, `muscle-map/**`, `features/training` |
| 2 | Beslenme | `(tabs)/nutrition`, `nutrition/**`, `features/nutrition` |
| 2 | İlerleme | `(tabs)/progress`, `progress/**`, `features/progress` |
| 2 | AI Koç + Premium | `(tabs)/coach`, `coach/**`, `premium/**`, `features/ai` |
| 2 | Kurulum + Profil + Destek + … | `(onboarding)`, `profile`, `support`, `notifications`, `gyms`, `integrations` |
| 3 | 4 alan oturumuna küçük düzeltme | UI test bulguları (örtülen düğme, a11y, geniş ekran sütunu) |

Ortak dokümanları (`docs/DESIGN-FIXES.md`, `AGENT-GUIDE.md` tablosu) yalnız şef (ve Temel kendi bölümlerini) düzenledi; alan oturumları sapmaları raporda yazdı.

## Neler işe yaradı
- Dalga 0'daki ölçüt dokümanı: 6 oturum aynı sadelik tanımıyla çalıştı.
- Temel'in **ara bildirimi** (yeni `useScreenSize`, `StatRow`): şef alan oturumlarına duyurdu; çakışan hatayı (yan yana sayıların üst üste binmesi) bileşen çözdü.
- UI test oturumu gerçek hatalar buldu: yüzen düğme öğün "+" düğmelerini örtüyor, geniş ekranda sütun taşması, seçim denetimlerinde a11y.
- Şefin bağımsız doğrulaması: "typecheck temiz" diyen oturumun testinde tip hatası vardı; şef düzeltti.
- Emülatörde 320 dp + 1.3× yazı: web'in göstermediği 3 native sorun (rozet adları kelime ortasından bölünüyor, ısı haritası segment etiketleri kesiliyor, Ana Sayfa alt başlığı kesiliyor); sahiplerine iletildi, düzeltme sonrası emülatörde yeniden doğrulandı.

## Neler yavaşlattı / dersler
- UI test oturumu **zaman kutusu olmadan** 2 saatten fazla sürdü (kural cilası); tam matris 1750 yapılandırma, 85 dk. → Zaman kutusu koy, hızlı ve tam matrisi ayır.
- Boştaki oturuma bildirim aboneliği hemen tetiklendi → abonelik yalnız oturum meşgulken.
- Bir oturum başka bir projenin oturumunu şaşırttı (ortak emülatörü kullanma) → kullanılan ortamı o projenin şefine kısa bilgiyle bildir.
- Web önizlemede "kesilmiş metin" uyarıları çoğunlukla web'e özgüydü (`adjustsFontSizeToFit`); native'de bakmadan düzeltme istemek yanlış olurdu.
- `.qa/` çıktısı 100 MB'a ulaştı → bitişte temizlemeyi öner.

## Sonuç (sayılarla)
218 test, tip / lint / biçim temiz, Android + iOS paketleri derleniyor; tam tarama 63 rota × 5 boyut × 3 veri durumu × 2 tema = 1750 yapılandırmada **0 hata, 26 küçük uyarı**; 7 kullanıcı akışı geçti; yazı 1.3× kolunda 0 hata. Tasarım sapmaları `docs/DESIGN-FIXES.md`'ye işlendi.
