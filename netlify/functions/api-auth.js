import { sql, json, fail, siteUrl, clientIp, ipKey, throttled } from '../lib/db.js';
import { normalizeEmail, createMagicLink, peekMagicLink, consumeMagicLink, consumeMagicCode, findOrCreateUser,
         createSession, sessionCookie, currentUser, destroySession, destroyAllSessions,
         verifyNonce, verifyCookie, verifyCookieFrom, sameOrigin } from '../lib/auth.js';
import { sendMagicLink } from '../lib/mail.js';

/* Sign-in by email link. No passwords: nothing to forget, nothing to leak.
   POST /api/auth/request   {email}         -> sends the link (honeypot: "website")
   GET  /api/auth/verify?t= (from the email) -> a page with one button, so a mail
                                               scanner following the link cannot spend it
   POST /api/auth/verify    t=<token>       -> creates the session, sets the cookie, redirects
   POST /api/auth/verify    {token, kind:'native'} -> returns a bearer session (iOS shell, later)
   GET  /api/auth/me
   POST /api/auth/logout
   POST /api/auth/delete    {confirm:'DELETE'} -> the person and, if they own it, the household */

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function page(title, body, status = 200, headers = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Lunch Sorted</title>
<meta name="color-scheme" content="light dark">
<style>:root{--ground:#E9EEE6;--surface:#FBFCF9;--line:#CFDACB;--ink:#16241E;--ink-2:#4A5C53;--accent:#2E5A48;--accent-fg:#FBFCF9}
@media (prefers-color-scheme:dark){:root{--ground:#0E1815;--surface:#17251F;--line:#2B3E36;--ink:#E6EEE7;--ink-2:#A6BAAE;--accent:#79C8A2;--accent-fg:#0E1815}}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 Karla,"Helvetica Neue",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:28px 26px;max-width:420px;width:100%}
h1{font:700 26px/1.15 "Familjen Grotesk","Trebuchet MS",sans-serif;letter-spacing:-.02em;margin:0 0 10px;overflow-wrap:anywhere}
p{margin:0 0 18px;color:var(--ink-2)}
button{width:100%;min-height:48px;border:0;border-radius:12px;background:var(--accent);color:var(--accent-fg);font:600 15px "Familjen Grotesk","Trebuchet MS",sans-serif;cursor:pointer}
a{color:var(--accent)}</style></head><body><div class="card">${body}</div></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer', ...headers } });
}

export default async function handler(req, context) {
  const url = new URL(req.url);
  const action = url.pathname.split('/').pop();
  try {
    if (req.method === 'POST' && action === 'request') {
      const body = await req.json().catch(() => ({}));
      if (body.website) return json({ ok: true });                       /* honeypot: pretend */
      const email = normalizeEmail(body.email);
      if (!email) return fail('That does not look like an email address');
      const ip = ipKey(clientIp(req, context));
      /* cheapest filter first, and a rejected request writes nothing further */
      if (ip && await throttled('link-ip:' + ip, 20, 60 * 60)) return fail('Too many sign-in requests from here; try again in an hour.', 429);
      if (await throttled('link:' + email, 3, 15 * 60)) return fail('A link was sent recently. Check your inbox, or try again in a few minutes.', 429);
      if (await throttled('link:all', 2000, 24 * 60 * 60)) return fail('Sign-in is busy right now; try again later.', 503);
      const { token, code } = await createMagicLink(email);
      const link = `${siteUrl(req)}/api/auth/verify?t=${token}`;
      const sent = await sendMagicLink(email, link, code);
      /* the link and code come back to the caller only where a deploy has opted in (the test suite) */
      const show = sent.devLink && (process.env.SITE_ENV === 'test' || process.env.DEV_LINKS === '1');
      return json({ ok: true, ...(show ? { devLink: sent.devLink, devCode: sent.devCode } : {}) });
    }

    if (req.method === 'GET' && action === 'verify') {
      const t = url.searchParams.get('t') || '';
      const email = t && await peekMagicLink(t);
      if (!email) return page('Link expired', `<h1>That link has expired.</h1><p>Sign-in links work once and last fifteen minutes. Ask for a new one from the app.</p><p><a href="/app/">Back to Lunch Sorted</a></p>`, 410);
      const nonce = verifyNonce();
      return page('Sign in', `<h1>Sign in as ${esc(email)}?</h1><p>One tap and you are back in the app. If you use Lunch Sorted from your home screen, open it there and type the code from the same email instead.</p>
<form method="post" action="/api/auth/verify"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="n" value="${esc(nonce)}"><button type="submit">Continue to Lunch Sorted</button></form>`, 200, verifyCookie(nonce));
    }

    if (req.method === 'POST' && action === 'verify') {
      const ip = ipKey(clientIp(req, context));
      if (ip && await throttled('verify-ip:' + ip, 20, 15 * 60)) return fail('Too many attempts; try again in a few minutes', 429);
      const ctype = req.headers.get('content-type') || '';
      let token, kind = 'web';
      if (ctype.includes('application/json')) { const b = await req.json().catch(() => ({})); token = b.token; kind = b.kind === 'native' ? 'native' : 'web'; }
      else {
        const form = await req.formData().catch(() => null); token = form && form.get('t');
        /* the button must be pressed on our own page: same origin, and the nonce the page set */
        const nonce = form && form.get('n'), cookieNonce = verifyCookieFrom(req);
        if (!sameOrigin(req, siteUrl(req)) || !nonce || !cookieNonce || nonce !== cookieNonce)
          return page('Please use the link', `<h1>Please open the link from your email.</h1><p>That request did not come from the sign-in page, so nothing happened.</p><p><a href="/app/">Back to Lunch Sorted</a></p>`, 403);
      }
      const email = token && await consumeMagicLink(String(token));
      if (!email) {
        if (kind === 'native') return fail('That link has expired', 410);
        return page('Link expired', `<h1>That link has expired.</h1><p>Ask for a new one from the app.</p><p><a href="/app/">Back to Lunch Sorted</a></p>`, 410);
      }
      const user = await findOrCreateUser(email);
      const session = await createSession(user.id, kind);
      if (kind === 'native') return json({ token: session, user });
      const h = new Headers({ location: '/app/?signed-in=1' });
      h.append('set-cookie', sessionCookie(session)['set-cookie']);
      h.append('set-cookie', verifyCookie('', true)['set-cookie']);
      return new Response(null, { status: 303, headers: h });
    }

    if (req.method === 'POST' && action === 'code') {
      const body = await req.json().catch(() => ({}));
      const email = normalizeEmail(body.email);
      if (!email) return fail('That does not look like an email address');
      if (!sameOrigin(req, siteUrl(req))) return fail('Not allowed', 403);
      if (await throttled('code:' + email, 8, 15 * 60)) return fail('Too many tries; ask for a new email.', 429);
      const ok = await consumeMagicCode(email, body.code);
      if (!ok) return fail('That code is not right, or it has expired. Codes work once, for fifteen minutes.', 410);
      const user = await findOrCreateUser(email);
      const session = await createSession(user.id, 'web');
      return json({ ok: true, user }, 200, sessionCookie(session));
    }

    if (req.method === 'GET' && action === 'me') {
      const user = await currentUser(req);
      return json({ user: user || null });
    }

    if (req.method === 'POST' && action === 'logout') {
      await destroySession(req);
      return json({ ok: true }, 200, sessionCookie('', true));
    }

    if (req.method === 'POST' && action === 'delete') {
      const user = await currentUser(req);
      if (!user) return fail('Not signed in', 401);
      const body = await req.json().catch(() => ({}));
      if (body.confirm !== 'DELETE') return fail('Confirmation missing');
      const q = sql();
      /* a household the person owns goes with them; one they merely joined loses a member */
      await q`DELETE FROM households WHERE owner_user_id = ${user.id}`;
      await q`DELETE FROM household_members WHERE user_id = ${user.id}`;
      await q`DELETE FROM invites WHERE created_by = ${user.id}`;
      await destroyAllSessions(user.id);
      await q`DELETE FROM magic_links WHERE email = ${user.email}`;
      await q`DELETE FROM users WHERE id = ${user.id}`;
      return json({ ok: true }, 200, sessionCookie('', true));
    }

    return fail('Not found', 404);
  } catch (e) {
    console.error('api-auth', e);
    return fail('Something went wrong on our side', 500);
  }
}

export const config = { path: '/api/auth/*' };
