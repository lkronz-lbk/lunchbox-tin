/* The shell the two admin pages share: /admin (the numbers) and /admin/copy
   (the words). Server-rendered, no script anywhere on them, so the policy can
   say script-src 'none' and mean it. */

export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* forms need somewhere to post; the numbers page has none and says so */
export const csp = (forms = false) =>
  `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action ${forms ? "'self'" : "'none'"}`;

/* --ink-3 is the quietest text that still clears 4.5:1 on both grounds, and
   --edge is the quietest border that still clears 3:1; the site's own --line is
   too faint to be the edge of something you have to type into. */
const BASE = `:root{--ground:#E9EEE6;--surface:#FBFCF9;--line:#CFDACB;--edge:#5C6D64;--ink:#16241E;--ink-2:#4A5C53;--ink-3:#5C6D64;--accent:#2E5A48;--accent-fg:#FBFCF9;--warn:#8E2440}
@media (prefers-color-scheme:dark){:root{--ground:#0E1815;--surface:#17251F;--line:#2B3E36;--edge:#7A8E84;--ink:#E6EEE7;--ink-2:#A6BAAE;--ink-3:#7A8E84;--accent:#79C8A2;--accent-fg:#0E1815;--warn:#EA8299}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 Karla,"Helvetica Neue",sans-serif;padding:28px 18px 60px}
.wrap{max-width:760px;margin:0 auto}
h1{font:700 28px/1.1 "Familjen Grotesk","Trebuchet MS",sans-serif;letter-spacing:-.02em;margin:0 0 4px}
.sub{color:var(--ink-3);font-size:13px;margin:0 0 22px}
h2{font:600 11px ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);margin:26px 0 8px}
p{color:var(--ink-2)} a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}`;

export function page(title, body, { status = 200, css = '', forms = false } = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Lunch Sorted</title>
<meta name="color-scheme" content="light dark">
<style>${BASE}${css}</style></head><body><div class="wrap">${body}</div></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': csp(forms), 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex'
    }
  });
}

/* the people in ADMIN_EMAILS, and nobody else */
export function admins() {
  return (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
export function isAdmin(user) {
  return !!user && admins().includes(user.email.toLowerCase());
}
