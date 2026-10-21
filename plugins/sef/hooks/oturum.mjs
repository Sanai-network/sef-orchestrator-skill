#!/usr/bin/env node
/**
 * SessionStart hook'u (matcher: "compact"): bir oturum otomatik ya da elle sıkıştırıldıktan hemen sonra çalışır.
 * Yalnız şef ve işçi oturumlarında iş yapar; başka oturumda hiçbir şey yazmaz ve bağlama bir şey eklemez.
 *
 *  - Rol: işçi = ilk kullanıcı mesajında "ROL: İŞÇİ" (brif); şef = transkriptte "ROL: İŞÇİ" brif'li bir
 *    start_session çağrısı ya da satır başında "ŞEF DURUM DOSYASI: <yol>.md" yazmış bir asistan mesajı;
 *    ikisi de değilse ve ilk mesaj Desktop'un "(from the session that started this one)" etiketini taşıyorsa görevli işçi.
 *  - Son compact_boundary kaydından tetik ve sıkıştırma öncesi token sayısı okunur, günlüğe yazılır.
 *  - Döngü: baglam.json'daki pencerede (dk) en az N sıkıştırma varsa uyarı eklenir ve günlüğe "dongu" yazılır.
 *  - Bağlama geri eklenen: kurallar + durum dosyası (varsa) + işçide orijinal brif.
 * Hata olursa sessizce çıkar (exit 0); hook hiçbir zaman oturumu durdurmaz.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ayar, olc, esikFor, donguVarMi, gunlugeYaz, expandHome, textOf, lines } from './ortak.mjs';

const MARKER = (rol) => new RegExp(`^\\s*\\**\\s*${rol} DURUM DOSYASI:\\**\\s*\`?([^\\s\`*]+\\.md)\`?`, 'mu');
const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('tr-TR'));
const kisalt = (s, n) => (s.length > n ? s.slice(0, n) + `\n…(${s.length - n} karakter kırpıldı)` : s);

function projeAdi(cwd) {
  const i = cwd.search(/[\\/]\.claude[\\/]worktrees[\\/]/);
  return path.basename(i >= 0 ? cwd.slice(0, i) : cwd);
}

function rolBul(file) {
  let ilk = null;
  let sef = false;
  let sefDosya = null;
  for (const j of lines(file)) {
    if (j.type === 'user' && ilk === null) {
      const t = textOf(j.message?.content).trim();
      if (t) ilk = t;
    }
    if (j.type !== 'assistant') continue;
    for (const c of j.message?.content ?? []) {
      if (c?.type === 'tool_use' && /start_session/.test(c.name ?? '') && String(c.input?.prompt ?? '').includes('ROL: İŞÇİ')) sef = true;
      if (c?.type === 'text') {
        const m = c.text.match(MARKER('ŞEF'));
        if (m && fs.existsSync(expandHome(m[1]))) {
          sef = true;
          sefDosya = expandHome(m[1]);
        }
      }
    }
  }
  const isciDurum = () => {
    const m = ilk.match(MARKER('İŞÇİ'));
    return m ? expandHome(m[1]) : null;
  };
  if (ilk && ilk.includes('ROL: İŞÇİ')) return { rol: 'işçi', brif: ilk, durum: isciDurum() };
  if (sef) return { rol: 'şef', durum: sefDosya };
  // Başka bir oturumun başlattığı ama brif'i şablon dışı olan oturum (Desktop "... (from the session that started this one)").
  if (ilk && ilk.includes('(from the session that started this one)')) return { rol: 'işçi', brif: ilk, durum: isciDurum() };
  return { rol: null };
}

async function main() {
  let input = '';
  for await (const c of process.stdin) input += c;
  const h = JSON.parse(input);
  if (h.hook_event_name !== 'SessionStart' || h.source !== 'compact') return;
  const file = h.transcript_path;
  if (!file || !fs.existsSync(file)) return;

  const { rol, brif, durum } = rolBul(file);
  if (!rol) return; // şef ya da işçi değil: davranış değişmez

  const a = ayar();
  const o = olc(file);
  const son = o.sikistirmalar.at(-1) ?? {};
  const { esik } = esikFor(o.model, a);
  const d = donguVarMi(o.sikistirmalar, a);
  const durumVar = durum && fs.existsSync(durum);
  const onerilen = path.join(a.durumKlasoru, projeAdi(h.cwd ?? ''), `sef-${String(h.session_id ?? 'x').slice(0, 8)}.md`).replace(/\\/g, '/');

  // SEF_BAGLAM_KURU=1: kuru çalıştırma (test / denetim); günlüğe yazmaz, yalnız bağlama ekleneceği metni üretir.
  if (!process.env.SEF_BAGLAM_KURU) gunlugeYaz(
    { olay: d.dongu ? 'dongu' : 'sikistirma', rol, oturum: h.session_id, transkript: path.basename(file), tetik: son.tetik, oncesi: son.oncesi, esik, yakinSikistirma: d.yakin, durumDosyasi: durumVar ? durum : null, cwd: h.cwd },
    a,
  );

  const p = [];
  if (d.dongu)
    p.push(
      `[Bağlam yönetimi] DÖNGÜ: son ${a.donguPencereDakika} dakikada ${d.yakin} sıkıştırma oldu. Yeni iş başlatma ve büyük dosya okuma.`,
      rol === 'şef'
        ? 'Kullanıcıya tek satırla bildir ("Bağlam sıkıştırma döngüsü: son N dakikada N sıkıştırma; durdum, kararını bekliyorum.") ve onun kararını bekle.'
        : 'Durum dosyanı güncelle, şefe SendMessage ile "bağlam sıkıştırma döngüsü" bildir ve dur.',
      '',
    );
  p.push(
    `[Bağlam yönetimi] Bu ${rol} oturumu az önce sıkıştırıldı (tetik: ${son.tetik ?? '?'}, öncesi: ${fmt(son.oncesi)} token, eşik: ${fmt(esik)}).`,
  );
  if (rol === 'şef') {
    p.push(
      `1) Kullanıcıya tek satır yaz: "Bağlam ${fmt(esik)} eşiğini aştı, sıkıştırıldı, devam ediliyor."`,
      '2) Durum dosyasındaki "Değişmez kurallar ve kullanıcı kararları" bölümünü aynen uygula. "Bekleyen onaylar"ı onaylanmış sayma.',
      '3) "Sıradaki adım"dan devam et; tamamlananları tekrar yapma. İşçilerin gerçek durumunu list_sessions {linked:true} ile doğrula.',
    );
    if (durumVar) p.push('', `--- ŞEF DURUM DOSYASI: ${durum} ---`, kisalt(fs.readFileSync(durum, 'utf8'), a.hookDurumSiniri));
    else p.push('', `Durum dosyan yok. Devam etmeden önce özetten durum dosyasını yaz (şablon: ~/.claude/skills/sef-orkestrator/references/baglam-yonetimi.md) ve yolunu ayrı bir satırda bildir: ŞEF DURUM DOSYASI: ${onerilen}`);
  } else {
    p.push(
      '1) Aşağıdaki orijinal brif\'in bütün kurallarını (sahiplik, commit yok, ortam, ücretli çağrı yok, rapor biçimi) aynen uygula.',
      '2) Tamamlanan adımları tekrar yapma: önce durum dosyası ve git status / git diff ile neyin yapıldığını gör.',
      '3) Kaldığın adımdan devam et. Final raporuna "bağlam sıkıştırıldı" satırını ekle.',
      '4) Brif\'te "İŞÇİ DURUM DOSYASI:" satırı varsa o dosyayı şimdi oluştur ya da güncelle (tamamlanan adımlar, kalan adımlar, dokunulan dosyalar, kararlar); sonraki sıkıştırmada buradan devam edilir.',
    );
    if (durumVar) p.push('', `--- İŞÇİ DURUM DOSYASI: ${durum} ---`, kisalt(fs.readFileSync(durum, 'utf8'), a.hookDurumSiniri));
    p.push('', '--- ORİJİNAL BRİF ---', kisalt(brif, a.hookBrifSiniri));
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: p.join('\n') } }));
}

main()
  .catch((e) => {
    try {
      const a = ayar();
      fs.mkdirSync(a.durumKlasoru, { recursive: true });
      fs.appendFileSync(path.join(a.durumKlasoru, 'hook-hata.log'), `${new Date().toISOString()} ${e?.stack ?? e}\n`);
    } catch {
      /* yut */
    }
  })
  .finally(() => process.exit(0));
