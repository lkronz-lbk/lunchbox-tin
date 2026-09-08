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

/* the front page alone carries Google Analytics (public/ga.js); the other pages, and the planner, never do */
export const LANDING_CSP = SITE_CSP
  .replace("script-src 'none'", "script-src 'self' https://www.googletagmanager.com")
  .replace("img-src 'self' data:", "img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com")
  .replace("frame-ancestors", "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com; frame-ancestors");

export function readPolicies(toml) {
  /* one block at a time, so a block without a CSP can't borrow the next one's */
  const out = {};
  for (const block of toml.split('[[headers]]').slice(1)) {
    const path = block.match(/for = "([^"]+)"/), csp = block.match(/Content-Security-Policy = "([^"]*)"/);
    if (path && csp) out[path[1]] = csp[1];
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('csp.mjs')) {
  let toml = fs.readFileSync('netlify.toml', 'utf8');
  if (process.argv.includes('--check')) {
    const have = readPolicies(toml);
    const want = {'/app/*': APP_CSP, '/': LANDING_CSP, '/index.html': LANDING_CSP, '/privacy.html': SITE_CSP, '/terms.html': SITE_CSP, '/help.html': SITE_CSP, '/back.html': BACK_CSP};
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
  ['/', '/index.html'].forEach(p => put(p, LANDING_CSP));
  ['/privacy.html', '/terms.html', '/help.html'].forEach(p => put(p, SITE_CSP));
  put('/back.html', BACK_CSP);
  fs.writeFileSync('netlify.toml', toml);
  console.log('CSP written:', hashes.length, 'script hash(es)');
}
