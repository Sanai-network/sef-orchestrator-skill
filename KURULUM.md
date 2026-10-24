# Kurulum

`sef` eklentisi `sanai` pazarından kurulur. Kurulum kişi başınadır; her adımı sen yaparsın, ajan bu dosyaları senin yerine yazmaz.

## 0. Gereksinimler
- Claude Code; oturum araçları için Claude Desktop'ın **Code** sekmesi. Araçlar yoksa yöntem `Agent` alt ajanlarıyla çalışır.
- Node.js ≥ 18 (hook'lar ve betikler).
- İsteğe bağlı: giriş yapılmış `gh`. Güncelleme bildirimi GitHub'ı bununla okur; yoksa oturum başında "güncelleme denetlenemedi" der.

## 1. Eklentiyi kur
Claude Code içinde:
```
/plugin marketplace add Sanai-network/sef-orchestrator-skill
/plugin install sef@sanai
```
Eklentinin kendisini geliştiriyorsan pazarı yerel klonundan da ekleyebilirsin: `/plugin marketplace add <klon yolu>`.

## 2. Profili oluştur
Tercihlerin `~/.claude/sef/profil.json`'da durur. Eklenti klasörünün dışındadır; güncelleme onu silmez. Örnek: `plugins/sef/profil.ornek.json`.

```bash
mkdir -p ~/.claude/sef
```
```bash
cat > ~/.claude/sef/profil.json <<'JSON'
{ "surum": 1, "hizliYol": "baglama-duyarli", "arsiv": "dalga-sonu", "git": "proje-gore", "koruma": "enforce", "baglamUyari": 400000 }
JSON
```

| Alan | Değerler | Ne yapar |
|---|---|---|
| `hizliYol` | `baglama-duyarli` · `her-zaman` · `asla` | Şef küçük işi (tek dosya + testi, ~15 dk) kendisi yapar mı. `baglama-duyarli`: yalnız bağlamı `baglamUyari`'nın altındayken. `asla`: şef hiç kod yazmaz. |
| `arsiv` | `dalga-sonu` · `hemen` · `onayla` | Doğrulanan işçi oturumları ne zaman arşivlenir. |
| `git` | `proje-gore` · `commit-yok` | `commit-yok`: işçiler commit atmaz, PR kipi kullanılmaz. |
| `koruma` | `enforce` · `log` · `off` | Koruma hook'unun kipi (§8). |
| `baglamUyari` | token sayısı | Şefin bağlamı bunu geçince uyarı, durum dosyası ve temiz oturuma devir önerisi. |

- Dosya yoksa varsayılanlar geçerlidir. Bozuksa ya da bir alan geçersizse o alan için varsayılan kullanılır ve oturum başında tek satır uyarı çıkar.
- Profil tercih söyler, **izin vermez**. Sormadan oturum açmak, işçinin push / PR açması ve arşivleme CLAUDE.md'deki cümlene dayanır (§4).
- Ajanlar (şef dahil) bu dosyaya yazamaz; hook engeller.

## 3. İstersen: proje izin dosyası
Koruma hook'u main'e doğrudan push'u ve canlıya dokunan komutları engeller (`gh pr merge` serbesttir; birleştirmeden önce şef senin onayını ister). Bir projede bunlardan bazılarını açmak için o projede `.claude/sef.local.json` yaz:
```json
{ "izinli": ["git push origin main", "railway up --environment staging*"] }
```
- Her öğe bir komut önekidir; `*` herhangi bir karakter dizisi yerine geçer. Tek başına `"*"` o projede izinle açılabilen bütün engelleri açar.
- Yalnız push ve canlı engellerini açar. İşçinin oturum açma / soru sorma engeli ve dosya korumaları izinden etkilenmez.
- Hook dosyayı çalışma klasöründen yukarı çıkarak bulur; worktree'deki işçi de ana projenin dosyasını görür.
- Git'e girmesin; dosyayı yerel dışlama listesine ekle:
```bash
echo '.claude/sef.local.json' >> .git/info/exclude
```
- Ajanlar bu dosyaya yazamaz; sen yazarsın.

## 4. CLAUDE.md satırları
Eklenti `CLAUDE.md`'ni yazmaz. Aşağıdaki örneği kendi cümlelerinle düzenleyip `~/.claude/CLAUDE.md`'ye ekle; izin isteyen davranışlar bu cümlelere dayanır. İstemediğin satırı ekleme.
```markdown
## Şef yöntemi (sef eklentisi)
- Geliştirme işinde şef yöntemini /sef:orkestrator ile başlatırım. Tercihlerim ~/.claude/sef/profil.json'da.
- Şef işçi oturumlarını istediği kadar açıp kapatabilir: sormadan `initiation: "user_asked"` ile başlatsın, gerekince durdursun ya da yeniden görevlendirsin; plan onayı beklemesin, "başlatayım mı / arşivleyeyim mi" diye sormasın.
- İstisna: bir oturum "ROL: İŞÇİ" ile başlıyorsa o oturumda işçisin; oturum açma, yalnız kendi görevini yap.
- PR akışlı projelerde işçiler kendi dallarına commit atıp push edebilir ve PR açabilir; main'e birleştirme yalnız benim onayımla.
- Doğrulanan, iptal edilen ya da gereksiz kalan işçi oturumlarını sormadan arşivleyebilirsin; worktree'li işçiyi birleştirmeden arşivleme.
```
Eski kurulumdan kalan "tek dosyalık işi şef kendisi yapsın" satırını sil; yerini profildeki `hizliYol` alır.

## 5. Eski kurulumu sök
Eski kopyayla eklenti birlikte kalırsa iki skill görünür ve hook'lar iki kez çalışır.

1. Eski skill klasörünü `skills/` dışına, yedeğe taşı:
```bash
mkdir -p ~/.claude/skill-yedekleri && mv ~/.claude/skills/sef-orkestrator ~/.claude/skill-yedekleri/sef-orkestrator-$(date +%Y%m%d-%H%M)
```
   Windows (PowerShell): klasörü `$env:USERPROFILE\.claude\skill-yedekleri\` altına taşı.
2. `~/.claude/settings.json`'dan eski hook girdilerini sil:
   - `PreToolUse` altında komutu `skills/sef-orkestrator/scripts/isci-koruma.mjs` olan öğe (ve onunla gelen `SEF_HOOK=…` ön eki);
   - `SessionStart` altında komutu `skills/sef-orkestrator/scripts/baglam-hook.mjs` olan öğe.
   Başka hook'lara dokunma. Bu iki öğe dizide tek başınaysa diziyi de kaldırabilirsin.
3. `autoCompactWindow` kişisel bir ayardır; eklenti ona dokunmaz. İstersen bırak, istersen sil.
4. İsteğe bağlı: eski log ve durum dosyaları (`~/.claude/sef-hook.log`, `~/.claude/sef-durum/`) artık kullanılmaz. Yeni yerleri `~/.claude/sef/koruma.log` ve `~/.claude/sef/durum/`.

## 6. Doğrula
Yeni bir oturum aç (açık oturumlar eski ayarla sürer):
- `/` yazınca `/sef:orkestrator` görünüyor mu? Skill yalnız bu komutla başlar; Claude onu kendiliğinden çağırmaz.
- Profil doğru okunuyor mu: `node <eklenti kökü>/scripts/profil.mjs` (eklenti kökü: `/plugin` ekranındaki kurulum yolu).
- Hook çalışıyor mu: şef oturumunda bir araç çağrısından sonra `tail -n 5 ~/.claude/sef/koruma.log`.

## 7. Güncelle
Oturum başında GitHub'daki main ile kurulu sürüm karşılaştırılır. Fark varsa kaç commit geride olduğun, commit başlıkları ve hook / betik kodu değiştiyse bir uyarı görünür. Güncellemeyi sen yaparsın:
```bash
claude plugin marketplace update sanai
```
```bash
claude plugin update sef@sanai
```
Sonra yeni oturum aç. Sürüm commit kimliğidir; her push yeni sürümdür. Sorunlu bir sürüm `git revert` ile geri alınır ve aynı yoldan herkese gider.

## 8. Koruma kipini değiştir
Koruma hook'u yalnız şef (`/sef:orkestrator` çağrılmış) ve işçi ("ROL: İŞÇİ" ile başlamış) oturumlarında çalışır; diğer oturumlara karışmaz. Kip profildeki `koruma` alanıdır:
- `enforce` (varsayılan): engeller ve Türkçe nedenini söyler.
- `log`: engellemez, yalnız `~/.claude/sef/koruma.log`'a yazar. Yeni bir makinede önce bunu deneyebilirsin.
- `off`: hiçbir şey yapmaz.

Hook iç hatada çağrıyı engellemez. Log'u okumak için:
```bash
tail -n 20 ~/.claude/sef/koruma.log
```
```bash
grep '"karar":"engel"' ~/.claude/sef/koruma.log
```

## 9. Kaldır
```
/plugin uninstall sef@sanai
```
`~/.claude/CLAUDE.md`'deki "Şef yöntemi" bölümünü sil. `~/.claude/sef/` klasörünü (profil, log, durum) istersen sil.
