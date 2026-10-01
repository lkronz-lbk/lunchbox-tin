/* Writes the app's Content-Security-Policy into netlify.toml with the sha256
   of each inline <script> in public/app/index.html. Run before every commit
   that touches the app (npm run csp); the smoke suite refuses a stale hash and
   serves the app under this exact policy, so a broken policy fails the tests
   instead of the site. */
import fs from 'node:fs';
import crypto from 'node:crypto';

const html = fs.readFileSync('public/app/index.html', 'utf8');
const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
for (const [, attrs] of tags) {
  /* every script must be an inline one we can hash; anything else would ship blocked */
  if (/\bsrc\s*=/.test(attrs)) throw new Error('public/app/index.html has a <script src=...>; only inline scripts can be hashed into the CSP');
}
const hashes = tags.map(m => "'sha256-" + crypto.createHash('sha256').update(m[2], 'utf8').digest('base64') + "'");

/* the app names its build in APP_BUILD; the worker names it in VERSION; a deploy where they differ is a deploy that lies about itself */
const appBuild = (html.match(/var APP_BUILD = '([^']+)'/) || [])[1];
const swVersion = (fs.readFileSync('public/app/sw.js', 'utf8').match(/var VERSION = '([^']+)'/) || [])[1];
if (!appBuild || appBuild !== swVersion) throw new Error(`APP_BUILD in public/app/index.html (${appBuild}) must equal VERSION in public/app/sw.js (${swVersion})`);
/* the "What's new" note is tagged per build: this compares the tag only, so a note deliberately
   carried forward — v22 ships v21's, so a phone that skipped v21 still hears it — passes once it is
   re-tagged, and a note left on the old tag, which is the forgotten one, does not */
const noteBuild = (html.match(/var WHATS_NEW = \{build:'([^']+)'/) || [])[1];
if (noteBuild !== appBuild) throw new Error(`WHATS_NEW.build in public/app/index.html (${noteBuild}) must equal APP_BUILD (${appBuild}): write this build's note, or '' for none`);
/* seenAs names the builds this note was already shown as, so a phone that read it on any of
   them is not shown it twice. It is a list (v27 carried v25's note across two shipped builds),
   written as one list literal of single-quoted builds, which is how the smoke checks read it too:
   whatsNew() asks indexOf, and a string's indexOf would match part of a tag.
   It is the field that is easy to leave behind: carried forward and then forgotten, it goes on
   silencing the note for every phone that stopped at those builds, release after release, and
   unlike a stale note, nothing on screen ever says so. So every entry must name a build that is
   not this one, the note must actually be carried (a build with text:'' has none), and the
   newest build named must be the one just before this: a note carried again adds the build it
   last went out on, and a list left beside a new note is caught here. */
const noteObj = (html.match(/var WHATS_NEW = \{[\s\S]*?\};\n/) || [''])[0];
/* every way of writing the key, quoted, computed or assigned after the literal, anywhere in the file,
   so that none of them can stand in for the one read here: exactly one is allowed */
const seenKeys = html.match(/seenAs["'\]]*\s*[:=](?!=)/g) || [];
if (seenKeys.length) {
  const seenField = noteObj.match(/\bseenAs\s*:\s*\[([^\]]*)\]\s*,/);   /* the list and then the next field: nothing joined on after it */
  if (seenKeys.length > 1 || !seenField || seenField[1].replace(/'[^']*'/g, '').replace(/[\s,]/g, '')) throw new Error("WHATS_NEW.seenAs in public/app/index.html must be one list of single-quoted builds, written once and followed by the next field, such as seenAs:['lunchsorted-v25'],");
  const seenAs = [...seenField[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
  if (!seenAs.length || seenAs.some(b => !b)) throw new Error("WHATS_NEW.seenAs in public/app/index.html is empty or has an empty entry: name the builds the note was shown as, or remove the field");
  if (seenAs.includes(appBuild)) throw new Error(`WHATS_NEW.seenAs in public/app/index.html names APP_BUILD (${appBuild}), which would hide this build's note from every phone: name only the earlier builds the note is carried from`);
  if (/\btext\s*:\s*''/.test(noteObj)) throw new Error("WHATS_NEW.seenAs in public/app/index.html sits beside text:'', a build with no note to carry: remove seenAs");
  const num = t => +((t.match(/-v(\d+)$/) || [])[1] || NaN);
  if (!num(appBuild)) throw new Error(`APP_BUILD (${appBuild}) does not end in -v and a number, so npm run csp cannot tell whether WHATS_NEW.seenAs was left behind: tag the build lunchsorted-vN, or remove seenAs`);
  if (seenAs.some(b => b.replace(/\d+$/, '') !== appBuild.replace(/\d+$/, '') || !num(b))) throw new Error(`WHATS_NEW.seenAs in public/app/index.html names something that is not a build tag like ${appBuild}: whatsNew() compares whole tags`);
  const newest = Math.max(...seenAs.map(num));
  if (newest !== num(appBuild) - 1) throw new Error(`WHATS_NEW.seenAs in public/app/index.html goes up to ${seenAs.find(b => num(b) === newest) || seenAs.join(', ')}, but this is ${appBuild}: a note carried again adds the build just before this one, and a new note drops seenAs`);
}

export const APP_CSP = [
  "default-src 'none'",
  "script-src " + hashes.join(' '),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ');

/* /back.html is where Stripe sends the iPhone app's parent; its one script carries the query into the app */
const backHtml = fs.readFileSync('public/back.html', 'utf8');
const backTags = [...backHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
export const BACK_CSP = [
  "default-src 'none'",
  "script-src " + backTags.map(m => "'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'").join(' '),
  "style-src 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

export const SITE_CSP = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ');

/* the front page and the /ideas/ articles carry Google Analytics (public/ga.js); the other pages, and the planner, never do */
export const LANDING_CSP = SITE_CSP
  .replace("script-src 'none'", "script-src 'self' https://www.googletagmanager.com")
  .replace("img-src 'self' data:", "img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com")
  .replace("frame-ancestors", "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com; frame-ancestors");

/* The file has to be TOML before any of the rest of this means anything. Both
   readers below take the FIRST Content-Security-Policy in a block, which is what
   let dev ship a netlify.toml with a merge conflict still in it: the live half was
   maintained, the dead half sat under it, --check called the policy up to date, and
   the smoke suite served the app from the good line — while Netlify would have
   failed the whole file on parse and applied no header in it at all. So the shape
   of the file is checked before its contents, and by something that cannot be
   fooled by reading only the first match. */
export function assertParseable(toml) {
  const lines = toml.split('\n');
  const marks = lines
    .map((l, i) => (/^(<{7}|={7}|>{7}|\|{7})(\s|$)/.test(l) ? i + 1 : 0))
    .filter(Boolean);
  if (marks.length) throw new Error('netlify.toml has unresolved merge conflict markers on line(s) ' + marks.join(', ') + ' — Netlify fails the whole file on a parse error, so no header, redirect or build command in it is applied. Resolve the conflict, then run `npm run csp`.');
  const paths = [];
  for (const block of toml.split('[[headers]]').slice(1)) {
    const path = (block.match(/for = "([^"]+)"/) || [, '?'])[1];
    const n = (block.match(/^\s*"?Content-Security-Policy"?\s*=/gm) || []).length;
    if (n > 1) throw new Error('netlify.toml declares Content-Security-Policy ' + n + ' times for "' + path + '"; TOML forbids a duplicate key, and only the first would ever be read here');
    paths.push(path);
  }
  /* Two blocks for one path are legal TOML and Netlify sends the header twice, which the
     browser enforces as the intersection — so a stale twin silently blocks the app. The
     readers here disagree about which one is real: readPolicies keys by path and lets the
     LAST win, while put() anchors on the first `for` and rewrites the FIRST. So --check can
     read a fresh block while the regenerator maintains a dead one, and the suite serves the
     good policy while production gets both. Refuse the ambiguity instead of picking a side. */
  const twice = paths.filter((p, i) => paths.indexOf(p) !== i);
  if (twice.length) throw new Error('netlify.toml has more than one [[headers]] block for ' + [...new Set(twice)].map(p => '"' + p + '"').join(', ') + '; Netlify would send each header twice and the browser enforces the intersection. Merge them into one block.');
  return toml;
}

export function readPolicies(toml) {
  /* one block at a time, so a block without a CSP can't borrow the next one's */
  assertParseable(toml);
  const out = {};
  for (const block of toml.split('[[headers]]').slice(1)) {
    const path = block.match(/for = "([^"]+)"/), csp = block.match(/Content-Security-Policy = "([^"]*)"/);
    if (path && csp) out[path[1]] = csp[1];
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('csp.mjs')) {
  let toml = assertParseable(fs.readFileSync('netlify.toml', 'utf8'));
  if (process.argv.includes('--check')) {
    const have = readPolicies(toml);
    const want = {'/app/*': APP_CSP, '/': LANDING_CSP, '/index.html': LANDING_CSP, '/ideas/*': LANDING_CSP, '/privacy.html': SITE_CSP, '/terms.html': SITE_CSP, '/help.html': SITE_CSP, '/feedback.html': SITE_CSP, '/thanks.html': SITE_CSP, '/on-the-list.html': SITE_CSP, '/404.html': SITE_CSP, '/back.html': BACK_CSP};
    const stale = Object.keys(want).filter(p => have[p] !== want[p]);
    if (stale.length) { console.error('netlify.toml CSP is stale for ' + stale.join(', ') + ' — run `npm run csp`'); process.exit(1); }
    console.log('CSP up to date'); process.exit(0);
  }
  const put = (path, value) => {
    /* the tempered run stops at the next [[headers]], so a block without a slot can never rewrite the next one's */
    const re = new RegExp('(\\[\\[headers\\]\\]\\s*\\n\\s*for = "' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"(?:(?!\\[\\[headers)[\\s\\S])*?Content-Security-Policy = ")[^"]*(")');
    if (!re.test(toml)) throw new Error('no CSP slot for ' + path + ' in netlify.toml');
    toml = toml.replace(re, '$1' + value + '$2');
  };
  put('/app/*', APP_CSP);
  ['/', '/index.html', '/ideas/*'].forEach(p => put(p, LANDING_CSP));
  ['/privacy.html', '/terms.html', '/help.html', '/feedback.html', '/thanks.html', '/on-the-list.html', '/404.html'].forEach(p => put(p, SITE_CSP));
  put('/back.html', BACK_CSP);
  fs.writeFileSync('netlify.toml', toml);
  console.log('CSP written:', hashes.length, 'script hash(es)');
}
