/**
 * son-rapor.mjs ve maliyet.mjs'nin ortak yardımcıları.
 * Transkriptler ~/.claude/projects/<klasör>/<oturum>.jsonl altında durur. Worktree'de çalışan işçinin klasörü
 * ana projeninkinden farklıdır (<proje>--claude-worktrees-<ad>), bu yüzden arama ana proje + tüm worktree
 * klasörlerini kapsar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const args = process.argv.slice(2);
export const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
/** Bir bayrağın tüm değerleri: --bul a --bul b,c → ['a','b','c'] */
export const optAll = (name) =>
  args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? args[i + 1].split(',') : [])).filter(Boolean);

export const BASE = path.join(os.homedir(), '.claude', 'projects');
const WT = '--claude-worktrees-';
export const encode = (p) => p.replace(/[:\\/ .]/g, '-');

/** Geçerli klasörün (ya da --proje'nin) transkript klasörü; bulunamazsa null. */
export function tryProjectDir() {
  const guess = opt('proje', null) ?? encode(process.cwd());
  const dir = path.join(BASE, guess);
  if (fs.existsSync(dir)) return dir;
  // Eski sürümler '.' karakterini kodlamamış olabilir.
  const alt = path.join(BASE, process.cwd().replace(/[:\\/ ]/g, '-'));
  return fs.existsSync(alt) ? alt : null;
}

/** tryProjectDir gibi, ama bulunamazsa yakın adları önererek çıkar. */
export function projectDir() {
  const found = tryProjectDir();
  if (found) return found;
  const dir = path.join(BASE, opt('proje', null) ?? encode(process.cwd()));
  const last = process.cwd().split(/[\\/]/).pop();
  const near = fs.existsSync(BASE) ? fs.readdirSync(BASE).filter((d) => d.toLowerCase().includes(String(last).toLowerCase())) : [];
  console.error(`Proje klasörü bulunamadı: ${dir}${near.length ? `\nBenzerler: ${near.join(', ')}` : ''}\n--proje <klasör adı> ver.`);
  process.exit(2);
}

/** Ana proje klasörü + onun tüm worktree klasörleri (şef worktree içindeyse ana projeye çıkılır). */
export function projectFamilyDirs() {
  const found = tryProjectDir();
  if (!found) {
    console.error('Not: geçerli klasör bir proje değil; tüm projelerin transkriptleri aranıyor (--proje ile daralt).');
    return fs.readdirSync(BASE).map((d) => path.join(BASE, d)).filter((d) => fs.statSync(d).isDirectory());
  }
  const own = path.basename(found);
  const root = own.includes(WT) ? own.slice(0, own.indexOf(WT)) : own;
  return fs
    .readdirSync(BASE)
    .filter((d) => d === root || d.startsWith(root + WT))
    .map((d) => path.join(BASE, d));
}

export function head(file, bytes = 300_000) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(bytes, fs.statSync(file).size));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

export const textOf = (content) =>
  typeof content === 'string' ? content : (content ?? []).map((c) => (c && c.type === 'text' ? c.text : '')).join('\n');

/** Klasör(ler)deki .jsonl dosyaları, en son değişen önce. */
export function listing(dirs) {
  return [dirs]
    .flat()
    .flatMap((dir) =>
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs })),
    )
    .sort((a, b) => b.mtime - a.mtime);
}

/** Transkriptin ilk gerçek kullanıcı mesajı: işçide bu, background + brif'tir. */
export function firstUserText(file) {
  for (const line of head(file).split('\n')) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type !== 'user') continue;
    const t = textOf(j.message?.content).trim();
    if (t) return t;
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
const SKILL_DIR = path.join(HOME, '.claude', 'skills', 'sef-orkestrator');
const VARSAYILAN_PENCERE = 1_000_000;
const VARSAYILAN_ORAN = 0.97; // harness'ın ayarsız davranışı (get_usage: autoCompactsAtPercent 97)

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
};

/** Skill parametreleri (baglam.json) + harness eşiği (settings.json). */
export function ayar() {
  const b = readJson(path.join(SKILL_DIR, 'baglam.json'));
  const s = readJson(path.join(HOME, '.claude', 'settings.json'));
  return {
    uyariOrani: b.uyariOrani ?? 0.8,
    donguPencereDakika: b.donguPencereDakika ?? 15,
    donguSikistirmaSayisi: b.donguSikistirmaSayisi ?? 2,
    isciYenilemeSiniri: b.isciYenilemeSiniri ?? 2,
    durumKlasoru: expandHome(b.durumKlasoru ?? '~/.claude/sef-durum'),
    hookBrifSiniri: b.hookBrifSiniri ?? 8000,
    hookDurumSiniri: b.hookDurumSiniri ?? 12000,
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

/** Seviye: ok / UYARI / ESIK. */
export function seviye(boy, model, a = ayar()) {
  const { esik, kaynak } = esikFor(model, a);
  const uyari = Math.round(esik * a.uyariOrani);
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
