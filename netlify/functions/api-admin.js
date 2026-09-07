import { sql, siteEnv } from '../lib/db.js';
import { currentUser } from '../lib/auth.js';
import { prices } from '../lib/stripe.js';
import { trialEnd } from '../lib/trial.js';

/* The numbers, for the people named in ADMIN_EMAILS and nobody else: households,
   trials, plans, sign-ins, emails sent. Counts from the database, rendered as a
   page with no script, so there is nothing to hash and nothing to leak. */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function admins() {
  return (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Lunch Sorted</title>
<meta name="color-scheme" content="light dark">
<style>:root{--ground:#E9EEE6;--surface:#FBFCF9;--line:#CFDACB;--ink:#16241E;--ink-2:#4A5C53;--ink-3:#6E7F75;--accent:#2E5A48}
@media (prefers-color-scheme:dark){:root{--ground:#0E1815;--surface:#17251F;--line:#2B3E36;--ink:#E6EEE7;--ink-2:#A6BAAE;--ink-3:#7A8E84;--accent:#79C8A2}}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 Karla,"Helvetica Neue",sans-serif;padding:28px 18px 60px}
.wrap{max-width:760px;margin:0 auto}
h1{font:700 28px/1.1 "Familjen Grotesk","Trebuchet MS",sans-serif;letter-spacing:-.02em;margin:0 0 4px}
.sub{color:var(--ink-3);font-size:13px;margin:0 0 22px}
h2{font:600 11px ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);margin:26px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.tile b{display:block;font:700 26px/1.1 "Familjen Grotesk","Trebuchet MS",sans-serif;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tile span{font-size:12.5px;color:var(--ink-2)}
.tile small{display:block;font-size:12px;color:var(--ink-3);margin-top:2px}
table{border-collapse:collapse;width:100%;font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
td{padding:8px 12px;border-top:1px solid var(--line)} tr:first-child td{border-top:0}
td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace;font-size:13px}
p{color:var(--ink-2)} a{color:var(--accent)}</style></head><body><div class="wrap">${body}</div></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}

const tile = (n, label, note) => `<div class="tile"><b>${esc(n)}</b><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
const row = (label, n) => `<tr><td>${esc(label)}</td><td>${esc(n)}</td></tr>`;

export async function stats(now = Date.now()) {
  const q = sql();
  const [h] = await q`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS month FROM households`;
  const [u] = await q`SELECT count(*)::int AS total, count(*) FILTER (WHERE mail_ok = false)::int AS quiet FROM users`;
  const [s] = await q`SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week, count(DISTINCT user_id) FILTER (WHERE last_used_at > now() - interval '7 days')::int AS active FROM sessions`;
  const [m] = await q`SELECT count(*)::int AS shared FROM (SELECT household_id FROM household_members GROUP BY household_id HAVING count(*) > 1) x`;
  const [helpers] = await q`SELECT count(*)::int AS n FROM household_members WHERE role = 'helper'`;
  const ent = await q`SELECT plan, status, cancel_at_period_end AS cape, stripe_price_id AS price FROM entitlements`;
  const paid = ent.filter(e => e.plan !== 'free' && (e.status === 'active' || e.status === 'past_due'));
  const p = prices();
  const byPlan = { lifetime: paid.filter(e => e.plan === 'lifetime').length, month: paid.filter(e => e.plan === 'household' && p.month && e.price === p.month).length };
  byPlan.year = paid.length - byPlan.lifetime - byPlan.month;
  const pastDue = paid.filter(e => e.status === 'past_due').length, ending = paid.filter(e => e.cape).length;
  /* trials: computed the way the app and the reminder job compute them */
  const hs = await q`SELECT h.id, h.created_at, h.doc->>'createdAt' AS doc_created, e.plan, e.status FROM households h LEFT JOIN entitlements e ON e.household_id = h.id ORDER BY h.id DESC LIMIT 5000`;
  let trialing = 0, lapsed = 0, endingSoon = 0; const capped = hs.length === 5000;
  for (const x of hs) {
    if (x.plan && x.plan !== 'free' && (x.status === 'active' || x.status === 'past_due')) continue;
    const end = trialEnd(x); if (!end) continue;
    const left = end.getTime() - now;
    if (left > 0) { trialing++; if (left <= 4 * 86400000) endingSoon++; } else lapsed++;
  }
  const notices = await q`SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE sent_at > now() - interval '7 days')::int AS week FROM notices GROUP BY kind`;
  const [ev] = await q`SELECT count(*) FILTER (WHERE received_at > now() - interval '7 days')::int AS week FROM stripe_events`;
  const [inv] = await q`SELECT count(*) FILTER (WHERE used_at IS NOT NULL)::int AS used, count(*) FILTER (WHERE used_at IS NULL AND expires_at > now())::int AS open FROM invites`;
  return {
    households: { total: h.total, week: h.week, month: h.month, shared: m.shared, helpers: helpers.n },
    people: { total: u.total, signinsWeek: s.week, activeWeek: s.active, stoppedMail: u.quiet },
    plans: { paid: paid.length, year: byPlan.year, month: byPlan.month, lifetime: byPlan.lifetime, pastDue, ending },
    trials: { trialing, endingSoon, lapsed, capped },
    emails: Object.fromEntries(notices.map(n => [n.kind, { total: n.n, week: n.week }])),
    invites: inv, stripeEventsWeek: ev.week
  };
}

export default async function handler(req) {
  try {
    const user = await currentUser(req);
    if (!user) return page('Sign in first', `<h1>Sign in first.</h1><p>Open <a href="/app/">the planner</a>, sign in from Setup, then come back to this page.</p>`, 401);
    if (!admins().includes(user.email.toLowerCase())) return page('Not found', `<h1>Not found.</h1><p><a href="/app/">Back to Lunch Sorted</a></p>`, 404);
    const t = await stats();
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const body = `<h1>Lunch Sorted, by the numbers</h1><p class="sub">${esc(siteEnv())} · ${esc(when)} ET · counts from the database</p>
<h2>Households</h2><div class="grid">${tile(t.households.total, 'households')}${tile(t.households.week, 'new this week', `${t.households.month} in 30 days`)}${tile(t.households.shared, 'with a second phone', `${t.households.helpers} helpers`)}</div>
<h2>Three weeks</h2><div class="grid">${tile(t.trials.trialing, 'on the trial', `${t.trials.endingSoon} end within 4 days${t.trials.capped ? ' · newest 5,000 households' : ''}`)}${tile(t.trials.lapsed, 'lapsed to free', t.trials.capped ? 'newest 5,000 households' : '')}${tile(t.plans.paid, 'paying', t.plans.pastDue ? `${t.plans.pastDue} past due` : '')}</div>
<h2>Plans</h2><div class="grid">${tile(t.plans.year, 'yearly')}${tile(t.plans.month, 'monthly')}${tile(t.plans.lifetime, 'forever')}${tile(t.plans.ending, 'set to end', 'cancelled, running to the period end')}</div>
<h2>People</h2><div class="grid">${tile(t.people.total, 'signed-in people')}${tile(t.people.signinsWeek, 'sign-ins this week')}${tile(t.people.activeWeek, 'active this week', 'a session used in 7 days')}${tile(t.people.stoppedMail, 'stopped reminders')}</div>
<h2>Emails and invites</h2><table>
${row('Trial-ending emails, all time / this week', `${(t.emails.trial_ending || {}).total || 0} / ${(t.emails.trial_ending || {}).week || 0}`)}
${row('Trial-ended emails, all time / this week', `${(t.emails.trial_ended || {}).total || 0} / ${(t.emails.trial_ended || {}).week || 0}`)}
${row('Invites used / open', `${t.invites.used} / ${t.invites.open}`)}
${row('Stripe events this week', t.stripeEventsWeek)}
</table>
<p style="font-size:13px;color:var(--ink-3);margin-top:22px">Stripe holds the money side: <a href="https://dashboard.stripe.com/">dashboard.stripe.com</a>. This page is for the people in ADMIN_EMAILS only.</p>`;
    return page('By the numbers', body);
  } catch (e) {
    console.error('api-admin', e);
    return page('Something went wrong', `<h1>Something went wrong on our side.</h1><p><a href="/admin">Try again</a></p>`, 500);
  }
}

export const config = { path: ['/api/admin', '/api/admin/*'] };
