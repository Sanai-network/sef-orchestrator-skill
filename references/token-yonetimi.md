# Token yönetimi

Hedef: iş başına toplam token'ı (şef + işçiler + tekrar turları) en düşük tutmak. En pahalı kalemler çıktı token'ı, gereğinden güçlü model ve gereksiz büyük bağlamdır. Bu maddeleri her işte uygula.

## 1. İşçiye yalnız işinin bağlamını ver
- `context: "fresh"` kullan; `fork` asla, çünkü bütün konuşmayı taşır. `background` ≥ 80 karakter olmalı ama kısa kalsın: projenin amacı ve bu parçanın yeri.
- İşçi projenin `CLAUDE.md`'sini kendisi yükler; brif onu tekrar etmez. Ortak kurallar ve rapor biçimi de dosya yoluyla verilir (`isci-kurallari.md`), brif'e yazılmaz. Brif'e yalnız projeye özgü ve `CLAUDE.md`'de olmayan kurallar girer (hafızadan, 3–6 satır).
- Dosya içeriğini brif'e yapıştırma; yol ve satır aralığı ver (`apps/web/src/x.tsx:40-90`).
- Bağımlı işe öncülün raporunu değil, ≤ 15 satırlık devir notunu ver.
- Brif uzunluk hedefleri: basit ~15, orta ~35, karmaşık ≤ ~80 satır.

## 2. Tekrar eden bağlamı yeniden kullan
- Aynı dosyalardaki takip işini bağlamı olan boştaki işçiye `SendMessage` ile gönder; dosyaları yeniden okumaz. İstem önbelleği (cache) yaklaşık bir saat sıcak kalır, bu yüzden takibi erken göndermek daha ucuzdur.
- Birden çok işçiye gereken bilgiyi (ölçüt, API sözleşmesi, tasarım kararı) şef bir kez dosyaya yazar, brif'ler o dosyanın yolunu verir. **Mutlak yol ver:** worktree'deki işçi, ana klasördeki commit edilmemiş bir dosyayı ancak mutlak yolla görür.
- Ortam bilgisini (adresler, portlar, test hesabı) ortam işçisinin raporundan bir kez al; sonraki brif'lere tek satır olarak geçir.

## 3. Şefin bağlam hijyeni
- Geniş okuma yerine dar grep kullan. Geniş taramayı Haiku `Explore` alt ajanına ver; özet olarak döner.
- Uzun çıktıyı bağlama dökme:
  - test ve derleme çıktısında yalnız özeti ve son satırları oku (`| tail -n 30`, kısa raporlayıcı, `grep -E "fail|error"`);
  - ekran görüntülerini birleştirip tek seferde bak;
  - işçi raporunu `son-rapor.mjs` ile dosyadan al.
- İşçi raporları kısadır (`isci-kurallari.md`: basit ve orta ≤ 25 satır, karmaşık ≤ 50 satır); uzun kanıtlar dosyada durur.
- Aynı doğrulamayı her işçi için ayrı ayrı tekrarlama. İşçiye özel hedefli testi o işçi bitince çalıştır, bütün kapı komutlarını dalga sonunda bir kez çalıştır.
- Bağlam dolarsa: `baglam-yonetimi.md`. Uyarıda durum dosyası yazılır, eşikte harness sıkıştırır, işçi boştayken yenilenir.

## 4. Uzun işçi oturumu en büyük kalemdir (ölçüldü)
Her turda bütün bağlam yeniden okunur. Bu yüzden maliyet kabaca **mesaj sayısı × bağlam boyu** ile büyür ve çoğu önbellek okumasıdır. 2026-10-16'da mesai-sosyal'daki iki Opus işçisi 443 ve 276 mesaj sürdü: 246M ve 131M token önbellek okuması, ≈ $79 ve ≈ $50 (API karşılığı). Ne yapmalı:
- İşi, bir işçinin ~100–150 mesajda bitireceği büyüklükte parçala. Zaman kutusu bunun için var.
- Bunu aşan işçiden ara rapor ve devir notu al; kalanı taze bir oturuma ver. Taze oturum küçük bağlamla başlar.
- İşçiye dev dosyaları baştan sona okutma; satır aralığıyla okusun.
- Ucuz model uzun oturumda da ucuzdur: aynı 246M önbellek okuması Haiku'da ≈ $2.5 tutar.

## 5. Gereksiz çalıştırmayı önle
- Oturum sayısı ayrık dosya kümesi sayısı kadardır; boşuna bölme.
- Her brif'te zaman kutusu olsun. Uzun tarama (tam matris) yalnız dalga sonunda çalışır, günlük işte hızlı matris yeter.
- Deneme ve test çalıştırmalarını (alt ajan dahil) küçük ve süre sınırlı tut.
- Sınıf yanlış seçildiyse erken düzelt (`siniflandirma-ve-model.md` §6).
- Doğrulanan işçiyi arşivle; boşta bekleyen oturum kenar çubuğunu ve bağlı oturum listesini şişirir.

## 6. Ölçüm
Her iş ağı bittiğinde şu komutu çalıştır:
```
node ~/.claude/skills/sef-orkestrator/scripts/maliyet.mjs --bul <kimlik1> --bul <kimlik2> --sef
```
Komut işçi başına modeli, mesaj sayısını, girdi / önbellek / çıktı token'ını ve tahmini $'ı verir. Fiyatlar API fiyatıdır; abonelikte kota karşılığı olarak oku. `--sef` şefin kendi transkriptini de ekler.
- Final rapora tek satır yaz: "Maliyet: 4 işçi (2 Haiku, 1 Sonnet, 1 Opus) ≈ $1.80; şef ≈ $2.10."
- Sonuçtan ders çıkar: hangi sınıf beklenenden pahalı çıktı, hangi brif tekrar turu doğurdu? Dersi proje hafızasına kısaca yaz.

Fiyatlar (1M token, 2026-10; betiğin içindeki tabloyu güncel tut):

| Model | Girdi | Çıktı | Önbellek okuma |
|---|---|---|---|
| Haiku 5.5 | 0.10 | 0.50 | ~0.01 |
| Sonnet 5.5 | 2 | 10 | 0.20 |
| Opus 5.5 | 4 | 20 | 0.20 |
| Fable 5.1 | 10 | 50 | 0.25 |

Haiku'da 100K token'ı aşan istemlerin fiyatı girdi 0.50, çıktı 2.50'dir.
