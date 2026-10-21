# Arayüz: eklentinin parçaları arasındaki sözleşme

Bu dosya hook'ların, betiklerin ve metinlerin birbirinden beklediği adları ve biçimleri sabitler.
Bir parçayı değiştiren, buradaki sözleşmeyi bozuyorsa önce bu dosyayı günceller.

## 1. Yollar

| Ne | Yol | Kim yazar |
|---|---|---|
| Eklenti kökü | `${CLAUDE_PLUGIN_ROOT}` (hook'ta), skill'de `${CLAUDE_SKILL_DIR}/../..` | güncelleme |
| Profil | `~/.claude/sef/profil.json` (test için `SEF_PROFIL` ortam değişkeni) | yalnız kullanıcı |
| Proje izin dosyası | `<proje>/.claude/sef.local.json` | yalnız kullanıcı |
| Koruma log'u | `~/.claude/sef/koruma.log` (`SEF_LOG` ile değişir; 5 MB'ta `.1`'e döner) | koruma hook'u |
| Durum klasörü | `~/.claude/sef/durum/` (şef / işçi durum dosyaları, `gunluk.jsonl`) | şef, işçi, betikler |
| Oturum hook'unun önbelleği | `~/.claude/sef/durum/guncelleme.json` | oturum hook'u |

Eklenti klasörüne çalışma anında hiçbir şey yazılmaz; güncelleme onu siler.

## 2. Profil

```json
{ "surum": 1, "hizliYol": "baglama-duyarli", "arsiv": "dalga-sonu", "git": "proje-gore", "koruma": "enforce", "baglamUyari": 400000 }
```

| Alan | Değerler | Varsayılan | Okuyan |
|---|---|---|---|
| `hizliYol` | `baglama-duyarli` · `her-zaman` · `asla` | `baglama-duyarli` | şef (metin) |
| `arsiv` | `dalga-sonu` · `hemen` · `onayla` | `dalga-sonu` | şef (metin) |
| `git` | `proje-gore` · `commit-yok` | `proje-gore` | şef, koruma hook'u |
| `koruma` | `enforce` · `log` · `off` | `enforce` | koruma hook'u |
| `baglamUyari` | pozitif tam sayı (token) | `400000` | `baglam.mjs`, şef |

- Dosya yoksa: varsayılanlar, uyarı yok.
- Dosya bozuksa (JSON değil, nesne değil) ya da bir alan geçersizse: o alanlar için varsayılan; oturum hook'u oturum başında tek satır uyarır. Koruma hook'u sessizce varsayılanla çalışır.
- Bilinmeyen alanlar yok sayılır. `surum` yoksa 1 sayılır.
- Profil tercih söyler, izin vermez. İzin isteyen davranış (sormadan oturum açma, işçinin push / PR açması, arşivleme) kullanıcının CLAUDE.md'sindeki cümleden gelir.

Okuma işlevi `scripts/profil.mjs`:

```js
export const VARSAYILAN = Object.freeze({ surum: 1, hizliYol: 'baglama-duyarli', arsiv: 'dalga-sonu', git: 'proje-gore', koruma: 'enforce', baglamUyari: 400000 });
export function profilYolu();                 // SEF_PROFIL ?? ~/.claude/sef/profil.json
export function profilOku(dosya = profilYolu()); // → { profil, uyarilar: string[], kaynak: 'dosya' | 'yok' | 'bozuk' }
```

`node scripts/profil.mjs` profili ve uyarıları yazdırır. Koruma hook'u hızlı ve bağımsız kalmak için bu işlevi içe aktarmaz; aynı kuralları kendi içinde uygular (yalnız `git` ve `koruma`).

## 3. Proje izin dosyası

```json
{ "izinli": ["git push origin main", "railway up --environment staging*"] }
```

- Konum: hook'un `cwd`'sinden yukarı çıkarak bulunan ilk `.claude/sef.local.json`; ev dizinine varınca durulur (ev dizinindeki sayılmaz). Böylece `<proje>/.claude/worktrees/<ad>` içindeki işçi de ana projenin dosyasını bulur.
- Her öğe bir komut önekidir. Komut parçası (bileşik komutun `&&`, `;`, `|` ile ayrılmış her biri, boşlukları sadeleşmiş hâli) önekle başlıyorsa izinlidir. `*` herhangi bir karakter dizisi yerine geçer.
- Tek başına `"*"`: o projede izinle açılabilen bütün engeller açık.
- Yalnız "izin dosyası açar: evet" olan engelleri açar (bkz. §5). Rol kuralları ve dosya koruması izinden etkilenmez.
- Bozuk dosya: hiç izin yok sayılır, log'a yazılır.

## 4. Rol tespiti

Koruma ve oturum hook'u aynı kuralı uygular; ikisi de transkripti (`transcript_path`) okur.

- **İşçi:** transkriptin ilk gerçek kullanıcı mesajı (`type: "user"`, `isMeta`, `isSidechain`, `isCompactSummary` değil; `<system-reminder>` blokları atılmış; `<` ile başlamayan) `ROL: İŞÇİ` ile başlıyor. Desktop'ın açtığı oturumda mesaj `Background (from the session that started this one):` ile başlar; o zaman `Task:` satırından sonrası `ROL: İŞÇİ` ile başlıyor mu bakılır. `İ`, `Ş`, `Ç` için ASCII karşılıkları da kabul edilir.
- **Şef:** işçi değil ve transkriptte şunlardan biri var:
  - bir kullanıcı mesajının **metin** içeriğinde `<command-name>/sef:orkestrator</command-name>` (araç sonucu, `tool_result` içinde geçen sayılmaz);
  - `name: "Skill"` olan bir `tool_use`, `input.skill` değeri `sef:orkestrator` ve sonucu hata değil (`is_error` yok).
- **Diğer:** hiçbiri. Hook karışmaz: koruma izin verir ve log'a yazmaz; oturum hook'u yalnız güncelleme bildirimini yapar.
- Transkript okunamazsa rol `diger` sayılır (fail-open).

## 5. Koruma engelleri

| Kural kimliği | Engellenen | Kimde | İzin dosyası açar |
|---|---|---|---|
| `isci-oturum` | `mcp__ccd_session__start_session`, `mcp__ccd_session__hand_off_to_session`, `Workflow` | işçi | hayır |
| `isci-soru` | `AskUserQuestion` | işçi | hayır |
| `ana-dal-push` | `main` / `master`'a push, `gh pr merge` | şef + işçi | evet |
| `canli` | bilinen deploy ve yayın komutları, adı deploy olan paket betikleri, `launchctl` (okuma alt komutları hariç) | şef + işçi | evet |
| `ev-silme` | ev dizinini ya da `~/.claude`'u silen `rm -r` | şef + işçi | hayır |
| `ayar-yazma` | `~/.claude/settings*.json` ve herhangi bir `CLAUDE.md`'ye yazma | işçi | hayır |
| `sef-dosyasi` | profil ve proje izin dosyasına yazma | şef + işçi | hayır |
| `isci-commit` | `git commit` (yalnız profilde `"git": "commit-yok"`) | işçi | hayır |

Yazma = `Edit`, `Write`, `MultiEdit`, `NotebookEdit` aracının hedefi ya da Bash'te yönlendirme, `tee`, `cp` / `mv` hedefi, `sed -i`.

**Karar biçimi.** Engel `enforce` kipinde PreToolUse JSON çıktısıyla verilir:

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "<Türkçe neden ve ne yapılacağı>" } }
```

Mesaj işçiye "soruyu şefe yaz" ya da "şefe engel olarak bildir"; şefe "kullanıcıya sor ya da proje izin dosyasına önek eklemesini öner" der. `log` kipinde engel kararı log'a yazılır ve çağrı geçer. Her durumda çıkış kodu 0'dır; iç hatada çağrı geçer.

**Log satırı** (tek satır JSON): `{ "zaman", "oturum", "rol", "arac", "karar": "izin" | "engel" | "log-engel" | "hata", "kural", "kip", "komut"? }`. Bash komut metni yalnız engel kararında yazılır.

## 6. Oturum hook'u

- SessionStart (`startup`, `resume`, `clear`, `compact`). Çıktı `hookSpecificOutput.additionalContext` ile bağlama eklenir. Toplam bütçe ~4 sn; çıkış kodu her zaman 0.
- **Güncelleme bildirimi** (her oturumda, rolden bağımsız; `compact`'ta yapılmaz): yerel commit `~/.claude/plugins/installed_plugins.json` → `sef@sanai` → `gitCommitSha`. GitHub `Sanai-network/sef-orchestrator-skill` main ile `gh api` üzerinden karşılaştırılır. Fark varsa ≤ 6 satır: kaç commit geride, başlıklar, `hooks/` ya da `scripts/` değiştiyse "hook / betik kodu değişti" ve iki güncelleme komutu. `gh` yoksa ya da giriş yoksa tek satır "güncelleme denetlenemedi". Ajan güncellemeyi kendiliğinden koşmaz.
- **Geri yükleme** (yalnız `compact`, yalnız şef ve işçi): kurallar + durum dosyası + işçide brif.
- Profil bozuksa tek satır uyarı.

## 7. Testler

`node --test plugins/sef/test/` tek komuttur ve ağ gerektirmez. Betik ve hook'lar ayrıca `--selftest` taşıyabilir; o zaman `test/` altında onu koşan bir test dosyası bulunur. Test verisi `plugins/sef/test/veri/` altındadır.
