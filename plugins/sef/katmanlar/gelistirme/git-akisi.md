# Git akışı (şef için)

Yazıcı işçilerin nerede çalışacağı, nereye commit atacağı ve kapsamın nasıl denetleneceği projeye göre seçilir.

## Kip seçimi
- **Projenin kendi kuralı önce gelir:** proje `CLAUDE.md`'si ya da kendi geliştirme yöntemi (dal adı, PR şablonu, commit kuralı) bu dosyayı geçer.
- **Profil:** `"git": "commit-yok"` ise PR kipi kullanılmaz ve işçiler commit atamaz (koruma hook'u engeller). Aşağıdaki seçim yalnız `proje-gore`'de yapılır.
- **PR kipi**, üç koşul birlikte varsa:
  1. GitHub uzak deposu (`git remote -v`);
  2. issue / PR akışı ya da kuralı (`.github/` klasörü, proje `CLAUDE.md`'sinde PR kuralı);
  3. kullanıcının işçilerin push / PR açması için **kalıcı izni** (CLAUDE.md'de kendi cümlesiyle). Yoksa planı sunarken sor: "Dallara push edip PR açayım mı?" "Evet" yalnız bu iş için geçerlidir.
- Koşullar yoksa (ya da kullanıcı "hayır" derse) → **aynı klasör kipi**.
- Git yoksa → **git'siz proje**.

## PR kipi
**Hazırlık (şef, işçileri açmadan önce):**
- Worktree taze bir checkout'tur: commit'lenmemiş değişiklikler (Dalga 0 dokümanı dahil), `.env` gibi izlenmeyen dosyalar, `node_modules` ve `Pods` içinde yoktur.
- Dalga 0'ı commit'le (proje kuralı izin veriyorsa ya da kullanıcı onaylarsa); edilemiyorsa içeriğini brif'e koy.
- `start_session`'a `source_branch` = `git branch --show-current` çıktısını açıkça ver.
- Gereken izlenmeyen dosyalar (örn. `.env.local`) için repo kökünde `.worktreeinclude` (`.gitignore` söz dizimi). Bu da bir repo değişikliğidir: Dalga 0'da, aynı izinle.
- Brif'in GIT alanına kurulum komutunu alt paket köküyle yaz (`cd app && npm ci`).
- Native iOS build'i işçiye yaptırma: her worktree'de GB'larca `Pods` ve `DerivedData` oluşur. Native build ve simülatör şefindir (B sınıfı).

**İşçi:**
- Başlarken `git log -1 --oneline` çıktısını raporlar.
- Kendi worktree'sinde, kendi dalına commit atar, push eder, PR açar; PR açıklamasına brif kimliğini yazar. **Push edip PR açan işçi en az Sonnet'tir.**
- `main`'e birleştirmez, başka dala dokunmaz (main'e doğrudan push hook'ta engelli; birleştirme şefin ve kullanıcının işi).

**Bağımlı işçi:** önceden açılır; worktree'si öncülün commit'leri olmadan kesilmiştir. "BAŞLA" mesajının ilk adımı `git merge refs/heads/<öncülün dalı>`; çakışmada işçi durur ve bildirir.

**Şef:**
- PR diff'ini ve CI'yi kendisi doğrular (`gh pr diff`, `gh pr checks` ya da `ccd_pr` araçları); kapıları worktree yolunda kendisi çalıştırır.
- Birleştirme sırası planda tanımlı olsun (örn. Temel → alanlar). Her birleştirmeden sonra kalan PR'lar yeni `main`'e göre güncellenir; çakışma iş sahibine geri gönderilir, şef çözmez.
- `main`'e birleştirme **yalnız kullanıcının "evet"iyle**. Hook `gh pr merge`'ü engellemez; bu kural yalnız metindedir, birleştirmeden önce mutlaka sor.
- Dallar raporlarda ve komutlarda tam ref ile anılır: `refs/heads/<dal>`.
- Bitişte worktree ve `DerivedData` temizliğini kullanıcıya öner; kendin silme.

## Aynı klasör kipi
- Bütün işçiler `use_worktree: false`, aynı checkout'ta; **ayrık dosya sahipliği** şart.
- Şef başlamadan `git status --porcelain` ve tabanı (`git rev-parse HEAD`) not eder. Kullanıcının commit'lenmemiş değişiklikleri ayrıca not edilir; işçiye yazılmaz.
- Kapsam = `git diff <taban> --stat` + yeni izlenmeyen dosyalar; her dosya sahibinin listesinde mi?
- **Ortak dosyalar** (`package.json`, kilit dosyası, rota / modül kayıtları, ortak tipler) tek sahibe ya da şefe verilir; diğerleri ihtiyacı raporda yazar.
- İşçiler commit atmaz, `git add` yapmaz, dal değiştirmez, `stash` / `reset` yapmaz. Commit dizisini şef kurar; projenin ve kullanıcının kuralına göre.
- Otomatik biçimlendirme hook'u ya da `--fix` başka işçinin dosyasına dokunabilir: kapıları `--fix` olmadan çalıştır.

## Git'siz proje
- Başlamadan taban kopyası al, proje klasörünün **dışına**: `rsync -a --exclude node_modules --exclude .expo <proje>/ <proje>-taban-<tarih>/`.
- Kapsam: `diff -ru --exclude=node_modules <proje>-taban-<tarih> <proje>`. Taban kopyası geri alma için de kullanılır.
- Worktree yok: `use_worktree: false`, ayrık dosya sahipliği.
- `git init`'i kullanıcıya öner; kendin yapma.

## Kapıları doğru yerde çalıştır
- **PR kipinde:** işçinin worktree yolunda (`git worktree list`). Worktree yoksa dalı ana checkout'ta değiştirme; geçici bir worktree aç (`git worktree add <geçici-yol> refs/heads/<dal>`) ve kurulumu orada çalıştır.
- **Aynı klasör kipinde:** proje kökünde (monorepo'da ilgili alt paket kökünde).
- Projenin Node ve paket yöneticisi sürümüne uy: `.nvmrc` / `.node-version`, `package.json` `engines` ve `packageManager` (corepack). Yanlış sürümle alınan "hata" işçinin değil ortamındır.
