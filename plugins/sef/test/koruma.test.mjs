import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BETIK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'koruma.mjs');

test('koruma.mjs --selftest: bütün vakalar geçer', () => {
  const r = spawnSync(process.execPath, [BETIK, '--selftest'], { encoding: 'utf8', timeout: 120000 });
  const kalan = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('KALDI'));
  assert.equal(r.status, 0, `selftest başarısız:\n${kalan.join('\n')}\n${r.stderr ?? ''}`);
  assert.match(r.stdout, /\d+ geçti, 0 kaldı/);
});
