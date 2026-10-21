#!/usr/bin/env node
/**
 * İşçi (ve şef) transkriptlerinden token kullanımını ve API fiyatıyla tahmini maliyeti tablolar.
 * Abonelikte $ değeri fatura değildir; kotadan ne kadar yediğinin göreli ölçüsüdür.
 *
 *   node maliyet.mjs --bul <brif-kimliği> [--bul <kimlik2>,<kimlik3>] [--sef] [dosya.jsonl ...] [--proje <klasör>]
 *
 * --bul  : brif kimliğiyle işçi transkriptini bulur (ana proje + worktree klasörleri; en son değişen eşleşme).
 * --sef  : geçerli klasörün en son değişen transkriptini (şefin kendisi) ekler.
 * Her transkriptin alt ajan dosyaları (<oturum>/subagents/*.jsonl) aynı satıra eklenir.
 * Aynı mesaj birden çok satıra yazıldığı için kullanım message.id ile tekilleştirilir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, optAll, projectDir, listing, findByText, lines } from './ortak.mjs';

// 1M token başına $ (2026-10). in: girdi, out: çıktı, read: önbellek okuma. Önbellek yazma: 5 dk = 1.25×in, 1 sa = 2×in.
const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50, read: 0.25 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01, long: { in: 0.5, out: 2.5, read: 0.05 } }, // long: istem > 100K
};
const SHORT = { 'claude-fable-5-1': 'fable', 'claude-opus-5-5': 'opus', 'claude-sonnet-5-5': 'sonnet', 'claude-haiku-5-5': 'haiku' };

function priceFor(model, promptTokens) {
  const p = PRICES[String(model).replace(/\[.*\]$/, '')];
  if (!p) return null;
  return p.long && promptTokens > 100_000 ? p.long : p;
}

function withSubagents(file) {
  const sub = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  const extra = fs.existsSync(sub) ? fs.readdirSync(sub).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(sub, f)) : [];
  return [file, ...extra];
}

function measure(files) {
  const seen = new Set();
  const r = { models: {}, msgs: 0, input: 0, cw: 0, cr: 0, output: 0, usd: 0, unpriced: 0 };
  for (const file of files)
    for (const j of lines(file)) {
      const m = j.message;
      if (j.type !== 'assistant' || !m?.usage || m.model === '<synthetic>') continue; // <synthetic>: harness'ın yazdığı, API'ye gitmeyen mesaj
      const id = m.id ?? j.requestId ?? j.uuid;
      if (seen.has(id)) continue;
      seen.add(id);
      const u = m.usage;
      const cw5 = u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation ? 0 : u.cache_creation_input_tokens ?? 0);
      const cw1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      const input = u.input_tokens ?? 0;
      const cr = u.cache_read_input_tokens ?? 0;
      const output = u.output_tokens ?? 0;
      r.msgs++;
      r.input += input;
      r.cw += cw5 + cw1h;
      r.cr += cr;
      r.output += output;
      const name = SHORT[m.model] ?? m.model ?? '?';
      r.models[name] = (r.models[name] ?? 0) + 1;
      const p = priceFor(m.model, input + cw5 + cw1h + cr);
      if (!p) {
        r.unpriced++;
        continue;
      }
      r.usd += (input * p.in + cw5 * p.in * 1.25 + cw1h * p.in * 2 + cr * p.read + output * p.out) / 1e6;
    }
  return r;
}

const targets = [];
for (const id of optAll('bul')) {
  const hits = findByText(id);
  if (!hits.length) console.error(`Bulunamadı: ${id}`);
  else targets.push({ label: id, file: hits[0].file });
}
if (args.includes('--sef')) {
  const own = listing(projectDir())[0];
  if (own) targets.push({ label: 'şef', file: own.file });
}
for (const a of args) if (a.endsWith('.jsonl') && fs.existsSync(a)) targets.push({ label: path.basename(a, '.jsonl').slice(0, 12), file: a });

if (!targets.length) {
  console.error('Kullanım: node maliyet.mjs --bul <brif-kimliği> [--bul ...] [--sef] [dosya.jsonl ...]');
  process.exit(1);
}

const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
const rows = targets.map((t) => ({ ...t, ...measure(withSubagents(t.file)) }));
const total = rows.reduce(
  (a, r) => ({ msgs: a.msgs + r.msgs, input: a.input + r.input, cw: a.cw + r.cw, cr: a.cr + r.cr, output: a.output + r.output, usd: a.usd + r.usd }),
  { msgs: 0, input: 0, cw: 0, cr: 0, output: 0, usd: 0 },
);

const W = Math.max(8, ...rows.map((r) => r.label.length));
const line = (c) => console.log(c.map((x, i) => (i === 0 ? String(x).padEnd(W) : String(x).padStart(i === 1 ? 22 : 9))).join(' '));
line(['iş', 'model (mesaj)', 'mesaj', 'girdi', 'önb.yaz', 'önb.oku', 'çıktı', '$']);
for (const r of rows)
  line([
    r.label,
    Object.entries(r.models).map(([m, n]) => `${m}×${n}`).join(' '),
    r.msgs,
    k(r.input),
    k(r.cw),
    k(r.cr),
    k(r.output),
    r.usd.toFixed(2) + (r.unpriced ? '*' : ''),
  ]);
line(['TOPLAM', '', total.msgs, k(total.input), k(total.cw), k(total.cr), k(total.output), total.usd.toFixed(2)]);
console.log('\nAPI fiyatıyla tahmini $ (önbellek yazma 5 dk=1.25×, 1 sa=2× girdi). * = fiyatı bilinmeyen modelli mesaj var.');
