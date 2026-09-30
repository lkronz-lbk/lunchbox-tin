/* Regenerates the FAQPage block in public/help.html from the page's own answers.
   The smoke suite fails when the two drift apart, so edit the page, then run this:
     node scripts/faq.mjs
   Every question the block already names is refreshed from the paragraph under the
   matching <h2>; a question the page no longer has is an error, not a silent drop.
   With --check it only reports whether the block is current (exit 1 if not). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'help.html');
const html = fs.readFileSync(file, 'utf8');
const check = process.argv.includes('--check');

/* the same reading the smoke test does in a browser: an <h2>'s text, and the text of the <p> right after it */
const decode = s => s.replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&rsaquo;/g, '›').replace(/&lsaquo;/g, '‹').replace(/&rarr;/g, '→').replace(/&larr;/g, '←')
  .replace(/&minus;/g, '−').replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();
const onPage = {};
for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/g)) onPage[decode(m[1])] = decode(m[2]);

const start = html.indexOf('<script type="application/ld+json">'), end = html.indexOf('</script>', start);
const ld = JSON.parse(html.slice(start + '<script type="application/ld+json">'.length, end));
const missing = ld.mainEntity.filter(q => !onPage[q.name]).map(q => q.name);
if (missing.length) { console.error('help.html: the FAQ block names a question the page does not have:\n  ' + missing.join('\n  ')); process.exit(1); }
let stale = 0;
for (const q of ld.mainEntity) { if (q.acceptedAnswer.text !== onPage[q.name]) { stale++; q.acceptedAnswer.text = onPage[q.name]; } }
const priced = ld.mainEntity.filter(q => /\$\d/.test(q.acceptedAnswer.text)).map(q => q.name);
if (priced.length) { console.error('help.html: a FAQ answer carries a price, which the help page never does:\n  ' + priced.join('\n  ')); process.exit(1); }
if (check) { console.log(stale ? `help.html: ${stale} FAQ answer(s) differ from the page` : 'help.html: the FAQ block is current'); process.exit(stale ? 1 : 0); }
const block = JSON.stringify(ld, null, 1).replace(/^/gm, '').replace(/\n {2}/g, '\n  ').replace(/\n {1}/g, '\n ');
fs.writeFileSync(file, html.slice(0, start + '<script type="application/ld+json">'.length) + '\n' + block + '\n' + html.slice(end));
console.log(stale ? `help.html: ${stale} FAQ answer(s) refreshed` : 'help.html: the FAQ block was already current');
