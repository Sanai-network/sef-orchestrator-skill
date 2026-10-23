import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BETIK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'maliyet.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sef-maliyet-test-'));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const mesaj = (id, model) =>
  JSON.stringify({ type: 'assistant', message: { id, model, usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 } } });
const calis = (...satirlar) => {
  const f = path.join(home, 't.jsonl');
  fs.writeFileSync(f, satirlar.join('\n') + '\n');
  const r = spawnSync(process.execPath, [BETIK, f], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home }, cwd: home });
  return { kod: r.status, out: r.stdout, err: r.stderr };
};

test('aynı message.id bir kez sayılır; bilinen modelde * yok', () => {
  const r = calis(mesaj('m1', 'claude-opus-5-5'), mesaj('m1', 'claude-opus-5-5'), mesaj('m2', 'claude-opus-5-5'));
  assert.equal(r.kod, 0, r.err);
  assert.match(r.out, /opus×2/);
  assert.doesNotMatch(r.out, /\d\*/);
});

test('fiyatı bilinmeyen model: satırda ve TOPLAM satırında *', () => {
  const r = calis(mesaj('m1', 'claude-bilinmeyen-9'));
  const toplam = r.out.split('\n').find((l) => l.startsWith('TOPLAM'));
  assert.match(toplam, /\d\*$/);
});

test('argümansız çağrı kullanım yazar, çıkış 1', () => {
  const r = spawnSync(process.execPath, [BETIK], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Kullanım/);
});
