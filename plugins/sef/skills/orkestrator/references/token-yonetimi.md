# Token yönetimi

Hedef: iş başına toplam token'ı (şef + işçiler + tekrar turları) en düşük tutmak. En pahalı kalemler uzun oturumların yeniden okunan bağlamı, gereğinden güçlü model ve çıktı token'ıdır.

## 1. İşçiye yalnız işinin bağlamını ver
- `context: "fresh"`; `fork` bütün konuşmayı taşır. `background` ≥ 80 karakter ama kısa: projenin amacı ve bu parçanın yeri.
- İşçi projenin `CLAUDE.md`'sini kendisi yükler; brif onu tekrar etmez. Ortak kurallar ve rapor biçimi dosya yoluyla verilir. Brif'e yalnız projeye özgü ve `CLAUDE.md`'de olmayan kurallar girer (hafızadan, 3–6 satır).
- Dosya içeriğini brif'e yapıştırma; yol ve satır aralığı ver (`apps/web/src/x.tsx:40-90`).
- Bağımlı işe öncülün raporunu değil, ≤ 15 satırlık devir notunu ver.
- Brif uzunluk hedefleri: basit ~15, orta ~35, karmaşık ≤ ~80 satır.

## 2. Tekrar eden bağlamı yeniden kullan
- Aynı dosyalardaki takip işini bağlamı olan boştaki işçiye `SendMessage` ile gönder. İstem önbelleği yaklaşık bir saat sıcak kalır; takibi erken göndermek daha ucuzdur.
- Birden çok işçiye gereken bilgiyi (ölçüt, sözleşme, tasarım kararı) şef bir kez dosyaya yazar, brif'ler yolunu verir. **Mutlak yol ver:** worktree'deki işçi ana klasördeki commit'lenmemiş dosyayı ancak mutlak yolla görür.
- Ortam bilgisini (adresler, portlar, test hesabı) bir kez al; sonraki brif'lere tek satır geçir.

## 3. Şefin bağlam hijyeni
- Geniş okuma yerine dar grep. Geniş taramayı Haiku `Explore` alt ajanına ver; özet döner.
- Uzun çıktıyı bağlama dökme: test ve derleme çıktısında yalnız özeti ve sonu (`| tail -n 30`, `grep -E "fail|error"`); ekran görüntülerini birleştirip tek seferde bak; işçi raporunu `son-rapor.mjs` ile al.
- Aynı doğrulamayı her işçi için tekrarlama: hedefli testi işçi bitince, bütün kapıları dalga sonunda bir kez.
- Hızlı yol şefin bağlamını büyütür; bu yüzden bağlama duyarlıdır (SKILL.md §3).
- Bağlam pahalılaşınca: `baglam-yonetimi.md`.

## 4. Uzun işçi oturumu en büyük kalemdir (ölçüldü)
Her turda bütün bağlam yeniden okunur; maliyet kabaca **mesaj sayısı × bağlam boyu** ile büyür ve çoğu önbellek okumasıdır. Ölçülen bir örnekte iki Opus işçisi 443 ve 276 mesaj sürdü: 246M ve 131M token önbellek okuması, ≈ $79 ve ≈ $50 (API karşılığı). Ne yapmalı:
- İşi bir işçinin ~100–150 mesajda bitireceği büyüklükte parçala. Zaman kutusu bunun için var.
- Bunu aşan işçiden ara rapor ve devir notu al; kalanı taze bir oturuma ver.
- İşçiye dev dosyaları baştan sona okutma; satır aralığıyla okusun.
- Ucuz model uzun oturumda da ucuzdur: aynı 246M önbellek okuması Haiku'da ≈ $2.5 tutar.

## 5. Gereksiz çalıştırmayı önle
- Oturum sayısı ayrık dosya kümesi sayısı kadardır; boşuna bölme.
- Her brif'te zaman kutusu ve bekçi. Uzun tarama (tam matris) yalnız dalga sonunda.
- Deneme ve test çalıştırmalarını (alt ajan dahil) küçük ve süre sınırlı tut.
- Sınıf yanlış seçildiyse erken düzelt (`siniflandirma-ve-model.md` §6).
- Doğrulanan işçiyi profile göre arşivle; boşta bekleyen oturum listeyi şişirir.

## 6. Ölçüm
Her iş ağı bittiğinde:
```
node "<eklenti kökü>/scripts/maliyet.mjs" --bul <kimlik1> --bul <kimlik2> --sef
```
İşçi başına model, mesaj sayısı, girdi / önbellek / çıktı token'ı ve tahmini $ verir. Fiyatlar API fiyatıdır; abonelikte kota karşılığı olarak oku. `--sef` şefin kendi transkriptini ekler.
- Final rapora tek satır: "Maliyet: 4 işçi (2 Haiku, 1 Sonnet, 1 Opus) ≈ $1.80; şef ≈ $2.10."
- Ders çıkar: hangi sınıf beklenenden pahalı çıktı, hangi brif tekrar turu doğurdu? Kısaca proje hafızasına yaz.

Fiyatlar (1M token, 2026-10; betiğin içindeki tablo esastır):

| Model | Girdi | Çıktı | Önbellek okuma |
|---|---|---|---|
| Haiku 5.5 | 0.10 | 0.50 | ~0.01 |
| Sonnet 5.5 | 2 | 10 | 0.20 |
| Opus 5.5 | 4 | 20 | 0.20 |
| Fable 5.1 | 10 | 50 | 0.25 |

Haiku'da 100K token'ı aşan istemlerin fiyatı girdi 0.50, çıktı 2.50'dir.
