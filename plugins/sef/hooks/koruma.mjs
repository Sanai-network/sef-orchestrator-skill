#!/usr/bin/env node
/**
 * koruma.mjs: sef eklentisinin PreToolUse koruma hook'u (v2). Sözleşme: shared/ARAYUZ.md §1, §3, §4, §5.
 *
 *   (hook)  stdin'e Claude Code'un PreToolUse JSON'u gelir: {tool_name, tool_input, transcript_path, cwd, session_id, …}
 *   node koruma.mjs --selftest
 *   node koruma.mjs --yardim
 *
 * Kapsam: yalnız şef ve işçi oturumları. Rol transkriptten bulunur (ARAYUZ §4):
 *   işçi = ilk gerçek kullanıcı mesajı "ROL: İŞÇİ" ile başlıyor (Desktop'ın "Background …" bloğunda "Task:" ardı);
 *   şef  = işçi değil ve bir kullanıcı mesajının metninde <command-name>/sef:orkestrator</command-name> var ya da
 *          hatasız sonuçlanmış bir Skill(sef:orkestrator) çağrısı var;
 *   diğer = hiçbiri ya da transkript okunamadı. Diğer oturumda hook karışmaz: izin verir, log'a yazmaz.
 * Engeller (kural kimlikleri ARAYUZ §5): isci-oturum, isci-soru, ana-dal-push, canli, ev-silme, ayar-yazma,
 *   sef-dosyasi, isci-commit. Proje izin dosyası (<proje>/.claude/sef.local.json) yalnız ana-dal-push ve canli'yi açar.
 *   Bash komutu tırnak ve heredoc gövdeleri ayrıştırılarak incelenir; `bash -c` / `eval` içi yeniden ayrıştırılır,
 *   `python3 -c`, `node -e` ve heredoc'la verilen kod komut sayılmaz. Bilinen CLI'larda --help / --version serbesttir.
 *   Sezgiseldir: değişkenle kurulan yollar, sembolik bağlar ve PowerShell aracı görülmez.
 * Kip profildeki "koruma" alanından gelir (SEF_PROFIL ?? ~/.claude/sef/profil.json; bozuksa varsayılan, sessiz):
 *   enforce (varsayılan): engelde stdout'a permissionDecision "deny" JSON'u yazar.
 *   log: engel kararını log'a "log-engel" diye yazar, çağrı geçer.   off: hiçbir şey yapmaz.
 *   Çıkış kodu her zaman 0.
 * Log: ~/.claude/sef/koruma.log (SEF_LOG ile değişir; 5 MB'ta .1'e döner). Bash komut metni yalnız engelde yazılır.
 * Fail-open: bozuk girdi, okunamayan transkript, iç hata ya da 5 sn iç süre aşımı → çağrı geçer, çıktı yok.
 * Bağımlılık yok; Node ≥18; kabuk ya da alt süreç çağırmaz (selftest hariç).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ISCI_OTURUM = new Set(['mcp__ccd_session__start_session', 'mcp__ccd_session__hand_off_to_session', 'Workflow']);
const YAZMA_ARACLARI = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const ROL_RE = /^ROL:\s*[Iİ][SŞ][CÇ][Iİ](?![\p{L}\p{N}])/u;
const ARKA_PLAN = 'Background (from the session that started this one):';
const SEF_SKILL = 'sef:orkestrator';
const SEF_KOMUT = `<command-name>/${SEF_SKILL}</command-name>`;
const SEF_IGNE = Buffer.from(SEF_SKILL);
const ILK_ISTEK_SATIR_SINIRI = 400;
const ILK_ISTEK_BAYT_SINIRI = 8 * 1024 * 1024;
const PARCA_BAYT = 4 * 1024 * 1024;
const LOG_SINIRI = 5 * 1024 * 1024;
const SURE_MS = 5000; // hooks.json'daki 10 sn'nin altında
const ANA_DALLAR = new Set(['main', 'master']);

/** Kural → hangi rollerde geçerli, izin dosyası açar mı (ARAYUZ §5). */
const KURALLAR = {
  'isci-oturum': { roller: ['isci'], izinAcar: false },
  'isci-soru': { roller: ['isci'], izinAcar: false },
  'ana-dal-push': { roller: ['isci', 'sef'], izinAcar: true },
  canli: { roller: ['isci', 'sef'], izinAcar: true },
  'ev-silme': { roller: ['isci', 'sef'], izinAcar: false },
  'ayar-yazma': { roller: ['isci'], izinAcar: false },
  'sef-dosyasi': { roller: ['isci', 'sef'], izinAcar: false },
  'isci-commit': { roller: ['isci'], izinAcar: false },
};

// ---------- iç süre sınırı ----------
let sonAn = Infinity;
class ZamanAsimi extends Error {}
const sureBak = () => { if (Date.now() > sonAn) throw new ZamanAsimi(`zaman aşımı (${SURE_MS} ms)`); };

// ---------- rol tespiti ----------
const metinOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).filter(Boolean).join('\n')
      : '';

/** İlk gerçek kullanıcı mesajı (son-rapor.mjs'teki ilkIstek ile aynı süzgeç); dosyanın yalnız başı okunur. */
function ilkIstek(dosya) {
  const fd = fs.openSync(dosya, 'r');
  try {
    const parca = Buffer.alloc(256 * 1024);
    let artik = '', okunan = 0, satir = 0;
    for (;;) {
      sureBak();
      const n = fs.readSync(fd, parca, 0, parca.length, null);
      const son = n === 0 || okunan + n >= ILK_ISTEK_BAYT_SINIRI;
      okunan += n;
      const satirlar = (artik + parca.toString('utf8', 0, n)).split('\n');
      artik = son ? '' : satirlar.pop();
      for (const l of satirlar) {
        if (++satir > ILK_ISTEK_SATIR_SINIRI) return null;
        let j;
        try { j = JSON.parse(l); } catch { continue; }
        if (j?.type !== 'user' || j.isMeta || j.isSidechain || j.isCompactSummary) continue;
        const t = metinOf(j.message?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
        if (!t || t.startsWith('<')) continue;
        return t;
      }
      if (son) return null;
    }
  } finally { fs.closeSync(fd); }
}

function isciMi(t) {
  t = t.normalize('NFC').replace(/\r/g, '');
  if (ROL_RE.test(t)) return true;
  if (t.startsWith(ARKA_PLAN)) {
    // "Task:" satırı (ardı aynı satırda ya da alt satırda); arka planda da "Task:" geçebilir, her biri denenir.
    for (const m of t.matchAll(/(?:^|\n)Task:[ \t]*/g)) if (ROL_RE.test(t.slice(m.index + m[0].length).trimStart())) return true;
  }
  return false;
}

/** Tek satırı inceler; şef işareti bulunursa true. Skill çağrılarının kimliklerini `bekleyen`de biriktirir. */
function sefSatiri(satir, bekleyen) {
  let j;
  try { j = JSON.parse(satir); } catch { return false; }
  if (!j || j.isSidechain) return false;
  const c = j.message?.content;
  if (j.type === 'user') {
    // Yalnız metin içeriği sayılır; tool_result içinde geçen komut adı (ör. grep çıktısı) sayılmaz.
    if (metinOf(c).includes(SEF_KOMUT)) return true;
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== 'tool_result' || !bekleyen.has(b.tool_use_id)) continue;
        if (b.is_error !== true) return true;
        bekleyen.delete(b.tool_use_id);
      }
    }
  } else if (j.type === 'assistant' && Array.isArray(c)) {
    for (const b of c) {
      if (b?.type === 'tool_use' && b.name === 'Skill' && typeof b.id === 'string'
        && String(b.input?.skill ?? '').replace(/^\//, '') === SEF_SKILL) bekleyen.add(b.id);
    }
  }
  return false;
}

/**
 * Transkriptte şef işareti var mı? Büyük dosyada hızlı olmak için ham baytlarda "sef:orkestrator" (ve bekleyen
 * Skill çağrısı kimlikleri) aranır; yalnız eşleşen satırlar ayrıştırılır.
 */
export function sefMi(dosya, parcaBayt = PARCA_BAYT) {
  const fd = fs.openSync(dosya, 'r');
  try {
    const bekleyen = new Set();
    const parca = Buffer.alloc(parcaBayt);
    let artik = Buffer.alloc(0);
    for (;;) {
      sureBak();
      const n = fs.readSync(fd, parca, 0, parca.length, null);
      const buf = artik.length ? Buffer.concat([artik, parca.subarray(0, n)]) : parca.subarray(0, n);
      const son = n === 0;
      const kesim = son ? buf.length : buf.lastIndexOf(0x0a) + 1;
      // [0, kesim) yalnız tam satırlar
      let i = 0;
      while (i < kesim) {
        let p = buf.indexOf(SEF_IGNE, i);
        for (const id of bekleyen) { const q = buf.indexOf(id, i); if (q >= 0 && (p < 0 || q < p)) p = q; }
        if (p < 0 || p >= kesim) break;
        const bas = p === 0 ? 0 : buf.lastIndexOf(0x0a, p - 1) + 1;
        let bit = buf.indexOf(0x0a, p);
        if (bit < 0 || bit > kesim) bit = kesim;
        if (sefSatiri(buf.toString('utf8', bas, bit), bekleyen)) return true;
        i = bit + 1;
      }
      if (son) return false;
      artik = Buffer.from(buf.subarray(kesim));
    }
  } finally { fs.closeSync(fd); }
}

/** 'isci' | 'sef' | 'diger'. Okunamayan transkript 'diger' (fail-open); süre aşımı yukarı fırlatılır. */
export function rolBul(transkript) {
  if (typeof transkript !== 'string' || !transkript) return 'diger';
  try {
    const t = ilkIstek(transkript);
    if (t !== null && isciMi(t)) return 'isci';
    return sefMi(transkript) ? 'sef' : 'diger';
  } catch (e) {
    if (e instanceof ZamanAsimi) throw e;
    return 'diger';
  }
}

// ---------- kabuk ayrıştırma (sezgisel) ----------
const YON = '\u0000>'; // yönlendirme işareti (tırnak içindeki ">" ile karışmasın)

/** `<<` ardındaki heredoc sınırlayıcısı: [ad, sonraki konum]. */
function heredocAd(src, i) {
  const n = src.length;
  if (src[i] === '-') i++;
  while (src[i] === ' ' || src[i] === '\t') i++;
  let d = '';
  while (i < n && !/[\s;|&<>()]/.test(src[i])) { if (src[i] !== "'" && src[i] !== '"' && src[i] !== '\\') d += src[i]; i++; }
  return [d, i];
}

/** Bekleyen heredoc gövdelerini (satır başı i) sınırlayıcı satırına kadar atlar; sonraki konumu verir. */
function heredocAtla(src, i, liste) {
  const n = src.length;
  while (liste.length) {
    const d = liste.shift();
    while (i < n) {
      const k = src.indexOf('\n', i);
      const satir = src.slice(i, k < 0 ? n : k).replace(/\r$/, '');
      i = k < 0 ? n : k + 1;
      if (satir.replace(/^\t+/, '') === d) break;
    }
  }
  return i;
}

const backtickSonu = (src, i) => { for (; i < src.length; i++) { if (src[i] === '\\') i++; else if (src[i] === '`') return i; } return -1; };

/** Çift tırnağın kapandığı yer (i açılıştan sonrası); içteki $( ) ve backtick atlanır. Yoksa -1. */
function ciftTirnakSonu(src, i) {
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === '"') return i;
    else if (c === '$' && src[i + 1] === '(') { i = altKabukSonu(src, i + 2); if (i < 0) return -1; }
    else if (c === '`') { i = backtickSonu(src, i + 1); if (i < 0) return -1; }
  }
  return -1;
}

/** `$(` ardından (i) eşleşen `)`'nin yeri; tırnaklar, iç içe $( ), backtick ve heredoc gövdeleri atlanır. Yoksa -1. */
function altKabukSonu(src, i) {
  const n = src.length, heredoclar = [];
  let derin = 1;
  while (i < n) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = src.indexOf("'", i + 1); if (j < 0) return -1; i = j + 1; continue; }
    if (c === '"') { const j = ciftTirnakSonu(src, i + 1); if (j < 0) return -1; i = j + 1; continue; }
    if (c === '`') { const j = backtickSonu(src, i + 1); if (j < 0) return -1; i = j + 1; continue; }
    if (c === '\n' && heredoclar.length) { i = heredocAtla(src, i + 1, heredoclar); continue; }
    if (c === '<' && src[i + 1] === '<') {
      if (src[i + 2] === '<') { i += 3; continue; }
      const [d, j] = heredocAd(src, i + 2); heredoclar.push(d); i = j; continue;
    }
    if (c === '(') derin++;
    else if (c === ')' && --derin === 0) return i;
    i++;
  }
  return -1;
}

/**
 * Komutu bölümlere (; && || | & satır sonu, alt kabuk) ve sözcüklere ayırır; tırnakları açar, heredoc gövdesini atlar.
 * Çift tırnak içindeki $( … ) ve `…` gerçek komuttur: ayrı bölümler olarak yeniden ayrıştırılır.
 */
export function ayristir(src) {
  const bolumler = [], icler = [];
  let bolum = [], w = null, i = 0;
  const n = src.length;
  const heredoclar = [];
  const sozcuk = () => { if (w !== null) { bolum.push(w); w = null; } };
  const bitir = () => { sozcuk(); if (bolum.length) bolumler.push(bolum); bolum = []; };
  while (i < n) {
    const c = src[i];
    if (c === '\\' && i + 1 < n) { if (src[i + 1] !== '\n') w = (w ?? '') + src[i + 1]; i += 2; continue; }
    if (c === "'") { const j = src.indexOf("'", i + 1); const e = j < 0 ? n : j; w = (w ?? '') + src.slice(i + 1, e); i = e + 1; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      // bash gibi: çift tırnakta \ yalnız $ ` " \ ve satır sonunu kaçırır (Windows yolu "C:\Users\…" bozulmaz).
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n && '$`"\\\n'.includes(src[j + 1])) { if (src[j + 1] !== '\n') s += src[j + 1]; j += 2; }
        else if (src[j] === '$' && src[j + 1] === '(') { const e = altKabukSonu(src, j + 2); const son = e < 0 ? n : e; icler.push(src.slice(j + 2, son)); s += '$(…)'; j = son + 1; }
        else if (src[j] === '`') { const e = backtickSonu(src, j + 1); const son = e < 0 ? n : e; icler.push(src.slice(j + 1, son)); s += '`…`'; j = son + 1; }
        else s += src[j++];
      }
      w = (w ?? '') + s; i = j + 1; continue;
    }
    if (c === '#' && w === null) { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '\n') { bitir(); i = heredocAtla(src, i + 1, heredoclar); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { sozcuk(); i++; continue; }
    if (c === '(' || c === ')' || c === '`') { bitir(); i++; continue; }
    if (c === '&' && src[i + 1] === '>') { sozcuk(); bolum.push(YON); i += src[i + 2] === '>' ? 3 : 2; continue; }
    if (c === ';' || c === '|' || c === '&') { bitir(); i++; if (src[i] === c || (c === '|' && src[i] === '&')) i++; continue; }
    if (c === '<' || c === '>') {
      if (w !== null && /^\d+$/.test(w)) w = null; // 2> gibi fd öneki
      sozcuk();
      if (c === '<' && src[i + 1] === '<') {
        if (src[i + 2] === '<') { i += 3; continue; } // here-string: ardındaki sözcük sıradan argüman olur
        const [d, j] = heredocAd(src, i + 2); heredoclar.push(d); i = j; continue;
      }
      i++;
      if (c === '>' && (src[i] === '>' || src[i] === '|')) i++;
      if (src[i] === '&') { i++; while (i < n && /[0-9-]/.test(src[i])) i++; continue; } // >&2: fd kopyası
      if (c === '>') bolum.push(YON); else bolum.push('\u0000<');
      continue;
    }
    w = (w ?? '') + c; i++;
  }
  bitir();
  for (const ic of icler) bolumler.push(...ayristir(ic));
  return bolumler;
}

const ANAHTAR = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']);
/** Başka komutu çalıştıran önekler: değer alan bayrakları ve atlanacak konumsal argüman sayısı (timeout SÜRE). */
const SARMAL = {
  sudo: { deger: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D', '--user', '--group'] },
  env: { deger: ['-u', '--unset', '-C', '--chdir'] },
  command: {}, builtin: {}, nohup: {}, exec: { deger: ['-a'] },
  time: { deger: ['-f', '-o', '--format', '--output'] },
  nice: { deger: ['-n', '--adjustment'] },
  ionice: { deger: ['-c', '-n', '-p', '--class', '--classdata'] },
  timeout: { deger: ['-s', '--signal', '-k', '--kill-after'], konum: 1 },
  gtimeout: { deger: ['-s', '--signal', '-k', '--kill-after'], konum: 1 },
  stdbuf: { deger: ['-i', '-o', '-e', '--input', '--output', '--error'] },
  caffeinate: { deger: ['-t', '-w'] },
  xargs: { deger: ['-n', '-I', '-L', '-P', '-s', '-d', '-E', '-a', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--replace'] },
};
const bayrakMi = (s) => s.startsWith('-') && s.length > 1;
/** Komut adı: yol öneki ve Windows uzantısı (.exe .cmd .bat .ps1) atılır; uzantılıysa küçük harfe iner. */
const ad = (s) => {
  const b = path.posix.basename(String(s || '').replace(/\\/g, '/'));
  const y = b.replace(/\.(?:exe|cmd|bat|ps1)$/i, '');
  return y === b ? b : y.toLowerCase();
};
const sadeBosluk = (s) => s.trim().replace(/\s+/g, ' ');

/** Bölümün komutunu ve argümanlarını verir (ortam atamaları, sudo / timeout vb. önekler atlanır); yönlendirme hedeflerini ayırır. */
function komutCoz(bolum) {
  const yaz = [], sozler = [];
  for (let k = 0; k < bolum.length; k++) {
    if (bolum[k] === YON) { if (k + 1 < bolum.length) yaz.push(bolum[++k]); continue; }
    if (bolum[k] === '\u0000<') { k++; continue; }
    sozler.push(bolum[k]);
  }
  let k = 0;
  while (k < sozler.length) {
    const w = sozler[k];
    if (ANAHTAR.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { k++; continue; }
    const s = SARMAL[ad(w)];
    if (!s) break;
    k++;
    let konum = s.konum ?? 0;
    while (k < sozler.length) {
      const x = sozler[k];
      if (x === '--') { k++; break; }
      if (bayrakMi(x)) { k += s.deger?.includes(x) ? 2 : 1; continue; }
      if (konum > 0) { konum--; k++; continue; }
      break;
    }
  }
  const kmt = sozler[k] ?? '', args = sozler.slice(k + 1);
  // İzin dosyası önekleri bu metinlerle karşılaştırılır: öneksiz komut ve bölümün tamamı.
  return { kmt, args, yaz, metinler: [sadeBosluk([kmt, ...args].join(' ')), sadeBosluk(sozler.join(' '))] };
}

// ---------- yollar (Windows'a dayanıklı) ----------
/**
 * Yolu karşılaştırılabilir biçime getirir: ~ / $HOME / $USERPROFILE açılır, \ → / (Windows), /c/… → c:/…,
 * göreli yol `dizin`e göre çözülür, . ve .. sadeleşir, sondaki / atılır; duyarsız dosya sisteminde küçük harf.
 */
export function yolCoz(t, dizin, ctx) {
  let p = String(t).replace(/^(?:~|\$HOME|\$\{HOME\}|\$USERPROFILE|\$\{USERPROFILE\})(?=[\\/]|$)/, () => ctx.ev);
  if (ctx.win) {
    p = p.replace(/\\/g, '/');
    const m = /^\/([a-zA-Z])(?=\/|$)/.exec(p);
    if (m) p = `${m[1]}:/${p.slice(3)}`;
  }
  const surucu = ctx.win && /^[a-zA-Z]:\//.test(p);
  if (!surucu && !p.startsWith('/')) p = `${dizin}/${p}`;
  let kok = '';
  if (ctx.win && /^[a-zA-Z]:\//.test(p)) { kok = p.slice(0, 2); p = p.slice(2); }
  p = path.posix.normalize(p);
  if (p.length > 1) p = p.replace(/\/+$/, '');
  p = kok + p;
  return ctx.duyarsiz ? p.toLowerCase() : p;
}

const ustMu = (ust, alt) => ust === alt || alt.startsWith(ust.endsWith('/') ? ust : `${ust}/`);

/** Hook bağlamı: ev dizini, platform, profil yolu; karşılaştırma için sadeleşmiş biçimleri de taşır. */
export function baglamKur({ ev = os.homedir(), win = process.platform === 'win32', duyarsiz, profilYolu, git = 'proje-gore', dalBul = gitDali } = {}) {
  const ctx = { ev, win, duyarsiz: duyarsiz ?? (win || process.platform === 'darwin'), git, dalBul };
  ctx.evS = yolCoz(ev, '/', ctx);
  ctx.claudeS = `${ctx.evS}/.claude`;
  ctx.profilS = new Set([yolCoz(path.join(ev, '.claude', 'sef', 'profil.json'), '/', ctx)]);
  if (profilYolu) ctx.profilS.add(yolCoz(profilYolu, '/', ctx));
  return ctx;
}

/** O anki dalı .git/HEAD'den okur (worktree'de .git dosyası gitdir'e yönlendirir). Bulunamazsa null. */
export function gitDali(dizin) {
  try {
    let d = dizin;
    for (let k = 0; k < 128; k++) {
      const g = path.join(d, '.git');
      let st = null;
      try { st = fs.statSync(g); } catch {}
      if (st) {
        let gd = g;
        if (st.isFile()) {
          const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(g, 'utf8'));
          if (!m) return null;
          gd = path.resolve(d, m[1]);
        }
        const m = /^ref:\s*refs\/heads\/(.+?)\s*$/.exec(fs.readFileSync(path.join(gd, 'HEAD'), 'utf8'));
        return m ? m[1] : null;
      }
      const ust = path.dirname(d);
      if (ust === d) return null;
      d = ust;
    }
  } catch {}
  return null;
}

// ---------- kurallar ----------
const LAUNCHCTL_OKU = new Set(['list', 'print', 'print-cache', 'print-disabled', 'blame', 'version', 'help', 'procinfo', 'managerpid', 'manageruid', 'managername', 'getenv', 'dumpstate', 'hostinfo', 'error', 'examine', 'resolveport', 'limit']);
const PAKET = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const KABUK = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);

/**
 * Yorumlayıcı bayrakları: kod = gömülü kod (betik yok), denetim = yalnız sözdizimi denetler (çalıştırmaz),
 * deger = değer alır (ardındaki sözcük betik değildir), dosya = ardındaki sözcük betiktir.
 */
const NODE_BAYRAK = { kod: ['-e', '-p', '-pe', '--eval', '--print'], denetim: ['-c', '--check'], deger: ['-r', '--require', '--import', '--loader', '--experimental-loader', '--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-concurrency', '--input-type', '--env-file', '-C', '--conditions', '--title'] };
const YORUM_BAYRAK = {
  kabuk: { kod: [], denetim: [], deger: [] }, // -c bashBak'ta yeniden ayrıştırılır; -n ve -o kabuk kuralında
  node: NODE_BAYRAK,
  ts: { ...NODE_BAYRAK, deger: [...NODE_BAYRAK.deger, '-P', '--project', '-O', '--compiler-options', '--tsconfig'] },
  python: { kod: ['-c'], denetim: [], deger: ['-W', '-X', '-Q'] },
  perl: { kod: ['-e', '-E'], denetim: ['-c'], deger: ['-I', '-M', '-m'] },
  ruby: { kod: ['-e'], denetim: ['-c'], deger: ['-I', '-r', '-C', '-E'] },
  pwsh: { kod: ['-Command', '-command', '-c', '-EncodedCommand', '-e', '-ec'], denetim: [], deger: ['-ExecutionPolicy', '-ep'], dosya: ['-File', '-file', '-f'] },
  deno: { kod: [], denetim: [], deger: ['--config', '-c', '--import-map', '--env-file'] },
};
const yorumTuru = (k) => KABUK.has(k) || k === 'source' || k === '.' ? 'kabuk'
  : /^python[\d.]*$/.test(k) ? 'python' : k === 'node' || k === 'nodejs' ? 'node' : k === 'tsx' || k === 'ts-node' ? 'ts'
  : k === 'powershell' ? 'pwsh' : YORUM_BAYRAK[k] ? k : null;
/** Test dosyası (`.test.` / `.spec.` / tests/ altı) deploy betiği sayılmaz. */
const testDosyasiMi = (b) => /(?:^|[\\/])(?:tests?|__tests__|spec)[\\/]/i.test(b) || /\.(?:test|spec)\./i.test(ad(b));
/** Değer alan global / alt komut bayrakları: değerleri konumsal argüman sayılmaz (`gh -R a/b pr merge`). */
const DEGERLI = {
  gh: ['-R', '--repo', '--hostname', '-X', '--method', '-f', '-F', '--field', '--raw-field', '-H', '--header', '--input', '-q', '--jq', '-t', '--template', '-p', '--preview', '-b', '--body', '--title', '-B', '--base'],
  npm: ['--prefix', '-w', '--workspace', '-C', '--userconfig', '--registry', '--tag', '--otp'],
  pnpm: ['-C', '--dir', '--filter', '-F', '--workspace-dir', '--tag', '--otp'],
  yarn: ['--cwd', '--tag', '--otp'],
  bun: ['--cwd', '--filter', '-F'],
  vercel: ['--scope', '-S', '--token', '-t', '--cwd', '-A', '--local-config', '--team', '-T', '-e', '--env', '-b', '--build-env', '-m', '--meta'],
  netlify: ['--site', '-s', '--dir', '-d', '--auth', '-a', '--functions', '-f', '--message', '-m', '--alias', '--filter', '--context'],
  firebase: ['--project', '-P', '--only', '--except', '--token', '--config', '-c', '-m', '--message'],
  wrangler: ['--env', '-e', '-c', '--config', '--name', '--compatibility-date'],
  fly: ['-a', '--app', '-c', '--config', '-r', '--region', '-i', '--image', '-t', '--access-token'],
  railway: ['-s', '--service', '-e', '--environment', '-p', '--project'],
  eas: ['-p', '--platform', '-e', '--profile', '--channel', '--branch', '-m', '--message'],
  kubectl: ['-n', '--namespace', '-f', '--filename', '--context', '-l', '--selector', '-o', '--output', '--kubeconfig', '-c', '--container'],
  helm: ['-n', '--namespace', '-f', '--values', '--kube-context', '--set', '--version', '--kubeconfig'],
  terraform: ['-var', '-var-file', '-target'],
  docker: ['--config', '-H', '--host', '--context', '-c', '-l', '--log-level'],
  gcloud: ['--project', '--region', '--zone', '--account', '--format', '--configuration', '--filter', '--impersonate-service-account'],
  aws: ['--profile', '--region', '--output', '--endpoint-url', '--query'],
  az: ['--subscription', '-g', '--resource-group', '-o', '--output', '--query'],
  supabase: ['--workdir', '--project-ref', '--db-url', '-p', '--password'],
  prisma: ['--schema'],
  make: ['-C', '--directory', '-f', '--file', '--makefile'],
  cargo: ['--manifest-path', '-p', '--package', '--registry', '--token'],
  twine: ['-r', '--repository', '-u', '--username', '-p', '--password'],
  git: ['-o', '--push-option', '--repo', '--receive-pack', '--exec'],
};
DEGERLI.flyctl = DEGERLI.fly;
/** Konumsal argümanlar; `degerli` bayraklarının ardındaki değer atlanır. */
const pozisyonel = (a, degerli = []) => {
  const p = [];
  for (let j = 0; j < a.length; j++) {
    if (degerli.includes(a[j])) { j++; continue; }
    if (!bayrakMi(a[j])) p.push(a[j]);
  }
  return p;
};
/** Bilinen CLI'da yardım, sürüm ya da kuru çalıştırma mı? (`--`'dan sonrası betiğe gider, sayılmaz.) */
const muafMi = (a) => {
  const k = a.indexOf('--');
  const once = k < 0 ? a : a.slice(0, k);
  return once.some((x) => x === '--help' || x === '-h' || x === '--version' || x === '--dry-run' || x.startsWith('--dry-run=')) || pozisyonel(once)[0] === 'help';
};
/**
 * Ad canlıya giden bir iş mi? (paket betiği, make hedefi, betik dosyası; uzantı atılır)
 * Canlı: bir parçası deploy / redeploy / undeploy / publish ile başlıyor ya da ":" ile ayrılmış bir bölüm tam olarak
 * "release" (`release`, `release:prod`). Değil: test / lint / check / spec parçası var ya da ilk parça pre / post / test /
 * lint / check ile başlıyor. Örnek: `deploy:prod`, `build:deploy`, `deploy-prod.sh`, `redeploy.js` canlı;
 * `predeploy-check`, `test:deploy-unit`, `lint:deploy`, `check-deploy-config.mjs`, `release-notes` değil.
 */
export function canliAdMi(s) {
  const x = String(s ?? '').toLowerCase().replace(/\.(?:[cm]?[jt]s|sh|bash|zsh|py|rb|pl|ps1)$/, '');
  const p = x.split(/[:\-_./]+/).filter(Boolean);
  if (!p.length || /^(?:pre|post|test|lint|check)/.test(p[0]) || p.some((t) => ['test', 'tests', 'spec', 'lint', 'check'].includes(t))) return false;
  return p.some((t) => /^(?:(?:re|un)?deploy|publish)/.test(t)) || x.split(':').includes('release');
}
const deployFiili = (p) => p.slice(0, 4).includes('deploy') || (p.slice(0, 4).some((t) => /^deployments?$/.test(t)) && p.slice(0, 4).some((t) => ['create', 'update', 'delete', 'cancel'].includes(t)));
/** (p: değerleri atılmış konumsallar, a: ham argümanlar) → canlıya dokunuyor mu? */
const DEPLOY_CLI = {
  vercel: (p, a) => p.length === 0 || a.some((x) => ['deploy', '--prod', '--production', 'promote', 'redeploy', 'rollback'].includes(x)) || (p[0] === 'alias' && p[1] === 'set'),
  netlify: (p) => p[0] === 'deploy',
  firebase: (p) => p[0] === 'deploy',
  wrangler: (p) => ['deploy', 'publish'].includes(p[0]) || (p[0] === 'pages' && p[1] === 'deploy') || (p[0] === 'versions' && p[1] === 'deploy'),
  fly: (p) => p[0] === 'deploy',
  flyctl: (p) => p[0] === 'deploy',
  railway: (p, a) => ['up', 'deploy', 'redeploy', 'delete', 'restart', 'down'].includes(p[0])
    || (['variables', 'variable'].includes(p[0]) && (a.some((x) => x === '--set' || x.startsWith('--set=')) || ['set', 'delete'].includes(p[1]))),
  eas: (p) => ['submit', 'update'].includes(p[0]),
  kubectl: (p) => ['apply', 'delete', 'replace', 'scale'].includes(p[0]) || (p[0] === 'rollout' && !['status', 'history'].includes(p[1])),
  terraform: (p) => ['apply', 'destroy'].includes(p[0]),
  helm: (p) => ['install', 'upgrade', 'uninstall', 'rollback'].includes(p[0]),
  gcloud: deployFiili,
  aws: (p) => deployFiili(p) || (p[0] === 'lambda' && ['update-function-code', 'publish-version'].includes(p[1])),
  az: deployFiili,
  docker: (p) => p[0] === 'push',
  supabase: (p) => (p[0] === 'db' && p[1] === 'push') || (p[0] === 'functions' && p[1] === 'deploy'),
  prisma: (p) => p[0] === 'migrate' && p[1] === 'deploy',
  make: (p) => p.some((t) => !t.includes('=') && canliAdMi(t)),
  cargo: (p) => p[0] === 'publish',
  twine: (p) => p[0] === 'upload',
};

/** Yorumlayıcıya verilen betik dosyası; gömülü kod, yalnız sözdizimi denetimi ya da stdin ise null. */
function betikAdi(k, args) {
  const tur = yorumTuru(k), t = YORUM_BAYRAK[tur];
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a === '--') return args[j + 1] ?? null;
    if (a === '-' || t.kod.includes(a) || t.denetim.includes(a)) return null;
    if (tur === 'python' && a === '-m') return args[j + 1] ?? null;
    if (t.dosya?.includes(a)) return args[j + 1] ?? null;
    if (tur === 'deno') { if (a === 'eval') return null; if (['run', 'test', 'bench'].includes(a) && j === args.findIndex((x) => !bayrakMi(x))) { if (a !== 'run') return null; continue; } }
    if (t.deger.includes(a)) { j++; continue; }
    if (tur === 'kabuk' && /^[-+][a-zA-Z]+$/.test(a)) {
      if (a[0] === '-' && a.includes('n')) return null; // -n: yalnız sözdizimi
      if (/[oO]$/.test(a)) j++; // -o pipefail, -euo pipefail
      continue;
    }
    if (!bayrakMi(a)) return a;
  }
  return null;
}

/** gh: PR birleştirme (pr merge, REST PUT …/pulls/N/merge, GraphQL mergePullRequest) ve sürüm yayını. */
function ghBak(args) {
  if (muafMi(args)) return null;
  const p = pozisyonel(args, DEGERLI.gh);
  if (p[0] === 'pr' && p[1] === 'merge') return { kural: 'ana-dal-push', neden: 'gh pr merge: PR birleştirme' };
  if (p[0] === 'release' && p[1] === 'create') return { kural: 'canli', neden: 'gh release create: yayın' };
  if (p[0] === 'api') {
    let yontem = 'GET';
    for (let j = 0; j < args.length; j++) {
      const m = /^(?:-X|--method=?)(.*)$/.exec(args[j]);
      if (m) yontem = (m[1] || args[j + 1] || '').toUpperCase();
    }
    if (yontem === 'PUT' && /(?:^|\/)pulls\/[^/]+\/merge\/?$/.test(p[1] ?? '')) return { kural: 'ana-dal-push', neden: 'gh api …/pulls/N/merge: PR birleştirme' };
    if (p[1] === 'graphql' && args.some((a) => /mergePullRequest/.test(a))) return { kural: 'ana-dal-push', neden: 'gh api graphql mergePullRequest: PR birleştirme' };
  }
  return null;
}

function deployBak(kmt, args) {
  const k = ad(kmt);
  if (k === 'npx' || k === 'bunx' || (k === 'pnpm' && ['dlx', 'exec'].includes(args[0])) || (k === 'npm' && args[0] === 'exec')) {
    const geri = k === 'npx' || k === 'bunx' ? args : args.slice(1);
    const p = geri.findIndex((x) => !bayrakMi(x));
    return p < 0 ? null : deployBak(geri[p], geri.slice(p + 1));
  }
  if (k === 'gh') return ghBak(args);
  if (PAKET.has(k)) {
    if (muafMi(args)) return null;
    let p = pozisyonel(args, DEGERLI[k]);
    if (k === 'yarn' && p[0] === 'workspace') p = p.slice(2);
    if (p[0] === 'publish') return { kural: 'canli', neden: `${k} publish: paket yayını` };
    const betik = ['run', 'run-script'].includes(p[0]) ? p[1] : p[0];
    if (betik && canliAdMi(betik)) return { kural: 'canli', neden: `deploy betiği: ${k} ${p.join(' ').slice(0, 80)}` };
    return null;
  }
  if (yorumTuru(k)) {
    const b = betikAdi(k, args);
    if (b && !testDosyasiMi(b) && canliAdMi(ad(b))) return { kural: 'canli', neden: `deploy betiği: ${k} ${b}` };
    return null;
  }
  if (DEPLOY_CLI[k]) {
    if (!muafMi(args) && DEPLOY_CLI[k](pozisyonel(args, DEGERLI[k]), args)) return { kural: 'canli', neden: `deploy / yayın komutu: ${[k, ...args].join(' ').slice(0, 80)}` };
    return null;
  }
  if (canliAdMi(k)) return { kural: 'canli', neden: `deploy betiği: ${kmt}` };
  return null;
}

// Commit üreten git alt komutları (isci-commit); --abort / --quit ve commit'siz kipleri hariç.
const GIT_COMMIT = new Set(['commit', 'merge', 'cherry-pick', 'rebase', 'revert', 'am']);
function gitBak(args, dizin, ctx) {
  let k = 0, d = dizin;
  while (k < args.length) {
    const a = args[k];
    if (a === '-C') { d = yolCoz(args[k + 1] ?? '.', d, ctx); k += 2; continue; }
    if (['-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'].includes(a)) { k += 2; continue; }
    if (a.startsWith('-')) { k++; continue; }
    break;
  }
  const alt = args[k], geri = args.slice(k + 1);
  if (GIT_COMMIT.has(alt)) {
    if (muafMi(geri) || geri.some((x) => ['--abort', '--quit', '--no-commit', '--show-current-patch'].includes(x)) || (['cherry-pick', 'revert'].includes(alt) && geri.includes('-n'))) return null;
    return { kural: 'isci-commit', neden: `git ${alt}: commit üretir; profilde "git": "commit-yok"` };
  }
  if (alt !== 'push' || muafMi(geri) || geri.includes('-n')) return null;
  if (geri.some((x) => x === '--all' || x === '--mirror')) return { kural: 'ana-dal-push', neden: 'git push --all/--mirror: main/master da gider' };
  const poz = pozisyonel(geri, DEGERLI.git);
  // --repo verilince uzak depo konumsal değildir: ilk konumsal argüman da refspec'tir.
  const hedefler = (geri.some((x) => x.startsWith('--repo')) ? poz : poz.slice(1)).map((r) => r.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, ''));
  const ana = hedefler.find((h) => ANA_DALLAR.has(h));
  if (ana) return { kural: 'ana-dal-push', neden: `git push: ${ana} dalına push` };
  if (hedefler.length === 0 || hedefler.includes('HEAD')) {
    const dal = ctx.dalBul(d);
    if (dal && ANA_DALLAR.has(dal)) return { kural: 'ana-dal-push', neden: `git push: o anki dal ${dal}` };
  }
  return null;
}

function rmBak(args, dizin, ctx) {
  const bayrak = args.filter(bayrakMi);
  if (!bayrak.some((b) => b === '--recursive' || (/^-[^-]/.test(b) && /[rR]/.test(b)))) return null;
  for (const t of args.filter((x) => !bayrakMi(x))) {
    const p = yolCoz(t, dizin, ctx);
    if (ustMu(p, ctx.evS)) return { kural: 'ev-silme', neden: `rm -r ${t}: ev dizinini ya da üstünü siler` };
    if (path.posix.dirname(p) === ctx.evS && /[*?]/.test(path.posix.basename(p))) return { kural: 'ev-silme', neden: `rm -r ${t}: ev dizinindeki her şeyi siler` };
    if (ustMu(ctx.claudeS, p)) return { kural: 'ev-silme', neden: `rm -r ${t}: ~/.claude altını siler` };
  }
  return null;
}

function yazmaHedefleri(kmt, args, yaz) {
  const k = ad(kmt);
  const h = [...yaz];
  const poz = pozisyonel(args);
  if (k === 'tee' || k === 'truncate' || k === 'rm' || k === 'unlink' || k === 'shred' || k === 'touch') h.push(...poz);
  else if ((k === 'sed' || k === 'gsed') && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) h.push(...poz);
  else if (k === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a))) h.push(...poz);
  else if (['cp', 'mv', 'install', 'ln', 'rsync', 'scp', 'ditto'].includes(k) && poz.length) h.push(poz[poz.length - 1]);
  else if (k === 'dd') h.push(...args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3)));
  return h;
}

/** Yazma hedefi korunan bir dosya mı? (ayar-yazma yalnız işçide geçerli; rol süzgeci sonra uygulanır.) */
function hedefBak(t, dizin, ctx) {
  const p = yolCoz(t, dizin, ctx);
  const taban = path.posix.basename(p);
  const ust = path.posix.dirname(p);
  const md = ctx.duyarsiz ? 'claude.md' : 'CLAUDE.md';
  const sonuc = [];
  if (ctx.profilS.has(p)) sonuc.push({ kural: 'sef-dosyasi', neden: `${t}: profili yalnız kullanıcı yazar` });
  if (taban === 'sef.local.json' && path.posix.basename(ust) === '.claude') sonuc.push({ kural: 'sef-dosyasi', neden: `${t}: proje izin dosyasını yalnız kullanıcı yazar` });
  if (path.posix.basename(ust) === '.claude' && /^settings[^/]*\.json$/.test(taban)) {
    sonuc.push({ kural: 'ayar-yazma', neden: ust === ctx.claudeS ? `${t}: ~/.claude/settings*.json'a yazma` : `${t}: proje .claude/settings*.json'a yazma (hook'ları kapatabilir)` });
  }
  if (taban === md) sonuc.push({ kural: 'ayar-yazma', neden: `${t}: CLAUDE.md'ye yazma` });
  return sonuc;
}

/** Bash komutunu inceler; bulguların listesini verir: {kural, neden, metinler}. */
export function bashBak(komut, ctx, cwd, derinlik = 0) {
  const bulgular = [];
  let dizin = cwd;
  for (const bolum of ayristir(String(komut ?? ''))) {
    const { kmt, args, yaz, metinler } = komutCoz(bolum);
    const k = ad(kmt);
    const ekle = (b) => { if (b) bulgular.push({ ...b, metinler: b.metinler ?? metinler }); };
    if (k === 'cd') { dizin = yolCoz(pozisyonel(args)[0] ?? ctx.ev, dizin, ctx); continue; }
    // Kabuğa verilen kod gerçek komuttur: yeniden ayrıştır.
    if (derinlik < 4) {
      if (k === 'eval') { bulgular.push(...bashBak(args.join(' '), ctx, dizin, derinlik + 1)); continue; }
      if (KABUK.has(k)) {
        const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
        if (c >= 0) { const kod = args.slice(c + 1).find((a) => !bayrakMi(a)); if (kod) bulgular.push(...bashBak(kod, ctx, dizin, derinlik + 1)); continue; }
      }
    }
    if (k === 'launchctl') {
      const p = pozisyonel(args)[0];
      if (!LAUNCHCTL_OKU.has(p) && !muafMi(args)) ekle({ kural: 'canli', neden: `launchctl ${p ?? ''}: sistem servislerini değiştirir`.trim() });
    } else if (k === 'git') ekle(gitBak(args, dizin, ctx));
    else if (k === 'rm') ekle(rmBak(args, dizin, ctx));
    ekle(deployBak(kmt, args));
    for (const t of yazmaHedefleri(kmt, args, yaz)) for (const b of hedefBak(t, dizin, ctx)) ekle(b);
  }
  return bulgular;
}

// ---------- proje izin dosyası ----------
/** cwd'den yukarı çıkarak ilk <dizin>/.claude/sef.local.json'u okur; ev dizinine varınca durur. */
export function izinOku(cwd, ctx) {
  let d = path.resolve(cwd);
  for (let k = 0; k < 128; k++) {
    if (yolCoz(d, '/', ctx) === ctx.evS) break;
    const f = path.join(d, '.claude', 'sef.local.json');
    let metin = null;
    try { metin = fs.readFileSync(f, 'utf8'); } catch {}
    if (metin !== null) {
      try {
        const j = JSON.parse(metin);
        if (!j || !Array.isArray(j.izinli)) throw new Error('"izinli" listesi yok');
        const desenler = j.izinli.filter((x) => typeof x === 'string' && x.trim()).map((x) => {
          const ham = sadeBosluk(x);
          return { ham, re: ham === '*' ? null : new RegExp(`^${ham.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}`) };
        });
        return { dosya: f, desenler };
      } catch (e) {
        return { dosya: f, desenler: [], uyari: `izin dosyası bozuk (${f}): ${String(e?.message ?? e).slice(0, 120)}; izin yok sayıldı` };
      }
    }
    const ust = path.dirname(d);
    if (ust === d) break;
    d = ust;
  }
  return { dosya: null, desenler: [] };
}

const izinBul = (metinler, desenler) => desenler.find((d) => d.re === null || metinler.some((m) => d.re.test(m)));

// ---------- değerlendirme ----------
/** Hook girdisini değerlendirir: {rol, arac, karar: 'izin'|'engel', engeller[], izinler[], uyari?, izinDosyasi?}. */
export function degerlendir(girdi, secenek = {}) {
  if (!girdi || typeof girdi !== 'object') throw new Error('girdi bir JSON nesnesi değil');
  const arac = String(girdi.tool_name ?? '');
  const cwd = typeof girdi.cwd === 'string' && girdi.cwd ? girdi.cwd : process.cwd();
  const rol = rolBul(girdi.transcript_path);
  const sonuc = { rol, arac, karar: 'izin', engeller: [], izinler: [] };
  if (rol === 'diger') return sonuc;
  const ctx = baglamKur(secenek);
  const cwdS = yolCoz(cwd, '/', ctx);
  let bulgular = [];
  if (ISCI_OTURUM.has(arac)) bulgular.push({ kural: 'isci-oturum', neden: `${arac}: işçi oturum açamaz, devredemez, workflow başlatamaz` });
  if (arac === 'AskUserQuestion') bulgular.push({ kural: 'isci-soru', neden: 'AskUserQuestion: işçi kullanıcıya doğrudan soru sormaz' });
  if (YAZMA_ARACLARI.has(arac)) {
    const t = girdi.tool_input?.file_path ?? girdi.tool_input?.notebook_path;
    if (typeof t === 'string' && t) bulgular.push(...hedefBak(t, cwdS, ctx));
  }
  if (arac === 'Bash') bulgular.push(...bashBak(girdi.tool_input?.command, ctx, cwdS));
  bulgular = bulgular.filter((b) => KURALLAR[b.kural].roller.includes(rol) && (b.kural !== 'isci-commit' || ctx.git === 'commit-yok'));
  if (bulgular.some((b) => KURALLAR[b.kural].izinAcar)) {
    const iz = izinOku(cwd, ctx);
    if (iz.uyari) sonuc.uyari = iz.uyari;
    sonuc.izinDosyasi = iz.dosya;
    bulgular = bulgular.filter((b) => {
      const d = KURALLAR[b.kural].izinAcar && b.metinler ? izinBul(b.metinler, iz.desenler) : null;
      if (d) sonuc.izinler.push({ kural: b.kural, onek: d.ham });
      return !d;
    });
  }
  sonuc.engeller = bulgular.filter((b, i) => bulgular.findIndex((x) => x.kural === b.kural && x.neden === b.neden) === i);
  sonuc.karar = sonuc.engeller.length ? 'engel' : 'izin';
  return sonuc;
}

/** Engel mesajı: ne olduğu ve ne yapılacağı. */
export function engelMesaji(s) {
  const satirlar = [`sef koruma hook'u bu çağrıyı engelledi (${s.rol === 'isci' ? 'işçi' : 'şef'} oturumu):`];
  for (const e of s.engeller) satirlar.push(`- [${e.kural}] ${e.neden}`);
  if (s.rol === 'isci') {
    satirlar.push(s.engeller.some((e) => e.kural === 'isci-soru')
      ? 'İşçi kullanıcıya soru sormaz: soruyu şefe yaz (SendMessage) ya da makul varsayımla ilerleyip raporuna yaz.'
      : 'Bu eylemi yapma ve başka yoldan deneme: şefe engel olarak bildir (SendMessage ya da raporunda); gerekirse şef kullanıcıya sorar.');
  } else if (s.engeller.some((e) => KURALLAR[e.kural].izinAcar)) {
    satirlar.push('Kullanıcıya sor; onaylarsa komutu kendisi çalıştırsın ya da proje izin dosyasına (<proje>/.claude/sef.local.json, "izinli" listesi) bu komutun önekini eklemesini öner.');
  } else {
    satirlar.push('Kullanıcıya sor; bu kural izin dosyasıyla açılmaz, gerekiyorsa değişikliği kullanıcı kendisi yapar.');
  }
  return satirlar.join('\n');
}

// ---------- profil, log ve çalıştırma ----------
const profilYolu = () => process.env.SEF_PROFIL || path.join(os.homedir(), '.claude', 'sef', 'profil.json');

/** Yalnız git ve koruma alanları (ARAYUZ §2); bozuk dosya ya da geçersiz değer sessizce varsayılana döner. */
export function profilOku(f = profilYolu()) {
  const p = { git: 'proje-gore', koruma: 'enforce', yol: f };
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      if (['proje-gore', 'commit-yok'].includes(j.git)) p.git = j.git;
      if (['enforce', 'log', 'off'].includes(j.koruma)) p.koruma = j.koruma;
    }
  } catch {}
  return p;
}

const logYolu = () => process.env.SEF_LOG || path.join(os.homedir(), '.claude', 'sef', 'koruma.log');

/** Log'a giden metinde gizli değerleri maskeler: URL kullanıcı bilgisi, bilinen token önekleri, --token / --password, Authorization. */
export function maskele(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1***@')
    .replace(/\b(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g, '$1***')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/\b(xox[abposr]-)[A-Za-z0-9-]+/g, '$1***')
    .replace(/(--(?:token|password|passwd|pass|api-key|secret)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi, '$1***')
    .replace(/(Authorization:\s*)(?:(Bearer|Basic|token)\s+)?[^\s'"]+/gi, (_, a, b) => `${a}${b ? `${b} ` : ''}***`);
}

function logYaz(kayit) {
  try {
    const f = logYolu();
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    try { if (fs.statSync(f).size > LOG_SINIRI) fs.renameSync(f, `${f}.1`); } catch {}
    fs.appendFileSync(f, `${JSON.stringify({ zaman: new Date().toISOString(), ...kayit })}\n`, { mode: 0o600 });
  } catch {}
}

function stdinOku() {
  return new Promise((coz, red) => {
    const parcalar = [];
    process.stdin.on('data', (p) => parcalar.push(p));
    process.stdin.on('end', () => coz(Buffer.concat(parcalar).toString('utf8')));
    process.stdin.on('error', red);
  });
}

const kisalt = (s, n = 300) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…` : s) : undefined);
const tekil = (a) => [...new Set(a)].join(',');

async function hookCalistir() {
  const test = process.env.SEF_KORUMA_TEST; // yalnız selftest: patla | yavas
  sonAn = Date.now() + (test === 'yavas' ? 300 : SURE_MS);
  // stdin hiç kapanmazsa: sessizce geç.
  setTimeout(() => process.exit(0), (test === 'yavas' ? 300 : SURE_MS) + 500).unref();
  const profil = profilOku();
  if (profil.koruma === 'off') return;
  let girdi = null;
  try {
    girdi = JSON.parse(await stdinOku());
    if (test === 'patla') throw new Error('test: yapay iç hata');
    if (test === 'yavas') for (;;) sureBak();
    const s = degerlendir(girdi, { git: profil.git, profilYolu: profil.yol });
    if (s.rol === 'diger') return;
    const engel = s.karar === 'engel';
    logYaz({
      oturum: girdi.session_id, rol: s.rol, arac: s.arac,
      karar: engel ? (profil.koruma === 'enforce' ? 'engel' : 'log-engel') : 'izin',
      kural: engel ? tekil(s.engeller.map((e) => e.kural)) : s.izinler.length ? tekil(s.izinler.map((e) => e.kural)) : undefined,
      kip: profil.koruma,
      // Gizlilik: komut metni (token, şifre içerebilir) yalnız engel kararında yazılır.
      komut: engel && s.arac === 'Bash' ? kisalt(maskele(String(girdi.tool_input?.command ?? ''))) : undefined,
      neden: engel ? s.engeller.map((e) => maskele(e.neden)) : undefined,
      onek: s.izinler.length ? [...new Set(s.izinler.map((e) => e.onek))] : undefined,
      cwd: girdi.cwd, uyari: s.uyari,
    });
    if (engel && profil.koruma === 'enforce') {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: engelMesaji(s) } }));
    }
  } catch (e) {
    logYaz({ oturum: girdi?.session_id, arac: girdi?.tool_name, karar: 'hata', kip: profil.koruma, hata: String(e?.message ?? e).slice(0, 300), not: 'fail-open: çağrı geçti' });
  }
}

// ---------- selftest ----------
async function selftest() {
  const BETIK = fileURLToPath(import.meta.url);
  const VERI = path.join(path.dirname(BETIK), '..', 'test', 'veri', 'koruma');
  const fx = (a) => path.join(VERI, a);
  const FX = ['hook-isci-arkaplan.jsonl', 'hook-isci-dogrudan.jsonl', 'hook-isci-sef-komutlu.jsonl', 'hook-diger.jsonl', 'hook-diger-alinti.jsonl', 'hook-bozuk.jsonl', 'hook-sef-komut.jsonl', 'hook-sef-skill.jsonl', 'hook-sef-skill-hata.jsonl', 'hook-sef-arac-sonucu.jsonl'];
  for (const a of FX) if (!fs.existsSync(fx(a))) { console.error(`Test dosyası eksik: ${fx(a)}`); return 1; }
  const gecici = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sef-koruma-test-')));
  const ev = path.join(gecici, 'ev');
  const proje = path.join(ev, 'proje');
  fs.mkdirSync(proje, { recursive: true });
  const T = {
    isciBg: fx('hook-isci-arkaplan.jsonl'), isciD: fx('hook-isci-dogrudan.jsonl'), isciSef: fx('hook-isci-sef-komutlu.jsonl'),
    diger: fx('hook-diger.jsonl'), digerAlinti: fx('hook-diger-alinti.jsonl'), bozuk: fx('hook-bozuk.jsonl'),
    sef: fx('hook-sef-komut.jsonl'), sefSkill: fx('hook-sef-skill.jsonl'), sefHata: fx('hook-sef-skill-hata.jsonl'), aracSonucu: fx('hook-sef-arac-sonucu.jsonl'),
    yok: path.join(gecici, 'yok.jsonl'),
  };
  const sahteDal = (dal) => () => dal;
  let gecti = 0, kaldi = 0;
  const vaka = (ad, ok) => {
    let sonuc = false, hata = '';
    try { sonuc = ok(); } catch (e) { hata = ` (${e.message})`; }
    if (sonuc) gecti++; else kaldi++;
    console.log(`${sonuc ? 'GEÇTİ' : 'KALDI'}  ${ad}${hata}`);
  };
  const D = (girdi, sec = {}) => degerlendir({ cwd: proje, ...girdi }, { ev, win: false, duyarsiz: false, dalBul: sahteDal('isci/a1'), ...sec });

  // 1) Rol tespiti
  vaka('rol: Background + Task: ROL: İŞÇİ → işçi', () => rolBul(T.isciBg) === 'isci');
  vaka('rol: system-reminder + ROL: İŞÇİ → işçi', () => rolBul(T.isciD) === 'isci');
  vaka('rol: ROL: İSCI (karışık ASCII) + sonra şef komutu → işçi (işçi önceliklidir)', () => rolBul(T.isciSef) === 'isci');
  vaka('rol: sıradan kullanıcı mesajı → diğer', () => rolBul(T.diger) === 'diger');
  vaka('rol: metnin ortasında "ROL: İŞÇİ" → diğer', () => rolBul(T.digerAlinti) === 'diger');
  vaka('rol: /sef:orkestrator komutu → şef', () => rolBul(T.sef) === 'sef');
  vaka('rol: Skill(sef:orkestrator) hatasız → şef', () => rolBul(T.sefSkill) === 'sef');
  vaka('rol: Skill(sef:orkestrator) is_error → diğer', () => rolBul(T.sefHata) === 'diger');
  vaka('rol: komut adı yalnız tool_result / Bash girdisi / yan zincirde → diğer', () => rolBul(T.aracSonucu) === 'diger');
  vaka('rol: bozuk / kullanıcı mesajsız transkript → diğer', () => rolBul(T.bozuk) === 'diger');
  vaka('rol: olmayan dosya → diğer', () => rolBul(T.yok) === 'diger');
  vaka('rol: dizin yolu → diğer', () => rolBul(gecici) === 'diger');
  vaka('rol: transcript_path yok → diğer', () => rolBul(undefined) === 'diger');
  // Desktop brifi biçimleri (Tur 1)
  const rolYaz = (ad, icerik) => { const f = path.join(gecici, `rol-${ad}.jsonl`); fs.writeFileSync(f, `${JSON.stringify({ type: 'user', message: { role: 'user', content: icerik } })}\n`); return f; };
  const BG = (x) => `${ARKA_PLAN}\nbla\n\nTask:${x}`;
  for (const [ad, icerik, bek] of [
    ['BG Task: alt satır', BG('\nROL: İŞÇİ x'), 'isci'],
    ['BG Task: aynı satır', BG(' ROL: İŞÇİ x'), 'isci'],
    ['BG CRLF', BG('\r\nROL: İŞÇİ x').replace(/\n/g, '\r\n'), 'isci'],
    ['BG CRLF + \\r\\r\\n', BG('\r\r\nROL: İŞÇİ x').replace(/\n(?!$)/g, '\r\n'), 'isci'],
    ['BG Task: iki kez, ikincisi işçi', BG('\nxx\nTask:\nROL: İŞÇİ x'), 'isci'],
    ['BG içinde ROL ama Task: değil', `${ARKA_PLAN}\nROL: İŞÇİ\n\nTask:\nsıradan`, 'diger'],
    ['BG Task: sıradan', BG('\nsıradan görev'), 'diger'],
    ['"ROL: İŞÇİM" işçi değil', 'ROL: İŞÇİM x', 'diger'],
    ['BG Task: ROL: İŞÇİM işçi değil', BG(' ROL: İŞÇİM x'), 'diger'],
    ['NFD "ROL: İŞÇİ"', 'ROL: İŞÇİ x'.normalize('NFD'), 'isci'],
    ['bitişik "ROL:İŞÇİ"', 'ROL:İŞÇİ x', 'isci'],
  ]) vaka(`rol: ${ad} → ${bek}`, () => rolBul(rolYaz(ad.replace(/[^a-z0-9]/gi, '_'), icerik)) === bek);
  vaka('rol: içe aktarma yan etkisiz (stdin beklemez, log yazmaz) ve rolBul dışa aktarılmış', () => {
    const f = path.join(gecici, 'ice-aktarma.log');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(import.meta.url)}).then((m) => console.log(typeof m.rolBul, m.rolBul(${JSON.stringify(T.isciBg)})))`], { encoding: 'utf8', timeout: 10000, env: { ...process.env, SEF_LOG: f } });
    return r.status === 0 && r.stdout.trim() === 'function isci' && !fs.existsSync(f);
  });
  // Parça sınırları: küçük parçalarla taranınca da aynı sonuç
  for (const [ad, f, bek] of [['komut', T.sef, true], ['skill', T.sefSkill, true], ['skill hata', T.sefHata, false], ['araç sonucu', T.aracSonucu, false]]) {
    for (const pb of [7, 64, 333]) vaka(`sefMi parça=${pb} bayt · ${ad} → ${bek}`, () => sefMi(f, pb) === bek);
  }
  // Büyük transkript: gürültü içinde, komut sonda
  const buyuk = path.join(gecici, 'buyuk.jsonl');
  {
    const gurultu = fs.readFileSync(T.aracSonucu, 'utf8');
    const dolgu = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(4000) }] } });
    const parcalar = [fs.readFileSync(T.diger, 'utf8')];
    for (let k = 0; k < 600; k++) parcalar.push(`${dolgu}\n`, gurultu);
    fs.writeFileSync(buyuk, parcalar.join(''));
  }
  vaka('rol: ~2.5 MB gürültülü transkript, şef işareti yok → diğer', () => rolBul(buyuk) === 'diger');
  fs.appendFileSync(buyuk, fs.readFileSync(T.sef, 'utf8'));
  vaka('rol: ~2.5 MB transkriptin sonunda /sef:orkestrator → şef', () => rolBul(buyuk) === 'sef' && sefMi(buyuk, 1000) === true);

  // 2) Karar matrisi: rol × araç (beklenen: [işçi, şef, diğer])
  const B = (command) => ({ arac: 'Bash', girdi: { command } });
  const Y = (arac, file_path) => ({ arac, girdi: { file_path } });
  const MATRIS = [
    ['start_session', { arac: 'mcp__ccd_session__start_session', girdi: { title: 'x' } }, 'Eİİ'],
    ['hand_off_to_session', { arac: 'mcp__ccd_session__hand_off_to_session', girdi: { title: 'x' } }, 'Eİİ'],
    ['Workflow', { arac: 'Workflow', girdi: { script: 'x' } }, 'Eİİ'],
    ['AskUserQuestion', { arac: 'AskUserQuestion', girdi: { questions: [] } }, 'Eİİ'],
    ['Agent (salt-okunur alt ajan)', { arac: 'Agent', girdi: { prompt: 'x' } }, 'İİİ'],
    ['SendMessage', { arac: 'SendMessage', girdi: { to: 'x' } }, 'İİİ'],
    ['Bash ls -la', B('ls -la'), 'İİİ'],
    ['git push origin main', B('git push origin main'), 'EEİ'],
    ['git push -u origin isci/a1', B('git push -u origin isci/a1'), 'İİİ'],
    ['git push origin feature (şefte de serbest)', B('git push origin feature'), 'İİİ'],
    ['git push origin HEAD:master', B('git push origin HEAD:master'), 'EEİ'],
    ['git push --force origin +refs/heads/main', B('git push --force origin +refs/heads/main'), 'EEİ'],
    ['git push origin refs/heads/x:refs/heads/main (pilot)', B('git push origin refs/heads/isletme-kanal:refs/heads/main 2>&1 | tail -4'), 'EEİ'],
    ['git push --all', B('git push --all origin'), 'EEİ'],
    ['git push --help', B('git push --help'), 'İİİ'],
    ['git push --repo=url main', B('git push --repo=git@x:y.git main'), 'EEİ'],
    ['git push --repo url feature', B('git push --repo git@x:y.git feature'), 'İİİ'],
    ['git -C dir push origin feature', B('git -C ../x push origin feature'), 'İİİ'],
    ['git commit -m "… git push origin main …" (tırnak içi)', B('git commit -m "sonra git push origin main yap"'), 'İİİ'],
    ['heredoc gövdesinde git push', B("cat <<'EOF' > notlar.md\ngit push origin main\nlaunchctl load x\nEOF\necho bitti"), 'İİİ'],
    ['echo x && git push origin main (zincir)', B('echo x && git push origin main'), 'EEİ'],
    ['$(git push origin main) (alt kabuk)', B('echo $(git push origin main)'), 'EEİ'],
    ['bash -c "git push origin main"', B('bash -c "git push origin main"'), 'EEİ'],
    ["sh -lc 'railway up'", B("sh -lc 'railway up'"), 'EEİ'],
    ['eval "launchctl load x"', B('eval "launchctl load x"'), 'EEİ'],
    ['launchctl load', B('launchctl load ~/Library/LaunchAgents/x.plist'), 'EEİ'],
    ['sudo launchctl bootout', B('sudo launchctl bootout system/x'), 'EEİ'],
    ['launchctl list (salt-okunur)', B('launchctl list | grep x'), 'İİİ'],
    ['npm run deploy:prod', B('npm run deploy:prod'), 'EEİ'],
    ['npm run deploy -- --help (betiğe gider)', B('npm run deploy -- --help'), 'EEİ'],
    ['yarn deploy', B('yarn deploy'), 'EEİ'],
    ['npm publish', B('npm publish --access public'), 'EEİ'],
    ['npm publish --help', B('npm publish --help'), 'İİİ'],
    ['./scripts/deploy-prod.sh', B('./scripts/deploy-prod.sh --yes'), 'EEİ'],
    ['./deploy.sh --help (bilinmeyen betik, muafiyet yok)', B('./deploy.sh --help'), 'EEİ'],
    ['bash deploy.sh', B('bash deploy.sh'), 'EEİ'],
    ['python3 deploy.py', B('python3 scripts/deploy.py --env prod'), 'EEİ'],
    ['npx vercel --prod', B('npx vercel --prod'), 'EEİ'],
    ['vercel --version', B('vercel --version'), 'İİİ'],
    ['npx vercel help deploy', B('npx vercel help deploy'), 'İİİ'],
    ['firebase deploy', B('firebase deploy --only hosting'), 'EEİ'],
    ['wrangler deploy', B('npx wrangler deploy'), 'EEİ'],
    ['eas submit', B('eas submit -p android'), 'EEİ'],
    ['railway redeploy --help (pilot yanlış alarmı)', B('curl -s -o /dev/null -w "health %{http_code}\\n" https://x/health; railway redeploy --help 2>&1 | head -20'), 'İİİ'],
    ['railway redeploy --service @proje/api -y (pilot gerçek yakalama)', B('railway redeploy --service @proje/api -y 2>&1 | tail -3'), 'EEİ'],
    ['railway status | python3 -c "…deploy…" (pilot yanlış alarmı)', B('railway status --json 2>/dev/null | python3 -c "\nimport json,sys\nd=json.load(sys.stdin)\nfor s in d[\'x\']:\n  print(s.get(\'preDeployCommand\'), s.get(\'latestDeployment\'))\n"'), 'İİİ'],
    ['for … $(railway status | python3 -c "…deploy…") (pilot, döngü içinde)', B("for i in $(seq 1 25); do s=$(railway status --json 2>/dev/null | python3 -c \"\nimport json,sys\nd=json.load(sys.stdin)\nprint((d.get('latestDeployment') or {}).get('status'))\n\"); echo $s; sleep 5; done"), 'İİİ'],
    ["python3 - <<'EOF' … deploy … (heredoc kod)", B("python3 - <<'EOF'\nimport json\nprint(json.load(open('deploy.json')))\nEOF"), 'İİİ'],
    ['node -e "…deploy…"', B("node -e \"console.log(require('./deploy.json').hedef)\""), 'İİİ'],
    ['gh pr merge', B('gh pr merge 12 --squash'), 'EEİ'],
    ['gh pr merge --help', B('gh pr merge --help'), 'İİİ'],
    ['gh pr view', B('gh pr view 12 --json state'), 'İİİ'],
    ['npm run build (zararsız)', B('npm run build && npm test'), 'İİİ'],
    ['grep deploy (zararsız)', B('grep -rn deploy src/'), 'İİİ'],
    ['rm -rf ~', B('rm -rf ~'), 'EEİ'],
    ['rm -rf "$HOME"', B('rm -rf "$HOME"'), 'EEİ'],
    ['rm -rf ~/*', B('rm -rf ~/*'), 'EEİ'],
    ['rm -fr ~/.claude', B('rm -fr ~/.claude'), 'EEİ'],
    ['rm -r -f $HOME/.claude/projects', B('rm -r -f $HOME/.claude/projects'), 'EEİ'],
    ['rm -rf / ', B('rm -rf /'), 'EEİ'],
    ['rm -rf ../.. (cwd ev/proje → kök)', B('rm -rf ../..'), 'EEİ'],
    ['rm -rf node_modules (zararsız)', B('rm -rf node_modules dist'), 'İİİ'],
    ['rm ~/.claude/settings.json (dosya silme = yazma)', B('rm ~/.claude/settings.json'), 'Eİİ'],
    ["echo '{}' > ~/.claude/settings.json", B("echo '{}' > ~/.claude/settings.json"), 'Eİİ'],
    ['jq … > $HOME/.claude/settings.local.json', B('jq . a.json > $HOME/.claude/settings.local.json'), 'Eİİ'],
    ['cp x ~/.claude/settings.json', B('cp yeni.json ~/.claude/settings.json'), 'Eİİ'],
    ['tee -a ~/.claude/CLAUDE.md', B('echo satır | tee -a ~/.claude/CLAUDE.md'), 'Eİİ'],
    ['cd ~/.claude && sed -i settings.json', B("cd ~/.claude && sed -i '' 's/a/b/' settings.json"), 'Eİİ'],
    ['cat ~/.claude/settings.json (okuma)', B('cat ~/.claude/settings.json'), 'İİİ'],
    ['cp ~/.claude/settings.json /tmp/yedek (kaynak)', B('cp ~/.claude/settings.json /tmp/yedek.json'), 'İİİ'],
    ['echo x > ~/.claude/settings-yedek.json (settings*.json)', B('echo x > ~/.claude/settings-yedek.json'), 'Eİİ'],
    ['echo x > ~/.claude/projects/a/settings.json (alt dizin, korunmaz)', B('echo x > ~/.claude/projects/a/settings.json'), 'İİİ'],
    ['proje CLAUDE.md\'ye yazma (işçide engel)', B('echo not >> CLAUDE.md'), 'Eİİ'],
    ['echo > ~/.claude/sef/profil.json', B('echo "{}" > ~/.claude/sef/profil.json'), 'EEİ'],
    ['mv x .claude/sef.local.json', B('mv yeni.json .claude/sef.local.json'), 'EEİ'],
    ['cat .claude/sef.local.json (okuma)', B('cat .claude/sef.local.json'), 'İİİ'],
    ['2>&1 yönlendirmesi zararsız', B('npm test 2>&1 | tail -5'), 'İİİ'],
    ['Write ~/.claude/settings.json', Y('Write', path.join(ev, '.claude', 'settings.json')), 'Eİİ'],
    ['MultiEdit ~/.claude/settings.local.json', Y('MultiEdit', path.join(ev, '.claude', 'settings.local.json')), 'Eİİ'],
    ['Edit proje/CLAUDE.md', Y('Edit', path.join(proje, 'CLAUDE.md')), 'Eİİ'],
    ['Edit CLAUDE.md (göreli yol)', Y('Edit', 'alt/CLAUDE.md'), 'Eİİ'],
    ['Write ~/.claude/sef/profil.json', Y('Write', path.join(ev, '.claude', 'sef', 'profil.json')), 'EEİ'],
    ['Edit proje/.claude/sef.local.json', Y('Edit', path.join(proje, '.claude', 'sef.local.json')), 'EEİ'],
    ['Write proje/src/a.ts', Y('Write', path.join(proje, 'src', 'a.ts')), 'İİİ'],
    ['Write proje/.claude/settings.json (proje ayarı)', Y('Write', path.join(proje, '.claude', 'settings.json')), 'Eİİ'],
    ['Edit proje/.claude/settings.local.json', Y('Edit', path.join(proje, '.claude', 'settings.local.json')), 'Eİİ'],
    ["echo '{}' > .claude/settings.local.json (Bash, proje)", B("echo '{}' > .claude/settings.local.json"), 'Eİİ'],
    ['cp x alt/.claude/settings.json (Bash, proje)', B('cp x.json alt/.claude/settings.json'), 'Eİİ'],
    ['cat .claude/settings.json (okuma)', B('cat .claude/settings.json'), 'İİİ'],
    // Tur 1 · deploy yanlış alarmları (engellenmez)
    ['node --test tests/deploy.test.mjs', B('node --test tests/deploy.test.mjs'), 'İİİ'],
    ['node --check scripts/deploy.js', B('node --check scripts/deploy.js'), 'İİİ'],
    ['bash -n deploy.sh', B('bash -n deploy.sh'), 'İİİ'],
    ['npm run test:deploy-unit', B('npm run test:deploy-unit'), 'İİİ'],
    ['npm run lint:deploy', B('npm run lint:deploy'), 'İİİ'],
    ['npm run predeploy-check', B('npm run predeploy-check'), 'İİİ'],
    ['python3 scripts/predeploy_check.py', B('python3 scripts/predeploy_check.py'), 'İİİ'],
    ['node scripts/check-deploy-config.mjs', B('node scripts/check-deploy-config.mjs'), 'İİİ'],
    ['aws lambda get-function --function-name deploy-fn', B('aws lambda get-function --function-name deploy-fn'), 'İİİ'],
    ['gcloud run services list --filter=deploy', B('gcloud run services list --filter=deploy'), 'İİİ'],
    ['gcloud run services list --filter deploy', B('gcloud run services list --filter deploy'), 'İİİ'],
    ['kubectl rollout status deploy/api', B('kubectl rollout status deploy/api -n prod'), 'İİİ'],
    ['kubectl apply --dry-run=client -f x.yaml', B('kubectl apply --dry-run=client -f x.yaml'), 'İİİ'],
    ['npm publish --dry-run', B('npm publish --dry-run'), 'İİİ'],
    ['eas build --local', B('eas build --platform ios --local'), 'İİİ'],
    ['git push -n origin main (kuru)', B('git push -n origin main'), 'İİİ'],
    // Tur 1 · gerçek yakalamalar korunur
    ['npm run deploy', B('npm run deploy'), 'EEİ'],
    ['npm run build:deploy', B('npm run build:deploy'), 'EEİ'],
    ['npm run release', B('npm run release'), 'EEİ'],
    ['railway up', B('railway up'), 'EEİ'],
    ['gcloud run deploy api', B('gcloud run deploy api --region europe-west1'), 'EEİ'],
    ['aws cloudformation deploy', B('aws --profile prod cloudformation deploy --template-file t.yml'), 'EEİ'],
    ['az deployment group create', B('az deployment group create -g rg --template-file t.json'), 'EEİ'],
    ['kubectl rollout restart deploy/api', B('kubectl rollout restart deploy/api'), 'EEİ'],
    ['kubectl apply -f x.yaml', B('kubectl apply -f x.yaml'), 'EEİ'],
    ['eas build --platform ios --profile production (derleme, yayın değil)', B('eas build --platform ios --profile production'), 'İİİ'],
    ['eas update --branch production', B('eas update --branch production'), 'EEİ'],
    // Tur 2 · yorumlayıcı bayrakları: betik çalışır, engellenir
    ['bash -e deploy.sh', B('bash -e deploy.sh'), 'EEİ'],
    ['bash -euo pipefail deploy.sh', B('bash -euo pipefail deploy.sh'), 'EEİ'],
    ['bash -o pipefail -e deploy.sh', B('bash -o pipefail -e deploy.sh'), 'EEİ'],
    ['sh -e ./deploy.sh', B('sh -e ./deploy.sh'), 'EEİ'],
    ['zsh -e deploy.sh', B('zsh -e deploy.sh'), 'EEİ'],
    ["bash -c 'bash -e deploy.sh'", B("bash -c 'bash -e deploy.sh'"), 'EEİ'],
    ['python3 -E deploy.py', B('python3 -E deploy.py'), 'EEİ'],
    ['python3 -W ignore deploy.py', B('python3 -W ignore deploy.py'), 'EEİ'],
    ['python3.12 -X dev deploy.py', B('python3.12 -X dev deploy.py'), 'EEİ'],
    ['node --test scripts/deploy.js', B('node --test scripts/deploy.js'), 'EEİ'],
    ['node -r dotenv/config scripts/deploy.js', B('node -r dotenv/config scripts/deploy.js'), 'EEİ'],
    ['node --require ./x.js scripts/deploy.js', B('node --require ./x.js scripts/deploy.js'), 'EEİ'],
    ['node --import ./x.mjs scripts/deploy.js', B('node --import ./x.mjs scripts/deploy.js'), 'EEİ'],
    ['node --loader tsx scripts/deploy.ts', B('node --loader tsx scripts/deploy.ts'), 'EEİ'],
    ['node --test-reporter spec scripts/deploy.js', B('node --test-reporter spec scripts/deploy.js'), 'EEİ'],
    ['tsx -r x scripts/deploy.ts', B('tsx -r x scripts/deploy.ts'), 'EEİ'],
    ['deno run -A deploy.ts', B('deno run -A deploy.ts'), 'EEİ'],
    ['perl -w deploy.pl', B('perl -w deploy.pl'), 'EEİ'],
    // Tur 2 · önceki tur bozulmaz
    ['node --test tests/deploy.test.mjs (tekrar)', B('node --test tests/deploy.test.mjs'), 'İİİ'],
    ['node --test tests/deploy.js (tests/ altı)', B('node --test tests/deploy.js'), 'İİİ'],
    ['node --test scripts/deploy.spec.js', B('node --test scripts/deploy.spec.js'), 'İİİ'],
    ['node -c scripts/deploy.js (sözdizimi)', B('node -c scripts/deploy.js'), 'İİİ'],
    ['bash -en deploy.sh (sözdizimi)', B('bash -en deploy.sh'), 'İİİ'],
    ['node -e "…deploy…" -r x (gömülü kod)', B("node -r x -e \"require('./deploy.json')\""), 'İİİ'],
    ['python3 -c "…deploy…" (gömülü kod)', B("python3 -W ignore -c \"print('deploy')\""), 'İİİ'],
    ['deno eval "deploy"', B('deno eval "console.log(1)" deploy'), 'İİİ'],
    // Tur 2 · ad kuralı
    ['node tools/redeploy.js', B('node tools/redeploy.js'), 'EEİ'],
    ['node scripts/undeploy.js', B('node scripts/undeploy.js'), 'EEİ'],
    ['aws lambda update-function-code', B('aws lambda update-function-code --function-name x --zip-file fileb://a.zip'), 'EEİ'],
    ['aws lambda publish-version', B('aws lambda publish-version --function-name x'), 'EEİ'],
    ['aws lambda get-function (okuma)', B('aws lambda get-function --function-name x'), 'İİİ'],
    ['make release-notes', B('make release-notes'), 'İİİ'],
    ['make release-check', B('make release-check'), 'İİİ'],
    ['make release', B('make release'), 'EEİ'],
    ['npm run release:prod', B('npm run release:prod'), 'EEİ'],
    ['npm run release-notes', B('npm run release-notes'), 'İİİ'],
    ['bash scripts/release.sh', B('bash scripts/release.sh'), 'EEİ'],
    // Tur 1 · sarmalayıcılar ve global bayraklar
    ['timeout 60 railway up', B('timeout 60 railway up'), 'EEİ'],
    ['timeout -s KILL 30 git push origin main', B('timeout -s KILL 30 git push origin main'), 'EEİ'],
    ['timeout 30 git push origin main', B('timeout 30 git push origin main'), 'EEİ'],
    ['caffeinate -i npm run deploy', B('caffeinate -i npm run deploy'), 'EEİ'],
    ['nice -n 10 railway up', B('nice -n 10 railway up'), 'EEİ'],
    ['stdbuf -oL railway up', B('stdbuf -oL railway up'), 'EEİ'],
    ['stdbuf -o L railway up', B('stdbuf -o L railway up'), 'EEİ'],
    ['sudo -u deploy launchctl load x', B('sudo -u deploy launchctl load x'), 'EEİ'],
    ['env -u X FOO=1 git push origin main', B('env -u X FOO=1 git push origin main'), 'EEİ'],
    ['timeout 5 ls (zararsız)', B('timeout 5 ls'), 'İİİ'],
    ['gh -R a/b pr merge 3', B('gh -R a/b pr merge 3'), 'EEİ'],
    ['gh pr --repo a/b merge 3', B('gh pr --repo a/b merge 3'), 'EEİ'],
    ['gh api -X PUT repos/o/r/pulls/3/merge', B('gh api -X PUT repos/o/r/pulls/3/merge'), 'EEİ'],
    ['gh api --method=PUT /repos/o/r/pulls/3/merge', B('gh api --method=PUT /repos/o/r/pulls/3/merge'), 'EEİ'],
    ['gh api graphql mergePullRequest', B("gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:\"x\"}) { clientMutationId } }'"), 'EEİ'],
    ['gh api repos/o/r/pulls/3/merge (GET, okuma)', B('gh api repos/o/r/pulls/3/merge'), 'İİİ'],
    ['gh -R a/b pr view 3', B('gh -R a/b pr view 3'), 'İİİ'],
    ['pnpm --filter api deploy', B('pnpm --filter api deploy'), 'EEİ'],
    ['npm --prefix x run deploy', B('npm --prefix x run deploy'), 'EEİ'],
    ['npm -w pkg run deploy', B('npm -w pkg run deploy'), 'EEİ'],
    ['yarn workspace api deploy', B('yarn workspace api deploy'), 'EEİ'],
    ['railway --service x up', B('railway --service x up'), 'EEİ'],
    ['railway --service x logs (okuma)', B('railway --service x logs'), 'İİİ'],
    ['vercel --scope team (deploy)', B('vercel --scope team'), 'EEİ'],
    // Tur 1 · Windows komut adları
    ['git.exe push origin main', B('git.exe push origin main'), 'EEİ'],
    ['"C:\\Program Files\\Git\\bin\\git.exe" push origin main', B('"C:\\Program Files\\Git\\bin\\git.exe" push origin main'), 'EEİ'],
    ['npm.cmd run deploy', B('npm.cmd run deploy'), 'EEİ'],
    ['vercel.cmd --prod', B('vercel.cmd --prod'), 'EEİ'],
    ['RAILWAY.EXE up', B('RAILWAY.EXE up'), 'EEİ'],
    ['pwsh -File ./deploy.ps1', B('pwsh -File ./deploy.ps1'), 'EEİ'],
    ['pwsh -Command "Get-Content deploy.json"', B('pwsh -Command "Get-Content deploy.json"'), 'İİİ'],
    // Tur 1 · canlı listesine eklenenler
    ['supabase db push', B('supabase db push'), 'EEİ'],
    ['npx supabase functions deploy', B('npx supabase functions deploy hello'), 'EEİ'],
    ['supabase db diff (okuma)', B('supabase db diff'), 'İİİ'],
    ['npx prisma migrate deploy', B('npx prisma migrate deploy'), 'EEİ'],
    ['prisma migrate dev (yerel)', B('npx prisma migrate dev'), 'İİİ'],
    ['make deploy', B('make deploy'), 'EEİ'],
    ['make -C web deploy-prod', B('make -C web deploy-prod'), 'EEİ'],
    ['make test (zararsız)', B('make test'), 'İİİ'],
    ['cargo publish', B('cargo publish'), 'EEİ'],
    ['twine upload', B('twine upload dist/*'), 'EEİ'],
    ['railway delete', B('railway delete -y'), 'EEİ'],
    ['railway restart', B('railway restart --service api'), 'EEİ'],
    ['railway variables --set', B('railway variables --set KEY=1'), 'EEİ'],
    ['railway variables (okuma)', B('railway variables'), 'İİİ'],
    ['vercel alias set', B('vercel alias set x.vercel.app ornek.com'), 'EEİ'],
    ['vercel alias ls (okuma)', B('vercel alias ls'), 'İİİ'],
    // Tur 1 · çift tırnak içi $( ) ve backtick
    ['commit heredoc, gövdede tek sayıda " (yanlış alarm)', B("git commit -m \"$(cat <<'EOF'\nfix: 5\" ekran\n\ngit push origin main\nEOF\n)\""), 'İİİ'],
    ['echo "$(git push origin main)"', B('echo "$(git push origin main)"'), 'EEİ'],
    ['echo "x `railway up`"', B('echo "x `railway up`"'), 'EEİ'],
    ['echo "$(rm -rf ~)"', B('echo "$(rm -rf ~)"'), 'EEİ'],
    ['iç içe "$(echo "$(git push origin main)")"', B('echo "$(echo "$(git push origin main)")"'), 'EEİ'],
    ['echo "$(date) deploy" (zararsız)', B('echo "$(date +%s) deploy bitti"'), 'İİİ'],
    ['NotebookEdit proje/a.ipynb', { arac: 'NotebookEdit', girdi: { notebook_path: path.join(proje, 'a.ipynb') } }, 'İİİ'],
    ['NotebookEdit proje/CLAUDE.md (notebook_path)', { arac: 'NotebookEdit', girdi: { notebook_path: path.join(proje, 'CLAUDE.md') } }, 'Eİİ'],
    ['git commit (varsayılan profil)', B('git commit -qm x'), 'İİİ'],
  ];
  const roller = [['işçi', T.isciBg], ['şef', T.sef], ['diğer', T.diger]];
  for (const [ad, { arac, girdi }, bek] of MATRIS) {
    roller.forEach(([rAd, tr], ri) => {
      const beklenen = bek[ri] === 'E' ? 'engel' : 'izin';
      vaka(`karar [${rAd}] ${ad} → ${beklenen}`, () => {
        const s = D({ tool_name: arac, tool_input: girdi, transcript_path: tr });
        return s.karar === beklenen && (beklenen === 'izin' || s.engeller.length > 0);
      });
    });
  }
  const kural = (girdi, sec) => D(girdi, sec).engeller.map((e) => e.kural).join(',');
  vaka('kural kimliği: işçi start_session → isci-oturum', () => kural({ tool_name: 'Workflow', transcript_path: T.isciBg }) === 'isci-oturum');
  vaka('kural kimliği: işçi AskUserQuestion → isci-soru', () => kural({ tool_name: 'AskUserQuestion', transcript_path: T.isciBg }) === 'isci-soru');
  vaka('kural kimliği: gh pr merge → ana-dal-push', () => kural({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 3' }, transcript_path: T.sef }) === 'ana-dal-push');
  vaka('kural kimliği: launchctl load → canli', () => kural({ tool_name: 'Bash', tool_input: { command: 'launchctl load x' }, transcript_path: T.sef }) === 'canli');
  vaka('kural kimliği: rm -rf ~ → ev-silme', () => kural({ tool_name: 'Bash', tool_input: { command: 'rm -rf ~' }, transcript_path: T.sef }) === 'ev-silme');
  vaka('kural kimliği: işçi Write settings → ayar-yazma', () => kural({ tool_name: 'Write', tool_input: { file_path: path.join(ev, '.claude', 'settings.json') }, transcript_path: T.isciBg }) === 'ayar-yazma');
  vaka('kural kimliği: şef Edit profil → sef-dosyasi', () => kural({ tool_name: 'Edit', tool_input: { file_path: path.join(ev, '.claude', 'sef', 'profil.json') }, transcript_path: T.sef }) === 'sef-dosyasi');
  vaka('profil yolu SEF_PROFIL ile değiştiyse o da korunur', () => kural({ tool_name: 'Write', tool_input: { file_path: path.join(gecici, 'p.json') }, transcript_path: T.sef }, { profilYolu: path.join(gecici, 'p.json') }) === 'sef-dosyasi');
  // diğer rol: transkriptin diğer biçimleri de karışmaz
  vaka('karar [işçi, doğrudan] start_session → engel', () => D({ tool_name: 'mcp__ccd_session__start_session', transcript_path: T.isciD }).karar === 'engel');
  vaka('karar [diğer, alıntı] start_session → izin', () => D({ tool_name: 'mcp__ccd_session__start_session', transcript_path: T.digerAlinti }).karar === 'izin');
  vaka('karar [şef, Skill aracı] git push origin main → engel', () => D({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: T.sefSkill }).karar === 'engel');
  vaka('karar [diğer, Skill hata] git push origin main → izin', () => D({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: T.sefHata }).karar === 'izin');
  vaka('karar [diğer, araç sonucu] rm -rf ~ → izin', () => D({ tool_name: 'Bash', tool_input: { command: 'rm -rf ~' }, transcript_path: T.aracSonucu }).karar === 'izin');

  // isci-commit: yalnız profilde commit-yok
  const commit = (tr, cmd = 'git commit -m x') => D({ tool_name: 'Bash', tool_input: { command: cmd }, transcript_path: tr }, { git: 'commit-yok' });
  vaka('commit-yok · işçi git commit → engel (isci-commit)', () => commit(T.isciBg).engeller[0]?.kural === 'isci-commit');
  vaka('commit-yok · işçi git -C x -c a=b commit → engel', () => commit(T.isciBg, 'git -C ../x -c user.name=a commit -m x').karar === 'engel');
  vaka('commit-yok · işçi heredoc mesajlı commit → engel', () => commit(T.isciBg, "git add -A && git commit -q -F - <<'EOF'\nmesaj\nEOF").karar === 'engel');
  vaka('commit-yok · şef git commit → izin', () => commit(T.sef).karar === 'izin');
  vaka('commit-yok · işçi git commit --help → izin', () => commit(T.isciBg, 'git commit --help').karar === 'izin');
  vaka('commit-yok · işçi git log → izin', () => commit(T.isciBg, 'git log --oneline -3').karar === 'izin');
  for (const c of ['git merge feature', 'git cherry-pick abc123', 'git rebase main', 'git rebase --continue', 'git revert HEAD', 'git am 0001.patch', 'git -C ../x merge --ff-only y'])
    vaka(`commit-yok · işçi ${c} → engel (isci-commit)`, () => commit(T.isciBg, c).engeller[0]?.kural === 'isci-commit');
  for (const c of ['git merge --abort', 'git rebase --abort', 'git cherry-pick -n abc123', 'git revert --no-commit HEAD', 'git am --quit', 'git merge-base main HEAD'])
    vaka(`commit-yok · işçi ${c} → izin`, () => commit(T.isciBg, c).karar === 'izin');
  vaka('commit-yok · şef git merge feature → izin', () => commit(T.sef, 'git merge feature').karar === 'izin');

  // Hedefsiz push: o anki dal
  const push = (dal, cmd = 'git push', tr = T.isciBg) => D({ tool_name: 'Bash', tool_input: { command: cmd }, transcript_path: tr }, { dalBul: sahteDal(dal) }).karar;
  vaka('karar [işçi] git push, o anki dal main → engel', () => push('main') === 'engel');
  vaka('karar [şef] git push, o anki dal main → engel', () => push('main', 'git push', T.sef) === 'engel');
  vaka('karar [işçi] git push origin HEAD, o anki dal master → engel', () => push('master', 'git push origin HEAD') === 'engel');
  vaka('karar [işçi] git push, o anki dal isci/a1 → izin', () => push('isci/a1') === 'izin');
  vaka('karar [şef] git push -u origin HEAD, dal feature → izin', () => push('feature', 'git push -u origin HEAD', T.sef) === 'izin');
  vaka('karar [işçi] git push, dal belirlenemedi → izin (fail-open)', () => push(null) === 'izin');
  // .git/HEAD okuma (alt süreç yok)
  const depo = path.join(gecici, 'depo');
  fs.mkdirSync(path.join(depo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(depo, 'alt', 'dizin'), { recursive: true });
  fs.writeFileSync(path.join(depo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const gercek = (cmd, cwd = depo, tr = T.isciBg) => degerlendir({ tool_name: 'Bash', tool_input: { command: cmd }, transcript_path: tr, cwd }, { ev, win: false, duyarsiz: false }).karar;
  vaka('gitDali: .git/HEAD → main', () => gitDali(depo) === 'main');
  vaka('gitDali: alt dizinden yukarı arar → main', () => gitDali(path.join(depo, 'alt', 'dizin')) === 'main');
  vaka('gitDali: depo dışı → null', () => gitDali(path.join(gecici, 'ev')) === null);
  vaka('git: .git/HEAD main, işçi git push → engel', () => gercek('git push') === 'engel');
  vaka('git: alt dizinde, şef git push → engel', () => gercek('git push', path.join(depo, 'alt', 'dizin'), T.sef) === 'engel');
  fs.writeFileSync(path.join(depo, '.git', 'HEAD'), '3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a\n');
  vaka('gitDali: ayrık HEAD → null, git push → izin', () => gitDali(depo) === null && gercek('git push') === 'izin');
  fs.writeFileSync(path.join(depo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const wt = path.join(gecici, 'wt');
  fs.mkdirSync(path.join(depo, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(depo, '.git', 'worktrees', 'wt')}\n`);
  fs.writeFileSync(path.join(depo, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/isci/a1\n');
  vaka('gitDali: worktree .git dosyası → isci/a1', () => gitDali(wt) === 'isci/a1');
  vaka('git: worktree dal isci/a1, işçi git push → izin', () => gercek('git push', wt) === 'izin');
  vaka('git: cd <depo> && git push (cd izlenir) → engel', () => gercek(`cd ${depo} && git push`, wt) === 'engel');
  vaka('git: git -C <depo> push → engel', () => gercek(`git -C ${depo} push`, wt) === 'engel');
  // gerçek git ile (git yoksa atlanır; hook alt süreç çağırmaz, yalnız test doğrular)
  const gitVar = spawnSync('git', ['--version']).status === 0;
  if (gitVar) {
    const gd = path.join(gecici, 'gercek-depo');
    fs.mkdirSync(gd);
    const g = (...a) => spawnSync('git', ['-C', gd, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    vaka('gerçek git: yeni depo dal main → gitDali main', () => gitDali(gd) === 'main');
    g('checkout', '-q', '-b', 'isci/a1');
    vaka('gerçek git: checkout isci/a1 → gitDali isci/a1', () => gitDali(gd) === 'isci/a1');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
    const gwt = path.join(gecici, 'gercek-wt');
    g('worktree', 'add', '-q', '-b', 'isci/b2', gwt);
    vaka('gerçek git: worktree add → gitDali isci/b2', () => gitDali(gwt) === 'isci/b2');
  } else console.log('ATLANDI git bulunamadı: gerçek depo vakaları');

  // 3) Proje izin dosyası
  const izinYaz = (dizin, icerik) => { fs.mkdirSync(path.join(dizin, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dizin, '.claude', 'sef.local.json'), typeof icerik === 'string' ? icerik : JSON.stringify(icerik)); };
  const ip = path.join(ev, 'izinli-proje');
  const ipAlt = path.join(ip, '.claude', 'worktrees', 'a', 'src');
  fs.mkdirSync(ipAlt, { recursive: true });
  const I = (cmd, tr = T.sef, cwd = ip, arac = 'Bash', girdi = { command: cmd }) => D({ tool_name: arac, tool_input: girdi, transcript_path: tr, cwd });
  izinYaz(ip, { izinli: ['git push origin main', 'railway up --environment staging*', 'npx  vercel   --prod'] });
  vaka('izin: şef git push origin main + önek → izin, önek kaydı', () => { const s = I('git push origin main'); return s.karar === 'izin' && s.izinler[0]?.onek === 'git push origin main' && s.izinler[0]?.kural === 'ana-dal-push'; });
  vaka('izin: işçi git push origin main + önek → izin', () => I('git push origin main', T.isciBg).karar === 'izin');
  vaka('izin: önek fazladan bayrakla da eşleşir (git push origin main --force-with-lease)', () => I('git push origin main --force-with-lease').karar === 'izin');
  vaka('izin: boşluk sadeleşir (git  push   origin main)', () => I('git  push   origin  main').karar === 'izin');
  vaka('izin: ortam ataması önekli (GIT_TRACE=1 git push origin main)', () => I('GIT_TRACE=1 git push origin main').karar === 'izin');
  vaka('izin: önek tutmaz (git push origin master) → engel', () => I('git push origin master').karar === 'engel');
  vaka('izin: joker railway up --environment staging-2 → izin', () => I('railway up --environment staging-2').karar === 'izin');
  vaka('izin: joker tutmaz railway up --environment production → engel', () => I('railway up --environment production').karar === 'engel');
  vaka('izin: desendeki boşluklar sadeleşir (npx vercel --prod)', () => I('npx vercel --prod').karar === 'izin');
  vaka('izin: her parça ayrı izin ister (push main && railway up) → engel', () => { const s = I('git push origin main && railway up'); return s.karar === 'engel' && s.engeller.length === 1 && s.engeller[0].kural === 'canli'; });
  vaka('izin: bash -c içindeki parça da eşleşir', () => I('bash -c "git push origin main"').karar === 'izin');
  vaka('izin: worktree alt dizininden yukarı arar → izin', () => I('git push origin main', T.isciBg, ipAlt).karar === 'izin');
  vaka('izin: ev-silme izinle açılmaz', () => I('rm -rf ~').karar === 'engel');
  izinYaz(ip, { izinli: ['*'] });
  vaka('izin "*": npm publish → izin', () => I('npm publish').karar === 'izin');
  vaka('izin "*": launchctl load + gh pr merge → izin', () => I('launchctl load x; gh pr merge 3').karar === 'izin');
  vaka('izin "*": rm -rf ~/.claude → engel', () => I('rm -rf ~/.claude').karar === 'engel');
  vaka('izin "*": işçi AskUserQuestion → engel', () => I('', T.isciBg, ip, 'AskUserQuestion', {}).karar === 'engel');
  vaka('izin "*": işçi start_session → engel', () => I('', T.isciBg, ip, 'mcp__ccd_session__start_session', {}).karar === 'engel');
  vaka('izin "*": şef Write profil → engel', () => I('', T.sef, ip, 'Write', { file_path: path.join(ev, '.claude', 'sef', 'profil.json') }).karar === 'engel');
  vaka('izin "*": işçi echo > ~/.claude/settings.json → engel', () => I("echo x > ~/.claude/settings.json", T.isciBg).karar === 'engel');
  vaka('izin "*": işçi git commit (commit-yok) → engel', () => D({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, transcript_path: T.isciBg, cwd: ip }, { git: 'commit-yok' }).karar === 'engel');
  izinYaz(ip, '{bozuk');
  vaka('izin: bozuk dosya → izin yok, uyarı', () => { const s = I('git push origin main'); return s.karar === 'engel' && /bozuk/.test(s.uyari ?? ''); });
  izinYaz(ip, { izinli: 'git push origin main' });
  vaka('izin: "izinli" liste değil → bozuk sayılır', () => { const s = I('git push origin main'); return s.karar === 'engel' && /bozuk/.test(s.uyari ?? ''); });
  izinYaz(ip, { izinli: [42, null, '', 'gh pr merge'] });
  vaka('izin: liste içi geçersiz öğeler atlanır, geçerli öğe çalışır', () => I('gh pr merge 3').karar === 'izin' && I('git push origin main').karar === 'engel');
  izinYaz(ev, { izinli: ['*'] });
  vaka('izin: ev dizinindeki .claude/sef.local.json sayılmaz', () => D({ tool_name: 'Bash', tool_input: { command: 'npm publish' }, transcript_path: T.sef, cwd: proje }).karar === 'engel');
  fs.rmSync(path.join(ev, '.claude', 'sef.local.json'));
  vaka('izinOku: dosya yok → boş liste', () => izinOku(proje, baglamKur({ ev, win: false, duyarsiz: false })).desenler.length === 0);

  // 4) Windows yolları (platformdan bağımsız: bağlam elle kurulur)
  const W = baglamKur({ ev: 'C:\\Users\\Kisi', win: true, profilYolu: 'C:\\Users\\Kisi\\.claude\\sef\\profil.json', dalBul: sahteDal('isci/a1') });
  const wcwd = 'C:\\Users\\Kisi\\proje';
  vaka('win yol: C:\\Users\\Kisi\\.claude\\Settings.json → c:/users/kisi/.claude/settings.json', () => yolCoz('C:\\Users\\Kisi\\.claude\\Settings.json', '/', W) === 'c:/users/kisi/.claude/settings.json');
  vaka('win yol: /c/Users/kisi/x (Git Bash) → c:/users/kisi/x', () => yolCoz('/c/Users/kisi/x', '/', W) === 'c:/users/kisi/x');
  vaka('win yol: ~/.claude → c:/users/kisi/.claude', () => yolCoz('~/.claude', '/', W) === 'c:/users/kisi/.claude');
  vaka('win yol: $USERPROFILE\\.claude → c:/users/kisi/.claude', () => yolCoz('$USERPROFILE\\.claude', '/', W) === 'c:/users/kisi/.claude');
  vaka('win yol: ..\\x göreli → c:/users/kisi/x', () => yolCoz('..\\x', yolCoz(wcwd, '/', W), W) === 'c:/users/kisi/x');
  vaka('win yol: C:/.. kökte kalır → c:/', () => yolCoz('C:/..', '/', W) === 'c:/');
  const WD = (tool_name, tool_input, tr = T.isciBg) => degerlendir({ tool_name, tool_input, transcript_path: tr, cwd: wcwd }, { ev: W.ev, win: true, profilYolu: W.ev + '\\.claude\\sef\\profil.json', dalBul: sahteDal('isci/a1') }).karar;
  vaka('win: işçi Write C:\\USERS\\kisi\\.claude\\settings.json → engel', () => WD('Write', { file_path: 'C:\\USERS\\kisi\\.claude\\settings.json' }) === 'engel');
  vaka('win: işçi Edit c:\\proje\\claude.md → engel', () => WD('Edit', { file_path: 'c:\\proje\\claude.md' }) === 'engel');
  vaka('win: şef Write C:\\Users\\Kisi\\.claude\\sef\\PROFIL.json → engel', () => WD('Write', { file_path: 'C:\\Users\\Kisi\\.claude\\sef\\PROFIL.json' }, T.sef) === 'engel');
  vaka('win: işçi Write C:\\Users\\Kisi\\proje\\src\\a.ts → izin', () => WD('Write', { file_path: 'C:\\Users\\Kisi\\proje\\src\\a.ts' }) === 'izin');
  vaka('win: rm -rf /c/Users/Kisi → engel', () => WD('Bash', { command: 'rm -rf /c/Users/Kisi' }, T.sef) === 'engel');
  vaka('win: rm -rf C:/users/kisi/.claude → engel', () => WD('Bash', { command: 'rm -rf C:/users/kisi/.claude' }, T.sef) === 'engel');
  vaka('win: rm -rf "C:\\Users\\Kisi\\.claude\\projects" (tırnaklı) → engel', () => WD('Bash', { command: 'rm -rf "C:\\Users\\Kisi\\.claude\\projects"' }, T.sef) === 'engel');
  vaka('win: işçi cp a "C:\\Users\\Kisi\\.claude\\settings.json" → engel', () => WD('Bash', { command: "cp a 'C:\\Users\\Kisi\\.claude\\settings.json'" }) === 'engel');
  vaka('win: rm -rf node_modules → izin', () => WD('Bash', { command: 'rm -rf node_modules' }, T.sef) === 'izin');
  vaka('win: CRLF satır sonlu heredoc gövdesi atlanır', () => WD('Bash', { command: "cat <<'EOF' > n.md\r\ngit push origin main\r\nEOF\r\necho ok" }, T.sef) === 'izin');
  const L = baglamKur({ ev: '/home/l', win: false, duyarsiz: false });
  vaka('ayristir: çift tırnakta \\" kaçar, \\U kalır (bash gibi)', () => JSON.stringify(ayristir('echo "a\\"b" "C:\\Users\\x"')) === JSON.stringify([['echo', 'a"b', 'C:\\Users\\x']]));
  vaka('linux (duyarlı): ~/.claude/Settings.json ayar sayılmaz', () => hedefBak('~/.claude/Settings.json', '/home/l', L).length === 0);
  vaka('macOS (duyarsız): ~/.claude/Settings.json ayar sayılır', () => hedefBak('~/.claude/Settings.json', '/Users/a', baglamKur({ ev: '/Users/a', win: false, duyarsiz: true })).length === 1);

  // 5) Hook süreci: kip × sonuç (sahte HOME, SEF_PROFIL, SEF_LOG; gerçek ~/.claude'a dokunulmaz)
  const sahteEv = path.join(gecici, 'kip-ev');
  fs.mkdirSync(sahteEv);
  const LOG = path.join(gecici, 'koruma.log');
  const PROFIL = path.join(gecici, 'profil.json');
  const calis = (girdi, { profil, ekEnv = {}, envEv = sahteEv } = {}) => {
    const env = { ...process.env, HOME: envEv, USERPROFILE: envEv, SEF_PROFIL: PROFIL, SEF_LOG: LOG };
    delete env.SEF_KORUMA_TEST;
    Object.assign(env, ekEnv);
    if (profil === undefined) fs.rmSync(PROFIL, { force: true });
    else fs.writeFileSync(PROFIL, typeof profil === 'string' ? profil : JSON.stringify(profil));
    const r = spawnSync(process.execPath, [BETIK], { input: typeof girdi === 'string' ? girdi : JSON.stringify(girdi), env, encoding: 'utf8', timeout: 15000 });
    let karar = null;
    try { karar = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null; } catch {}
    return { kod: r.status, out: r.stdout ?? '', err: r.stderr ?? '', karar };
  };
  const logSatirlari = (f = LOG) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const sonLog = () => logSatirlari().at(-1);
  const H = (tool_name, tool_input, transcript_path, cwd = proje) => ({ session_id: 'test', transcript_path, cwd, permission_mode: 'bypassPermissions', hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'toolu_test' });
  const KIP_VAKA = [
    ['işçi start_session', H('mcp__ccd_session__start_session', { title: 'x' }, T.isciBg), 'engel', 'isci-oturum'],
    ['işçi AskUserQuestion', H('AskUserQuestion', { questions: [] }, T.isciBg), 'engel', 'isci-soru'],
    ['şef start_session', H('mcp__ccd_session__start_session', { title: 'x' }, T.sef), 'izin'],
    ['şef git push origin main', H('Bash', { command: 'git push origin main' }, T.sef), 'engel', 'ana-dal-push'],
    ['şef git push origin feature', H('Bash', { command: 'git push origin feature' }, T.sef), 'izin'],
    ['işçi Bash ls', H('Bash', { command: 'ls' }, T.isciBg), 'izin'],
  ];
  for (const [ad, girdi, bek, kr] of KIP_VAKA) {
    vaka(`kip enforce (profil yok → varsayılan) · ${ad} → çıkış 0, ${bek === 'engel' ? 'deny JSON' : 'çıktı yok'}, log ${bek}`, () => {
      const r = calis(girdi); const l = sonLog();
      if (r.kod !== 0 || r.err !== '' || l?.kip !== 'enforce' || l?.oturum !== 'test' || typeof l?.zaman !== 'string') return false;
      return bek === 'engel'
        ? r.karar?.permissionDecision === 'deny' && r.karar?.hookEventName === 'PreToolUse' && l.karar === 'engel' && l.kural === kr
        : r.out === '' && l.karar === 'izin' && l.kural === undefined;
    });
    vaka(`kip log · ${ad} → çıkış 0, çıktı yok, log ${bek === 'engel' ? 'log-engel' : 'izin'}`, () => {
      const r = calis(girdi, { profil: { koruma: 'log' } }); const l = sonLog();
      return r.kod === 0 && r.out === '' && l?.kip === 'log' && l.karar === (bek === 'engel' ? 'log-engel' : 'izin');
    });
    vaka(`kip off · ${ad} → çıkış 0, çıktı yok, log yazılmaz`, () => {
      const once = logSatirlari().length; const r = calis(girdi, { profil: { koruma: 'off' } });
      return r.kod === 0 && r.out === '' && logSatirlari().length === once;
    });
  }
  const mesaj = (girdi) => calis(girdi).karar?.permissionDecisionReason ?? '';
  vaka('mesaj: işçi AskUserQuestion → "soruyu şefe yaz"', () => /soruyu şefe yaz/.test(mesaj(KIP_VAKA[1][1])));
  vaka('mesaj: işçi start_session → "şefe engel olarak bildir"', () => /şefe engel olarak bildir/.test(mesaj(KIP_VAKA[0][1])));
  vaka('mesaj: şef push main → "kullanıcıya sor" + izin dosyası', () => { const m = mesaj(KIP_VAKA[3][1]); return /Kullanıcıya sor/.test(m) && /sef\.local\.json/.test(m) && /\[ana-dal-push\]/.test(m); });
  vaka('mesaj: şef Edit profil → izin dosyasıyla açılmaz', () => /izin dosyasıyla açılmaz/.test(mesaj(H('Edit', { file_path: path.join(sahteEv, '.claude', 'sef', 'profil.json') }, T.sef))));
  vaka('diğer oturum rm -rf ~ → çıkış 0, çıktı yok, log yazılmaz', () => {
    const once = logSatirlari().length; const r = calis(H('Bash', { command: 'rm -rf ~' }, T.diger));
    return r.kod === 0 && r.out === '' && logSatirlari().length === once;
  });
  vaka('profil bozuk → varsayılan enforce, sessiz', () => { const r = calis(KIP_VAKA[0][1], { profil: '{bozuk' }); return r.kod === 0 && r.err === '' && r.karar?.permissionDecision === 'deny'; });
  vaka('profil geçersiz değer ("LOG") → varsayılan enforce', () => calis(KIP_VAKA[0][1], { profil: { koruma: 'LOG' } }).karar?.permissionDecision === 'deny');
  vaka('profil dizi → varsayılan enforce', () => calis(KIP_VAKA[0][1], { profil: '[]' }).karar?.permissionDecision === 'deny');
  vaka('profil git commit-yok → işçi git commit deny', () => calis(H('Bash', { command: 'git commit -m x' }, T.isciBg), { profil: { git: 'commit-yok' } }).karar?.permissionDecision === 'deny');
  vaka('profil yok → işçi git commit izin', () => calis(H('Bash', { command: 'git commit -m x' }, T.isciBg)).out === '');
  vaka('log: engellenen Bash komutunu 300 karakterle kısaltır', () => { calis(H('Bash', { command: 'git push origin main ' + 'x'.repeat(1000) }, T.sef)); const l = sonLog(); return l?.karar === 'engel' && l?.komut?.length === 301; });
  vaka('log: izin verilen Bash komutunun metnini yazmaz (gizlilik)', () => { calis(H('Bash', { command: 'curl -H "Authorization: Bearer GIZLI" x' }, T.sef)); const l = sonLog(); return l?.karar === 'izin' && l.komut === undefined && !JSON.stringify(l).includes('GIZLI'); });
  vaka('log: engel komutunda token / parola / URL kullanıcı bilgisi maskelenir', () => {
    calis(H('Bash', { command: 'git push https://u:GIZLI1@github.com/a/b main && railway up --token GIZLI2 && curl -H "Authorization: Bearer GIZLI3" x; echo ghp_GIZLI4 github_pat_GIZLI5 sk-GIZLI6xx xoxb-GIZLI7' }, T.sef));
    const l = sonLog(); const j = JSON.stringify(l);
    return l?.karar === 'engel' && !/GIZLI/.test(j) && /\*\*\*/.test(l.komut) && l.neden.some((x) => /--token \*\*\*/.test(x));
  });
  vaka('maskele: --password="a b", --token=x, authorization küçük harf', () => maskele('x --password="a b" --token=zz -H "authorization: qq"') === 'x --password=*** --token=*** -H "authorization: ***"');
  if (process.platform !== 'win32') {
    vaka('log dosyası 0600, klasör 0700 izinle oluşur', () => {
      const f = path.join(gecici, 'izinli-log', 'alt', 'koruma.log');
      calis(KIP_VAKA[0][1], { ekEnv: { SEF_LOG: f } });
      return (fs.statSync(f).mode & 0o777) === 0o600 && (fs.statSync(path.dirname(f)).mode & 0o777) === 0o700;
    });
  }
  vaka('log: Bash dışı engelde komut alanı yok', () => { calis(KIP_VAKA[0][1]); const l = sonLog(); return l?.karar === 'engel' && l.komut === undefined; });
  izinYaz(ip, { izinli: ['git push origin main'] });
  vaka('izin dosyası: şef push main → çıktı yok, log karar=izin, kural + önek', () => {
    const r = calis(H('Bash', { command: 'git push origin main' }, T.sef, ip)); const l = sonLog();
    return r.out === '' && l?.karar === 'izin' && l.kural === 'ana-dal-push' && l.onek?.[0] === 'git push origin main' && l.komut === undefined;
  });
  izinYaz(ip, '{bozuk');
  vaka('izin dosyası bozuk: engel + log\'da uyarı', () => { const r = calis(H('Bash', { command: 'git push origin main' }, T.sef, ip)); const l = sonLog(); return r.karar?.permissionDecision === 'deny' && /bozuk/.test(l?.uyari ?? ''); });

  // 6) Fail-open
  vaka('fail-open: bozuk JSON → çıkış 0, çıktı yok, log karar=hata', () => { const r = calis('{bozuk'); const l = sonLog(); return r.kod === 0 && r.out === '' && l?.karar === 'hata'; });
  vaka('fail-open: boş stdin → çıkış 0, çıktı yok', () => { const r = calis(''); return r.kod === 0 && r.out === ''; });
  vaka('fail-open: JSON nesne değil (null) → çıkış 0, çıktı yok', () => { const r = calis('null'); return r.kod === 0 && r.out === ''; });
  vaka('fail-open: yapay iç hata + engellenecek girdi → çıkış 0, çıktı yok, log karar=hata', () => {
    const r = calis(KIP_VAKA[0][1], { ekEnv: { SEF_KORUMA_TEST: 'patla' } }); const l = sonLog();
    return r.kod === 0 && r.out === '' && l?.karar === 'hata' && /yapay/.test(l.hata);
  });
  vaka('fail-open: iç süre aşımı → çıkış 0, çıktı yok, log karar=hata', () => {
    const t0 = Date.now(); const r = calis(KIP_VAKA[0][1], { ekEnv: { SEF_KORUMA_TEST: 'yavas' } }); const l = sonLog();
    return r.kod === 0 && r.out === '' && l?.karar === 'hata' && /zaman aşımı/.test(l.hata) && Date.now() - t0 < 5000;
  });
  vaka('fail-open: transkript yok + işçi aracı → çıkış 0 (rol diğer)', () => { const r = calis(H('mcp__ccd_session__start_session', {}, T.yok)); return r.kod === 0 && r.out === ''; });
  vaka('fail-open: tool_input yok, şef Bash → çıkış 0, çıktı yok', () => { const r = calis({ tool_name: 'Bash', transcript_path: T.sef }); return r.kod === 0 && r.out === ''; });
  const dosyaLog = path.join(gecici, 'bir-dosya');
  fs.writeFileSync(dosyaLog, 'x');
  vaka('log yazılamazsa: enforce engeli yine uygular', () => calis(KIP_VAKA[0][1], { ekEnv: { SEF_LOG: path.join(dosyaLog, 'koruma.log') } }).karar?.permissionDecision === 'deny');
  vaka('SEF_LOG yoksa ~/.claude/sef/koruma.log (sahte HOME)', () => {
    const env = { ...process.env, HOME: sahteEv, USERPROFILE: sahteEv, SEF_PROFIL: PROFIL }; delete env.SEF_LOG; delete env.SEF_KORUMA_TEST;
    fs.rmSync(PROFIL, { force: true });
    spawnSync(process.execPath, [BETIK], { input: JSON.stringify(KIP_VAKA[0][1]), env, encoding: 'utf8' });
    return logSatirlari(path.join(sahteEv, '.claude', 'sef', 'koruma.log')).at(-1)?.kural === 'isci-oturum';
  });
  vaka('log 5 MB\'ı aşınca .1\'e döner', () => {
    const f = path.join(gecici, 'buyuk.log'); fs.writeFileSync(f, 'x'.repeat(LOG_SINIRI + 1));
    calis(KIP_VAKA[0][1], { ekEnv: { SEF_LOG: f } });
    return fs.statSync(`${f}.1`).size === LOG_SINIRI + 1 && logSatirlari(f).length === 1;
  });
  vaka('selftest gerçek ~/.claude\'u kullanmaz', () => !LOG.startsWith(path.join(os.homedir(), '.claude')) && !ev.startsWith(path.join(os.homedir(), '.claude')));
  vaka('--yardim → çıkış 0', () => spawnSync(process.execPath, [BETIK, '--yardim'], { encoding: 'utf8' }).status === 0);

  fs.rmSync(gecici, { recursive: true, force: true });
  console.log(`\n${gecti} geçti, ${kaldi} kaldı`);
  return kaldi === 0 ? 0 : 1;
}

const YARDIM = `koruma.mjs: sef eklentisinin PreToolUse koruma hook'u (ARAYUZ §5).
  Hook olarak: stdin'den PreToolUse JSON'u okur; engelde permissionDecision "deny" JSON'u yazar; çıkış hep 0.
  Kip: profildeki "koruma" (enforce | log | off). Profil: SEF_PROFIL ?? ~/.claude/sef/profil.json.
  Log: ~/.claude/sef/koruma.log (SEF_LOG ile değişir).
  node koruma.mjs --selftest`;

async function ana() {
  const a = process.argv.slice(2);
  if (a.includes('--selftest')) return selftest();
  if (a.includes('--yardim') || a.includes('-h') || a.includes('--help')) { console.log(YARDIM); return 0; }
  await hookCalistir();
  return 0;
}

// Yalnız doğrudan çalıştırılınca (içe aktarılınca stdin beklemesin). Ad karşılaştırması: Windows'ta realpath
// farkı (sürücü harfi, subst) hook'u sessizce kapatmasın.
if (path.basename(process.argv[1] ?? '') === path.basename(fileURLToPath(import.meta.url))) {
  ana().then((k) => { process.exitCode = k ?? 0; }, (e) => {
    // Son çare: selftest dışında hiçbir koşulda çalışmayı bozma.
    if (process.argv.includes('--selftest')) { console.error(e); process.exitCode = 1; return; }
    logYaz({ karar: 'hata', hata: String(e?.message ?? e).slice(0, 300), not: 'fail-open' });
    process.exitCode = 0;
  });
}
