#!/usr/bin/env node
/**
 * Bağlam izleme (şef kullanır). Sıkıştırma eşiği ~/.claude/settings.json'daki autoCompactWindow'dan (yalnız okunur),
 * uyarı eşiği profildeki mutlak baglamUyari'dan (~/.claude/sef/profil.json; varsayılan 400000 token) okunur.
 * Seviye: bağlam ≥ sıkıştırma eşiği → ESIK · ≥ baglamUyari → UYARI · değilse ok.
 *
 *   node baglam.mjs ayar
 *       Geçerli eşikleri ve kaynaklarını yazar (model başına), baglamUyari'yı ve döngü ayarlarını.
 *   node baglam.mjs durum [--sef] [--bul <brif-kimliği>[,<kimlik2>]] [dosya.jsonl ...]
 *       Her oturum için son API çağrısındaki bağlam boyu, seviye (ok / UYARI / ESIK), sıkıştırma sayısı,
 *       son sıkıştırmanın öncesi / sonrası ve döngü durumu. --sef: geçerli klasörün en son transkripti (şefin kendisi).
 *       Çıkış kodu: 0 hepsi ok · 10 en az bir UYARI · 20 en az bir ESIK ya da döngü.
 *   node baglam.mjs --help   Bu yardım.
 *   node baglam.mjs brif --bul <brif-kimliği>
 *       İşçinin orijinal brif'ini (ilk kullanıcı mesajı) yazar; işçi yenilemesinde yeniden göndermek için.
 *   node baglam.mjs kaydet --olay <yenileme|uyari|dongu|not> --oturum <ad> [--bag <token>] [--neden "<metin>"]
 *       Günlüğe tek satır ekler (işçi yenileme vb. şefin yaptığı işlemler için; sıkıştırmaları hook yazar).
 *   node baglam.mjs gunluk [--son 20]
 *       Günlüğün son kayıtlarını okunur biçimde yazar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, opt, optAll, projectDir, listing, findByText, firstUserText, ayar, esikFor, olc, seviye, donguVarMi, gunlugeYaz } from './ortak.mjs';

const k = (n) => (n == null ? '-' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
const saat = (t) => (t ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-');
const a = ayar();
for (const u of a.profilUyarilari) console.error(`Uyarı: ${u}`);
const komut = args[0];

const YARDIM = `Bağlam izleme. Uyarı eşiği profildeki baglamUyari (varsayılan 400000 token), ESIK sıkıştırma eşiğidir.
Kullanım:
  node baglam.mjs ayar
  node baglam.mjs durum [--sef] [--bul <kimlik>[,<kimlik2>]] [dosya.jsonl ...]   (çıkış: 0 ok · 10 UYARI · 20 ESIK ya da döngü)
  node baglam.mjs brif --bul <kimlik>
  node baglam.mjs kaydet --olay <yenileme|uyari|dongu|not> --oturum <ad> [--bag <token>] [--neden "<metin>"]
  node baglam.mjs gunluk [--son N]
  node baglam.mjs --help`;

if (!komut || ['--help', '-h', 'help', 'yardim', '--yardim'].includes(komut)) {
  console.log(YARDIM);
  process.exit(komut ? 0 : 1);
} else if (komut === 'ayar') {
  console.log(`uyarı eşiği (profil baglamUyari): ${k(a.baglamUyari)}  ·  döngü: ${a.donguPencereDakika} dk içinde ≥ ${a.donguSikistirmaSayisi} sıkıştırma  ·  işçi yenileme sınırı: ${a.isciYenilemeSiniri}`);
  console.log(`durum klasörü: ${a.durumKlasoru}`);
  const uyarisizlar = [];
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) {
    const { esik, kaynak } = esikFor(m, a);
    console.log(`${m.padEnd(18)} eşik ${k(esik).padStart(5)}  uyarı ${k(a.baglamUyari).padStart(5)}  (${kaynak})`);
    if (a.baglamUyari >= esik) uyarisizlar.push(m);
  }
  if (uyarisizlar.length) console.log(`Not: baglamUyari sıkıştırma eşiğinden küçük değil (${uyarisizlar.join(', ')}); bu modellerde UYARI hiç görülmez, doğrudan ESIK olur.`);
} else if (komut === 'durum') {
  const hedef = [];
  for (const id of optAll('bul')) {
    const hits = findByText(id);
    if (hits.length) hedef.push({ ad: id, file: hits[0].file });
    else console.error(`Bulunamadı: ${id}`);
  }
  if (args.includes('--sef')) {
    const own = listing(projectDir())[0];
    if (own) hedef.push({ ad: 'şef', file: own.file });
  }
  for (const x of args.slice(1)) if (x.endsWith('.jsonl') && fs.existsSync(x)) hedef.push({ ad: path.basename(x, '.jsonl').slice(0, 12), file: x });
  if (!hedef.length) {
    console.error('Kullanım: node baglam.mjs durum [--sef] [--bul <kimlik>] [dosya.jsonl]');
    process.exit(1);
  }
  let kod = 0;
  const W = Math.max(6, ...hedef.map((h) => h.ad.length));
  console.log(`${'oturum'.padEnd(W)}  ${'bağlam'.padStart(6)}  ${'eşik'.padStart(5)}  seviye  sıkışt.  son (saat öncesi→sonrası)  döngü`);
  for (const h of hedef) {
    const o = olc(h.file);
    const s = seviye(o.boy, o.model, a);
    const d = donguVarMi(o.sikistirmalar, a);
    const son = o.sikistirmalar.at(-1);
    // Sıkıştırma etkisizse (sonrası hemen uyarı seviyesinde) bu da döngü sayılır.
    const etkisiz = son && son.sonrasi != null && son.sonrasi >= Math.min(s.uyari, s.esik);
    const dongu = d.dongu || etkisiz;
    kod = Math.max(kod, s.seviye === 'ESIK' || dongu ? 20 : s.seviye === 'UYARI' ? 10 : 0);
    console.log(
      `${h.ad.padEnd(W)}  ${k(o.boy).padStart(6)}  ${k(s.esik).padStart(5)}  ${s.seviye.padEnd(6)}  ${String(o.sikistirmalar.length).padStart(7)}  ${son ? `${saat(son.zaman)} ${k(son.oncesi)}→${k(son.sonrasi)}` : '-'}`.padEnd(W + 60) +
        (dongu ? (etkisiz ? 'EVET (sıkıştırma etkisiz)' : `EVET (${d.yakin} sıkıştırma / ${a.donguPencereDakika} dk)`) : 'yok'),
    );
  }
  process.exit(kod);
} else if (komut === 'brif') {
  // İşçi yenilemesinde orijinal brif'i yeniden göndermek için: transkriptin ilk kullanıcı mesajı, sistem blokları atılmış.
  const id = opt('bul', null);
  const hit = id ? findByText(id)[0] : null;
  if (!hit) {
    console.error('Kullanım: node baglam.mjs brif --bul <brif-kimliği>');
    process.exit(1);
  }
  console.log(firstUserText(hit.file).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim());
} else if (komut === 'kaydet') {
  const olay = opt('olay', null);
  const oturum = opt('oturum', null);
  if (!olay || !oturum) {
    console.error('Kullanım: node baglam.mjs kaydet --olay <yenileme|uyari|dongu|not> --oturum <ad> [--bag <token>] [--neden "<metin>"]');
    process.exit(1);
  }
  gunlugeYaz({ olay, rol: opt('rol', 'şef'), oturum, bag: opt('bag', null) ? Number(opt('bag')) : null, neden: opt('neden', null) }, a);
  console.log('kaydedildi');
} else if (komut === 'gunluk') {
  const f = path.join(a.durumKlasoru, 'gunluk.jsonl');
  if (!fs.existsSync(f)) {
    console.log('(günlük boş)');
    process.exit(0);
  }
  const satirlar = fs.readFileSync(f, 'utf8').trim().split('\n').slice(-Number(opt('son', 20)));
  for (const l of satirlar) {
    try {
      const j = JSON.parse(l);
      console.log(
        `${new Date(j.zaman).toLocaleString('tr-TR')}  ${String(j.olay).padEnd(10)} ${String(j.rol ?? '').padEnd(4)} ${String(j.oturum ?? '').slice(0, 24).padEnd(24)} ` +
          [j.tetik && `tetik=${j.tetik}`, j.oncesi && `öncesi=${k(j.oncesi)}`, j.bag && `bağlam=${k(j.bag)}`, j.esik && `eşik=${k(j.esik)}`, j.neden].filter(Boolean).join('  '),
      );
    } catch {
      /* bozuk satır */
    }
  }
} else {
  console.error('Kullanım: node baglam.mjs ayar | durum ... | brif ... | kaydet ... | gunluk [--son N] | --help');
  process.exit(1);
}
