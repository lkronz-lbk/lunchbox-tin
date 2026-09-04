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

export const APP_CSP = [
  "default-src 'none'",
  "script-src " + hashes.join(' '),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
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
    const want = {'/app/*': APP_CSP, '/': SITE_CSP, '/index.html': SITE_CSP, '/privacy.html': SITE_CSP};
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
  ['/', '/index.html', '/privacy.html'].forEach(p => put(p, SITE_CSP));
  fs.writeFileSync('netlify.toml', toml);
  console.log('CSP written:', hashes.length, 'script hash(es)');
}
