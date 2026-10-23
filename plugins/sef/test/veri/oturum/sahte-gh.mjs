#!/usr/bin/env node
// Testlerin sahte gh'si. Hook'a SEF_GH ile verilir; ağa çıkmaz.
//   SAHTE_GH_KAYIT  her çağrının argümanlarını bu dosyaya bir satır JSON olarak ekler
//   SAHTE_GH_KIP    cevap (varsayılan) | giris | ag | yavas
//   SAHTE_GH_CEVAP  kip "cevap" iken stdout'a basılacak dosya
import fs from 'node:fs';

// node --test varsayılan deseni bu dosyayı da koşabilir: gh gibi çağrılmadıysa hiçbir şey yapma.
if (process.argv[2] !== 'api') process.exit(0);

if (process.env.SAHTE_GH_KAYIT) fs.appendFileSync(process.env.SAHTE_GH_KAYIT, JSON.stringify(process.argv.slice(2)) + '\n');
const kip = process.env.SAHTE_GH_KIP || 'cevap';
if (kip === 'giris') {
  process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\n');
  process.exit(4);
}
if (kip === 'ag') {
  process.stderr.write('error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n');
  process.exit(1);
}
if (kip === 'yavas') setTimeout(() => process.exit(0), 20_000);
else process.stdout.write(fs.readFileSync(process.env.SAHTE_GH_CEVAP, 'utf8'));
