import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARSAYILAN, profilOku, profilYolu } from '../scripts/profil.mjs';

const BETIK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'profil.mjs');
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'sef-profil-test-'));
test.after(() => fs.rmSync(gecici, { recursive: true, force: true }));
const yaz = (ad, icerik) => {
  const f = path.join(gecici, ad);
  fs.writeFileSync(f, typeof icerik === 'string' ? icerik : JSON.stringify(icerik));
  return f;
};

test('dosya yok: varsayılanlar, uyarı yok, kaynak yok', () => {
  const r = profilOku(path.join(gecici, 'yok.json'));
  assert.deepEqual(r.profil, VARSAYILAN);
  assert.deepEqual(r.uyarilar, []);
  assert.equal(r.kaynak, 'yok');
});

test('geçerli dosya: değerler alınır, uyarı yok', () => {
  const f = yaz('gecerli.json', { surum: 1, hizliYol: 'asla', arsiv: 'hemen', git: 'commit-yok', koruma: 'log', baglamUyari: 250000 });
  const r = profilOku(f);
  assert.deepEqual(r.profil, { surum: 1, hizliYol: 'asla', arsiv: 'hemen', git: 'commit-yok', koruma: 'log', baglamUyari: 250000 });
  assert.deepEqual(r.uyarilar, []);
  assert.equal(r.kaynak, 'dosya');
});

test('kısmi dosya: eksik alanlar varsayılan, surum yoksa 1', () => {
  const r = profilOku(yaz('kismi.json', { koruma: 'off' }));
  assert.deepEqual(r.profil, { ...VARSAYILAN, koruma: 'off' });
  assert.deepEqual(r.uyarilar, []);
});

test('bozuk JSON ve nesne olmayan içerik: varsayılanlar + uyarı, kaynak bozuk', () => {
  for (const icerik of ['{ bozuk', '[1,2]', '"metin"', 'null']) {
    const r = profilOku(yaz('bozuk.json', icerik));
    assert.deepEqual(r.profil, VARSAYILAN, icerik);
    assert.equal(r.uyarilar.length, 1, icerik);
    assert.equal(r.kaynak, 'bozuk', icerik);
  }
});

test('geçersiz alan: yalnız o alan varsayılana döner, alan başına bir uyarı', () => {
  const r = profilOku(yaz('gecersiz.json', { hizliYol: 'belki', arsiv: 'hemen', git: 3, koruma: 'enforce', baglamUyari: -5 }));
  assert.equal(r.profil.hizliYol, VARSAYILAN.hizliYol);
  assert.equal(r.profil.arsiv, 'hemen');
  assert.equal(r.profil.git, VARSAYILAN.git);
  assert.equal(r.profil.baglamUyari, VARSAYILAN.baglamUyari);
  assert.equal(r.uyarilar.length, 3);
  assert.ok(r.uyarilar.some((u) => u.includes('hizliYol')) && r.uyarilar.some((u) => u.includes('baglamUyari')));
  assert.equal(r.kaynak, 'dosya');
});

test('baglamUyari: ondalık, metin ve sıfır geçersiz', () => {
  for (const v of [1.5, '400000', 0, null]) {
    const r = profilOku(yaz('bu.json', { baglamUyari: v }));
    assert.equal(r.profil.baglamUyari, VARSAYILAN.baglamUyari, String(v));
    assert.equal(r.uyarilar.length, 1, String(v));
  }
});

test('bilinmeyen alan yok sayılır (profile girmez, uyarı yok)', () => {
  const r = profilOku(yaz('bilinmeyen.json', { hizliYol: 'her-zaman', yeniAlan: true, baglamUyari: 300000 }));
  assert.equal(r.profil.hizliYol, 'her-zaman');
  assert.equal('yeniAlan' in r.profil, false);
  assert.deepEqual(r.uyarilar, []);
});

test('VARSAYILAN dondurulmuş, profilOku onu değiştirmez', () => {
  assert.ok(Object.isFrozen(VARSAYILAN));
  const r = profilOku(path.join(gecici, 'yok.json'));
  r.profil.koruma = 'off';
  assert.equal(VARSAYILAN.koruma, 'enforce');
});

test('profilYolu: SEF_PROFIL, yoksa ~/.claude/sef/profil.json', () => {
  const eski = process.env.SEF_PROFIL;
  try {
    process.env.SEF_PROFIL = '/baska/yol.json';
    assert.equal(profilYolu(), '/baska/yol.json');
    delete process.env.SEF_PROFIL;
    assert.equal(profilYolu(), path.join(os.homedir(), '.claude', 'sef', 'profil.json'));
  } finally {
    if (eski === undefined) delete process.env.SEF_PROFIL;
    else process.env.SEF_PROFIL = eski;
  }
});

test('CLI: profili ve uyarıları yazdırır', () => {
  const ortam = { ...process.env, SEF_PROFIL: yaz('cli.json', { git: 'yanlis', koruma: 'log' }) };
  const r = spawnSync(process.execPath, [BETIK], { encoding: 'utf8', env: ortam });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"koruma": "log"/);
  assert.match(r.stdout, /UYARI: .*"git"/);
  const yok = spawnSync(process.execPath, [BETIK], { encoding: 'utf8', env: { ...process.env, SEF_PROFIL: path.join(gecici, 'yok.json') } });
  assert.doesNotMatch(yok.stdout, /UYARI/);
});
