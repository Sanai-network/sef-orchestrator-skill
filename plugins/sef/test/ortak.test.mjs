import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encode, textOf, firstUserText, ilkSatirlar, esikFor, donguVarMi, ayar, expandHome, lines, olc } from '../scripts/ortak.mjs';

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'sef-ortak-test-'));
test.after(() => fs.rmSync(gecici, { recursive: true, force: true }));
const yaz = (ad, satirlar) => {
  const f = path.join(gecici, ad);
  fs.writeFileSync(f, satirlar.map((s) => (typeof s === 'string' ? s : JSON.stringify(s))).join('\n') + '\n');
  return f;
};

test('encode: harf ve rakam dışındaki her karakter "-"', () => {
  assert.equal(encode('/a/b.c_d e/çş'), '-a-b-c-d-e---');
  assert.equal(encode('C:\\x\\.y'), 'C--x--y');
});

test('textOf: metin, blok dizisi ve beklenmeyen biçimler', () => {
  assert.equal(textOf('a'), 'a');
  assert.equal(textOf([{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(textOf(undefined), '');
  assert.equal(textOf({ type: 'text' }), '');
});

test('firstUserText: meta, hatırlatma ve "<" ile başlayanları atlar', () => {
  const f = yaz('a.jsonl', [
    { type: 'user', isMeta: true, message: { content: 'meta' } },
    { type: 'user', message: { content: '<system-reminder>gizli</system-reminder>' } },
    { type: 'user', message: { content: '<command-name>/x</command-name>' } },
    'yarım satır {',
    { type: 'user', message: { content: [{ type: 'text', text: '<system-reminder>x</system-reminder>GERÇEK BRİF' }] } },
  ]);
  assert.equal(firstUserText(f), 'GERÇEK BRİF');
  assert.equal(firstUserText(yaz('b.jsonl', [{ type: 'assistant', message: { content: 'x' } }])), '');
});

test('ilkSatirlar: sınıra kadar okur, parça sınırındaki çok baytlı karakteri bozmaz', () => {
  const uzun = 'ş'.repeat(40_000);
  const f = yaz('c.jsonl', [{ n: 1, uzun }, { n: 2 }, { n: 3 }]);
  const l = [...ilkSatirlar(f, 2)].map((s) => JSON.parse(s));
  assert.equal(l.length, 2);
  assert.equal(l[0].uzun, uzun);
});

test('ayar: sabit sınırlar, profil ve durum klasörü varsayılanı; esikFor varsayılan %97', () => {
  const a = ayar();
  for (const k of ['uyariOrani', 'donguPencereDakika', 'donguSikistirmaSayisi', 'isciYenilemeSiniri', 'durumKlasoru', 'hookBrifSiniri', 'hookDurumSiniri', 'pencere', 'modelPencere'])
    assert.ok(k in a, k);
  assert.equal(a.durumKlasoru, expandHome('~/.claude/sef/durum'));
  assert.equal(a.donguPencereDakika, 15);
  assert.equal(esikFor('claude-opus-5-5', { modelPencere: {}, pencere: undefined }).esik, 970_000);
  assert.equal(esikFor('claude-opus-5-5[1m]', { modelPencere: { 'claude-opus-5-5': 1234 } }).esik, 1234);
});

test('donguVarMi ve olc', () => {
  const simdi = Date.parse('2026-10-21T10:10:00Z');
  const s = [{ zaman: '2026-10-21T10:00:00Z' }, { zaman: '2026-10-21T10:05:00Z' }, { zaman: '2026-10-21T08:00:00Z' }];
  assert.deepEqual(donguVarMi(s, { donguPencereDakika: 15, donguSikistirmaSayisi: 2 }, simdi), { dongu: true, yakin: 2 });
  const f = yaz('d.jsonl', [
    { type: 'assistant', timestamp: 't1', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'assistant', timestamp: 't2', message: { model: '<synthetic>', usage: { input_tokens: 999 } } },
  ]);
  assert.equal(olc(f).boy, 15);
  assert.equal([...lines(f)].length, 2);
});
