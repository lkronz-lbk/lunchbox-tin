import { sql, json, fail, siteUrl, siteEnv, clientIp, ipKey, digest } from '../lib/db.js';
import { normalizeEmail, normalizeCode, createMagicLink, peekMagicLink, consumeMagicLink, consumeMagicCode, findOrCreateUser,
         createSession, sessionCookie, currentUser, destroySession, destroyAllSessions,
         verifyNonce, verifyCookie, verifyCookieFrom, sameOrigin, mailStopToken, stopMail } from '../lib/auth.js';
import { sendMagicLink, sendWelcome } from '../lib/mail.js';
import { cancelSubscription } from '../lib/stripe.js';

/* Sign-in by email link. No passwords: nothing to forget, nothing to leak.
   POST /api/auth/request   {email}         -> sends the link (honeypot: "website")
   GET  /api/auth/verify?t= (from the email) -> a page with one button, so a mail
                                               scanner following the link cannot spend it
   POST /api/auth/verify    t=<token>       -> creates the session, sets the cookie, redirects
   POST /api/auth/verify    {token, kind:'native'} -> returns a bearer session (iOS shell, later)
   GET  /api/auth/me
   POST /api/auth/logout
   POST /api/auth/delete    {confirm:'DELETE'} -> the person and, if they own it, the household */

/* What a stranger can make these routes write, and how a limit could be turned on real parents.
   A count for an address or a connection lives in rate_events under a digest (db.js), so no address
   sits there in the clear and a row is the same small size whatever was sent. A count is marked only
   when the request is let through: one turned away writes nothing. Requests arriving together can each see room for one
   more, so a limit can be passed by the few in flight.
   - /request answers to three limits at once: LINKS_FROM_ONE an hour from one connection (a /64 on
     IPv6), LINKS_TO_ONE a quarter hour to one address, and LINKS_A_DAY for everyone. The last bounds
     what a flood can write, three marks and a sign-in link a request let through: about 6 KB at
     worst (an address of 320 three-byte letters sits in the link and two of its indexes), 12 MB a
     day, measured. It also bounds the sign-in emails a stranger can make us send, and it is the lock
     a stranger could spend on everyone: that many requests let through in a day stop every new
     sign-in email, and App Review's standing code with them, until the oldest are a day old. At
     twenty an hour a connection that takes five IPv4 addresses for a day, a hundred for an hour, or
     one IPv6 /48 (65,536 /64s) at once. A parent already signed in is untouched (sessions last 180
     days). Raising it would raise the mail a stranger can send in our name.
   - /code counts a try only while a code for that address is waiting, the only time one can be
     right: an invented address writes nothing, and every try that is counted rides on a link
     /request let through (CODE_TRIES a link at most, 3 MB a day), so it has no limit of its own for
     a stranger to spend. CODE_TRIES a quarter hour against a code of 40 bits is the guard against
     guessing.
   - /verify counts nothing: a link's token is 32 random bytes, which no number of tries finds, and a
     count would be a row for every request anyone sent.
   Exported for the smoke suite, which holds them to the README. */
export const LINKS_FROM_ONE = 20, LINKS_TO_ONE = 3, LINKS_A_DAY = 2000, CODE_TRIES = 8;

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function page(title, body, status = 200, headers = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Lunch Sorted</title>
<meta name="color-scheme" content="light dark">
<style>:root{--ground:#E9EEE6;--surface:#FBFCF9;--line:#CFDACB;--ink:#16241E;--ink-2:#3E4D45;--accent:#2A5141;--accent-fg:#FBFCF9}
@media (prefers-color-scheme:dark){:root{--ground:#0E1815;--surface:#17251F;--line:#2B3E36;--ink:#E6EEE7;--ink-2:#AFC1B6;--accent:#81CBA8;--accent-fg:#0E1815}}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 Karla,"Helvetica Neue",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:28px 26px;max-width:420px;width:100%}
h1{font:700 26px/1.15 "Familjen Grotesk","Trebuchet MS",sans-serif;letter-spacing:-.02em;margin:0 0 10px;overflow-wrap:anywhere}
p{margin:0 0 18px;color:var(--ink-2)}
button{width:100%;min-height:48px;border:0;border-radius:12px;background:var(--accent);color:var(--accent-fg);font:600 15px "Familjen Grotesk","Trebuchet MS",sans-serif;cursor:pointer}
a{color:var(--accent)}
::placeholder{color:var(--ink-2);opacity:1}</style></head><body><div class="card">${body}</div></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer', ...headers } });
}

/* a first sign-in gets one welcome; a failure to send never fails the sign-in */
async function welcome(user, req, beta) {
  if (!user.created) return;
  try { await sendWelcome(user.email, siteUrl(req), `${siteUrl(req)}/api/auth/mail-stop?t=${await mailStopToken(user.id)}`, !!beta); }   /* a beta tester's first sign-in gets the beta welcome, not the three-weeks one */
  catch (e) { console.error('welcome email', e.message); }
}

/* REVIEW_EMAIL + REVIEW_CODE: the address App Review signs in with, and its standing code. Empty means no such account. */
function reviewAccount(email) {
  const raw = process.env.REVIEW_EMAIL || '';
  if (!raw) return '';
  const who = normalizeEmail(raw), code = normalizeCode(process.env.REVIEW_CODE || '');
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
  /* a misconfiguration must show in the logs the first time it is tried, not as a surprise from Apple */
  if (!who) { console.error('REVIEW_EMAIL is not an email address; the review account is off'); return ''; }
  if (code.length < 8) { console.error('REVIEW_CODE needs eight or more letters and digits; the review account is off'); return ''; }
  if (admins.includes(who)) { console.error('REVIEW_EMAIL is in ADMIN_EMAILS; a standing code must not open /admin, so the review account is off'); return ''; }
  return email === who ? code : '';
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
      /* a stranger's page could otherwise post here from every visitor's browser, and spend the day's links from their connections */
      if (!sameOrigin(req, siteUrl(req))) return fail('Not allowed', 403);
      /* the three limits in one statement, marked only if all three have room (see the top of the file).
         A connection whose address is unknown, never the case on Netlify, shares one count */
      const conn = 'link-ip:' + ipKey(clientIp(req, context)), addr = 'link:' + digest(email);
      const [room] = await sql()`
        WITH here AS (SELECT count(*) < ${LINKS_FROM_ONE} AS ok FROM rate_events WHERE key = ${conn} AND at > now() - interval '1 hour'),
             them AS (SELECT count(*) < ${LINKS_TO_ONE} AS ok FROM rate_events WHERE key = ${addr} AND at > now() - interval '15 minutes'),
             everyone AS (SELECT count(*) < ${LINKS_A_DAY} AS ok FROM rate_events WHERE key = 'link:all' AND at > now() - interval '1 day'),
             tick AS (INSERT INTO rate_events (key)
                      SELECT k FROM here, them, everyone, (VALUES (${conn}::text), (${addr}::text), ('link:all')) AS v(k)
                      WHERE here.ok AND them.ok AND everyone.ok RETURNING key)
        SELECT here.ok AS here, them.ok AS them, everyone.ok AS everyone FROM here, them, everyone`;
      if (!room.here) return fail('Too many sign-in requests from here; try again in an hour.', 429);
      if (!room.them) return fail('A link was sent recently. Check your inbox, or try again in a few minutes.', 429);
      if (!room.everyone) return fail('Sign-in is busy right now; try again later.', 503);
      /* App Review's tester has no inbox of ours: one address, named in the environment, signs in with a
         fixed code and gets no email. The code is still only accepted for that address, still expires. */
      const review = reviewAccount(email);
      const { token, code } = await createMagicLink(email, review || undefined);
      const link = `${siteUrl(req)}/api/auth/verify?t=${token}${body.beta === true ? '&b=1' : ''}`;   /* the app says a beta code is waiting; only the welcome's wording rides on it */
      const sent = review ? { ok: true } : await sendMagicLink(email, link, code);
      /* the link and code come back to the caller only where a deploy has opted in (the test suite) */
      const show = sent.devLink && (siteEnv() === 'test' || process.env.DEV_LINKS === '1');
      return json({ ok: true, ...(show ? { devLink: sent.devLink, devCode: sent.devCode } : {}) });
    }

    if (req.method === 'GET' && action === 'verify') {
      const t = url.searchParams.get('t') || '', b = url.searchParams.get('b') === '1';
      const email = t && await peekMagicLink(t);
      if (!email) return page('Link expired', `<h1>That link has expired.</h1><p>Sign-in links work once and last fifteen minutes. Ask for a new one from the app.</p><p><a href="/app/">Back to Lunch Sorted</a></p>`, 410);
      const nonce = verifyNonce();
      /* the link opens inside the iPhone app now, where a parent is primed to tap. If this
         phone is already signed in as someone else, continuing would hand that household's
         week to the other account on the next sync, so say whose it is and what is lost */
      const already = await currentUser(req).catch(() => null);
      const swap = already && already.email !== email;
      /* the association file opens this page inside the iPhone app, so the sentence sending a
         parent to the app would be sending them where they already are */
      const inApp = /LunchSortedApp/.test(req.headers.get('user-agent') || '');
      const head = swap
        ? `<h1>You are signed in as ${esc(already.email)}.</h1><p>Carrying on signs this device in as <b>${esc(email)}</b>, and the week on it joins that household. If you did not ask for this link, close this page instead.</p>`
        : `<h1>Sign in as ${esc(email)}?</h1><p>One tap and you are signed in on this device.${inApp ? '' : ' Building the week on your phone? Open the app there and type the code from the same email instead.'}</p>`;
      return page('Sign in', `${head}
<form method="post" action="/api/auth/verify"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="n" value="${esc(nonce)}">${b ? '<input type="hidden" name="b" value="1">' : ''}<button type="submit">${swap ? 'Sign in as them instead' : 'Continue to Lunch Sorted'}</button></form>`, 200, verifyCookie(nonce));
    }

    if (req.method === 'POST' && action === 'verify') {
      const ctype = req.headers.get('content-type') || '';
      let token, kind = 'web', beta = false;
      if (ctype.includes('application/json')) { const b = await req.json().catch(() => ({})); token = b.token; kind = b.kind === 'native' ? 'native' : 'web'; beta = b.beta === true; }
      else {
        const form = await req.formData().catch(() => null); token = form && form.get('t'); beta = !!(form && form.get('b') === '1');
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
      await welcome(user, req, beta);
      if (kind === 'native') return json({ token: session, user: { id: user.id, email: user.email, name: user.name } });
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
      /* a try is counted only while a code for this address is waiting (see the top of the file) */
      const key = 'code:' + digest(email);
      const [t] = await sql()`
        WITH waiting AS (SELECT EXISTS (SELECT 1 FROM magic_links WHERE email = ${email} AND code_used_at IS NULL AND expires_at > now()) AS yes),
             room AS (SELECT count(*) < ${CODE_TRIES} AS yes FROM rate_events WHERE key = ${key} AND at > now() - interval '15 minutes'),
             tick AS (INSERT INTO rate_events (key) SELECT ${key} FROM waiting, room WHERE waiting.yes AND room.yes RETURNING key)
        SELECT waiting.yes AS waiting, room.yes AS room FROM waiting, room`;
      if (!t.room) return fail('Too many tries; ask for a new email.', 429);
      const ok = t.waiting && await consumeMagicCode(email, body.code);
      if (!ok) return fail('That code is not right, or it has expired. Codes work once, for fifteen minutes.', 410);
      const user = await findOrCreateUser(email);
      const session = await createSession(user.id, 'web');
      await welcome(user, req, body.beta === true);
      return json({ ok: true, user: { id: user.id, email: user.email, name: user.name } }, 200, sessionCookie(session));
    }

    /* the link at the foot of every reminder: a page with one button, so a mail scanner that
       follows links cannot unsubscribe anyone; the button does it. Sign-in emails still come when asked for. */
    if (req.method === 'GET' && action === 'mail-stop') {
      const t = url.searchParams.get('t') || '';
      return page('Stop reminders', `<h1>Stop the reminder emails?</h1><p>You will not get emails about your three weeks, the Household plan, or the beta. Sign-in links still arrive when you ask for one.</p>
<form method="post" action="/api/auth/mail-stop"><input type="hidden" name="t" value="${esc(t)}"><button type="submit">Stop these reminders</button></form><p><a href="/app/">Back to Lunch Sorted</a></p>`);
    }
    if (req.method === 'POST' && action === 'mail-stop') {
      const form = await req.formData().catch(() => null);
      const ok = await stopMail(form && form.get('t'));
      return page(ok ? 'Done' : 'That link did not work', ok
        ? `<h1>No more reminders.</h1><p>You will not get emails about your three weeks or the Household plan. Sign-in links still arrive when you ask for one.</p><p><a href="/app/">Back to Lunch Sorted</a></p>`
        : `<h1>That link did not work.</h1><p>It may be from an older email. Reply to any of our emails and a person will sort it.</p><p><a href="/app/">Back to Lunch Sorted</a></p>`, ok ? 200 : 410);
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
      /* a household the person owns goes with them, and its yearly plan stops charging; one
         they merely joined loses a member. The card is cancelled for whoever pays it, owner
         or not: deleting the payer removes the membership the portal needs, so a plan left
         running here could never be stopped from inside the app again. */
      const subs = await q`SELECT e.stripe_subscription_id AS id FROM entitlements e JOIN households h ON h.id = e.household_id
        WHERE (h.owner_user_id = ${user.id} OR e.paid_by = ${user.id}) AND e.stripe_subscription_id IS NOT NULL AND e.status IN ('active', 'past_due')`;
      for (const s of subs) await cancelSubscription(s.id);
      await q`DELETE FROM households WHERE owner_user_id = ${user.id}`;
      await q`DELETE FROM household_members WHERE user_id = ${user.id}`;
      await q`DELETE FROM invites WHERE created_by = ${user.id}`;
      await destroyAllSessions(user.id);
      await q`DELETE FROM magic_links WHERE email = ${user.email}`;
      /* the throttle keys are a digest of the address, which is still the address's, so they go with it */
      await q`DELETE FROM rate_events WHERE key IN (${'link:' + digest(user.email)}, ${'code:' + digest(user.email)})`;
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
