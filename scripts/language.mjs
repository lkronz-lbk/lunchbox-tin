/* The house language rules, checked rather than remembered.

     npm run language                     # what is wrong, and where
     node scripts/language.mjs --check    # same, but fails the build (npm test runs this)

   Three rules, all of them things a parent would notice:

     1. American English. Color, canceled, gray, center, sanitizer, flavored.
     2. "Packed school lunches", never a bare "school lunch" — a school lunch is
        the one bought in the cafeteria, and this plans the one in the box.
     3. "In one minute", never "about a minute". The hedge costs more than it
        protects.

   Three kinds of thing are deliberately not violations. All of them are listed
   below with the reason rather than quietly skipped, so that a file coming off
   the frozen list is a one-line change and not an archaeology exercise.

   Identifiers are not prose, either: `.tick`, `ticked()` and a lookup key are
   names, and renaming them would mean touching sync. The patterns below match
   the word forms that appear in sentences, not a property or a call. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Everything worth reading, minus what is generated or vendored. */
const SCAN = [
  'README.md', 'CLAUDE.md',
  'public/index.html', 'public/privacy.html', 'public/terms.html', 'public/back.html',
  'public/app/index.html', 'public/app/sw.js',
  'store/listing.md', 'ios/README.md',
  'tests/smoke.mjs',
  'netlify/functions', 'netlify/lib', 'scripts', 'docs',
];

/* Carrying the old wording on purpose. Each entry names what it owes and when
   that can be paid, so this is the single place that answers "why does the app
   still say that?". */
const FROZEN = {
  'public/app/index.html':
    'frozen while the App Store review is in flight; owed at the next app deploy',
  'store/listing.md':
    'editing listing metadata mid-review is not worth the risk; owed once the review clears',
};

/* Files where an English word is data or subject matter rather than our own
   voice, so correcting it would make the file wrong. */
const EXEMPT = {
  'docs/marketing/keywords.md':
    'Pinterest search terms are what a parent types, not our wording',
  'docs/marketing/launch-copy.md':
    'pin titles, boards and topics lead on those same search terms',
  'CLAUDE.md':
    'states the rules, so it has to name the words it bans',
  'scripts/language.mjs':
    'this file — same reason',
};

const RULES = [
  {
    id: 'hedge',
    re: /about a minute/gi,
    say: '"in one minute", not "about a minute"',
  },
  {
    id: 'bare-lunch',
    re: /(?<!packed )\bschool lunch(?:es)?\b/gi,
    say: '"packed school lunches" — a bare "school lunch" is the one bought in the cafeteria',
  },
  {
    /* British spellings, as they appear in a sentence. "color" and "colors"
       must not match, so the stem carries the "u". */
    id: 'spelling',
    re: new RegExp(
      '\\b(?:' + [
        'colour\\w*', 'flavour\\w*', 'behaviour\\w*', 'favourite\\w*',
        'centres?', 'greys?', 'whilst', 'cancelled', 'labelled', 'travelled',
        'modelled', 'licence', 'defence', 'offence', 'catalogue', 'programme',
        'metres?', 'litres?', 'aeroplane\\w*', 'fulfil\\b', 'enrol\\b',
        '(?:organi|reali|recogni|summari|customi|personali|priorit|minimi|maximi'
          + '|normali|saniti|utili|analy|initiali|seriali|apologi)s(?:e|es|ed|ing|ation\\w*|er|ers)?',
      ].join('|') + ')\\b', 'gi'),
    say: 'American English',
  },
  {
    /* "tick" as a word someone reads. Not ".tick", not "ticked(", not "ticket". */
    id: 'tick',
    re: /(?<![.\w-])tick(?:s|ed|ing)?\b(?!\s*\()/gi,
    say: '"check off" / "checkmark" — never "tick" in anything a person reads',
  },
];

function walk(entry) {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [entry];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) =>
    d.name === 'node_modules' || d.name.startsWith('.') ? [] : walk(path.join(entry, d.name)));
}

const READABLE = /\.(?:md|html|js|mjs|py|txt)$/;

/* In prose, a phrase in quotes or backticks is something being named rather
   than something being said: a Pinterest search term, a label in somebody
   else's UI, the wording we are arguing against. Correcting those makes the
   sentence wrong. This applies to Markdown only — in HTML and JavaScript a
   quote is syntax, and content="..." is exactly where our own words live. */
function quoted(line) {
  const spans = [];
  for (const re of [/"[^"]*"/g, /`[^`]*`/g, /“[^”]*”/g]) {
    for (const m of line.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

export function findings() {
  const out = [];
  for (const rel of [...new Set(SCAN.flatMap(walk))].sort()) {
    if (!READABLE.test(rel) || rel in FROZEN || rel in EXEMPT) continue;
    const prose = rel.endsWith('.md');
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        const skip = prose ? quoted(line) : [];
        for (const m of line.matchAll(rule.re)) {
          if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
          out.push({ rel, line: i + 1, word: m[0], say: rule.say });
        }
      });
    }
  }
  return out;
}

const bad = findings();
for (const f of bad) console.log(`${f.rel}:${f.line}  ${JSON.stringify(f.word)} — ${f.say}`);

if (bad.length) {
  console.log(`\nlanguage: ${bad.length} to fix. The rules are in CLAUDE.md under Conventions.`);
  if (process.argv.includes('--check')) process.exit(1);
} else {
  console.log('language: clean');
  for (const [f, why] of Object.entries(FROZEN)) console.log(`  frozen  ${f} — ${why}`);
  for (const [f, why] of Object.entries(EXEMPT)) console.log(`  exempt  ${f} — ${why}`);
}
