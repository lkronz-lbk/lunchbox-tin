import { createHash } from 'node:crypto';
import { sql, siteEnv } from '../lib/db.js';
import { currentUser } from '../lib/auth.js';
import { prices } from '../lib/stripe.js';
import { trialEnd } from '../lib/trial.js';

/* The numbers, for the people named in ADMIN_EMAILS and nobody else: households,
   trials, plans, sign-ins, emails sent, and the two rosters of people by email.
   Counts from the database. The rosters carry emails and the one script sorts them:
   the page is for ADMIN_EMAILS only, is never cached, and is never indexed. */
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* The only script on the page: it takes the two rosters the server already rendered and
   sorts, filters, searches and pages them in the browser. Nothing is fetched and nothing
   is stored; the rows are the markup. Its own sha256 is the whole of script-src below, so
   the policy can never go stale against it. */
const SCRIPT = `(function () {
  var num = function (n) { return n.toLocaleString('en-US'); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-table]'), function (box) {
    var table = box.querySelector('table'), body = table.tBodies[0], head = table.tHead.rows[0];
    var all = Array.prototype.slice.call(body.rows);
    var search = box.querySelector('[data-search]');
    var picks = Array.prototype.slice.call(box.querySelectorAll('[data-filter]'));
    var sheet = box.querySelector('[data-sheet]'), tally = box.querySelector('[data-count]');
    var back = box.querySelector('[data-prev]'), on = box.querySelector('[data-next]');
    var per = 30, at = 0, col = -1, dir = 1;

    function matching() {
      var q = (search.value || '').trim().toLowerCase();
      return all.filter(function (row) {
        if (q && row.textContent.toLowerCase().indexOf(q) < 0) return false;
        for (var i = 0; i < picks.length; i++) {
          var p = picks[i];
          if (p.value && row.cells[+p.getAttribute('data-filter')].textContent.trim() !== p.value) return false;
        }
        return true;
      });
    }

    function draw() {
      var rows = matching();
      if (col >= 0) {
        var byNumber = head.cells[col].getAttribute('data-sort') === 'num';
        rows = rows.slice().sort(function (a, b) {
          var x = a.cells[col].getAttribute('data-v') || '', y = b.cells[col].getAttribute('data-v') || '';
          if (byNumber) { x = parseFloat(x) || 0; y = parseFloat(y) || 0; }
          return x === y ? 0 : (x < y ? -dir : dir);
        });
      }
      var pages = Math.max(1, Math.ceil(rows.length / per));
      if (at > pages - 1) at = pages - 1;
      var from = at * per, to = Math.min(from + per, rows.length);
      while (body.firstChild) body.removeChild(body.firstChild);
      for (var i = from; i < to; i++) body.appendChild(rows[i]);
      tally.textContent = rows.length ? num(from + 1) + '–' + num(to) + ' of ' + num(rows.length) + (rows.length === all.length ? '' : ' (of ' + num(all.length) + ')') : 'nothing matches';
      back.disabled = at === 0; on.disabled = at >= pages - 1;
      for (var j = 0; j < head.cells.length; j++) {
        var th = head.cells[j], mark = th.querySelector('[data-arrow]');
        if (j === col) th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
        if (mark) mark.textContent = j === col ? (dir > 0 ? ' ↑' : ' ↓') : '';
      }
      if (sheet) sheet.textContent = rows.map(function (r) {
        return Array.prototype.map.call(r.cells, function (c) { return c.textContent.trim(); }).join(', ');
      }).join('\\n');
    }

    function reset() { at = 0; draw(); }
    search.addEventListener('input', reset);
    picks.forEach(function (p) { p.addEventListener('change', reset); });
    back.addEventListener('click', function () { if (at > 0) { at--; draw(); box.scrollIntoView(); } });
    on.addEventListener('click', function () { at++; draw(); box.scrollIntoView(); });
    Array.prototype.forEach.call(head.cells, function (th, i) {
      th.querySelector('button').addEventListener('click', function () {
        if (col === i) dir = -dir; else { col = i; dir = th.getAttribute('data-sort') === 'num' ? -1 : 1; }
        at = 0; draw();
      });
    });
    box.querySelector('[data-clear]').addEventListener('click', function () {
      search.value = ''; picks.forEach(function (p) { p.value = ''; }); col = -1; dir = 1; reset();
    });
    Array.prototype.forEach.call(box.querySelectorAll('[hidden]'), function (el) { el.hidden = false; });
    draw();
  });
})();`;
const PAGE_CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(SCRIPT, 'utf8').digest('base64')}'; base-uri 'none'; frame-ancestors 'none'`;

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
td{padding:8px 12px;border-top:1px solid var(--line)} .kv tr:first-child td{border-top:0}
.kv td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace;font-size:13px}
p{color:var(--ink-2)} a{color:var(--accent)}
.tools{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.tools input,.tools select,.tools button{font:inherit;font-size:14px;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink)}
.tools input{flex:1 1 220px;min-width:0}
.tools button{cursor:pointer;color:var(--ink-2)}
.scroll{overflow-x:auto}
.rows{min-width:900px}
.rows th{padding:0;text-align:left;background:var(--surface);border-bottom:1px solid var(--line)}
.rows th button{all:unset;box-sizing:border-box;display:block;width:100%;min-height:44px;padding:14px 12px;font:600 11px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);cursor:pointer;white-space:nowrap}
.rows th[aria-sort] button{color:var(--accent)}
.rows tbody tr:first-child td{border-top:0}
.rows td.n{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace;font-size:13px}
.rows td.e{word-break:break-word;min-width:190px}
.rows td.d{white-space:nowrap}
.rows td.d,.rows td.n,.rows th.d,.rows th.n{width:1%}
.pager{display:flex;align-items:center;gap:12px;margin:10px 0 0;font-size:13px;color:var(--ink-3)}
.pager button{font:inherit;min-height:44px;padding:8px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);cursor:pointer}
.pager button[disabled]{opacity:.45;cursor:default}
details{font-size:13px;color:var(--ink-3)} summary{cursor:pointer;padding:12px 0;min-height:20px}
pre{font-size:12px;white-space:pre-wrap;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px;margin:0}
.note{font-size:13px;color:var(--ink-3)}</style></head><body><div class="wrap">${body}</div><script>${SCRIPT}</script></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}

const tile = (n, label, note) => `<div class="tile"><b>${esc(n)}</b><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
const row = (label, n) => `<tr><td>${esc(label)}</td><td>${esc(n)}</td></tr>`;
const day = (d) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : 'never';
const shortDay = (d) => d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : 'never';

/* ---- the rosters ---- */
/* A roster is a plain table the script above sorts, filters, searches and pages. Every
   cell carries the value it sorts on, so the markup is the data and nothing is fetched.
   A column with a filter gets a dropdown of the values that are actually in it. */
const COLS = {
  email:    { label: 'Email', cls: 'e' },
  hh:       { label: 'Household', sort: 'num' },
  role:     { label: 'Role', filter: 'Role', cls: 'd' },
  plan:     { label: 'Plan', filter: 'Plan', cls: 'd' },
  status:   { label: 'Status', filter: 'Status', cls: 'd' },
  joined:   { label: 'Joined', sort: 'num', date: true },
  since:    { label: 'Came in', sort: 'num', date: true },
  lastSeen: { label: 'Last seen', sort: 'num', date: true },
  days:     { label: 'Days in app', sort: 'num' },
  sharing:  { label: 'Who they added', filter: 'Added' },
  others:   { label: 'Who else is on it', cls: 'e' }
};

const text = (key, v) => COLS[key].date ? day(v) : (v == null || v === '' ? '\u2014' : String(v));

function cellOf(key, v) {
  const c = COLS[key], shown = text(key, v);
  if (c.date) return `<td class="d" data-v="${v ? new Date(v).getTime() : 0}">${esc(shown)}</td>`;
  if (c.sort === 'num') return `<td class="n" data-v="${Number(v) || 0}">${esc(shown)}</td>`;
  return `<td${c.cls ? ` class="${c.cls}"` : ''} data-v="${esc(shown.toLowerCase())}">${esc(shown)}</td>`;
}

function roster(keys, rows, empty) {
  if (!rows.length) return `<p>${esc(empty)}</p>`;
  const picks = keys.map((k, i) => {
    if (!COLS[k].filter) return '';
    const seen = [...new Set(rows.map(r => text(k, r[k])))].sort();
    return `<select data-filter="${i}" aria-label="${esc(COLS[k].filter)}"><option value="">${esc(COLS[k].filter)}: all</option>${seen.map(v => `<option>${esc(v)}</option>`).join('')}</select>`;
  }).join('');
  const head = keys.map(k => `<th${COLS[k].date || COLS[k].sort === 'num' ? ' class="n"' : COLS[k].cls === 'd' ? ' class="d"' : ''} data-sort="${COLS[k].sort || 'text'}"><button type="button">${esc(COLS[k].label)}<span data-arrow></span></button></th>`).join('');
  const body = rows.map(r => `<tr>${keys.map(k => cellOf(k, r[k])).join('')}</tr>`).join('');
  const sheet = rows.map(r => keys.map(k => text(k, r[k])).join(', ')).join('\n');
  return `<div data-table>
<div class="tools" hidden><input type="search" data-search placeholder="Search these rows" aria-label="Search these rows">${picks}<button type="button" data-clear>Clear</button></div>
<div class="scroll"><table class="rows"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
<div class="pager" hidden><button type="button" data-prev>Previous</button><span data-count></span><button type="button" data-next>Next</button></div>
<details><summary>For a sheet, one line each</summary><pre data-sheet>${esc(sheet)}</pre></details>
</div>`;
}

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
  /* everyone by email, one row each: their household, its plan, when they were last seen
     and how many days they have had the app open. Two grouped scans instead of a pair of
     subqueries per person, because this page is one load and never a list endpoint. The
     session rows still carry activity from before last_seen_at was kept up to date. */
  const roll = await q`
    WITH used AS (SELECT user_id, max(last_used_at) AS at FROM sessions GROUP BY user_id),
         opened AS (SELECT user_id, count(*)::int AS n FROM user_days GROUP BY user_id)
    SELECT u.email, u.created_at AS joined, m.household_id AS hh, m.role,
           h.created_at, h.doc->>'createdAt' AS doc_created,
           e.plan, e.status, e.source, e.cancel_at_period_end AS cape, e.stripe_price_id AS price, e.event_at,
           greatest(u.last_seen_at, used.at) AS last_seen, coalesce(opened.n, 0) AS days
      FROM users u
      LEFT JOIN household_members m ON m.user_id = u.id
      LEFT JOIN households h ON h.id = m.household_id
      LEFT JOIN entitlements e ON e.household_id = m.household_id
      LEFT JOIN used ON used.user_id = u.id
      LEFT JOIN opened ON opened.user_id = u.id
     ORDER BY u.created_at DESC LIMIT 5000`;
  /* who else is on each household, from the rows already in hand rather than a second
     query. A parent invites a second parent or a caretaker; both show here, each with the
     day they were last active, so an account that was shared and then never touched again
     reads as plainly as one that is used from two phones. */
  const ROLE = { owner: 'Owner', adult: 'Parent', helper: 'Caretaker' };
  const inHousehold = new Map();
  for (const x of roll) {
    if (!x.hh) continue;
    if (!inHousehold.has(x.hh)) inHousehold.set(x.hh, []);
    inHousehold.get(x.hh).push(x);
  }
  /* one person's row, with the plan named the way the tiles above name it */
  const everyone = roll.map(x => {
    const paying = x.plan && x.plan !== 'free' && (x.status === 'active' || x.status === 'past_due');
    const end = x.hh ? trialEnd(x) : null;
    const household = inHousehold.get(x.hh) || [];
    const added = household.filter(o => o.role !== 'owner');
    const rest = household.filter(o => o.email !== x.email)
      .sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.email.localeCompare(b.email));
    return {
      email: x.email, hh: x.hh, days: x.days, joined: x.joined, since: x.event_at, lastSeen: x.last_seen,
      role: x.hh ? (ROLE[x.role] || x.role) : 'No household',
      sharing: !x.hh ? '' : !added.length ? 'Nobody'
        : added.some(o => o.role !== 'helper') && added.some(o => o.role === 'helper') ? 'A parent and a caretaker'
        : added.some(o => o.role === 'helper') ? 'A caretaker' : 'A second parent',
      others: rest.map(o => `${o.email} (${(ROLE[o.role] || o.role).toLowerCase()}, last active ${shortDay(o.last_seen)})`).join('; '),
      plan: !x.hh ? '' : paying ? (x.plan === 'lifetime' ? 'Forever' : p.month && x.price === p.month ? 'Monthly' : 'Yearly')
        : !end ? 'Free' : end.getTime() > now ? 'Three weeks' : 'Lapsed',
      status: paying ? (x.status === 'past_due' ? 'past due' : x.cape ? 'ending' : 'active')
        : x.status === 'canceled' ? 'canceled' : '',
      tester: x.source === 'code'
    };
  });
  return {
    households: { total: h.total, week: h.week, month: h.month, shared: m.shared, helpers: helpers.n },
    people: { total: u.total, signinsWeek: s.week, activeWeek: s.active, stoppedMail: u.quiet },
    plans: { paid: paid.length, year: byPlan.year, month: byPlan.month, lifetime: byPlan.lifetime, pastDue, ending },
    trials: { trialing, endingSoon, lapsed, capped },
    emails: Object.fromEntries(notices.map(n => [n.kind, { total: n.n, week: n.week }])),
    invites: inv, stripeEventsWeek: ev.week,
    roster: { standard: everyone.filter(x => !x.tester), testers: everyone.filter(x => x.tester), capped: roll.length === 5000 }
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
<h2>Plans</h2><div class="grid">${tile(t.plans.year, 'yearly')}${tile(t.plans.month, 'monthly')}${tile(t.plans.lifetime, 'forever')}${tile(t.plans.ending, 'set to end', 'canceled, running to the period end')}</div>
<h2>People</h2><div class="grid">${tile(t.people.total, 'signed-in people')}${tile(t.people.signinsWeek, 'sign-ins this week')}${tile(t.people.activeWeek, 'active this week', 'a session used in 7 days')}${tile(t.people.stoppedMail, 'stopped reminders')}</div>
<h2>Emails and invites</h2><table class="kv">
${row('Trial-ending emails, all time / this week', `${(t.emails.trial_ending || {}).total || 0} / ${(t.emails.trial_ending || {}).week || 0}`)}
${row('Trial-ended emails, all time / this week', `${(t.emails.trial_ended || {}).total || 0} / ${(t.emails.trial_ended || {}).week || 0}`)}
${row('Invites used / open', `${t.invites.used} / ${t.invites.open}`)}
${row('Stripe events this week', t.stripeEventsWeek)}
</table>
<h2>Standard users</h2>
${roster(['email', 'hh', 'role', 'plan', 'status', 'joined', 'lastSeen', 'days', 'sharing', 'others'], t.roster.standard, 'Nobody yet. Everyone who signs in and did not come in on a 100%-off code lands here.')}
<h2>Beta testers</h2>
${roster(['email', 'hh', 'role', 'plan', 'status', 'since', 'lastSeen', 'days', 'sharing', 'others'], t.roster.testers, 'None yet. A household that joins through the beta link (/beta), or checks out with a 100%-off code, lands here with everyone in it.')}
<p class="note">Days in app counts the New York days a person had the app open, one to a day. The days before this table shipped are read back from the session rows, which remember only the day a session began and the day it was last used, so an early count is a floor, not a total.${t.roster.capped ? ' Newest 5,000 people.' : ''}</p>
<p style="font-size:13px;color:var(--ink-3);margin-top:22px">Stripe holds the money side: <a href="https://dashboard.stripe.com/">dashboard.stripe.com</a>. This page is for the people in ADMIN_EMAILS only.</p>`;
    return page('By the numbers', body);
  } catch (e) {
    console.error('api-admin', e);
    return page('Something went wrong', `<h1>Something went wrong on our side.</h1><p><a href="/admin">Try again</a></p>`, 500);
  }
}

export const config = { path: ['/api/admin', '/api/admin/*'] };
