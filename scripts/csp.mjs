/* Writes the app's Content-Security-Policy into netlify.toml with the sha256
   of each inline <script> in public/app/index.html. Run before every commit
   that touches the app (npm run csp); the smoke suite refuses a stale hash and
   serves the app under this exact policy, so a broken policy fails the tests
   instead of the site. */
import fs from 'node:fs';
import crypto from 'node:crypto';

const html = fs.readFileSync('public/app/index.html', 'utf8');
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => "'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");

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
    const stale = have['/app/*'] !== APP_CSP;
    if (stale) { console.error('netlify.toml CSP is stale for public/app/index.html — run `npm run csp`'); process.exit(1); }
    console.log('CSP up to date'); process.exit(0);
  }
  const put = (path, value) => {
    const re = new RegExp('(\\[\\[headers\\]\\]\\s*\\n\\s*for = "' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[\\s\\S]*?Content-Security-Policy = ")[^"]*(")');
    if (!re.test(toml)) throw new Error('no CSP slot for ' + path + ' in netlify.toml');
    toml = toml.replace(re, '$1' + value + '$2');
  };
  put('/app/*', APP_CSP);
  ['/', '/index.html', '/privacy.html'].forEach(p => put(p, SITE_CSP));
  fs.writeFileSync('netlify.toml', toml);
  console.log('CSP written:', hashes.length, 'script hash(es)');
}
