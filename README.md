# sanai: şef eklentisi

Claude Code için `sanai` pazarı ve içindeki `sef` eklentisi. `/sef:orkestrator` ile başlayan oturum **şef** olur:
- geliştirme işini sınıflandırır (keşif / basit / orta / karmaşık + kritik);
- küçük işi kendisi yapar, büyük işi uygun model ve effort'la işçi oturumlarına dağıtır;
- bağımlılık sırasını yönetir, token'ı az harcar;
- sonucu bağımsız doğrular ve tek kısa Türkçe rapor verir.

Bir koruma hook'u şef ve işçi oturumlarında kısa bir engel listesi uygular (işçinin oturum açması ve kullanıcıya soru sorması, main'e push, deploy, ayar dosyalarına yazma). Oturum hook'u güncellemeyi bildirir ve bağlam sıkıştırılınca durumu geri yükler.

Kurulum, profil, izin dosyası, güncelleme ve eski kurulumu sökme: [KURULUM.md](KURULUM.md).

## İçerik
```
.claude-plugin/marketplace.json     pazar: sanai → plugins/sef
plugins/sef/
├─ .claude-plugin/plugin.json       eklenti (sürüm = commit)
├─ skills/orkestrator/              /sef:orkestrator: şef döngüsü (SKILL.md) + references/
├─ shared/cekirdek.md               her rolün uyduğu kısa çekirdek
├─ shared/isci-kurallari.md         işçi kuralları ve rapor biçimi
├─ shared/ARAYUZ.md                 parçalar arası sözleşme (yollar, profil, rol tespiti, engeller)
├─ katmanlar/gelistirme/            git kipleri, kapı sınıfları, mobil / Expo, örnek çalışma
├─ hooks/                           koruma (PreToolUse) ve oturum (SessionStart) hook'ları
├─ scripts/                         son-rapor, maliyet, bağlam ölçümü, profil
├─ test/                            node testleri: node --test "plugins/sef/test/*.test.mjs"
└─ profil.ornek.json                ~/.claude/sef/profil.json için örnek
```

## Kaynak notu
Kodlama ilkeleri, Andrej Karpathy'nin LLM kodlama hatalarına dair gözlemlerinden ve multica-ai/andrej-karpathy-skills (önceki adı forrestchang/andrej-karpathy-skills, MIT) çalışmasından uyarlanmıştır.
