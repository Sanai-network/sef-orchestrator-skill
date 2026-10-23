#!/usr/bin/env node
/**
 * Kullanıcı profilini okur: ~/.claude/sef/profil.json (test için SEF_PROFIL).
 * Sözleşme: shared/ARAYUZ.md §2. Bağımlılık yok.
 *
 *   node profil.mjs     profili ve uyarıları yazdırır
 *
 * Dosya yoksa varsayılanlar, uyarı yok. Dosya bozuksa ya da bir alan geçersizse o alanlar için varsayılan + uyarı.
 * Bilinmeyen alanlar yok sayılır.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VARSAYILAN = Object.freeze({
  surum: 1,
  hizliYol: 'baglama-duyarli',
  arsiv: 'dalga-sonu',
  git: 'proje-gore',
  koruma: 'enforce',
  baglamUyari: 400000,
});

const DEGERLER = {
  hizliYol: ['baglama-duyarli', 'her-zaman', 'asla'],
  arsiv: ['dalga-sonu', 'hemen', 'onayla'],
  git: ['proje-gore', 'commit-yok'],
  koruma: ['enforce', 'log', 'off'],
};

export function profilYolu() {
  return process.env.SEF_PROFIL || path.join(os.homedir(), '.claude', 'sef', 'profil.json');
}

/** → { profil, uyarilar: string[], kaynak: 'dosya' | 'yok' | 'bozuk' } */
export function profilOku(dosya = profilYolu()) {
  const profil = { ...VARSAYILAN };
  const uyarilar = [];
  let metin;
  try {
    metin = fs.readFileSync(dosya, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { profil, uyarilar, kaynak: 'yok' };
    return { profil, uyarilar: [`profil okunamadı (${dosya}): ${e?.code ?? e?.message}; varsayılanlar kullanılıyor`], kaynak: 'bozuk' };
  }
  let j;
  try {
    j = JSON.parse(metin);
  } catch {
    return { profil, uyarilar: [`profil geçerli JSON değil (${dosya}); varsayılanlar kullanılıyor`], kaynak: 'bozuk' };
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return { profil, uyarilar: [`profil bir nesne değil (${dosya}); varsayılanlar kullanılıyor`], kaynak: 'bozuk' };
  }

  if ('surum' in j && !(Number.isInteger(j.surum) && j.surum >= 1)) uyarilar.push(`profil: "surum" geçersiz (${JSON.stringify(j.surum)}); 1 kullanılıyor`);
  else if ('surum' in j) profil.surum = j.surum;

  for (const [alan, izinli] of Object.entries(DEGERLER)) {
    if (!(alan in j)) continue;
    if (izinli.includes(j[alan])) profil[alan] = j[alan];
    else uyarilar.push(`profil: "${alan}" geçersiz (${JSON.stringify(j[alan])}; beklenen: ${izinli.join(' | ')}); "${VARSAYILAN[alan]}" kullanılıyor`);
  }

  if ('baglamUyari' in j) {
    if (Number.isSafeInteger(j.baglamUyari) && j.baglamUyari > 0) profil.baglamUyari = j.baglamUyari;
    else uyarilar.push(`profil: "baglamUyari" geçersiz (${JSON.stringify(j.baglamUyari)}; beklenen: pozitif tam sayı); ${VARSAYILAN.baglamUyari} kullanılıyor`);
  }
  return { profil, uyarilar, kaynak: 'dosya' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const yol = profilYolu();
  const { profil, uyarilar, kaynak } = profilOku(yol);
  console.log(`profil: ${yol} (${kaynak})`);
  console.log(JSON.stringify(profil, null, 2));
  for (const u of uyarilar) console.log(`UYARI: ${u}`);
}
