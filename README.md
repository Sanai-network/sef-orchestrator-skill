# sef-orkestrator (Claude Code skill) — yedek

Claude Desktop "Code" sekmesi için şef / işçi orkestrasyon yöntemi. Ana oturum şef olur:
- işi sınıflandırır (basit / orta / karmaşık + kritik);
- her parçayı uygun model ve effort'la ayrı işçi oturumlarına verir;
- bağımlılık sırasını yönetir ve token'ı az harcar;
- sonucu bağımsız doğrular ve tek bir Türkçe rapor döner.

Bağlam 600K'yı aşınca harness otomatik sıkıştırır; hook durum dosyasını ve kuralları bağlama geri yükler.

## Geri yükleme
```bash
git clone https://github.com/Sanai-network/sef-orchestrator-skill.git ~/.claude/skills/sef-orkestrator
```

Bağlam yönetimi için iki ayar daha gerekir:
1. `kurulum/settings-ornegi.json`'daki `autoCompactWindow` ve `hooks.SessionStart` anahtarlarını `~/.claude/settings.json`'a ekle. Hook komutundaki yolu kendi kullanıcı klasörüne göre düzelt.
2. `kurulum/CLAUDE-satirlari.md`'deki kuralları `~/.claude/CLAUDE.md`'ye ekle.

Kontrol etmek için:
```bash
node ~/.claude/skills/sef-orkestrator/scripts/baglam.mjs ayar
```

## İçerik
- `SKILL.md`: şef döngüsü (ana yönerge).
- `references/`: sınıflandırma ve model, orkestrasyon ağı, token ve bağlam yönetimi, brif şablonları, işçi kuralları, doğrulama, oturum araçları.
- `scripts/`: `son-rapor.mjs` (işçi raporu), `maliyet.mjs` (işçi başına maliyet), `baglam.mjs` (bağlam ölçümü ve günlük), `baglam-hook.mjs` (sıkıştırma sonrası hook).
- `baglam.json`: bağlam yönetiminin oranları ve sınırları. Eşiğin kendisi `settings.json` → `autoCompactWindow`'dadır.

Betikler için Node.js 18+ gerekir.
