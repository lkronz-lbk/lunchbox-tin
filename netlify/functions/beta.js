import QRCode from 'qrcode';
import { siteUrl } from '../lib/db.js';
import { betaCode, betaCap, betaCount } from '../lib/beta.js';

/* The beta page: how many spots are left, one button into the app carrying the code. The only
   script is the site's own /ga.js (Google Analytics, as on the front page); noindex; the link is
   shared by hand, the cap is what limits it. */
const CSP = "default-src 'none'; script-src 'self' https://www.googletagmanager.com; img-src https://www.googletagmanager.com https://*.google-analytics.com; connect-src https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Lunch Sorted</title><meta name="color-scheme" content="light dark"><script src="/ga.js" defer></script><meta name="theme-color" content="#E9EEE6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0E1815" media="(prefers-color-scheme: dark)">
<style>:root{--ground:#E9EEE6;--surface:#FBFCF9;--line:#CFDACB;--ink:#16241E;--ink-2:#4A5C53;--ink-3:#6E7F75;--accent:#2E5A48;--accent-fg:#FBFCF9}
@media (prefers-color-scheme:dark){:root{--ground:#0E1815;--surface:#17251F;--line:#2B3E36;--ink:#E6EEE7;--ink-2:#A6BAAE;--ink-3:#7A8E84;--accent:#79C8A2;--accent-fg:#0E1815}}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 Karla,"Helvetica Neue",sans-serif;padding:40px 22px 70px}
.wrap{max-width:560px;margin:0 auto}
.eyebrow{font:600 11px ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3);margin:0 0 12px}
h1{font:700 32px/1.1 "Familjen Grotesk","Trebuchet MS",sans-serif;letter-spacing:-.025em;margin:0 0 14px}
p{color:var(--ink-2);margin:0 0 14px;max-width:60ch} strong{color:var(--ink)} li{color:var(--ink-2);margin:0 0 6px}
.btn{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:14px;background:var(--accent);color:var(--accent-fg);font-weight:600;text-decoration:none;margin:8px 0 6px}
.left{font:600 13px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin:0 0 22px}
a{color:var(--accent)}
.qr{display:none;margin:26px 0 0;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--surface);max-width:300px}
.qr svg{display:block;width:150px;height:150px;background:#fff;padding:6px;border-radius:8px}
.qr p{font-size:13px;margin:10px 0 0}
@media (hover:hover) and (pointer:fine){.qr{display:block}}</style></head><body><div class="wrap">${body}</div></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}

export default async function handler(req) {
  try {
    const code = betaCode();
    if (!code) return page('Not found', '<h1>Not found.</h1><p><a href="/">Lunch Sorted</a></p>', 404);
    const cap = betaCap(), left = Math.max(0, cap - await betaCount());
    const qr = await QRCode.toString(`${siteUrl(req)}/tester`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).catch(() => '');
    const ask = `<p>So was I. So I built this. Join as a beta tester, free, and if you like it, keep it free forever. The first ${esc(cap)} households.</p>
<p><strong>In return:</strong> sign in, pack real lunchboxes with it, add your own foods, shop from its list, let the kids pick their box, and tell us everything. We&rsquo;ll email you a couple of times in your first week with what to try and where to say what you found.</p>
<p><strong>Open this page on the phone you pack lunches with.</strong> Setup takes under a minute. Your email is what keeps your account, and your free-forever household, yours.</p>`;
    if (!left) return page('The beta is full', `<p class="eyebrow">Lunch Sorted beta</p><h1>The beta is full.</h1><p>Thank you for wanting in. Every new household still gets the whole app for three weeks, no card: <a href="/">lunchsorted.app</a>.</p>`);
    return page('Join the beta', `<p class="eyebrow">Lunch Sorted beta</p><h1>Sick of thinking about what to pack for lunch, every day, for the next 15 years?</h1>${ask}
<a class="btn" href="/app/?beta=${encodeURIComponent(code)}">Join the beta</a>
<p class="left">${esc(left)} spot${left === 1 ? '' : 's'} left</p>
<div class="qr">${qr}<p>On a laptop? Point your phone&rsquo;s camera at this.</p></div>`);
  } catch (e) {
    console.error('beta', e);
    return page('Something went wrong', '<h1>Something went wrong on our side.</h1><p><a class="btn" href="/beta">Try again</a></p>', 500);
  }
}

export const config = { path: '/beta' };
