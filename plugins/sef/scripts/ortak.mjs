/**
 * son-rapor.mjs, maliyet.mjs ve baglam.mjs'nin ortak yardımcıları (oturum hook'u da ayar / ölçüm işlevlerini kullanır).
 * Transkriptler ~/.claude/projects/<klasör>/<oturum>.jsonl altında durur. Worktree'de çalışan işçinin klasörü
 * ana projeninkinden farklıdır (<proje>--claude-worktrees-<ad>), bu yüzden arama ana proje + tüm worktree
 * klasörlerini kapsar. Kişisel tercihler ~/.claude/sef/profil.json'dadır (bkz. profil.mjs); oranlar ve sınırlar burada sabittir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { profilOku } from './profil.mjs';

export class KullanimHatasi extends Error {}

export const args = process.argv.slice(2);
export const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
/** Bir bayrağın tüm değerleri: --bul a --bul b,c → ['a','b','c'] */
export const optAll = (name) =>
  args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? args[i + 1].split(',') : [])).filter(Boolean);

const dizinMi = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Transkript kökü: $CLAUDE_CONFIG_DIR/projects varsa o, yoksa ~/.claude/projects. */
const cfg = process.env.CLAUDE_CONFIG_DIR;
export const BASE = cfg && dizinMi(path.join(cfg, 'projects')) ? path.join(cfg, 'projects') : path.join(os.homedir(), '.claude', 'projects');
const WT = '--claude-worktrees-';
export const AD_SINIRI = 200; // Claude Code klasör adını bu uzunlukta kırpar, sonuna '-<özet>' ekler.
const IS_WIN = process.platform === 'win32';
const adEsit = (a, b) => (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const onekMi = (s, on) => (IS_WIN ? s.toLowerCase().startsWith(on.toLowerCase()) : s.startsWith(on));

/** Claude Code'un klasör adı kodlaması: harf ve rakam dışındaki her karakter '-' olur. */
export const encode = (p) => String(p).replace(/[^a-zA-Z0-9]/g, '-');
const eskiEncode = (p) => String(p).replace(/[:\\/ ]/g, '-'); // eski sürümler '.' karakterini kodlamamış olabilir

export const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).filter(Boolean).join('\n')
      : '';

export function klasorler(kok = BASE) {
  try {
    return fs.readdirSync(kok, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/** Klasör(ler)deki .jsonl dosyaları, en son değişen önce. */
export function listing(dirs) {
  return [dirs]
    .flat()
    .flatMap((dir) => {
      let ad;
      try {
        ad = fs.readdirSync(dir);
      } catch {
        return [];
      }
      return ad
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const file = path.join(dir, f);
          try {
            return { file, mtime: fs.statSync(file).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** Dosyanın ilk `sinir` dolu satırı; dosya parça parça okunur (büyük transkriptte baştan okumak yeter). */
export function* ilkSatirlar(file, sinir = 400) {
  const fd = fs.openSync(file, 'r');
  try {
    const dec = new StringDecoder('utf8');
    const buf = Buffer.alloc(65536);
    let kalan = '';
    let n = 0;
    for (;;) {
      const r = fs.readSync(fd, buf, 0, buf.length, null);
      const bitti = r === 0;
      const parcalar = (kalan + (bitti ? dec.end() : dec.write(buf.subarray(0, r)))).split('\n');
      kalan = bitti ? '' : parcalar.pop();
      for (const p of parcalar) {
        if (!p) continue;
        if (++n > sinir) return;
        yield p;
      }
      if (bitti) return;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Klasördeki transkriptlerin ilk cwd alanı (kırpılmış uzun klasör adlarını çözmek için). */
export function ilkCwd(dir) {
  for (const f of listing(dir).slice(0, 3))
    for (const l of ilkSatirlar(f.file, 50)) {
      try {
        const j = JSON.parse(l);
        if (typeof j.cwd === 'string') return j.cwd;
      } catch {
        /* yarım satır */
      }
    }
  return null;
}

/** Bir cwd'nin kök altındaki klasör adı (yoksa null). */
export function cwdKlasoru(cwd, kok = BASE, mevcut = klasorler(kok)) {
  const ad = encode(cwd);
  if (ad.length <= AD_SINIRI) return mevcut.find((d) => adEsit(d, ad) || adEsit(d, eskiEncode(cwd))) ?? null;
  const on = ad.slice(0, AD_SINIRI) + '-';
  for (const d of mevcut.filter((d) => onekMi(d, on))) {
    const c = ilkCwd(path.join(kok, d));
    if (c && adEsit(c, cwd)) return d;
  }
  return null;
}

/** Worktree kardeşleri: <kodlanmış-cwd>--claude-worktrees-* */
export function worktreeKardesleri(cwd, kok = BASE, mevcut = klasorler(kok)) {
  const on = encode(cwd) + WT;
  if (on.length < AD_SINIRI) return mevcut.filter((d) => onekMi(d, on));
  const wtKok = path.join(cwd, '.claude', 'worktrees') + path.sep;
  return mevcut.filter((d) => {
    if (!onekMi(d, on.slice(0, AD_SINIRI))) return false;
    const c = ilkCwd(path.join(kok, d));
    return c && onekMi(c, wtKok);
  });
}

const yolMu = (v) => /[\\/]/.test(v) || /^[A-Za-z]:/.test(v) || v.startsWith('~') || v === '.' || v === '..';

export function benzerler(mevcut, ad) {
  const son = String(ad).split(/[-\\/]/).filter(Boolean).pop()?.toLowerCase() ?? '';
  const b = son ? mevcut.filter((d) => d.toLowerCase().includes(son)).slice(0, 8) : [];
  return b.length ? `\nBenzerler: ${b.join(', ')}` : '';
}

/** --proje (klasör adı ya da yol) ya da çağıranın cwd'si → { cwd|null, klasor|null, aday }. Hatada KullanimHatasi. */
export function projeCoz(kok = BASE, proje = null) {
  const mevcut = klasorler(kok);
  if (proje && !yolMu(proje)) {
    const k = mevcut.find((d) => adEsit(d, proje));
    if (!k) throw new KullanimHatasi(`Proje klasörü yok: ${path.join(kok, proje)}${benzerler(mevcut, proje)}`);
    return { cwd: null, klasor: k, aday: proje };
  }
  const p = proje ? path.resolve(expandHome(proje)) : process.cwd();
  if (proje && path.dirname(p) === kok && mevcut.some((d) => adEsit(d, path.basename(p)))) return { cwd: null, klasor: path.basename(p), aday: path.basename(p) };
  const adaylar = [p];
  try {
    const r = fs.realpathSync(p);
    if (r !== p) adaylar.push(r);
  } catch {
    /* yol yok */
  }
  for (const c of adaylar) {
    const k = cwdKlasoru(c, kok, mevcut);
    if (k) return { cwd: c, klasor: k, aday: encode(c) };
  }
  if (proje && !fs.existsSync(p)) throw new KullanimHatasi(`--proje yolu yok ve kökte karşılığı bulunamadı: ${p}`);
  const son = adaylar[adaylar.length - 1];
  return { cwd: son, klasor: null, aday: encode(son) };
}

/** Geçerli klasörün (ya da --proje'nin) transkript klasörü; bulunamazsa null. */
export function tryProjectDir() {
  try {
    const p = projeCoz(BASE, opt('proje', null));
    return p.klasor ? path.join(BASE, p.klasor) : null;
  } catch {
    return null;
  }
}

/** tryProjectDir gibi, ama bulunamazsa yakın adları önererek çıkar. */
export function projectDir() {
  const found = tryProjectDir();
  if (found) return found;
  const dir = path.join(BASE, opt('proje', null) ?? encode(process.cwd()));
  const last = process.cwd().split(/[\\/]/).pop();
  console.error(`Proje klasörü bulunamadı: ${dir}${benzerler(klasorler(), last)}\n--proje <klasör adı> ver.`);
  process.exit(2);
}

/** Ana proje klasörü + onun tüm worktree klasörleri (şef worktree içindeyse ana projeye çıkılır). */
export function projectFamilyDirs() {
  let p = null;
  try {
    p = projeCoz(BASE, opt('proje', null));
  } catch {
    /* aşağıda tüm projelere düşülür */
  }
  if (!p?.klasor) {
    console.error('Not: geçerli klasör bir proje değil; tüm projelerin transkriptleri aranıyor (--proje ile daralt).');
    return klasorler().map((d) => path.join(BASE, d));
  }
  const own = p.klasor;
  const root = own.includes(WT) ? own.slice(0, own.indexOf(WT)) : own;
  const mevcut = klasorler();
  const aile = new Set(mevcut.filter((d) => d === root || d.startsWith(root + WT)));
  aile.add(own);
  if (p.cwd) for (const d of worktreeKardesleri(p.cwd, BASE, mevcut)) aile.add(d);
  return [...aile].map((d) => path.join(BASE, d));
}

export function head(file, bytes = 300_000) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(bytes, fs.statSync(file).size));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

/**
 * Transkriptin ilk gerçek kullanıcı mesajı: işçide bu, background + brif'tir. <system-reminder> blokları atılır;
 * meta, yan zincir, sıkıştırma özeti ve '<' ile başlayan (komut, hatırlatma) mesajlar atlanır. Yoksa ''.
 */
export function firstUserText(file) {
  for (const l of ilkSatirlar(file, 400)) {
    let j;
    try {
      j = JSON.parse(l);
    } catch {
      continue;
    }
    if (j.type !== 'user' || j.isMeta || j.isSidechain || j.isCompactSummary) continue;
    const t = textOf(j.message?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (t && !t.startsWith('<')) return t;
  }
  return '';
}

/**
 * Brif kimliği (ya da benzersiz metin) İLK kullanıcı mesajında geçen transkriptler, yani işçinin kendisi.
 * Şefin transkripti de brif'i (start_session çağrısında) içerir; bu yüzden düz metin araması yalnız yedektir.
 */
export function findByText(needle) {
  if (!needle || needle.length < 4) {
    console.error('Arama metni boş ya da çok kısa (en az 4 karakter; brif kimliğini ver).');
    process.exit(1);
  }
  const all = listing(projectFamilyDirs());
  const own = all.filter(({ file }) => firstUserText(file).includes(needle));
  if (own.length) return own;
  const loose = all.filter(({ file }) => head(file).includes(needle));
  if (loose.length) console.error('Uyarı: metin hiçbir transkriptin ilk mesajında yok; ilk 300 KB eşleşmesine düşüldü (şefin transkripti de olabilir).');
  return loose;
}

// ---- Bağlam yönetimi: ayarlar ve ölçüm -------------------------------------------------------------

export const HOME = os.homedir();
export const expandHome = (p) => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const VARSAYILAN_PENCERE = 1_000_000;
const VARSAYILAN_ORAN = 0.97; // harness'ın ayarsız davranışı (get_usage: autoCompactsAtPercent 97)

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
};

// Oranlar ve sınırlar kodda sabittir; kullanıcıya açık tek bağlam tercihi profildeki baglamUyari'dır.
const SABIT = {
  uyariOrani: 0.8, // eski alan: seviye() artık profildeki mutlak baglamUyari'yı kullanır; hook uyumu için duruyor
  donguPencereDakika: 15,
  donguSikistirmaSayisi: 2,
  isciYenilemeSiniri: 2,
  hookBrifSiniri: 8000,
  hookDurumSiniri: 12000,
};

/** Sabit sınırlar + profil (baglamUyari) + harness eşiği (settings.json; yalnız okunur). */
export function ayar() {
  const s = readJson(path.join(HOME, '.claude', 'settings.json'));
  const { profil, uyarilar } = profilOku();
  return {
    ...SABIT,
    baglamUyari: profil.baglamUyari,
    profilUyarilari: uyarilar,
    durumKlasoru: expandHome('~/.claude/sef/durum'),
    pencere: s.autoCompactWindow,
    modelPencere: Object.fromEntries(Object.entries(s.modelSettings ?? {}).map(([m, v]) => [m, v?.autoCompactWindow]).filter(([, v]) => v)),
  };
}

/** Bir modelin sıkıştırma eşiği (token) ve kaynağı. */
export function esikFor(model, a = ayar()) {
  const m = String(model ?? '').replace(/\[.*\]$/, '');
  if (a.modelPencere[m]) return { esik: a.modelPencere[m], kaynak: `settings.json modelSettings.${m}` };
  if (a.pencere) return { esik: a.pencere, kaynak: 'settings.json autoCompactWindow' };
  return { esik: Math.round(VARSAYILAN_PENCERE * VARSAYILAN_ORAN), kaynak: 'harness varsayılanı (%97)' };
}

/**
 * Transkriptten bağlam ölçümü: son API çağrısının bağlam boyu, model, sıkıştırmalar
 * (compact_boundary: zaman, tetik, preTokens) ve son sıkıştırmadan sonraki ilk bağlam boyu.
 */
export function olc(file) {
  let last = null;
  let model = null;
  const sikistirmalar = [];
  let bekleyen = null; // son sıkıştırmadan sonraki ilk API çağrısını yakalamak için
  for (const j of lines(file)) {
    if (j.type === 'system' && j.subtype === 'compact_boundary') {
      bekleyen = { zaman: j.timestamp, tetik: j.compactMetadata?.trigger ?? '?', oncesi: j.compactMetadata?.preTokens ?? null, sonrasi: null };
      sikistirmalar.push(bekleyen);
      continue;
    }
    const u = j.type === 'assistant' ? j.message?.usage : null;
    if (!u || j.message?.model === '<synthetic>') continue;
    const boy = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
    last = { boy, zaman: j.timestamp };
    model = j.message.model;
    if (bekleyen && bekleyen.sonrasi === null) bekleyen.sonrasi = boy;
  }
  return { boy: last?.boy ?? 0, zaman: last?.zaman ?? null, model, sikistirmalar };
}

/** Seviye: ok / UYARI (≥ profildeki baglamUyari) / ESIK (≥ sıkıştırma eşiği). */
export function seviye(boy, model, a = ayar()) {
  const { esik, kaynak } = esikFor(model, a);
  const uyari = a.baglamUyari;
  return { seviye: boy >= esik ? 'ESIK' : boy >= uyari ? 'UYARI' : 'ok', esik, uyari, kaynak };
}

/** Son penceredeki sıkıştırma sayısı (döngü tespiti). */
export function donguVarMi(sikistirmalar, a = ayar(), simdi = Date.now()) {
  const pencere = a.donguPencereDakika * 60_000;
  const yakin = sikistirmalar.filter((s) => s.zaman && simdi - Date.parse(s.zaman) <= pencere);
  return { dongu: yakin.length >= a.donguSikistirmaSayisi, yakin: yakin.length };
}

/** Günlüğe tek satır (jsonl) ekler: ne zaman, hangi oturum, hangi token seviyesinde, neden. */
export function gunlugeYaz(kayit, a = ayar()) {
  fs.mkdirSync(a.durumKlasoru, { recursive: true });
  fs.appendFileSync(path.join(a.durumKlasoru, 'gunluk.jsonl'), JSON.stringify({ zaman: new Date().toISOString(), ...kayit }) + '\n');
}

export function* lines(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      /* yarım satır */
    }
  }
}
