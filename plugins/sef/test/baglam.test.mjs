import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BETIK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'baglam.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sef-baglam-test-'));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const MODEL = 'claude-opus-5-5';
const yaz = (ad, icerik) => {
  const f = path.join(home, ad);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof icerik === 'string' ? icerik : JSON.stringify(icerik));
  return f;
};
const asistan = (boy, zaman = '2026-10-21T10:00:00.000Z') =>
  JSON.stringify({ type: 'assistant', timestamp: zaman, message: { id: `m${boy}`, model: MODEL, usage: { input_tokens: boy, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } });
const transkript = (ad, ...satirlar) => yaz(`transkript/${ad}.jsonl`, satirlar.join('\n') + '\n');
const sikistirma = (zaman, oncesi) => JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: zaman, compactMetadata: { trigger: 'auto', preTokens: oncesi } });

/** Geçici HOME'da koşar; gerçek ev dizini ve profil okunmaz. */
function calis(argumanlar, { profil, ayarlar } = {}) {
  const profilYolu = profil === undefined ? path.join(home, 'profil-yok.json') : yaz('profil.json', profil);
  yaz('.claude/settings.json', ayarlar ?? {});
  const env = { ...process.env, HOME: home, USERPROFILE: home, SEF_PROFIL: profilYolu };
  delete env.CLAUDE_CONFIG_DIR;
  const r = spawnSync(process.execPath, [BETIK, ...argumanlar], { encoding: 'utf8', env, cwd: home });
  return { kod: r.status, out: r.stdout, err: r.stderr };
}

test('varsayılan baglamUyari 400000: altı ok, üstü UYARI (eşik 970K)', () => {
  const alt = calis(['durum', transkript('alt', asistan(399_999))]);
  assert.equal(alt.kod, 0, alt.out + alt.err);
  assert.match(alt.out, /\bok\b/);
  const ust = calis(['durum', transkript('ust', asistan(400_000))]);
  assert.equal(ust.kod, 10, ust.out + ust.err);
  assert.match(ust.out, /UYARI/);
});

test('profildeki baglamUyari ve settings.json autoCompactWindow: ok / UYARI / ESIK', () => {
  const ayarlar = { autoCompactWindow: 5000 };
  const profil = { baglamUyari: 1000 };
  const ok = calis(['durum', transkript('ok', asistan(999))], { profil, ayarlar });
  assert.equal(ok.kod, 0, ok.out + ok.err);
  const uyari = calis(['durum', transkript('uyari', asistan(1000))], { profil, ayarlar });
  assert.equal(uyari.kod, 10, uyari.out + uyari.err);
  assert.match(uyari.out, /UYARI/);
  const sinir = calis(['durum', transkript('sinir', asistan(4999))], { profil, ayarlar });
  assert.equal(sinir.kod, 10);
  const esik = calis(['durum', transkript('esik', asistan(5000))], { profil, ayarlar });
  assert.equal(esik.kod, 20, esik.out + esik.err);
  assert.match(esik.out, /ESIK/);
});

test('baglamUyari eşikten büyükse UYARI atlanır, doğrudan ESIK', () => {
  const r = calis(['durum', transkript('buyuk', asistan(5000))], { profil: { baglamUyari: 900_000 }, ayarlar: { autoCompactWindow: 5000 } });
  assert.equal(r.kod, 20);
  assert.match(r.out, /ESIK/);
  const ayar = calis(['ayar'], { profil: { baglamUyari: 900_000 }, ayarlar: { autoCompactWindow: 5000 } });
  assert.match(ayar.out, /UYARI hiç görülmez/);
});

test('geçersiz baglamUyari: varsayılan 400000 ve stderr uyarısı', () => {
  const r = calis(['durum', transkript('gecersiz', asistan(450_000))], { profil: { baglamUyari: 'çok' } });
  assert.equal(r.kod, 10);
  assert.match(r.err, /baglamUyari/);
});

test('sıkıştırma etkisizse (sonrası ≥ baglamUyari) döngü sayılır → çıkış 20', () => {
  const t = transkript('etkisiz', asistan(100), sikistirma('2026-10-21T09:00:00.000Z', 900_000), asistan(450_000, '2026-10-21T09:01:00.000Z'));
  const r = calis(['durum', t]);
  assert.equal(r.kod, 20, r.out);
  assert.match(r.out, /etkisiz/);
});

test('ayar çıktısı baglamUyari yazar, baglam.json/uyarı oranı yok', () => {
  const r = calis(['ayar']);
  assert.equal(r.kod, 0);
  assert.match(r.out, /baglamUyari\): 400K/);
  assert.doesNotMatch(r.out, /uyarı oranı/);
});

test('--help çalışır; bilinmeyen komut 1 döner', () => {
  const y = calis(['--help']);
  assert.equal(y.kod, 0);
  assert.match(y.out, /baglamUyari/);
  assert.equal(calis(['zzz']).kod, 1);
});

test('kaydet / gunluk geçici HOME altındaki durum klasörüne yazar', () => {
  const k = calis(['kaydet', '--olay', 'not', '--oturum', 'deneme', '--neden', 'test']);
  assert.equal(k.kod, 0, k.err);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'sef', 'durum', 'gunluk.jsonl')));
  const g = calis(['gunluk']);
  assert.match(g.out, /deneme/);
});
