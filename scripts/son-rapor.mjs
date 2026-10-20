#!/usr/bin/env node
/**
 * Bir oturumun transkriptinden (jsonl) son uzun asistan mesajını (final rapor) yazdırır.
 * `list_events` çıktısı kısalır ve araç çağrılarıyla dolar; tam raporu buradan al.
 *
 *   node son-rapor.mjs <dosya.jsonl> [--min 1500]
 *   node son-rapor.mjs --bul "<brif kimliği ya da brif'te geçen benzersiz metin>" [--proje <klasör>] [--min 1500]
 *   node son-rapor.mjs --liste [--proje <klasör>]
 *
 * --bul   : ana proje klasörü + tüm worktree klasörlerindeki transkriptlerin İLK 300 KB'ında metni arar
 *           (brif başta durur); eşleşenlerden en son değişeni seçer. Birden çok eşleşme varsa hepsini listeler.
 * --liste : aynı klasörlerde son değişen transkriptleri, ilk kullanıcı isteğinin başıyla listeler.
 * --proje : ~/.claude/projects altındaki klasör adı. Varsayılan: geçerli klasör (':' '\' '/' '.' ve boşluk → '-').
 * --min   : raporun en az bu kadar karakter olması (varsayılan 1500; kısa bir takip yanıtı için 60 ver).
 */
import path from 'node:path';
import { args, opt, head, textOf, listing, projectFamilyDirs, findByText, lines } from './ortak.mjs';

const min = Number(opt('min', 1500));

function firstRequest(file) {
  for (const line of head(file).split('\n')) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type !== 'user') continue;
    // Sistem hatırlatma bloklarını at; geriye gerçek istek (brif) kalırsa onu göster.
    const t = textOf(j.message?.content)
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
    if (!t || t.startsWith('<')) continue;
    return t.replace(/\s+/g, ' ').slice(0, 140);
  }
  return '(ilk istek okunamadı)';
}

function lastReport(file) {
  let best = null;
  for (const j of lines(file)) {
    if (j.type !== 'assistant') continue;
    const t = textOf(j.message?.content).trim();
    if (t.length >= min) best = t;
  }
  return best;
}

const first = args[0];
if (args.includes('--liste')) {
  for (const { file, mtime } of listing(projectFamilyDirs()).slice(0, 25))
    console.log(`${new Date(mtime).toLocaleString('tr-TR')}  ${path.basename(path.dirname(file)).slice(-28)}/${path.basename(file)}  ${firstRequest(file)}`);
} else if (args.includes('--bul')) {
  const hits = findByText(opt('bul', ''));
  if (!hits.length) {
    console.error('Eşleşen transkript yok.');
    process.exit(1);
  }
  if (hits.length > 1)
    console.error(`${hits.length} eşleşme (en son değişen seçildi):\n` + hits.map((h) => '  ' + h.file).join('\n'));
  console.log(`# ${hits[0].file}\n`);
  console.log(lastReport(hits[0].file) ?? '(rapor bulunamadı; --min değerini düşür)');
} else if (first && !first.startsWith('--')) {
  console.log(lastReport(first) ?? '(rapor bulunamadı; --min değerini düşür)');
} else {
  console.error('Kullanım: node son-rapor.mjs <dosya.jsonl> | --bul "<metin>" | --liste   [--proje <klasör>] [--min N]');
  process.exit(1);
}
