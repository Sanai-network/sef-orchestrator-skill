#!/usr/bin/env node
/**
 * son-rapor.mjs (v2): bir işçi oturumunun final raporunu transkriptten (jsonl) tam olarak alır.
 * Klasör çözümü, kodlama ve ilk-mesaj okuma ortak.mjs'te (maliyet.mjs ve baglam.mjs ile paylaşılır).
 * `list_events` çıktısı kısalır ve araç çağrılarıyla dolar; tam raporu buradan al.
 *
 *   node son-rapor.mjs --bul "<BRİF KİMLİĞİ>" [--proje <klasör-adı|yol>] [--min N] [--json] [--kok <projects-kökü>]
 *   node son-rapor.mjs <dosya.jsonl> [--min N] [--json]
 *   node son-rapor.mjs --oturum local_<id> [--min N] [--json] [--kok <dizin>] [--meta <dizin>]
 *   node son-rapor.mjs --liste [--proje <klasör|yol>] [--kok <dizin>] [--json]
 *   node son-rapor.mjs --selftest
 *
 * --kok    : transkript kökü. Varsayılan: $CLAUDE_CONFIG_DIR/projects varsa o, yoksa ~/.claude/projects.
 * --proje  : kök altındaki klasör adı ya da bir proje yolu (yol ise kodlanır). Varsayılan: çağıranın cwd'si.
 *            Kodlama: harf ve rakam dışındaki her karakter '-' olur ('/', '.', '_', boşluk, Türkçe harf…).
 *            200 karakteri aşan adlar kırpılıp sonuna '-<özet>' eklenir; betik bunu önek + transkriptteki cwd ile çözer.
 * --bul    : metni YALNIZ her transkriptin ilk gerçek kullanıcı mesajında arar (<system-reminder> blokları atılır;
 *            assistant/tool_use/queue içindeki geçişler sayılmaz, böylece şefin kendi transkripti elenir).
 *            Arama sırası: (1) proje klasörü, (2) worktree kardeşleri `<kodlanmış-cwd>--claude-worktrees-*`,
 *            (3) kökteki tüm klasörler. Eşleşme bulunan ilk aşamada durur; birden çok eşleşme stderr'e yazılır,
 *            en son değişen seçilir.
 * --min    : varsayılan 600. Son asistan metni her zaman yazılır; bundan kısaysa ondan önceki en son ≥min metin
 *            "ÖNCEKİ UZUN MESAJ" etiketiyle eklenir.
 * --json   : {dosya, projeKlasoru, oturumId, sonMesaj:{zaman,uzunluk,metin}, oncekiUzun:{…}|null,
 *            eslesmeler:[{dosya,mtime,ilkIstek}]}
 * --oturum : Desktop oturum kimliğinden (local_…) cwd ve cli oturum kimliğini meta veriden çözer.
 *            --meta: meta kökü (varsayılan macOS ~/Library/Application Support/Claude/claude-code-sessions,
 *            Windows %APPDATA%\Claude\claude-code-sessions, Linux ~/.config/Claude/claude-code-sessions).
 * --liste  : proje klasörü ve worktree kardeşlerindeki son 25 transkripti, ilk isteğin başıyla listeler.
 * Çıkış kodları: 0 bulundu · 1 eşleşme ya da rapor yok · 2 kullanım hatası.
 * Yalnız node: yerleşik modülleri; Node ≥18. Dosyalar satır satır akışla okunur.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  KullanimHatasi, AD_SINIRI, encode as kodla, textOf as metinOf, expandHome as tildeAc, klasorler, listing, firstUserText,
  cwdKlasoru, worktreeKardesleri, projeCoz, benzerler,
} from './ortak.mjs';

const VARSAYILAN_MIN = 600;
const IS_WIN = process.platform === 'win32';

// ---------- argümanlar ----------
const DEGERLI = new Set(['bul', 'proje', 'min', 'kok', 'oturum', 'meta']);
const BAYRAK = new Set(['json', 'liste', 'selftest', 'yardim', 'help']);

function argOku(argv) {
  const o = { dosya: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { o.yardim = true; continue; }
    if (a.startsWith('--')) {
      const ad = a.slice(2);
      if (BAYRAK.has(ad)) { o[ad === 'help' ? 'yardim' : ad] = true; continue; }
      if (!DEGERLI.has(ad)) throw new KullanimHatasi(`Bilinmeyen bayrak: ${a}`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || v === '') throw new KullanimHatasi(`${a} bir değer ister.`);
      if (o[ad] !== undefined) throw new KullanimHatasi(`${a} birden çok kez verilmiş.`);
      o[ad] = v;
      i++;
      continue;
    }
    if (o.dosya) throw new KullanimHatasi(`Fazladan argüman: ${a}`);
    o.dosya = a;
  }
  if (o.min !== undefined) {
    if (!/^\d+$/.test(o.min)) throw new KullanimHatasi(`--min negatif olmayan bir tamsayı olmalı: ${o.min}`);
    o.min = Number(o.min);
  } else o.min = VARSAYILAN_MIN;
  const kipler = ['bul', 'liste', 'oturum', 'selftest', 'dosya'].filter((k) => o[k]);
  if (kipler.length > 1) throw new KullanimHatasi(`Tek kip seçin; birlikte verilmiş: ${kipler.join(', ')}`);
  o.kip = kipler[0] ?? null;
  return o;
}

// ---------- transkript kökü ----------
function dizinMi(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function kokBul(o) {
  if (o.kok) {
    const k = path.resolve(tildeAc(o.kok));
    if (!dizinMi(k)) throw new KullanimHatasi(`--kok bulunamadı: ${k}`);
    return k;
  }
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (cfg && dizinMi(path.join(cfg, 'projects'))) return path.join(cfg, 'projects');
  return path.join(os.homedir(), '.claude', 'projects');
}

// ---------- transkript okuma (akış) ----------
function satirlar(dosya) {
  const akis = fs.createReadStream(dosya, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: akis, crlfDelay: Infinity });
  return { rl, kapat: () => { rl.close(); akis.destroy(); } };
}

/** İlk gerçek kullanıcı mesajı (system-reminder atılmış); ortak.mjs'teki ölçütle aynı. */
const ilkIstek = (dosya) => firstUserText(dosya) || null;
const kisalt = (t, n = 140) => (t ? t.replace(/\s+/g, ' ').slice(0, n) : '(ilk istek okunamadı)');

/** Tüm dosyayı satır satır tarar: son asistan metni ve ondan önceki en son ≥min metin. */
async function raporOku(dosya, min) {
  const { rl, kapat } = satirlar(dosya);
  const mesajlar = []; // {id, zaman, metin}
  let oturumId = null;
  let sonSentetik = null;
  try {
    for await (const l of rl) {
      if (!l) continue;
      let j;
      try { j = JSON.parse(l); } catch { continue; }
      if (!oturumId && typeof j.sessionId === 'string') oturumId = j.sessionId;
      if (j.type !== 'assistant' || j.isSidechain) continue;
      const t = metinOf(j.message?.content).trim();
      if (!t) continue;
      if (j.message?.model === '<synthetic>' || j.isApiErrorMessage) { sonSentetik = { zaman: j.timestamp ?? null, metin: t }; continue; }
      const id = j.message?.id ?? null;
      const son = mesajlar[mesajlar.length - 1];
      if (son && id && son.id === id) { son.metin += '\n' + t; son.zaman = j.timestamp ?? son.zaman; }
      else {
        mesajlar.push({ id, zaman: j.timestamp ?? null, metin: t });
        if (mesajlar.length > 2) {
          // Bellek: yalnız son mesajı ve ondan önceki en son ≥min mesajı tut.
          const onceki = mesajlar.slice(0, -1).reverse().find((m) => m.metin.length >= min);
          mesajlar.splice(0, mesajlar.length, ...(onceki ? [onceki] : []), mesajlar[mesajlar.length - 1]);
        }
      }
      sonSentetik = null;
    }
  } finally { kapat(); }
  if (!mesajlar.length) return { oturumId, son: null, onceki: null, sonSentetik };
  const son = mesajlar[mesajlar.length - 1];
  const onceki = son.metin.length < min ? mesajlar.slice(0, -1).reverse().find((m) => m.metin.length >= min) ?? null : null;
  const bicim = (m) => (m ? { zaman: m.zaman, uzunluk: m.metin.length, metin: m.metin } : null);
  return { oturumId, son: bicim(son), onceki: bicim(onceki), sonSentetik };
}

// ---------- kipler ----------
async function raporYaz(dosya, o, eslesmeler = []) {
  const r = await raporOku(dosya, o.min);
  const projeKlasoru = path.basename(path.dirname(dosya));
  const oturumId = r.oturumId ?? path.basename(dosya, '.jsonl');
  if (o.json) {
    console.log(JSON.stringify({ dosya, projeKlasoru, oturumId, sonMesaj: r.son, oncekiUzun: r.onceki, eslesmeler }, null, 2));
  } else {
    console.log(`# dosya: ${dosya}`);
    console.log(`# proje klasörü: ${projeKlasoru}`);
    if (r.son) {
      console.log(`# son mesaj: ${r.son.zaman ?? '(zaman yok)'}, ${r.son.uzunluk} karakter`);
      if (r.onceki)
        console.log(`# not: son mesaj --min (${o.min}) değerinden kısa; ondan önceki uzun mesaj altta "ÖNCEKİ UZUN MESAJ" olarak eklendi. Asıl SON mesaj hemen aşağıdaki.`);
      console.log('');
      console.log(r.son.metin);
      if (r.onceki) {
        console.log('');
        console.log(`# ===== ÖNCEKİ UZUN MESAJ (son mesaj DEĞİL): ${r.onceki.zaman ?? '(zaman yok)'}, ${r.onceki.uzunluk} karakter =====`);
        console.log('');
        console.log(r.onceki.metin);
      }
    } else console.log('# son mesaj: (yok)\n\n(rapor bulunamadı: transkriptte asistan metni yok)');
  }
  if (r.sonSentetik) console.error(`# uyarı: son asistan girdisi sentetik/hata mesajı (${r.sonSentetik.zaman}): ${kisalt(r.sonSentetik.metin, 120)}`);
  return r.son ? 0 : 1;
}

async function bulKipi(o) {
  const kok = kokBul(o);
  const p = projeCoz(kok, o.proje);
  const mevcut = klasorler(kok);
  const asama1 = p.klasor ? [p.klasor] : [];
  const asama2 = p.cwd ? worktreeKardesleri(p.cwd, kok, mevcut).filter((d) => !asama1.includes(d)) : [];
  const gorulen = new Set([...asama1, ...asama2]);
  const asama3 = mevcut.filter((d) => !gorulen.has(d));
  if (!p.klasor) console.error(`# not: geçerli projenin klasörü yok (${p.aday}); worktree kardeşleri ve tüm kök aranıyor.`);
  for (const [ad, liste] of [['proje', asama1], ['worktree', asama2], ['tüm kök', asama3]]) {
    const hits = [];
    for (const d of liste)
      for (const f of listing(path.join(kok, d))) {
        const t = ilkIstek(f.file);
        if (t && t.includes(o.bul)) hits.push({ dosya: f.file, mtime: new Date(f.mtime).toISOString(), ilkIstek: kisalt(t), _m: f.mtime });
      }
    if (!hits.length) continue;
    hits.sort((a, b) => b._m - a._m);
    if (hits.length > 1) {
      console.error(`# ${hits.length} eşleşme (aşama: ${ad}); en son değişen seçildi:`);
      for (const h of hits)
        console.error(`#   ${h === hits[0] ? '*' : ' '} ${h.mtime}  ${path.basename(path.dirname(h.dosya))}/${path.basename(h.dosya)}  ${h.ilkIstek}`);
    } else console.error(`# 1 eşleşme (aşama: ${ad}): ${path.basename(path.dirname(hits[0].dosya))}/${path.basename(hits[0].dosya)}`);
    return raporYaz(hits[0].dosya, o, hits.map(({ _m, ...h }) => h));
  }
  console.error(`Eşleşen transkript yok: "${o.bul}" hiçbir transkriptin ilk kullanıcı mesajında geçmiyor (kök: ${kok}).`);
  if (o.json) console.log(JSON.stringify({ dosya: null, projeKlasoru: null, oturumId: null, sonMesaj: null, oncekiUzun: null, eslesmeler: [] }, null, 2));
  return 1;
}

async function listeKipi(o) {
  const kok = kokBul(o);
  const p = projeCoz(kok, o.proje);
  const dirs = [...(p.klasor ? [p.klasor] : []), ...(p.cwd ? worktreeKardesleri(p.cwd, kok) : [])];
  if (!dirs.length) throw new KullanimHatasi(`Proje klasörü bulunamadı: ${path.join(kok, p.aday)}${benzerler(klasorler(kok), p.aday)}\n--proje <klasör adı> ver.`);
  const hepsi = dirs.flatMap((d) => listing(path.join(kok, d))).sort((a, b) => b.mtime - a.mtime).slice(0, 25);
  const satir = [];
  for (const f of hepsi) satir.push({ dosya: f.file, projeKlasoru: path.basename(path.dirname(f.file)), mtime: new Date(f.mtime).toISOString(), ilkIstek: kisalt(ilkIstek(f.file)) });
  if (o.json) console.log(JSON.stringify(satir, null, 2));
  else for (const s of satir) console.log(`${s.mtime}  ${dirs.length > 1 ? s.projeKlasoru + '/' : ''}${path.basename(s.dosya)}  ${s.ilkIstek}`);
  return satir.length ? 0 : 1;
}

function metaKoku(o) {
  if (o.meta) {
    const m = path.resolve(tildeAc(o.meta));
    if (!dizinMi(m)) throw new KullanimHatasi(`--meta bulunamadı: ${m}`);
    return m;
  }
  const h = os.homedir();
  const taban =
    process.platform === 'darwin' ? path.join(h, 'Library', 'Application Support', 'Claude')
    : IS_WIN ? path.join(process.env.APPDATA ?? path.join(h, 'AppData', 'Roaming'), 'Claude')
    : path.join(process.env.XDG_CONFIG_HOME ?? path.join(h, '.config'), 'Claude');
  return path.join(taban, 'claude-code-sessions');
}

function metaAra(dir, ad, derinlik = 3) {
  let girdiler;
  try { girdiler = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const g of girdiler) if (g.isFile() && g.name === ad) return path.join(dir, g.name);
  if (derinlik > 0) for (const g of girdiler) if (g.isDirectory()) { const r = metaAra(path.join(dir, g.name), ad, derinlik - 1); if (r) return r; }
  return null;
}

async function oturumKipi(o) {
  const id = o.oturum.startsWith('local_') ? o.oturum : `local_${o.oturum}`;
  if (!/^local_[A-Za-z0-9-]+$/.test(id)) throw new KullanimHatasi(`Geçersiz oturum kimliği: ${o.oturum}`);
  const mk = metaKoku(o);
  const mf = metaAra(mk, `${id}.json`);
  if (!mf) { console.error(`Oturum meta verisi bulunamadı: ${id} (meta kökü: ${mk})`); return 1; }
  let meta;
  try { meta = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { console.error(`Meta okunamadı: ${mf}: ${e.message}`); return 1; }
  const { cwd, cliSessionId } = meta;
  if (!cliSessionId) { console.error(`Meta veride cliSessionId yok (oturum henüz başlamamış olabilir): ${mf}`); return 1; }
  const kok = kokBul(o);
  const ad = `${cliSessionId}.jsonl`;
  const k = cwd ? cwdKlasoru(cwd, kok) : null;
  let dosya = k && fs.existsSync(path.join(kok, k, ad)) ? path.join(kok, k, ad) : null;
  if (!dosya) for (const d of klasorler(kok)) if (fs.existsSync(path.join(kok, d, ad))) { dosya = path.join(kok, d, ad); break; }
  if (!dosya) { console.error(`Transkript bulunamadı: ${ad} (cwd: ${cwd ?? '?'}, kök: ${kok})`); return 1; }
  console.error(`# oturum: ${id} → cli ${cliSessionId}, cwd ${cwd ?? '?'}`);
  return raporYaz(dosya, o);
}

async function dosyaKipi(o) {
  const f = path.resolve(tildeAc(o.dosya));
  let st;
  try { st = fs.statSync(f); } catch { throw new KullanimHatasi(`Dosya yok: ${f}`); }
  if (!st.isFile()) throw new KullanimHatasi(`Dosya değil: ${f}`);
  return raporYaz(f, o);
}

// ---------- selftest ----------
async function selftest() {
  const BETIK = fileURLToPath(import.meta.url);
  const TEST = path.join(path.dirname(BETIK), '..', 'test', 'veri', 'son-rapor');
  const fx = (ad) => path.join(TEST, ad);
  for (const ad of ['isci-kisa-son.jsonl', 'sef.jsonl', 'isci-worktree.jsonl', 'coklu-eski.jsonl', 'coklu-yeni.jsonl', 'baska-proje.jsonl', 'yalniz-hatirlatma.jsonl', 'oturum-meta.json'])
    if (!fs.existsSync(fx(ad))) { console.error(`Test dosyası eksik: ${fx(ad)}`); return 1; }

  const gecici = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'son-rapor-test-')));
  const kok = path.join(gecici, 'kok', 'projects');
  const proj = path.join(gecici, 'iş alanı', 'proje.v2_x y'); // '.', '_', boşluk, Türkçe harf
  const wt = path.join(proj, '.claude', 'worktrees', 'isci-a1');
  const bos = path.join(gecici, 'bos-proje');
  for (const d of [kok, proj, wt, bos]) fs.mkdirSync(d, { recursive: true });
  const yerlestir = (ad, klasor, hedef, mtimeSn) => {
    const dir = path.join(kok, klasor);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, hedef);
    fs.copyFileSync(fx(ad), f);
    const t = new Date(Date.UTC(2026, 0, 1) + mtimeSn * 1000);
    fs.utimesSync(f, t, t);
    return f;
  };
  const projAd = kodla(proj);
  const wtAd = kodla(wt);
  yerlestir('isci-kisa-son.jsonl', projAd, 'aaaa0001.jsonl', 10);
  yerlestir('sef.jsonl', projAd, 'aaaa0000.jsonl', 99); // şef: en yeni, kimlikleri tool_use'da ve sonraki mesajda içerir
  yerlestir('isci-worktree.jsonl', wtAd, 'bbbb0001.jsonl', 20);
  yerlestir('coklu-eski.jsonl', projAd, 'cccc0001.jsonl', 30);
  yerlestir('coklu-yeni.jsonl', projAd, 'cccc0002.jsonl', 40);
  yerlestir('yalniz-hatirlatma.jsonl', projAd, 'dddd0001.jsonl', 50);
  yerlestir('baska-proje.jsonl', '-baska-bir-proje', 'eeee0001.jsonl', 5);
  // Uzun yol: Claude Code 200 karakterde kırpar ve '-<özet>' ekler.
  const uzun = path.join(gecici, 'u'.repeat(120), 'v'.repeat(120));
  const uzunAd = kodla(uzun).slice(0, AD_SINIRI) + '-1abc2de';
  const uzunF = yerlestir('baska-proje.jsonl', uzunAd, 'ffff0001.jsonl', 6);
  fs.writeFileSync(uzunF, fs.readFileSync(uzunF, 'utf8').replaceAll('/sentetik/baska-proje', uzun.replaceAll('\\', '\\\\')).replaceAll('SR-TEST-BASKA-0005', 'SR-TEST-UZUN-0006'));
  // Oturum meta verisi (sentetik)
  const meta = path.join(gecici, 'meta', 'hesap', 'org');
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, 'local_test-0001.json'),
    fs.readFileSync(fx('oturum-meta.json'), 'utf8').replace('"__CWD__"', JSON.stringify(wt)));

  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(gecici, 'kok'), HOME: gecici, USERPROFILE: gecici }; // gerçek ev dizinine dokunulmaz
  const calis = (args, cwd = proj, ek = {}) => {
    const r = spawnSync(process.execPath, [BETIK, ...args], { cwd, env: { ...env, ...ek }, encoding: 'utf8' });
    return { kod: r.status, out: r.stdout, err: r.stderr };
  };
  const js = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

  const vakalar = [
    ['kodlama: "." "_" boşluk Türkçe → "-"', () => kodla('/a/b.c_d e/çş') === '-a-b-c-d-e---' && kodla('C:\\x\\.y') === 'C--x--y'],
    ['kodlama: cwd (".", "_", boşluk) --proje vermeden çözülür', () => {
      const r = calis(['--liste', '--json']);
      const j = js(r);
      return r.kod === 0 && Array.isArray(j) && j.some((s) => s.projeKlasoru === projAd);
    }],
    ['kodlama: 200+ karakterlik kırpılmış klasör adı çözülür', () => {
      fs.mkdirSync(uzun, { recursive: true });
      const r = calis(['--liste', '--json', '--proje', uzun]);
      const j = js(r);
      return r.kod === 0 && j?.[0]?.projeKlasoru === uzunAd;
    }],
    ['--kok varsayılanı $CLAUDE_CONFIG_DIR/projects', () => calis(['--liste', '--json']).kod === 0],
    ['worktree kardeş klasörü bulunur (--proje yok)', () => {
      const j = js(calis(['--bul', 'SR-TEST-WT-0002', '--json']));
      return j?.projeKlasoru === wtAd && j.sonMesaj?.metin.includes('WORKTREE RAPORU');
    }],
    ['şef transkripti elenir (kimlik tool_use ve sonraki mesajda)', () => {
      const r = calis(['--bul', 'SR-TEST-KISA-0001', '--json']);
      const j = js(r);
      return r.kod === 0 && path.basename(j.dosya) === 'aaaa0001.jsonl' && j.eslesmeler.length === 1;
    }],
    ['system-reminder içindeki metin eşleşmez → çıkış 1', () => calis(['--bul', 'SR-TEST-HATIRLATMA-0004']).kod === 1],
    ['tüm kök aşaması: başka proje bulunur', () => {
      const j = js(calis(['--bul', 'SR-TEST-BASKA-0005', '--json']));
      return j && path.basename(j.dosya) === 'eeee0001.jsonl';
    }],
    ['kısa son mesaj + ÖNCEKİ UZUN MESAJ', () => {
      const r = calis(['--bul', 'SR-TEST-KISA-0001']);
      const j = js(calis(['--bul', 'SR-TEST-KISA-0001', '--json']));
      const a = r.out.indexOf('KISA SON MESAJ'), b = r.out.indexOf('# ===== ÖNCEKİ UZUN MESAJ'), c = r.out.indexOf('UZUN ARA RAPOR');
      return r.kod === 0 && a > 0 && b > a && c > b && /# son mesaj: 2026-01-01T00:03:00\.000Z, \d+ karakter/.test(r.out) &&
        j.sonMesaj.uzunluk < 600 && j.oncekiUzun?.uzunluk >= 600 && j.oncekiUzun.zaman === '2026-01-01T00:01:00.000Z';
    }],
    ['--min küçükse önceki uzun eklenmez', () => js(calis(['--bul', 'SR-TEST-KISA-0001', '--json', '--min', '10']))?.oncekiUzun === null],
    ['çoklu eşleşme: en son değişen seçilir, hepsi stderr\'de', () => {
      const r = calis(['--bul', 'SR-TEST-COK-0003', '--json']);
      const j = js(r);
      return r.kod === 0 && path.basename(j.dosya) === 'cccc0002.jsonl' && j.eslesmeler.length === 2 &&
        r.err.includes('2 eşleşme') && r.err.includes('cccc0001.jsonl') && r.err.includes('cccc0002.jsonl');
    }],
    ['değer verilmemiş bayrak → çıkış 2', () =>
      calis(['--bul']).kod === 2 && calis(['--bul', '--json']).kod === 2 && calis(['--liste', '--proje']).kod === 2 && calis(['--min']).kod === 2],
    ['sayı olmayan --min, olmayan dosya/klasör → çıkış 2', () =>
      calis(['--bul', 'x', '--min', 'abc']).kod === 2 && calis(['--bul', 'x', '--min', 'NaN']).kod === 2 &&
      calis([path.join(gecici, 'yok.jsonl')]).kod === 2 && calis(['--bul', 'x', '--kok', path.join(gecici, 'yok')]).kod === 2 &&
      calis(['--liste', '--proje', '-olmayan-klasor']).kod === 2 && calis(['--liste'], bos).kod === 2 && calis(['--zzz']).kod === 2],
    ['eşleşme yok → çıkış 1', () => calis(['--bul', 'HIC-YOK-9999']).kod === 1],
    ['--json biçimi', () => {
      const j = js(calis(['--bul', 'SR-TEST-KISA-0001', '--json']));
      const anahtar = (o) => Object.keys(o).sort().join(',');
      return j && anahtar(j) === 'dosya,eslesmeler,oncekiUzun,oturumId,projeKlasoru,sonMesaj' &&
        anahtar(j.sonMesaj) === 'metin,uzunluk,zaman' && anahtar(j.oncekiUzun) === 'metin,uzunluk,zaman' &&
        j.oturumId === 'sentetik-oturum-kisa' && j.projeKlasoru === projAd &&
        anahtar(j.eslesmeler[0]) === 'dosya,ilkIstek,mtime' && !Number.isNaN(Date.parse(j.eslesmeler[0].mtime));
    }],
    ['dosya yolu kipi (eski kullanım) + başlık satırları', () => {
      const f = path.join(kok, projAd, 'cccc0002.jsonl');
      const r = calis([f, '--min', '60']);
      return r.kod === 0 && r.out.startsWith(`# dosya: ${f}\n# proje klasörü: ${projAd}\n# son mesaj: `) && r.out.includes('YENİ RAPOR');
    }],
    ['--proje klasör adıyla --bul (eski kullanım)', () => calis(['--bul', 'SR-TEST-COK-0003', '--proje', projAd], bos).kod === 0],
    ['--oturum local_<id> meta veriden çözülür', () => {
      const j = js(calis(['--oturum', 'local_test-0001', '--meta', path.join(gecici, 'meta'), '--json']));
      return j && path.basename(j.dosya) === 'bbbb0001.jsonl';
    }],
    ['--selftest kendi kökünü kullanır (gerçek ~/.claude okunmaz)', () => !kok.startsWith(path.join(os.homedir(), '.claude'))],
  ];

  let gecen = 0;
  for (const [ad, f] of vakalar) {
    let ok = false, hata = '';
    try { ok = !!(await f()); } catch (e) { hata = ` (${e.message})`; }
    if (ok) gecen++;
    console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${ad}${hata}`);
  }
  fs.rmSync(gecici, { recursive: true, force: true });
  console.log(`${gecen}/${vakalar.length} geçti`);
  return gecen === vakalar.length ? 0 : 1;
}

// ---------- giriş ----------
const KULLANIM = `Kullanım:
  node son-rapor.mjs --bul "<BRİF KİMLİĞİ>" [--proje <klasör|yol>] [--min N] [--json] [--kok <dizin>]
  node son-rapor.mjs <dosya.jsonl> [--min N] [--json]
  node son-rapor.mjs --oturum local_<id> [--min N] [--json] [--kok <dizin>] [--meta <dizin>]
  node son-rapor.mjs --liste [--proje <klasör|yol>] [--kok <dizin>] [--json]
  node son-rapor.mjs --selftest`;

async function ana() {
  let o;
  try { o = argOku(process.argv.slice(2)); } catch (e) {
    if (e instanceof KullanimHatasi) { console.error(`${e.message}\n${KULLANIM}`); return 2; }
    throw e;
  }
  if (o.yardim) { console.log(KULLANIM); return 0; }
  try {
    switch (o.kip) {
      case 'selftest': return await selftest();
      case 'bul': return await bulKipi(o);
      case 'liste': return await listeKipi(o);
      case 'oturum': return await oturumKipi(o);
      case 'dosya': return await dosyaKipi(o);
      default: console.error(KULLANIM); return 2;
    }
  } catch (e) {
    if (e instanceof KullanimHatasi) { console.error(e.message); return 2; }
    console.error(`Beklenmeyen hata: ${e.stack ?? e}`);
    return 1;
  }
}

ana().then((k) => { process.exitCode = k; });
