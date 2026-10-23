# Expo / Android / Windows ortam ipuçları

> **Uyarı:** Bu dosyanın Android / Windows bölümleri **Windows + Android emülatörü** içindir; macOS'ta `adb` yoksa o bölümleri atla. **Her platformda geçerli** diye işaretli bölümler her yerde kullanılır.

Expo / React Native projelerinde oku. Kaynak: Fitchemy çalışması. Projeye özel kesin bilgi için projenin `docs/` ve hafızasına bak. Ortam şefindir; şef ortamı bir ortam işçisine devrederse gerekli satırları onun brif'ine taşır. Doğrularken ortamı yalnız istemci olarak kullan (sür, ekran görüntüsü al).

## Dev sunucu ve emülatör (şefin ya da ortam işçisinin) — Windows + Android

- Emülatör ana bilgisayarı **`10.0.2.2`** olarak görür; LAN IP'ye ulaşamayabilir ("Something went wrong"). Metro: `REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 npx expo start --port 8100`. `--localhost` Windows'ta Metro'yu yalnız `[::1]`'e bağlar, çalışmaz.
- `TaskStop` Metro'nun `node` alt sürecini kapatmayabilir; port dolu kalırsa `netstat -ano | findstr :8100` ile süreci bul, öldür. Başka projelerin Metro'suna (başka portlar) dokunma.
- Derin bağlantı: `adb shell am start -a android.intent.action.VIEW -d "exp://10.0.2.2:8100/--/rota" host.exp.exponent`. Kurulum / onay ekranlarını kullanıcı adına geçmek yerine derin bağlantıyla ekrana git.
- Git Bash'te `/` ile başlayan rota argümanlarında `MSYS_NO_PATHCONV=1` şart (yoksa yol dönüşümü bozar).
- Windows'ta Bash heredoc / `python -c` içindeki ters eğik çizgiler bozulur: regex içeren dosya düzenlemelerini Edit / Write ile yap.
- PowerShell 5.1: `New-Object System.Drawing.Bitmap($w, $h + 2*$g)` hatalı ayrışır; önce değişkene hesapla ve `[System.Drawing.Bitmap]::new(w,h)` kullan. Çok ekran görüntüsünü tek sayfada görmek için `System.Drawing` ile yatay birleştir (token tasarrufu).

## Başsız, salt-okunur QA emülatörü (kullanıcının AVD'sine zarar vermez) — Android

```
emulator -avd <AVD> -read-only -no-snapshot-save -no-window -no-audio -no-boot-anim -gpu host
```
- Kullanıcının AVD verisi ve anlık görüntüsü değişmez; yaptığın her şey çıkışta atılır. Bitince `adb emu kill`.
- **Önce `adb devices` bak.** Çalışan bir emülatör varsa (kullanıcının ya da başka bir projenin) onu sürme. İkinci örnek gerekiyorsa `-port 5556` ver ve tüm `adb` / yardımcı komutları `ANDROID_SERIAL=emulator-5556` ile çalıştır (`adb`'yi `-s` olmadan çağıran yardımcılar iki cihazda karışır).
- Küçük ekran: `adb shell wm size 640x1136` + `adb shell wm density 320` (= 320 dp genişlik). Büyük yazı: `adb shell settings put system font_scale 1.3`. İşin bitince `wm size reset`, `wm density reset`, `font_scale 1.0`. Ekran boyutu değişince uygulama launcher'a düşebilir: yeniden aç.
- Anlık görüntüden açılınca Expo Go "Loading…"de takılabilir ya da "Something went wrong" gösterebilir: `am force-stop host.exp.exponent` + derin bağlantıyı yeniden aç; force-stop sonrası ilk niyet bazen launcher'a düşer, ikinci denemede açılır.
- Soğuk Metro'da font yükleme gecikirse uygulama yedek sistem yazı tipiyle açılabilir (tasarım gereği); gerçek yazı tipini görmek için yeniden aç.
- Kullanıcının görünür emülatörünü (pencereli) açarken `-read-only` kullanma; o onun durumunu taşır. Gezinti sırasında onun verisini değiştirme (antrenman başlatma, plan değiştirme vb. için önce sor).

## Web önizleme (react-native-web) neyi kanıtlamaz — Her platformda geçerli

- `hitSlop` DOM'a yansımaz (dokunma alanı ölçümleri uyarı olur). `adjustsFontSizeToFit` web'de çalışmaz (sığdırılan metin web'de "kesilmiş" görünür). Güvenli alan, klavye, işletim sistemi yazı ölçeği, izinler, kamera, haptik web'de yok. Dev'e özel `?fontScale=1.3` gibi bir geçersiz kılma yazıyı webde sınamayı sağlar.
- Ortak Metro web paketini de sunar (örn. `http://localhost:8100`): ayrı web sunucusu gerekmez.
- Başsız Chrome / Edge (`puppeteer-core`; macOS'ta Chrome) ile ekran görüntüsü ve DOM denetimi; geliştirme ortamında Expo'nun "Fast Refresh" göstergesi (`__expo_*`) uygulamanın parçası değildir, denetimlerde gizle.

## Expo'ya özel tuzaklar — Her platformda geçerli

- `expo-notifications`'ı Expo Go (Android) içinde en üstte içe aktarma; tembel yükle.
- `style={{ transform: cond ? [...] : undefined }}` Android'de güncellemede çöker; her zaman geçerli dizi ver (platformdan bağımsız alışkanlık olarak uygula).
- Expo API'leri sürüm sürüm kırıcıdır: `node_modules/<paket>/build/*.d.ts` ve ilgili SDK dokümanına bak, hafızana güvenme. Paket eklerken `npx expo install`.
- `expo-doctor` yama sürümü uyarıları (patch) kapıyı kırmaz; yükseltmeyi ayrı karar olarak sun.
- Ağır işlemleri (tam tarama, `expo export`, emülatör / simülatör) yazıcı oturumlar çalışırken başlatma; makine yavaşlar, sonuçlar dalgalanır.
