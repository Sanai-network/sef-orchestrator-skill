import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BETIK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'son-rapor.mjs');

test('son-rapor.mjs --selftest: en az 19 test, hepsi geçer', () => {
  const r = spawnSync(process.execPath, [BETIK, '--selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = r.stdout.match(/(\d+)\/(\d+) geçti/);
  assert.ok(m, 'özet satırı yok');
  assert.equal(m[1], m[2]);
  assert.ok(Number(m[2]) >= 19, `yalnız ${m[2]} test var`);
  assert.doesNotMatch(r.stdout, /^KALDI/m);
});

test('son-rapor.mjs --yardim: kullanım yazar, çıkış 0', () => {
  const r = spawnSync(process.execPath, [BETIK, '--yardim'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--selftest/);
});
