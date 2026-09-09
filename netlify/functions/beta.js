import { betaCode, betaCap, betaCount } from '../lib/beta.js';

/* The beta page: how many spots are left, one button into the app carrying the code. No script,
   noindex; the link is shared by hand, the cap is what limits it. */
const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Lunch Sorted</title><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#E9EEE6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0E1815" media="(prefers-color-scheme: dark)">
<style>:root{--ground:#E9EEE6;--surface:#FBFCF9;--line:#CFDACB;--ink:#16241E;--ink-2:#4A5C53;--ink-3:#6E7F75;--accent:#2E5A48;--accent-fg:#FBFCF9}
@media (prefers-color-scheme:dark){:root{--ground:#0E1815;--surface:#17251F;--line:#2B3E36;--ink:#E6EEE7;--ink-2:#A6BAAE;--ink-3:#7A8E84;--accent:#79C8A2;--accent-fg:#0E1815}}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 Karla,"Helvetica Neue",sans-serif;padding:40px 22px 70px}
.wrap{max-width:560px;margin:0 auto}
.eyebrow{font:600 11px ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-3);margin:0 0 12px}
h1{font:700 32px/1.1 "Familjen Grotesk","Trebuchet MS",sans-serif;letter-spacing:-.025em;margin:0 0 14px}
p{color:var(--ink-2);margin:0 0 14px;max-width:60ch} strong{color:var(--ink)} li{color:var(--ink-2);margin:0 0 6px}
.btn{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:14px;background:var(--accent);color:var(--accent-fg);font-weight:600;text-decoration:none;margin:8px 0 6px}
.left{font:600 13px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin:0 0 22px}
a{color:var(--accent)}</style></head><body><div class="wrap">${body}</div></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}

export default async function handler() {
  try {
    const code = betaCode();
    if (!code) return page('Not found', '<h1>Not found.</h1><p><a href="/">Lunch Sorted</a></p>', 404);
    const cap = betaCap(), left = Math.max(0, cap - await betaCount());
    const ask = `<p>Everything on, for good: the week planned in a minute, the shopping list, the kids choosing their own box, the other parent&rsquo;s phone. No card, ever.</p>
<p>In return: pack with it for two weeks and tell us what breaks. The ? in the app emails us.</p>
<p><strong>Open this on the phone you pack lunches with.</strong> The app asks for your email, no password, and switches the plan on for your household.</p>`;
    if (!left) return page('The beta is full', `<p class="eyebrow">Lunch Sorted beta</p><h1>The beta is full.</h1><p>Thank you for wanting in. Every new household still gets the whole app for three weeks, no card: <a href="/">lunchsorted.app</a>.</p>`);
    return page('Join the beta', `<p class="eyebrow">Lunch Sorted beta</p><h1>Free forever, for the first ${esc(cap)} households to test it.</h1>${ask}
<a class="btn" href="/app/?beta=${encodeURIComponent(code)}">Join the beta</a>
<p class="left">${esc(left)} spot${left === 1 ? '' : 's'} left</p>`);
  } catch (e) {
    console.error('beta', e);
    return page('Something went wrong', '<h1>Something went wrong on our side.</h1><p><a class="btn" href="/beta">Try again</a></p>', 500);
  }
}

export const config = { path: '/beta' };
