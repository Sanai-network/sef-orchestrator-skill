# Kapı sınıfları (A / B / C)

Şef **Anla** adımında `package.json` script'lerini, `Makefile` hedeflerini ve projenin kapı komutlarını okuyup sınıflar. Sınıf, kimin çalıştırabileceğini belirler.

| Sınıf | Ne yapar | Örnek | Kim çalıştırır |
|---|---|---|---|
| **A: güvenli** | Yalnız okur ya da derler | tip, lint (`--fix` olmadan), birim test, derleme | işçi ve şef |
| **B: yerel durum yazar** | Makinedeki durumu değiştirir | test DB'si, seed, simülatör / emülatör, önbellek temizliği, yerel servis, native build | yalnız şef |
| **C: canlı, ücretli ya da dışa açık** | Dünyaya dokunur | deploy, `launchctl`, gerçek API maliyeti, main'e push, yayın, e-posta / bildirim gönderimi | yalnız kullanıcının onayıyla |

- **Script adına güvenme, içeriğini oku.** `&&` / `;` zincirlerini parça parça sınıfla; zincirin sınıfı en yüksek parçanınkidir.
- **Tuzak örneği:** `"deploy": "yarn smoke:gate && yarn workspace web build && launchctl kickstart -k …web-prod && launchctl kickstart -k …worker"`. Adında "gate" geçen adım canlı servis zincirinin parçasıdır; zincirin tamamı **C**. Bu zincir bir kez canlı servisleri yeniden başlattı.
- Brif'e **yalnız A sınıfı** komutlar yazılır. B'yi şef çalıştırır. C yalnız kullanıcının "evet"iyle; proje izin dosyası bazı C komutlarını önek olarak açabilir.
- `--fix`, `--write` ve biçimlendiriciler A değildir: dosya yazarlar ve aynı klasör kipinde başkasının dosyasına dokunabilirler. İşçi biçimlendirmeyi yalnız kendi dosyalarına, yol vererek uygular.
- Koruma hook'u C sınıfının bir kısmını (main'e push, `gh pr merge`, bilinen deploy ve yayın komutları, adı deploy olan paket betikleri, `launchctl`) mekanik olarak engeller. Hook'un yakalamadığı C komutu da C'dir; sınıflandırma şefin işidir.
