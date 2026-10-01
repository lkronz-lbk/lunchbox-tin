/* End-to-end smoke tests for Lunch Sorted.
   No test framework and no build: a tiny static server plus Playwright.
     npm test                    (installs nothing if playwright is present)
     CHROMIUM_PATH=/path/to/chrome npm test
   Every check below guards something that has actually broken at least once. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPolicies } from '../scripts/csp.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
/* The test server enforces the same Content-Security-Policy Netlify will, so a
   policy that would break the app breaks the suite instead of the site. */
/* the walk-through must have a card for every step this build claims, no more — and a
   build that claims nothing must say nothing, which is the usual case */
const APP_SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app', 'index.html'), 'utf8');
const NOTE_TEXT = (APP_SRC.match(/var WHATS_NEW = \{build:'[^']*',(?: seenAs:\[[^\]]*\],)? text:'([^']*)'/) || [,''])[1];   /* a note carried forward names the builds it was shown as, a list between the two */
const APP_BUILD = (APP_SRC.match(/var APP_BUILD = '([^']+)'/) || [,''])[1];
const STEP_COUNT = (APP_SRC.match(/steps:\[([\s\S]*?)\n  \]\};/) || [,''])[1].split('\n').filter(l => l.trim().startsWith('[')).length;
const POLICIES = readPolicies(fs.readFileSync(path.join(ROOT, '..', 'netlify.toml'), 'utf8'));

/* The API runs in-process against an in-memory Postgres, through the same
   handlers Netlify deploys, so sign-in, sync and invites are tested for real. */
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../scripts/migrate.mjs';
process.env.SITE_ENV = 'test'; delete process.env.URL; delete process.env.DEPLOY_PRIME_URL; delete process.env.RESEND_API_KEY;
const db = new PGlite();
/* every email the functions send is captured here instead of going to Resend */
const mails = []; globalThis.__LS_MAIL = mails;
globalThis.__LS_SQL = async (strings, ...vals) => typeof strings === 'string' ? (await db.query(strings)).rows : (await db.sql(strings, ...vals)).rows;
/* statements that must see each other's work, in one transaction, as sql().transaction runs them on Neon (db.js) */
globalThis.__LS_SQL.transaction = fn => db.transaction(async tx => { const out = []; for (const [strings, vals] of fn((s, ...v) => [s, v])) out.push((await tx.sql(strings, ...vals)).rows); return out; });
await migrate(globalThis.__LS_SQL);
const { default: authHandler, LINKS_FROM_ONE, LINKS_TO_ONE, LINKS_A_DAY } = await import('../netlify/functions/api-auth.js');
const { CODE_TRIES } = await import('../netlify/lib/auth.js');
const { default: householdHandler } = await import('../netlify/functions/api-household.js');
const { default: billingHandler } = await import('../netlify/functions/api-billing.js');
const { default: adminHandler, stats: adminStats } = await import('../netlify/functions/api-admin.js');
const { default: betaHandler } = await import('../netlify/functions/beta.js');
const { default: recipeHandler } = await import('../netlify/functions/api-recipe.js');
const { default: errorsHandler, ROWS_AN_HOUR, EACH_AN_HOUR } = await import('../netlify/functions/api-errors.js');
const { ipKey, ipBucket, ERRORS_KEPT } = await import('../netlify/lib/db.js');
const { default: appleHandler } = await import('../netlify/functions/api-apple.js');
const appleLib = await import('../netlify/lib/apple.js');
process.env.ADMIN_EMAILS = 'liz@example.com';
process.env.REVIEW_EMAIL = 'review@example.com'; process.env.REVIEW_CODE = 'REVU-2468';
process.env.BETA_CODE = 'BETA-TEST-1234'; process.env.BETA_CAP = '2';
const stripeLib = await import('../netlify/lib/stripe.js');
/* Stripe itself is a stub: it answers the four calls the code makes and records what it was asked */
const stripeCalls = [];
/* when a Stripe plan renews in these checks: midday UTC on Jan 15, 2027, so the date a parent is
   shown is Jan 15 in any time zone from UTC-11 to UTC+11. At 08:00 it read Jan 14 more than eight
   hours west of UTC, where nothing pins the browser's zone */
const PERIOD_END = 1800014400;
globalThis.__LS_STRIPE_FETCH = async (url, init) => {
  const u = new URL(url); const params = Object.fromEntries(new URLSearchParams(init.body || ''));
  stripeCalls.push({ method: init.method, path: u.pathname, params, auth: init.headers.authorization });
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/v1/prices/price_year') return reply({ id: 'price_year', unit_amount: 1999, currency: 'usd', recurring: { interval: 'year' }, metadata: { founding: 'yes' } });
  if (u.pathname === '/v1/prices/price_life') return reply({ id: 'price_life', unit_amount: 7900, currency: 'usd' });
  if (u.pathname === '/v1/prices/price_month') return reply({ id: 'price_month', unit_amount: 299, currency: 'usd', recurring: { interval: 'month' } });
  /* what live mode said of production's forever id on 2026-09-30: an id it does not have */
  if (u.pathname === '/v1/prices/price_gone') return reply({ error: { type: 'invalid_request_error', code: 'resource_missing', param: 'price', message: "No such price: 'price_gone'" } }, 404);
  if (u.pathname === '/v1/checkout/sessions') {
    if (params['automatic_tax[enabled]'] === 'true' && globalThis.__LS_STRIPE_NO_TAX) return reply({ error: { message: 'You must configure Stripe Tax before enabling automatic_tax', code: 'invalid_request_error' } }, 400);
    return reply({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  }
  if (u.pathname === '/v1/coupons/beta100') return reply({ id: 'beta100', object: 'coupon', percent_off: 100 });
  if (u.pathname === '/v1/coupons/tenoff') return reply({ id: 'tenoff', object: 'coupon', percent_off: 10 });
  if (u.pathname === '/v1/invoices/in_clash') return reply({ id: 'in_clash', object: 'invoice' });   /* a newer account: the payment is listed apart */
  if (u.pathname === '/v1/invoice_payments') return reply({ data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_clash' } }] });
  if (u.pathname === '/v1/refunds') return reply({ id: 're_clash', status: 'succeeded' });
  if (u.pathname === '/v1/billing_portal/sessions') return reply({ url: 'https://billing.stripe.com/p/session/test_1' });
  if (/^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(u.pathname)) return reply({ id: u.pathname.split('/')[4], status: 'expired' });
  if (u.pathname.startsWith('/v1/subscriptions/')) {
    const id = u.pathname.split('/').pop();
    if (init.method === 'GET') return reply({ id, object: 'subscription', status: 'active', cancel_at_period_end: false, customer: 'cus_pat', items: { data: [{ current_period_end: PERIOD_END, price: { id: 'price_year' } }] } });
    if (init.method === 'DELETE') return reply({ id, status: 'canceled' });
    return reply({ id, cancel_at_period_end: true });
  }
  return reply({ error: { message: 'stub: ' + u.pathname } }, 404);
};
async function apiProxy(req, res){
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const method = req.method;
  const request = new Request(`http://${req.headers.host}${req.url}`, {method, headers,
    body: (method === 'GET' || method === 'HEAD') ? undefined : Buffer.concat(chunks), duplex: 'half'});
  const handler = req.url.startsWith('/api/auth/') ? authHandler : req.url.startsWith('/api/billing') ? billingHandler : req.url.startsWith('/api/apple') ? appleHandler : req.url.startsWith('/api/admin') ? adminHandler : req.url.startsWith('/api/recipe') ? recipeHandler : req.url.startsWith('/api/errors') ? errorsHandler : req.url.startsWith('/beta') ? betaHandler : householdHandler;
  let resp;
  try { resp = await handler(request, {ip: '127.0.0.1'}); }
  catch (e) { res.writeHead(500); return res.end(String(e)); }
  const out = {}; resp.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  if (cookies.length) out['set-cookie'] = cookies;
  if (process.env.LS_TRACE && method !== 'GET') {
    const who = (req.headers.cookie || '').match(/ls_session=([A-Za-z0-9_-]{6})/); const body = Buffer.concat(chunks).toString('utf8');
    let key = ''; try { const b = JSON.parse(body); const k = process.env.LS_TRACE; key = b.doc ? ' apple=' + JSON.stringify((b.doc.pantry || {})[k] || null) + ' v=' + b.version : ''; } catch {}
    const rows = await db.query(`SELECT id, version, doc->'pantry'->'${process.env.LS_TRACE}' AS row FROM households ORDER BY id`);
    console.error(`[trace] ${method} ${req.url} by ${who ? who[1] : '-'} -> ${resp.status}${key} | server ${JSON.stringify(rows.rows)}`);
  }
  res.writeHead(resp.status, out); res.end(Buffer.from(await resp.arrayBuffer()));
}
function cspFor(p){
  if(p.startsWith('/app/')) return POLICIES['/app/*'];
  if(p === '/back.html') return POLICIES['/back.html'];
  if(p.startsWith('/ideas/')) return POLICIES['/ideas/*'];
  if(p === '/' || p === '/index.html') return POLICIES['/index.html'];
  return POLICIES[p] || null;
}
const TYPES = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.json':'application/json',
  '.webmanifest':'application/manifest+json','.txt':'text/plain','.svg':'image/svg+xml',
  '.css':'text/css','.xml':'application/xml'};

function serve(){
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(p.startsWith('/api/') || p === '/beta') return apiProxy(req, res);
    if(p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      /* as Netlify does: a path that is not there gets the site's own 404 page, with a 404 */
      res.writeHead(404, {'Content-Type': 'text/html'}); return fs.createReadStream(path.join(ROOT, '404.html')).pipe(res);
    }
    const hdr = {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'};
    const csp = cspFor(p.replace(/index\.html$/, m => (p === '/index.html' ? m : m)));
    if(csp) hdr['Content-Security-Policy'] = csp;
    res.writeHead(200, hdr);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, 'localhost', () => r({server, port: server.address().port})));   /* localhost: Secure cookies work over http there */
}

/* wait for a condition inside the page, or for the server to hold something, instead of sleeping */
async function until(pg, fn, arg, ms = 15000){
  /* evaluate() awaits a returned promise; waitForFunction would take the promise itself as truthy */
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let v = false; try { v = await pg.evaluate(fn, arg); } catch {}
    if (v) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}
let failures = 0, checks = 0, warnings = 0;
/* A launch gate: something that must be true before the site goes public, but
   that shouldn't paint CI red while the project is still pre-launch. */
function warn(name, ok){
  if(ok) console.log(`  ok   ${name}`);
  else { warnings++; console.log(`  WARN ${name}`); }
}
function check(name, ok, detail){
  checks++;
  if(ok) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${detail !== undefined ? ' — got: '+JSON.stringify(detail) : ''}`); }
}
/* Playwright will not click what it cannot see, and it waits out its whole thirty-second
   default before saying so. Two pieces of this app's furniture are away more often than
   they are there: a sheet that is not open is visibility:hidden, and a toast that has
   timed out is pointer-events:none. Done or Undo tapped at one that never arrived does
   not fail the check it belongs to — it throws out of the suite and takes the four
   minutes still to run with it, so a miss costs a whole rerun instead of one FAIL. Wait
   for the thing; if it never came, step over it and let the checks around it say so. */
const sheetIsOpen = (pg, ms = 5000) => until(pg, () => document.querySelector('#sheet').classList.contains('open'), null, ms);
async function sheetDone(pg, ms = 5000){
  const open = await sheetIsOpen(pg, ms);
  if(open) await pg.click('#sheetClose');
  return open;
}
async function backdropTap(pg, ms = 5000){
  const open = await sheetIsOpen(pg, ms);
  if(open) await pg.click('#backdrop', {position:{x:10, y:10}});
  return open;
}
/* the toast hides after six seconds and goes pointer-events:none with it, so the count
   that decides whether Undo can be tapped has to ask whether it is still showing */
async function tapUndoOn(pg, name){
  const up = (await pg.$$eval('#toast.show [data-act="undo"]', a => a.length)) === 1;
  check(name, up);
  if(up) await pg.click('#toast.show [data-act="undo"]');
  return up;
}

const V1_SAVE = {
  settings:{kid:'Nora', days:[1,3,5], noHeat:true, avoidAllergens:['nuts','dairy'], avoidText:'kiwi'},
  foods:[{id:'f1',n:'Sunbutter wrap',c:'main',t:['protein','soft'],a:'deli',al:[]},
         {id:'f2',n:'Pretzel sticks',c:'side',t:['crunchy'],a:'snacks',al:['gluten']},
         {id:'f3',n:'Apple slices',c:'fruit',t:['crunchy'],a:'produce',al:[]},
         {id:'f4',n:'Fruit leather',c:'sweet',t:['chewy'],a:'snacks',al:[]}],
  week:{start:'2026-08-24', days:[{d:'2026-08-24',dow:1,
        slots:{main:'f1',side:'f2',fruit:'f3',sweet:'f4'},
        lock:{main:true,side:false,fruit:false,sweet:false}}]},
  have:{f2:true}, packed:{'2026-08-24':{main:true}}, seq:9
};

const { server, port } = await serve();
const BASE = `http://localhost:${port}`;
/* the browser resolves localhost to whichever family the server took; Node's fetch may not, so
   requests made from the test itself go to the address the server actually bound */
const ADDR = server.address();
const NODE_BASE = 'http://' + (ADDR.family === 'IPv6' || ADDR.family === 6 ? '[' + ADDR.address + ']' : ADDR.address) + ':' + port;

/* ------------------------------------------------ merge rules, without a browser */
{
  const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  /* one file, one scope: a second `function x(` quietly replaces the first, so a helper
     named after a row builder makes the row builder run where the helper was meant to */
  const twice = Object.entries((html.match(/^function [A-Za-z_$][\w$]*\(/gm) || []).reduce((m, d) => (m[d] = (m[d] || 0) + 1, m), {})).filter(([, n]) => n > 1).map(([d]) => d);
  check('no function in the app is declared twice', twice.length === 0, twice);
  const block = html.match(/<script>\s*\/\* Merge rules([\s\S]*?)<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const w = {}; new Function('window', block)(w); const M = w.LSMerge;
  const t1 = '2026-09-01T10:00:00.000Z', t2 = '2026-09-02T10:00:00.000Z';
  const base = { schema:2, id:'acc_1', name:'H', createdAt:t1, updatedAt:t1, onboardedAt:t1, activeKidId:'kid_1', pantry:{},
    members:[{id:'mem_a', name:'Liz', updatedAt:t1, deletedAt:null}],
    kids:[{id:'kid_1', name:'Nia', hue:0, createdAt:t1, updatedAt:t1, deletedAt:null, settings:{days:[1,2,3,4,5], updatedAt:t1},
      foods:[{id:'f1', n:'Apple', c:'fruit', updatedAt:t1, deletedAt:null}], week:null, packed:{}, eaten:{}, past:[]}] };
  const clone = () => JSON.parse(JSON.stringify(base));
  let a = clone(), b = clone();
  b.kids[0].foods[0].n = 'Green apple'; b.kids[0].foods[0].updatedAt = t2;
  a.kids[0].foods.push({id:'f2', n:'Crackers', c:'side', updatedAt:t1, deletedAt:null});
  let m = M.merge(a, b);
  check('merge: the newer edit to a food wins, and a food added elsewhere survives',
    m.kids[0].foods.find(f => f.id === 'f1').n === 'Green apple' && m.kids[0].foods.some(f => f.id === 'f2'));
  a = clone(); b = clone(); b.kids[0].foods[0].deletedAt = t2; b.kids[0].foods[0].updatedAt = t2; a.kids[0].foods[0].n = 'Red apple';
  m = M.merge(a, b);
  check('merge: a newer deletion beats an older rename', m.kids[0].foods[0].deletedAt === t2);
  a = clone(); b = clone(); a.tz = 'Pacific/Honolulu'; b.tz = 'America/New_York';
  check("merge: the household's zone is the server copy's; a joining phone never moves it, and a phone that has one fills a household that does not",
    M.merge(a, b).tz === 'America/New_York' && M.merge(a, Object.assign(clone(), {tz: null})).tz === 'Pacific/Honolulu');
  a = clone(); b = clone();
  a.kids[0].packed['2026-09-01'] = {main:{at:t1, by:'mem_a'}}; b.kids[0].packed['2026-09-01'] = {side:{at:t2, by:'mem_b'}};
  a.pantry['apples'] = {have:true, at:t1}; b.pantry['bread'] = {have:true, at:t2};
  m = M.merge(a, b);
  check('merge: ticks from both phones are kept', !!(m.kids[0].packed['2026-09-01'].main && m.kids[0].packed['2026-09-01'].side) && !!(m.pantry.apples && m.pantry.bread));
  a = clone(); b = clone();
  a.kids[0].eaten['2026-09-01'] = {main:{foodId:'f1', r:'none', at:t1, by:'mem_a'}}; b.kids[0].eaten['2026-09-01'] = {side:{foodId:'f2', r:'left', at:t2, by:'mem_b'}};
  a.kids[0].settings = {days:[1,2,3,4,5], review:false, homeAt:'17:30', updatedAt:t2}; b.kids[0].settings = {days:[1,2,3,4,5], review:true, homeAt:'15:00', updatedAt:t1};
  m = M.merge(a, b);
  a = clone(); b = clone();
  a.kids[0].week = { id:'wk_2', kidId:'kid_1', start:'2026-09-07', createdAt:t1, updatedAt:t2, days:[{ d:'2026-09-09', dow:3, slots:{main:'f1'}, lock:{}, kidPick:{}, over:{}, off:true, updatedAt:t2 }] };
  b.kids[0].week = { id:'wk_2', kidId:'kid_1', start:'2026-09-07', createdAt:t1, updatedAt:t1, days:[{ d:'2026-09-09', dow:3, slots:{main:'f1'}, lock:{}, kidPick:{}, over:{}, updatedAt:t1 }] };
  check('merge: a day taken off on this phone stays off on the other, by the day\'s own stamp', M.merge(a, b, '2026-09-01').kids[0].week.days[0].off === true && M.merge(b, a, '2026-09-01').kids[0].week.days[0].off === true);
  /* a phone still on the last build knows no day stamps: it strips the flag and the stamp and pushes the
     week back under the same week stamp, which is later than the day's own. The stamped day is the later word. */
  a = clone(); b = clone();
  a.kids[0].week = { id:'wk_2', kidId:'kid_1', start:'2026-09-07', createdAt:t1, updatedAt:'2026-09-02T10:00:00.004Z', days:[{ d:'2026-09-09', dow:3, slots:{main:'f1'}, lock:{}, kidPick:{}, over:{}, off:true, updatedAt:t2 }, { d:'2026-09-10', dow:4, slots:{main:'f1'}, lock:{}, kidPick:{}, over:{} }] };
  b.kids[0].week = { id:'wk_2', kidId:'kid_1', start:'2026-09-07', createdAt:t1, updatedAt:'2026-09-02T10:00:00.004Z', days:[{ d:'2026-09-09', dow:3, slots:{main:'f1'}, lock:{}, kidPick:{}, over:{} }, { d:'2026-09-10', dow:4, slots:{main:'f2'}, lock:{}, kidPick:{}, over:{} }] };
  {
    const ab = M.merge(a, b, '2026-09-01').kids[0].week.days, ba = M.merge(b, a, '2026-09-01').kids[0].week.days;
    check('merge: with the weeks level, a day carrying its own stamp beats the copy an older build stripped of it, on either phone', ab[0].off === true && ba[0].off === true, [ab[0], ba[0]]);
    check('merge: and a day neither copy stamped still goes to the local one', ab[1].slots.main === 'f1' && ba[1].slots.main === 'f2', [ab[1], ba[1]]);
  }
  check('merge: a Didn’t get to it answer travels like any other, and the newer what-came-home settings win', m.kids[0].eaten['2026-09-01'].main.r === 'none' && m.kids[0].eaten['2026-09-01'].side.r === 'left' && m.kids[0].settings.review === false && m.kids[0].settings.homeAt === '17:30');
  {
    const wk = (stamp) => ({ id:'wk_1', kidId:'kid_1', start:'2026-09-07', createdAt:t1, updatedAt:stamp, days:[
      { d:'2026-09-07', dow:1, slots:{main:'f1'}, lock:{main:false}, kidPick:{}, over:{}, updatedAt:t1 },
      { d:'2026-09-08', dow:2, slots:{main:'f1'}, lock:{main:false}, kidPick:{}, over:{}, updatedAt:t1 },
      { d:'2026-09-09', dow:3, slots:{main:'f1'}, lock:{main:false}, kidPick:{}, over:{} } ] });
    const t3 = '2026-09-03T10:00:00.000Z';
    a = clone(); b = clone(); a.kids[0].week = wk(t2); b.kids[0].week = wk(t3);
    a.kids[0].week.days[0].slots.main = 'a_mon'; a.kids[0].week.days[0].updatedAt = t2;      /* this phone changed Monday, later */
    b.kids[0].week.days[1].slots.main = 'b_tue'; b.kids[0].week.days[1].updatedAt = t3;      /* the other phone changed Tuesday, later still */
    b.kids[0].week.days[0].slots.main = 'b_mon'; b.kids[0].week.days[0].updatedAt = t1;      /* and Monday, earlier */
    a.kids[0].week.days[2].slots.main = 'a_wed'; b.kids[0].week.days[2].slots.main = 'b_wed';   /* Wednesday, unstamped on both: the newer week's copy */
    m = M.merge(a, b, '2026-09-01');
    const days = Object.fromEntries(m.kids[0].week.days.map(d => [d.d, d.slots.main]));
    check('merge: two parents changing different days both win, day by day, by the day\'s own stamp', days['2026-09-07'] === 'a_mon' && days['2026-09-08'] === 'b_tue', days);
    check('merge: a day with no stamp of its own goes by its week\'s, and a tie goes to this phone', days['2026-09-09'] === 'b_wed' && (() => { const x = clone(), y = clone(); x.kids[0].week = wk(t2); y.kids[0].week = wk(t2); x.kids[0].week.days[2].slots.main = 'x'; y.kids[0].week.days[2].slots.main = 'y'; return M.merge(x, y, '2026-09-01').kids[0].week.days[2].slots.main === 'x'; })(), days);
  }
  /* recipes belong to the household, so they merge like members and lunchboxes do */
  a = clone(); b = clone();
  a.recipes = [{id:'rec_1', n:'Blondies', m:40, y:12, ing:['1 cup oats'], steps:['Stir.'], src:'', url:null, createdAt:t1, updatedAt:t1, deletedAt:null}];
  b.recipes = [{id:'rec_1', n:'Pumpkin blondies', m:40, y:12, ing:['1 cup oats'], steps:['Stir.'], src:'', url:null, createdAt:t1, updatedAt:t2, deletedAt:null},
               {id:'rec_2', n:'Oat bars', m:20, y:8, ing:['2 cups oats'], steps:['Press.'], src:'', url:null, createdAt:t2, updatedAt:t2, deletedAt:null}];
  m = M.merge(a, b);
  check('merge: a recipe renamed on the other phone wins, and one written there arrives',
    m.recipes.length === 2 && m.recipes.filter(r => r.id === 'rec_1')[0].n === 'Pumpkin blondies'
    && m.recipes.some(r => r.id === 'rec_2'), m.recipes.map(r => r.n));
  a = clone(); b = clone();
  a.recipes = [{id:'rec_1', n:'Blondies', m:40, y:12, ing:['1 cup oats'], steps:['Stir.'], src:'', url:null, createdAt:t1, updatedAt:t2, deletedAt:null}];
  b.recipes = [{id:'rec_1', n:'Blondies', m:40, y:12, ing:['1 cup oats'], steps:['Stir.'], src:'', url:null, createdAt:t1, updatedAt:t1, deletedAt:t1}];
  check('merge: a recipe removed on one phone and edited later on the other keeps the later edit',
    M.merge(a, b).recipes[0].deletedAt === null);
  a = clone(); b = clone();
  a.recipes = [{id:'rec_1', n:'Blondies', m:40, y:12, ing:['1 cup oats'], steps:['Stir.'], src:'', url:null, createdAt:t1, updatedAt:t1, deletedAt:null}];
  b.recipes = [{id:'rec_1', n:'Blondies', m:40, y:12, ing:['1 cup oats'], steps:['Stir.'], src:'', url:null, createdAt:t1, updatedAt:t2, deletedAt:t2}];
  check('merge: and a newer removal beats an older edit, like every other record',
    M.merge(a, b).recipes[0].deletedAt === t2);
  a = clone(); b = clone(); b.members.push({id:'mem_b', name:'Sam', updatedAt:t2, deletedAt:null});
  b.kids.push({id:'kid_2', name:'Ollie', hue:1, createdAt:t2, updatedAt:t2, deletedAt:null, settings:{days:[1], updatedAt:t2}, foods:[], week:null, packed:{}, eaten:{}, past:[]});
  m = M.merge(a, b);
  check('merge: a member and a lunchbox added on the other phone appear', m.members.length === 2 && m.kids.length === 2);
  a = clone(); b = clone();
  a.kids.push({id:'kid_9', name:'Zed', hue:1, createdAt:t2, updatedAt:t2, deletedAt:null, settings:{days:[1], updatedAt:t2}, foods:[], week:null, packed:{}, eaten:{}, past:[]});
  b.kids.push({id:'kid_2', name:'Ollie', hue:1, createdAt:t2, updatedAt:t2, deletedAt:null, settings:{days:[1], updatedAt:t2}, foods:[], week:null, packed:{}, eaten:{}, past:[]});
  check('merge: two phones that each added a lunchbox compute the same document', M.same(M.merge(a, b), M.merge(b, a)) && M.merge(a, b).kids.map(k => k.id).join() === M.merge(b, a).kids.map(k => k.id).join());
  a = clone(); b = clone();
  a.kids[0].eaten['2026-09-01'] = {main:{foodId:'f1', r:'left', at:t2, by:'mem_a'}};
  b.kids[0].eaten['2026-09-01'] = {skipped:true, at:t1, by:'mem_b'};
  m = M.merge(a, b); const m2 = M.merge(b, a);
  check('merge: a newer answer beats an older skip, whichever phone holds it', !m.kids[0].eaten['2026-09-01'].skipped && !m2.kids[0].eaten['2026-09-01'].skipped);
  a = clone(); b = clone();
  a.kids[0].packed['2026-09-01'] = {main:{at:t2, by:'mem_a', off:true}}; b.kids[0].packed['2026-09-01'] = {main:{at:t1, by:'mem_b'}};
  a.pantry.bread = {have:false, at:t2}; b.pantry.bread = {have:true, at:t1};
  m = M.merge(a, b);
  check('merge: an un-tick travels and wins over the older tick', m.kids[0].packed['2026-09-01'].main.off === true && m.pantry.bread.have === false);
  a = clone(); b = clone();
  const dayA = {d:'2026-08-31', dow:1, slots:{main:'f1'}, lock:{}, kidPick:{}}, dayB = {d:'2026-08-31', dow:1, slots:{main:'f2'}, lock:{}, kidPick:{}};
  a.kids[0].week = {id:'w1', kidId:'kid_1', start:'2026-08-31', createdAt:t1, updatedAt:t1, days:[dayA, {d:'2026-09-03', dow:4, slots:{main:'f1'}, lock:{}, kidPick:{}}]};
  b.kids[0].week = {id:'w1', kidId:'kid_1', start:'2026-08-31', createdAt:t1, updatedAt:t2, days:[dayB, {d:'2026-09-03', dow:4, slots:{main:'f2'}, lock:{}, kidPick:{}}]};
  m = M.merge(a, b, '2026-09-02');
  check('merge: the newer plan wins for days ahead, and a day already gone keeps what was packed',
    m.kids[0].week.days.find(d => d.d === '2026-09-03').slots.main === 'f2' && m.kids[0].week.days.find(d => d.d === '2026-08-31').slots.main === 'f1');
}

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('playwright-core')); }

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
/* every context is a phone; the browser never fetches Google Fonts, which the suite does not
   test and which, through a slow proxy, can turn a page load into a thirty-second wait */
/* The app reads the clock in a dozen places and the week it plans depends on
   the weekday: on a Thursday the anchor rule leaves two days, the suite packs
   one, and the kid's pick (which needs two untouched days) never appears. So
   the suite failed every Thursday and Friday, on CI too. Every browser context
   is pinned to the most recent Tuesday, 9am local: Monday has gone (so the
   past-day invariants are exercised) and four days are still ahead. Set
   SMOKE_TODAY=YYYY-MM-DD to pin another day. Server-side code keeps the real
   clock, which is how a phone and a server always relate. */
const pinnedDay = (() => {
  if (process.env.SMOKE_TODAY) return process.env.SMOKE_TODAY;
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay() + 5) % 7));     /* back to Tuesday (0=Sun: Tue is 2; (day+5)%7 is days since Tuesday) */
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
})();
/* One clock for the whole run. An init script runs again on every document, and an
   offset taken fresh from Real.now() each time put the clock back to nine o'clock on
   every reload: a record stamped before the reload then outranked every record stamped
   after it until the clock caught up, and a merge in that window let the server's live
   copy of a food beat the tombstone this phone had just written -- two runs in three.
   Measured from one moment for every context, the pinned day's clock only ever moves
   forward, across reloads and across phones alike. */
const SUITE_START = Date.now();
const pinClock = async c => c.addInitScript(pin => {
  const Real = Date;
  const [y, m, dd] = pin.day.split('-').map(Number);
  let offset = new Real(y, m - 1, dd, 9, 0, 0).getTime() - pin.startReal;
  window.__pinHour = h => { offset = new Real(y, m - 1, dd, h, 0, 0).getTime() - Real.now(); };   /* the suite moves within the pinned day */
  function Fake(...a){ return a.length ? new Real(...a) : new Real(Real.now() + offset); }
  Fake.prototype = Real.prototype;
  Fake.now = () => Real.now() + offset;
  Fake.parse = Real.parse; Fake.UTC = Real.UTC;
  window.Date = Fake;
}, { day: pinnedDay, startReal: SUITE_START });
/* the lunchbox gear lives on a lunchbox tab, never on the household's Shop: step to Week first if needed */
/* Account is five rows now; each opens a pane over the tab */
const openPane = async (pg, name) => {
  await pg.click('[data-act="tab"][data-tab="setup"]');
  await pg.click(`[data-act="pane"][data-pane="${name}"]`);
  await pg.waitForSelector('#paneTitle');   /* the render is synchronous; wait for the thing, not for a guess at how long it takes */
};
const openGear = async pg => { if (!(await pg.$('[data-act="box-settings"]'))) { await pg.click('[data-act="tab"][data-tab="week"]'); await pg.waitForTimeout(250); } await pg.click('[data-act="box-settings"]'); };
/* a shuffle asks whose boxes when there is more than one; answer "all of them" */
const goShuffle = async pg => {
  await pg.waitForTimeout(250);
  const b = await pg.$('[data-act="shuffle-go"]');
  const many = await pg.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted') || '{}').kids?.filter(k => !k.deletedAt).length > 1);
  if (many && !b) throw new Error('a shuffle with more than one lunchbox must ask whose boxes');
  if (b) { await b.click(); await pg.waitForTimeout(400); }
};
console.log(`  clock pinned to ${pinnedDay} in every browser context (SMOKE_TODAY to change)`);
const phone = async () => { const c = await browser.newContext({ viewport:{width:375,height:812} }); await pinClock(c); await c.route(/^https:\/\/fonts\.g(oogleapis|static)\.com\//, r => r.abort()); return c; };
const ctx = await phone();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));

try {
  /* ---------------------------------------------------------- first run */
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(500);
  check('first run hides the tab bar but keeps the app\u2019s own header',
    await page.evaluate(() => getComputedStyle(document.querySelector('nav.tabs')).display === 'none'
      && getComputedStyle(document.querySelector('.topbar')).display !== 'none'
      && /Lunch/.test(document.querySelector('.topbar .brand').textContent)
      && document.getElementById('who').innerHTML === ''   /* the header is the brand and nothing else here */
      && document.body.classList.contains('first-run')));
  /* the whole point of the layout: a parent answers all of it without scrolling.
     The viewport the suite runs at is the one in tests/smoke.mjs's context. */
  check('the questions and both buttons fit on one screen, with the safe areas a phone asks for',
    await page.evaluate(() => {
      const d = document.documentElement;
      d.style.setProperty('--sat', '59px'); d.style.setProperty('--sab', '34px');
      const over = d.scrollHeight - d.clientHeight;
      const go = document.querySelector('[data-act="ob-go"]').getBoundingClientRect();
      const skip = document.querySelector('[data-act="ob-skip"]').getBoundingClientRect();
      const small = [...document.querySelectorAll('.ob button, .ob input')].filter(e => e.getBoundingClientRect().height < 43.5);
      d.style.removeProperty('--sat'); d.style.removeProperty('--sab');
      return over === 0 && go.bottom <= d.clientHeight && skip.bottom <= d.clientHeight && small.length === 0;
    }));
  check('the way back in is a sentence a new parent can rule out, not a bare word',
    await page.$eval('.ob [data-act="ob-signin"]', e => /already signed up/i.test(e.textContent)));
  /* The questions screen renders noticeBanner(), so a corrupt-save message or an invite
     reaches a parent there — but the what's-new note must not. It is a delta against a
     build they were last in on, and a phone still answering the questions has not been in
     on any build: whatsNew() marks the build seen and returns before the note is set.
     viewObEmail() renders no banner at all today, so the sign-in half of this is a guard
     against that changing, not a live assertion. */
  check('the what\u2019s-new note stays off the first-run screens, however old the build a phone last saw',
    await (async () => {
      await page.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
      await page.reload(); await page.waitForTimeout(600);
      const onQuestions = await page.evaluate(t => !!document.querySelector('.ob')
        && (!t || !document.getElementById('view').textContent.includes(t))   /* a build with no note has no text to keep off */
        && !document.querySelector('[data-act="whats-new"]'), NOTE_TEXT);
      await page.click('[data-act="ob-signin"]'); await page.waitForTimeout(300);
      const onSignIn = await page.evaluate(() => !!document.querySelector('.ob')
        && !/New: /.test(document.getElementById('view').textContent)
        && !document.querySelector('[data-act="whats-new"]'));
      /* and the build is stamped seen, so finishing the questions does not spring it either */
      const stamped = await page.evaluate(() => localStorage.getItem('lunchsorted-seen'));
      await page.click('[data-act="ob-later"]'); await page.waitForTimeout(400);
      return onQuestions && onSignIn && stamped === APP_BUILD;
    })());
  /* the boot cover is over a live screen, so while it is opaque it has to take the
     taps aimed at what it hides — a stray one used to reach Join their household */
  check('the boot splash swallows taps while it covers the app, and then goes',
    await (async () => {
      const c = await phone();          /* the suite's own phone: clock pinned, fonts blocked */
      const pg = await c.newPage();
      await pg.goto(BASE+'/app/', {waitUntil:'commit'});
      await pg.waitForFunction(() => document.querySelector('[data-act="ob-go"]'));
      const swallowed = await pg.evaluate(() => {
        const s = document.getElementById('splash');
        if(!s || +getComputedStyle(s).opacity < 0.99) return 'gone';   /* raced us; the removal is checked below */
        const at = document.querySelector('[data-act="ob-go"]').getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(at.left + at.width/2), Math.round(at.top + at.height/2));
        return (hit === s || s.contains(hit)) ? 'swallowed' : 'leaked';
      });
      const left = await pg.evaluate(async () => {
        const t = Date.now();
        while(document.getElementById('splash') && Date.now() - t < 9000) await new Promise(r => setTimeout(r, 25));
        return !document.getElementById('splash');
      });
      await c.close();
      return swallowed !== 'leaked' && left;
    })());

  await page.fill('#obName', 'Nia');
  await page.evaluate(() => { document.getElementById('obName').__kept = true; });
  await page.click('[data-act="ob-avoid"][data-v="dairy"]');
  await page.click('[data-act="ob-breadth"][data-v="picky"]');
  check('tapping a chip does not rebuild the form under the name field', await page.evaluate(() =>
    document.getElementById('obName').__kept === true && document.getElementById('obName').value === 'Nia'
    && document.querySelector('[data-act="ob-breadth"][data-v="picky"]').getAttribute('aria-pressed') === 'true'));
  await page.click('[data-act="ob-go"]');
  await page.waitForTimeout(400);
  check('after the questions, one screen asks where to send the sign-in link, with a way past it',
    (await page.$$eval('#signinEmail', a => a.length)) === 1 && (await page.$$eval('[data-act="ob-later"]', a => a.length)) === 1 && await page.evaluate(() => !(document.activeElement && document.activeElement.id === 'signinEmail')));
  await page.fill('#signinEmail', 'nope'); await page.click('[data-act="signin-request"]'); await page.waitForTimeout(200);
  check('a bad address is caught on that screen too, and stays in the field', /does not look like an email/i.test(await page.textContent('#toast')) && await page.$eval('#signinEmail', i => i.value === 'nope'));
  await page.click('[data-act="ob-later"]'); await page.waitForTimeout(300);
  check('the name typed at onboarding lands on the lunchbox',
    await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].name === 'Nia'));
  check('the week header leads with the date', /^Week of /.test((await page.textContent('.view-title')).trim()));
  check('the week eyebrow counts the days actually planned', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], words = ['No','One','Two','Three','Four','Five','Six','Seven'];
    return document.querySelector('.view-sub').textContent.trim().startsWith(words[k.week.days.length]); }));

  check('three taps land on a planned week',
    await page.getAttribute('nav.tabs [aria-current="true"]', 'data-tab') === 'week');
  const empties = await page.$$eval('.cmp.empty', a => a.length);
  check('every compartment is filled', empties === 0, empties);
  const planned = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.length);
  const tin = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.tin .cmp')];
    const care = cells.filter(c => c.querySelector('.marks .care[role="img"][aria-label]')).length;
    const cold = document.querySelectorAll('.marks .care[aria-label="keep cold"]').length;
    const words = cells.filter(c => /\b(crunchy|soft|protein|tangy|salty|juicy|hearty|light)\b/i.test(c.textContent)).length;
    const heights = cells.map(c => Math.round(c.getBoundingClientRect().height));
    const lab = cells[0] && Math.round(parseFloat(getComputedStyle(cells[0].querySelector('.lab')).fontSize));
    const mark = document.querySelector('.marks svg');
    return { cells: cells.length, care, cold, words, minH: Math.min(...heights), maxH: Math.max(...heights), lab, mark: mark ? Math.round(mark.getBoundingClientRect().width) : 0,
      tapped: cells.filter(c => c.tagName === 'BUTTON' && c.getBoundingClientRect().height >= 44).length };
  });
  check('the tin is compact: cells from 58px, an 11px label, no trait words, and every cell a 44px target', planned >= 2 && tin.cells >= planned * 4 && tin.minH >= 58 && tin.maxH < 100 && tin.lab === 11 && tin.words === 0 && tin.tapped === tin.cells && (await page.$$eval('.note', a => a.length)) === 0, tin);
  check('the care words are a 13px glyph in the label row with a spoken name', tin.care >= 1 && tin.cold >= 1 && tin.mark === 13, tin);
  check('excluded allergens never enter the list', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    return !d.kids[0].foods.some(f => (f.al||[]).includes('nuts') || (f.al||[]).includes('dairy'));
  }));

  /* ------------------------------------------------------------ packing */
  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(200);
  check('a compartment on the Pack screen is not a button', (await page.$$eval('.tin .cmp', a => a.filter(c => c.tagName === 'BUTTON' || c.getAttribute('data-act')).length)) === 0 && (await page.$$eval('.tin .cmp', a => a.length)) > 0);
  await page.click('[data-act="pack-all"]'); await page.waitForTimeout(200);
  check('one Packed tick fills every compartment with a food in it, and dims the box', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const d = k.week.days.find(x => k.packed[x.d]); if(!d) return false;
    const row = k.packed[d.d]; return Object.keys(d.slots).filter(c => d.slots[c]).every(c => row[c] && !row[c].off) && !!document.querySelector('.tin.packed') && document.querySelector('[data-act="pack-all"]').getAttribute('aria-pressed') === 'true';
  }));
  await page.click('[data-act="pack-all"]'); await page.waitForTimeout(200);
  check('a second tap un-ticks them all, as rows the other phone will see', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const d = k.week.days.find(x => k.packed[x.d]);
    return Object.values(k.packed[d.d]).every(r => r.off === true) && !document.querySelector('.tin.packed');
  }));
  await page.click('[data-act="pack-all"]');
  await page.waitForTimeout(200);
  check('packing records who and when', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    for(const k of d.kids) for(const dt in k.packed) for(const c in k.packed[dt])
      return !!k.packed[dt][c].by && !!k.packed[dt][c].at;
    return false;
  }));

  /* -------------------------------------------- where the cursor is left */
  {
    /* A sheet says it is a dialog, so the cursor goes into it as it opens and comes back to
       what opened it as it closes. Before, a parent on VoiceOver or a keyboard was left on
       the row behind the sheet, and at the top of the page once it had gone. A phone of its
       own, so nothing here moves the week the rest of the run reads. Every step waits for the
       sheet it needs and steps over what never came: a regression fails its own checks rather
       than spending Playwright's thirty seconds and the rest of the run. */
    const cf = await phone(); const pf = await cf.newPage(); pf.on('pageerror', e => errors.push(String(e.message)));
    await pf.goto(BASE+'/app/'); await pf.waitForTimeout(400);
    await pf.fill('#obName', 'Fern'); await pf.click('[data-act="ob-go"]'); await pf.waitForTimeout(400);
    await pf.click('[data-act="ob-later"]'); await pf.waitForTimeout(300);
    /* what has the cursor, whether a ring is drawn round it, and where the page is */
    const cursor = () => pf.evaluate(() => { const a = document.activeElement || document.body,
      o = {tag: a.tagName, id: a.id, inSheet: !!a.closest('#sheet'), first: a === document.querySelector('#view h2, #view h3'), ring: getComputedStyle(a).outlineStyle !== 'none', y: window.scrollY};
      [...a.attributes].forEach(x => { if (x.name.indexOf('data-') === 0) o[x.name.slice(5)] = x.value; }); return o; });
    /* a tap inside the open sheet, or false when there is nothing there to tap */
    const tapIn = async sel => { const h = await pf.$('#sheet.open ' + sel); if (!h) return false; try { await h.click({timeout: 3000}); return true; } catch { return false; } };
    /* a sheet a failed step left open would lie over every tap that follows */
    const clear = async () => { if (await pf.$('#sheet.open')) { await pf.click('#sheetClose'); await pf.waitForTimeout(300); } };
    await pf.click('[data-act="help"]');
    let up = await sheetIsOpen(pf), c = await cursor();
    check('a sheet takes the cursor as it opens: focus is on its title, not on the button behind it', up && c.id === 'sheetTitle', c);
    up = await sheetDone(pf); await pf.waitForTimeout(300); c = await cursor();
    check('and Done gives it back to the button that opened the sheet', up && c.act === 'help' && !c.inSheet && !c.ring, c);
    await pf.click('[data-act="help"]'); up = await backdropTap(pf); await pf.waitForTimeout(300); c = await cursor();
    check('as does a tap on the backdrop', up && c.act === 'help' && !c.inSheet, c);
    await clear(); await pf.click('[data-act="tab"][data-tab="shop"]'); await pf.waitForTimeout(250);
    const lineKey = await pf.getAttribute('[data-act="line-open"] >> nth=1', 'data-key', {timeout: 3000}).catch(() => null);
    if (lineKey) { await pf.click('[data-act="line-open"] >> nth=1'); up = await sheetDone(pf); await pf.waitForTimeout(300); } else up = false;
    c = await cursor();
    check('a line’s sheet hands the cursor back to that line, not to the first one on the list', up && c.act === 'line-open' && c.key === lineKey, {c, lineKey});
    /* The usual way out of a sheet is by choosing something, and that redraws the screen behind it: the
       button that opened the sheet is gone, so the one drawn in its place is found by what it carries.
       On a short screen the compartment is left straddling the top edge and tapped the way a thumb taps
       in Safari: no focus of its own, and none of the scrolling a test's own click does first. So the
       way back is the tap itself, and a focus() allowed to scroll would move the page. */
    await clear(); await pf.setViewportSize({width:375, height:400});
    await pf.click('[data-act="tab"][data-tab="week"]'); await pf.waitForTimeout(250);
    const slotWas = await pf.evaluate(async () => {
      const b = document.querySelector('#view [data-act="slot"][data-cat="side"]'); if (!b) return null;
      const r = b.getBoundingClientRect();
      window.scrollTo(0, Math.round(r.top + window.scrollY + r.height / 2));
      await new Promise(f => setTimeout(f, 100));
      const top = b.getBoundingClientRect().top;
      b.click();
      return {day: b.getAttribute('data-day'), cat: b.getAttribute('data-cat'), top, h: r.height};
    });
    up = !!slotWas && await sheetIsOpen(pf);
    /* the button is marked first, so the check can tell the sheet was drawn again under the cursor */
    await pf.evaluate(() => { const b = document.querySelector('#sheet.open [data-act="sheet-shuffle"]'); if (b) b.__drawnBefore = true; });
    const shuffled = up && await tapIn('[data-act="sheet-shuffle"]'); await pf.waitForTimeout(250);
    c = await cursor();
    const redrawn = await pf.evaluate(() => { const a = document.activeElement; return !!a && a.getAttribute('data-act') === 'sheet-shuffle' && !a.__drawnBefore; });
    check('a sheet redrawn by a tap inside it puts the cursor back on what was tapped, in the new sheet, not behind it', shuffled && (await sheetIsOpen(pf, 500)) && redrawn && c.inSheet, c);
    const yOpen = c.y;
    const picked = up && await tapIn('[data-act="pick"]'); await pf.waitForTimeout(300); c = await cursor();
    check('choosing from a compartment’s sheet closes it, redraws the week, and leaves the cursor on that compartment with the page where it was',
      picked && !(await pf.$('.sheet.open')) && c.act === 'slot' && c.day === slotWas.day && c.cat === slotWas.cat
      && slotWas.top < 0 && slotWas.top > -slotWas.h && c.y === yOpen, {c, slotWas, yOpen});
    /* The phone's keyboard has a Done key, and it is a key: the browser takes whoever pressed it for
       someone moving by keyboard and rings whatever a script focuses next. The first version of this
       left a ring on the compartment after every write-in. */
    await clear(); await pf.click('#view [data-act="slot"][data-cat="fruit"] >> nth=0'); up = await sheetIsOpen(pf);
    const wrote = up && await tapIn('[data-act="write-in"]');
    const typing = wrote && await until(pf, () => document.activeElement && document.activeElement.id === 'wiName', null, 3000);
    if (typing) { await pf.fill('#wiName', 'Leftover pasta'); await pf.press('#wiName', 'Enter'); await pf.waitForTimeout(300); }
    c = await cursor();
    check('a write-in saved with the keyboard’s own Done key puts the cursor back on its compartment, with no ring for a parent who never pressed Tab',
      typing && !(await pf.$('.sheet.open')) && c.act === 'slot' && c.cat === 'fruit' && !c.ring, c);
    /* A parent on a keyboard. After a key, the browser rings whatever a script focuses: this is the one
       place a title could wear a ring, and a control handed back must wear one. */
    await clear(); await pf.evaluate(() => window.scrollTo(0, 0));
    await pf.focus('[data-act="help"]'); await pf.keyboard.press('Enter'); up = await sheetIsOpen(pf);
    c = await cursor();
    const titleQuiet = up && c.id === 'sheetTitle' && !c.ring;
    await pf.keyboard.press('Tab');
    const onDone = (await cursor()).id === 'sheetClose';
    if (onDone) { await pf.keyboard.press('Enter'); await pf.waitForTimeout(300); }   /* Enter on anything else would press it */
    c = await cursor();
    check('a parent on a keyboard: Enter on the ? puts the cursor on the title with no ring, Tab reaches Done, and Enter there brings it back to the ?, ringed',
      titleQuiet && onDone && c.act === 'help' && c.ring, {titleQuiet, onDone, c});
    await clear();
    await pf.click('[data-act="tab"][data-tab="setup"]'); await pf.waitForTimeout(250);
    await pf.focus('[data-act="pane"][data-pane="account"]'); await pf.keyboard.press('Enter'); await pf.waitForTimeout(250);
    c = await cursor();
    check('and a page opened by Enter gives its own title the cursor, with no ring either', c.id === 'paneTitle' && !c.ring, c);
    if (await pf.$('[data-act="pane-done"]')) { await pf.click('[data-act="pane-done"]'); await pf.waitForTimeout(250); }
    /* One key held down repeats. On Done it would close the sheet and press whatever the cursor went
       back to, which opens the sheet again: one press is one tap. */
    await clear(); await pf.click('[data-act="tab"][data-tab="week"]'); await pf.waitForTimeout(250);
    await pf.focus('[data-act="help"]'); await pf.keyboard.press('Enter'); up = await sheetIsOpen(pf);
    await pf.focus('#sheetClose'); await pf.keyboard.down('Enter'); await pf.waitForTimeout(150);
    await pf.keyboard.down('Enter'); await pf.waitForTimeout(150); await pf.keyboard.up('Enter'); await pf.waitForTimeout(250);
    c = await cursor();
    check('a held Enter on Done closes the sheet once, and the repeat does not open it again', up && !(await pf.$('.sheet.open')) && c.act === 'help', c);
    await clear();
    await pf.click('[data-act="kidsheet"]'); up = await sheetIsOpen(pf);
    const adding = up && await tapIn('[data-act="add-kid"]');
    const fieldTook = adding && await until(pf, () => document.activeElement && document.activeElement.id === 'nkName', null, 3000);
    check('a sheet with a field of its own still puts the cursor in the field', fieldTook, await cursor());
    up = await sheetDone(pf); await pf.waitForTimeout(300); c = await cursor();
    check('and one sheet opened from another goes back to what opened the first of the two', adding && up && c.act === 'kidsheet' && !c.inSheet, c);
    /* the field waits for the sheet to slide in; a sheet put away before then keeps where the cursor went back to */
    await clear(); await pf.click('[data-act="kidsheet"]'); up = await sheetIsOpen(pf);
    const quick = up && await tapIn('[data-act="add-kid"]');
    /* the field must not have the cursor yet when Done is pressed, or this would test nothing */
    const early = quick && await pf.evaluate(() => { const was = (document.activeElement || {}).id; document.getElementById('sheetClose').click(); return was !== 'nkName'; });
    await pf.waitForTimeout(450); c = await cursor();
    check('a sheet put away before its field has taken the cursor leaves the cursor where it went back to', early && !(await pf.$('.sheet.open')) && c.act === 'kidsheet' && !c.inSheet, {c, early});
    /* Packed puts focus back on its button after the redraw, and a focus() left to scroll drags a
       half-hidden button into view: the page jumped under the thumb, which is the one thing a tick
       must never do. A screen short enough that Pack scrolls with one lunchbox, the button left
       straddling the top edge, and a click that does no scrolling of its own. */
    await clear(); await pf.setViewportSize({width:375, height:220});
    await pf.click('[data-act="tab"][data-tab="pack"]'); await pf.waitForTimeout(250);
    const jump = await pf.evaluate(async () => {
      const b = document.querySelector('[data-act="pack-all"]'); if (!b) return null;
      const r = b.getBoundingClientRect();
      window.scrollTo(0, Math.round(r.top + window.scrollY + r.height / 2));
      await new Promise(f => setTimeout(f, 100));
      const top = b.getBoundingClientRect().top, y0 = window.scrollY;
      b.click();
      await new Promise(f => setTimeout(f, 250));
      const a = document.activeElement;
      return {top, y0, y1: window.scrollY, act: a && a.getAttribute('data-act'), pressed: a && a.getAttribute('aria-pressed')};
    });
    check('Packed leaves the page where it was, with the cursor back on the button', !!jump && jump.top < 0 && jump.top > -44 && jump.y1 === jump.y0 && jump.act === 'pack-all' && jump.pressed === 'true', jump);
    /* the cook sheet does the same to its own controls: redrawn with its place kept, then the cursor
       put back on what was pressed. With that half off the top of the sheet, the sheet moved. */
    await clear(); await pf.setViewportSize({width:375, height:400});
    await pf.click('[data-act="tab"][data-tab="recipes"]'); await pf.waitForTimeout(250);
    await pf.click('#view [data-act="cook-recipe"] >> nth=0', {timeout: 5000}).catch(() => {}); up = await sheetIsOpen(pf);
    const cookJump = up && await pf.evaluate(async () => {
      const b = document.getElementById('sheetBody'), e = b.querySelector('[data-act="cook-makes"][data-v="1"]'); if (!e) return null;
      b.scrollTop = Math.round(e.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop + e.getBoundingClientRect().height / 2);
      await new Promise(f => setTimeout(f, 100));
      const top = e.getBoundingClientRect().top - b.getBoundingClientRect().top, y0 = b.scrollTop;
      e.click();
      await new Promise(f => setTimeout(f, 250));
      const a = document.activeElement;
      return {top, y0, y1: b.scrollTop, act: a && a.getAttribute('data-act'), v: a && a.getAttribute('data-v')};
    });
    check('a cook control leaves the sheet where it was when it takes the cursor back', !!cookJump && cookJump.top < 0 && cookJump.top > -44 && cookJump.y1 === cookJump.y0 && cookJump.act === 'cook-makes' && cookJump.v === '1', cookJump);
    await sheetDone(pf); await pf.waitForTimeout(300);
    /* Add lunchbox takes the header's lunchbox button away (two boxes get the folder tabs), so there
       is nothing to go back to. The first heading in the view takes the cursor, rather than nothing at all. */
    await clear(); await pf.setViewportSize({width:375, height:812});
    await pf.click('[data-act="tab"][data-tab="week"]'); await pf.waitForTimeout(250);
    await pf.click('[data-act="kidsheet"]'); up = await sheetIsOpen(pf);
    const adding2 = up && await tapIn('[data-act="add-kid"]');
    const named = adding2 && await until(pf, () => document.activeElement && document.activeElement.id === 'nkName', null, 3000);
    if (named) { await pf.fill('#nkName', 'Wren'); await tapIn('[data-act="save-kid"]'); await pf.waitForTimeout(400); }
    c = await cursor();
    check('when what opened a sheet has gone with what the sheet changed, the cursor lands on the first heading in the view, not nowhere',
      named && !(await pf.$('.sheet.open')) && c.first && !c.inSheet && !c.ring, c);
    await cf.close();
  }

  /* ---------------------------------------------------------- kid's pick */
  check('nobody is offered the kid\'s pick until the lunchbox says the kid has a say', (await page.$$eval('[data-act="kid-start"]', a => a.length)) === 0);
  await openGear(page); await page.waitForTimeout(250);
  check('the lunchbox settings open from the gear beside the name, with the rules and the kid\'s say on them', /School rules/.test(await page.textContent('#view')) && (await page.$$eval('[data-act="kidpick-on"]', a => a.length)) === 1 && (await page.$$eval('[data-act="allergen"]', a => a.length)) >= 5);
  await page.click('[data-act="kidpick-on"]'); await page.waitForTimeout(250);
  await page.click('[data-act="box-done"]'); await page.waitForTimeout(250);
  check('Done returns to the tab underneath', (await page.$$eval('[data-act="kid-start"]', a => a.length)) === 1 && !/School rules/.test(await page.textContent('#view')));
  /* today's box is packed (ticked above), so it is not on offer: what was packed stays as it was */
  const weekBefore = await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; return k.week.days.map(d => ({d: d.d, slots: Object.assign({}, d.slots), touched: Object.keys(k.packed[d.d] || {}).length > 0})); });
  const offered = weekBefore.filter(d => !d.touched);
  /* "each part": the main first, this day's against a later day's; the kid's pick trades the two */
  await page.click('[data-act="kid-start"]'); await page.waitForTimeout(250);
  const targetDate = offered[0].d;
  const partOpts = await page.$$eval('.kidmode .pick', a => a.map(b => ({d: b.getAttribute('data-d'), id: b.getAttribute('data-id')})));
  check("kid's pick takes over the screen with two pictures: tomorrow's main and a later day's, never one from a box with anything in the bag", partOpts.length === 2 && partOpts[0].d === targetDate && offered.some(o => o.d === partOpts[1].d) && partOpts[1].d !== targetDate && weekBefore[0].touched, {partOpts, offered});
  const firstMainLabel = await page.textContent('.kidmode h1');
  check("it asks by name, in a child's words, the main first", /^Nia, pick your lunch/i.test(firstMainLabel.trim()), firstMainLabel);
  check('the exit is worded for the parent', /give the phone back/i.test(await page.textContent('[data-act="kid-exit"]')));
  const chosenDate = partOpts[1].d, chosenMain = partOpts[1].id, targetMain = partOpts[0].id;
  await page.click('.kidmode .pick >> nth=1'); await page.waitForTimeout(200);
  let steps = 1; while (steps < 8 && await page.$('.kidmode .pick')) { await page.click('.kidmode .pick >> nth=0'); await page.waitForTimeout(150); steps++; }
  check('the taps end on the finished box', (await page.$$eval('.kiddone .tin .cmp', a => a.length)) === 4, steps);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  const afterPick = await page.evaluate((td) => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const k = d.kids[0], day = k.week.days.find(x => x.d === td);
    return {d: day.d, main: day.slots.main, locked: Object.values(day.lock).every(Boolean), days: k.week.days.map(x => ({d: x.d, main: x.slots.main, marks: Object.keys(x.kidPick || {}).length})),
      all: k.week.days.flatMap(x => Object.values(x.slots)).filter(Boolean).sort().join(),
      picked: Object.keys(day.kidPick || {}).length,
      by: !!(day.kidPick && day.kidPick.main && d.members.some(m => m.id === day.kidPick.main.by) && day.kidPick.main.picker === 'kid')};
  }, targetDate);
  check("the main the kid chose is tomorrow's now", afterPick.main === chosenMain, afterPick);
  check("and tomorrow's old main moved to that day, so nothing new is bought", afterPick.days.find(x => x.d === chosenDate).main === targetMain && afterPick.all === weekBefore.flatMap(d => Object.values(d.slots)).filter(Boolean).sort().join(), afterPick);
  check('kid-picked compartments are locked and attributed, on that day alone', afterPick.locked && afterPick.picked === 4 && afterPick.by && afterPick.days.filter(x => x.marks).length === 1, afterPick);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
  check('the week says who picked, once, on that day', (await page.$$eval('.chip.picked', a => a.map(c => c.textContent))).join() === 'Nia picked');
  await page.click('[data-act="shuffle-day"][data-day="'+targetDate+'"]'); await page.waitForTimeout(300); await goShuffle(page);
  const stillMain = await page.evaluate((td) => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.find(x => x.d === td).slots.main, targetDate);
  check("a shuffle does not overwrite what the kid chose", stillMain === chosenMain);
  check('every compartment that can change shows the swap cue, a locked one the lock', await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.daycard:not(.past) .cmp')];
    return cells.length > 0 && cells.every(c => (c.querySelector('.swap') ? 1 : 0) + (c.querySelector('.lock') ? 1 : 0) === 1) && [...document.querySelectorAll('.daycard.past')].every(d => !d.querySelector('.cmp') && !!d.querySelector('[data-act="gone-open"]'));
  }));
  check('a compartment on Week is a button that says its marks out loud', await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.daycard:not(.past) .cmp[data-act="slot"]')];
    return cells.length > 0 && cells.every(c => { const l = c.getAttribute('aria-label') || '', marks = [...c.querySelectorAll('.mk[role="img"]')].map(m => m.getAttribute('aria-label'));
      return /\. Change it$/.test(l) && marks.every(m => l.includes(m)); });
  }));
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(200);

  /* ----------------------------------------------------------- shopping */
  await page.click('[data-act="tab"][data-tab="shop"]');
  await page.waitForTimeout(200);
  const rows = await page.$$eval('.list .item', a => a.length);
  check('the week produces a shopping list', rows > 0, rows);
  {
    /* a dish goes on the list as what you buy for it: the pinwheel is deli turkey, cheese slices and tortillas */
    const dishes = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.flatMap(k => k.week ? k.week.days.map(d => k.foods.find(f => f.id === d.slots.main)).filter(Boolean) : []));
    const withParts = dishes.filter(f => f.buy && f.buy.length);
    const names = await page.$$eval('.list .item .nm', a => a.map(x => x.textContent));
    check('a dish with parts lists the parts, never the dish', withParts.length > 0 && withParts.every(f => !names.includes(f.n) && f.buy.every(b => names.includes(b))), {withParts: withParts.map(f => f.n), names});
    const shared = await page.$$eval('.list .item', a => a.filter(x => /\d+ boxes/.test(x.querySelector('.qty').textContent)).length);
    check('a part two dishes share is one line with a count', dishes.length < 2 || shared > 0 || new Set(withParts.flatMap(f => f.buy)).size === withParts.flatMap(f => f.buy).length, shared);
    const fromBank = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted')); const f = d.kids[0].foods.find(x => x.buy && x.buy.length); delete f.buy;   /* a food seeded before lists existed */
      localStorage.setItem('lunchsorted', JSON.stringify(d)); return f.n;
    });
    await page.reload(); await page.waitForTimeout(600); await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
    check('a food seeded before parts existed takes the bank\'s parts', fromBank && await page.evaluate((n) => { const f = JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.find(x => x.n === n); return !!(f.buy && f.buy.length); }, fromBank), fromBank);
    /* an update says what changed, once, and only to a phone that already had the app —
       and only when this build has something to say */
    await page.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
    await page.reload(); await page.waitForTimeout(600);
    if (!NOTE_TEXT) {
      check('a build with no note interrupts nobody', !/New: /.test(await page.textContent('#view')) && (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 0);
      check('and carries no walk-through to open', STEP_COUNT === 0, STEP_COUNT);
    } else {
      check('a phone that had the app is told what changed on the first open after an update',
        /New: /.test(await page.textContent('#view')) && (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 1);
      /* a note carried forward from an earlier build is for the phones that missed it: the ones that
         already read it there are not told twice, and there is no OK on a news banner to make it go away */
      /* seenAs is a list: a note carried across two shipped builds leaves alone the phones that read it on either */
      const seenAs = [...((APP_SRC.match(/var WHATS_NEW = \{build:'[^']*', seenAs:\[([^\]]*)\]/) || [,''])[1]).matchAll(/'([^']*)'/g)].map(m => m[1]);
      /* npm run csp reads the field the same way; one it could not read here would skip the check below unseen */
      if (/\bseenAs\s*:/.test((APP_SRC.match(/var WHATS_NEW = \{[\s\S]*?\};\n/) || [''])[0]))
        check('the note\'s seenAs reads as a list of builds, straight after its build', seenAs.length > 0, seenAs);
      if (seenAs.length) {
        const leftAlone = [];
        for (const b of seenAs) {
          await page.evaluate(b => localStorage.setItem('lunchsorted-seen', b), b);
          await page.reload(); await page.waitForTimeout(600);
          if (!/New: /.test(await page.textContent('#view')) && (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 0) leftAlone.push(b);
        }
        check('and a phone that already read it on any build it was carried from is left alone', leftAlone.length === seenAs.length, { seenAs, leftAlone });
        await page.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
        await page.reload(); await page.waitForTimeout(600);
      }
      await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
      check('the note follows to the next tab, once, and is green not amber', (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 1 && !!(await page.$('.banner.good')));
      await page.click('[data-act="whats-new"]'); await page.waitForTimeout(350);
      check('and "Show me" opens a walk-through, one step per thing that changed', (await page.$$eval('#sheetBody .switch', a => a.length)) === STEP_COUNT);
      /* the backdrop is the whole screen while the sheet slides in: a thumb that lands there
         has read nothing, so it puts the sheet away and leaves the note where it was */
      await backdropTap(page); await page.waitForTimeout(350);   /* the strip above the sheet, where a hurried thumb lands */
      check('a tap beside the sheet closes it without spending the note',
        !(await page.$('.sheet.open')) && (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 1
        && await page.evaluate(() => localStorage.getItem('lunchsorted-seen') === 'lunchsorted-v0'));
      await page.click('[data-act="whats-new"]'); await page.waitForTimeout(350);
      await sheetDone(page); await page.waitForTimeout(300);
      check('Done at the top of the walk-through dismisses the note',
        !/New: /.test(await page.textContent('#view')) && await page.evaluate((b) => localStorage.getItem('lunchsorted-seen') === b, APP_BUILD));
      await page.reload(); await page.waitForTimeout(600);
      check('and it stays gone after Done, rather than coming back on the next open', !/New: /.test(await page.textContent('#view')));
      await page.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
      await page.reload(); await page.waitForTimeout(600);
      check('a phone that has not seen this build gets the note back', (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 1);
      await page.click('[data-act="whats-new"]'); await page.waitForTimeout(350);
      await page.click('[data-act="whats-new-ok"]'); await page.waitForTimeout(300);
      check('Got it dismisses the note for good', !/New: /.test(await page.textContent('#view')) && await page.evaluate((b) => localStorage.getItem('lunchsorted-seen') === b, APP_BUILD));
      await page.reload(); await page.waitForTimeout(600);
      check('and once dismissed it stays gone', !/New: /.test(await page.textContent('#view')) && await page.evaluate((b) => localStorage.getItem('lunchsorted-seen') === b, APP_BUILD));
    }
    /* An OK on any other message is that message's alone. It used to mark the build seen too, so a
       note that message had pushed off the banner was gone for good: the beta switching on, or an
       invite that had lapsed, on the first open after an update, and the parent never heard what
       changed. A lapsed invite needs nobody signed in: any code the server does not hold is one,
       and this one is shaped like a real code (43 base64url characters), so a check on the shape
       still lets it by. The OK waits for the boot's last redraw, billing's, which would take the
       cursor away again. */
    const noSuchInvite = 'no-such-invite-'.padEnd(43, 'x');
    {
      await page.evaluate(() => { localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'); localStorage.removeItem('lunchsorted-billing'); });
      await page.goto(BASE + '/app/?join=' + noSuchInvite); await page.waitForLoadState('load');
      const lapsed = await until(page, () => /expired or was already used/.test(document.getElementById('view').textContent)
        && document.querySelectorAll('.banner [data-act="notice-dismiss"]').length === 1 && !!localStorage.getItem('lunchsorted-billing'));
      check('a lapsed invite, opened on the first open after an update, takes the banner with an OK', lapsed);
      if (lapsed) { await page.click('.banner [data-act="notice-dismiss"]'); await page.waitForTimeout(250); }
      check('and its OK clears that message alone, leaving the build unseen',
        lapsed && !/expired or was already used/.test(await page.textContent('#view')) && await page.evaluate(() => localStorage.getItem('lunchsorted-seen') === 'lunchsorted-v0'));
      if (!NOTE_TEXT) {
        check('with no note to give back, nothing takes its place', lapsed && !/New: /.test(await page.textContent('#view')) && (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 0);
      } else {
        /* noring is focusQuietly()'s mark, and what keeps the ring off under a thumb; the button's
           description is the note, so a screen reader landing on Show me hears what it would show */
        const back = lapsed && await page.evaluate(() => { const sm = document.querySelectorAll('[data-act="whats-new"]'), d = sm[0] && document.getElementById(sm[0].getAttribute('aria-describedby') || '');
          return sm.length === 1 && document.activeElement === sm[0] && sm[0].classList.contains('noring') && !!d && d.parentElement === sm[0].parentElement && d.textContent.trim().length > 0; });
        check('the note it held back comes straight back, the cursor on a Show me that a screen reader hears with the note, and no ring round it', back);
        if (back) { await page.click('[data-act="whats-new"]'); await sheetDone(page); await page.waitForTimeout(300); }
        check('and reading the walk-through is still what marks the build seen',
          back && !/New: /.test(await page.textContent('#view')) && await page.evaluate(b => localStorage.getItem('lunchsorted-seen') === b, APP_BUILD));
      }
    }
    /* Whether an open owes the note is settled at boot, and a phone that starts over owes nothing: the
       note leaves the banner, an OK does not bring it back, and a household set up afterwards is
       marked as having seen it, as a phone new to the app is at boot. Two ways to start over, on a
       phone of its own: Erase everything, and a save that breaks the first draw. The break is the
       test's own: the first draw into #view throws, once. */
    {
      const cx = await phone(); const px = await cx.newPage(); px.on('pageerror', e => errors.push(String(e.message)));
      await cx.addInitScript(() => {
        if (!sessionStorage.getItem('smoke-break-draw')) return;
        sessionStorage.removeItem('smoke-break-draw');
        const own = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        let armed = true;
        Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get(){ return own.get.call(this); },
          set(v){ if (armed && this.id === 'view') { armed = false; throw new Error('smoke: a draw that breaks'); } own.set.call(this, v); } });
      });
      const setUp = async () => {
        if (!(await until(px, () => !!document.querySelector('#obName'), null, 5000))) return false;
        await px.fill('#obName', 'Nia'); await px.click('[data-act="ob-go"]');
        if (!(await until(px, () => !!document.querySelector('[data-act="ob-later"]'), null, 5000))) return false;
        await px.click('[data-act="ob-later"]'); return until(px, () => !document.querySelector('.ob'), null, 5000);
      };
      const tapOK = async () => { const up = await until(px, () => document.querySelectorAll('.banner [data-act="notice-dismiss"]').length === 1, null, 5000);
        if (up) { await px.click('.banner [data-act="notice-dismiss"]'); await px.waitForTimeout(250); } return up; };
      const noNote = async () => (await px.$$eval('[data-act="whats-new"]', a => a.length)) === 0;
      const seenIs = b => px.evaluate(b => localStorage.getItem('lunchsorted-seen') === b, b);
      const erase = async () => {
        await openPane(px, 'account');
        if (!(await until(px, () => !!document.querySelector('[data-act="clear-all"]'), null, 5000))) return false;
        await px.click('[data-act="clear-all"]'); await px.waitForTimeout(150); await px.click('[data-act="clear-all"]'); await px.waitForTimeout(300);
        return px.evaluate(() => !!document.querySelector('.ob'));
      };
      await px.goto(BASE + '/app/'); const first = await setUp();
      /* an open that owes the note, with the note itself on the banner: Erase everything, then set up again */
      await px.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
      await px.reload(); await px.waitForTimeout(600);
      const wiped = first && (NOTE_TEXT ? (await px.$$eval('[data-act="whats-new"]', a => a.length)) === 1 : true) && await erase();
      check('Erase everything with the note up takes the note off too: the questions screen shows none', wiped && await noNote());
      const again = wiped && await setUp();
      await px.reload(); await px.waitForTimeout(600);
      check('and the household set up afterwards is marked as having seen it, so the next open shows none either', again && await noNote() && await seenIs(APP_BUILD));
      /* an open that owes the note, a lapsed invite's message over it, then Erase everything and set up again */
      await px.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
      await px.goto(BASE + '/app/?join=' + noSuchInvite); await px.waitForLoadState('load');
      const held = again && await until(px, () => /expired or was already used/.test(document.getElementById('view').textContent));
      const erased = held && await erase() && await px.evaluate(() => /expired or was already used/.test(document.getElementById('view').textContent));
      const okErased = erased && await setUp() && await tapOK();
      check('a phone erased and set up again is owed no note: the OK on a message from before brings none over the new household', okErased && await noNote());
      /* a save that breaks the first draw */
      await px.evaluate(() => { localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'); sessionStorage.setItem('smoke-break-draw', '1'); });
      await px.reload(); await px.waitForTimeout(600);
      const fresh = await px.evaluate(() => /could not be shown/.test(document.getElementById('view').textContent) && !!document.querySelector('.ob')
        && Object.keys(localStorage).some(k => k.startsWith('lunchsorted-backup-')));
      check('a save that breaks the first draw becomes a fresh start that keeps a copy and says so', fresh);
      /* had no copy been kept, the old household would open again next time, and it is still owed the note */
      check('and the break itself marks nothing seen', fresh && await seenIs('lunchsorted-v0'));
      const setFresh = fresh && await setUp();
      check('setting the fresh household up is what marks the build seen', setFresh && await seenIs(APP_BUILD));
      const okFresh = setFresh && await tapOK();
      check('so its OK then brings no note over the new week', okFresh && await noNote());
      await cx.close();
    }
    /* The beta link opened signed out, on the first open after an update. On Account, where the link
       lands and the sign-in is, the beta's own banner outranks the note; elsewhere the note keeps its
       place, so a tester who never signs in still hears about the avoid list. */
    {
      await page.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
      await page.goto(BASE + '/app/?beta=BETA-TEST-1234'); await page.waitForLoadState('load');
      const onAccount = await until(page, () => /Sign in and the beta switches on/.test(document.getElementById('view').textContent));
      if (NOTE_TEXT) {
        const noteHeld = onAccount && (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 0;
        await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
        const onPack = (await page.$$eval('[data-act="whats-new"]', a => a.length)) === 1 && !/Sign in and the beta switches on/.test(await page.textContent('#view'));
        check('signed out, the beta link\'s own banner outranks the note on Account, where the link lands', onAccount && noteHeld);
        check('and on Pack the note keeps its place, so a tester who never signs in still hears what changed', onAccount && onPack);
      } else check('signed out, with no note owed, the beta link\'s banner is on Account as ever', onAccount);
      /* this phone signs in further down, where a code still waiting would claim the beta */
      await page.evaluate(b => { localStorage.removeItem('lunchsorted-beta'); localStorage.setItem('lunchsorted-seen', b); }, APP_BUILD);
      await page.reload(); await page.waitForTimeout(600);
    }
    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
    check('the list groups every line under a real aisle', (await page.$$eval('.sect-head h3', a => a.map(x => x.textContent))).every(t => ['Produce','Deli','Bakery','Dairy','Drinks','Pantry','Snacks','Frozen','Your own'].includes(t)));
    /* the tick states: crossed off is ruled through, already-in-hand is not, and a
       row that toggles says so out loud */
    const shopRow = await page.$$eval('[data-act="have"]', a => a.slice(0, 1).map(b => ({
      pressed: b.getAttribute('aria-pressed'), done: b.closest('.item').classList.contains('done'), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }))[0]);
    check('a shopping row that is not ticked says so, and its check is a 54px-wide, 56px-tall target', shopRow && shopRow.pressed === 'false' && !shopRow.done && shopRow.w >= 54 && shopRow.h >= 56, shopRow);
    await page.click('[data-act="have"] >> nth=0'); await page.waitForTimeout(300);
    const shopOn = await page.$$eval('[data-act="have"]', a => a.slice(0, 1).map(b => ({
      pressed: b.getAttribute('aria-pressed'), done: b.closest('.item').classList.contains('done'),
      line: getComputedStyle(b.closest('.item').querySelector('.nm')).textDecorationLine }))[0]);
    check('ticking it flips aria-pressed and rules the name through', shopOn
      && shopOn.pressed === 'true' && shopOn.done && shopOn.line.includes('line-through'), shopOn);
    await page.click('[data-act="have"] >> nth=0'); await page.waitForTimeout(300);
    check('and unticking it puts both back', await page.$eval('[data-act="have"]', b =>
      b.getAttribute('aria-pressed') === 'false' && !b.closest('.item').classList.contains('done')));
    /* one line a thing: a single-ingredient food has nothing under it; a dish of several things names itself under each, and says how many boxes */
    const lines = await page.$$eval('.list .item.shopline', a => a.map(e => ({ nm: e.querySelector('.nm').textContent, meta: (e.querySelector('.meta') || {}).textContent || '', qty: e.querySelector('.qty').textContent })));
    check('a thing that is a food by itself is one line with nothing under it, and a dish of several things is named under each of them',
      lines.length > 0 && lines.every(l => !l.meta.split(' · ').includes(l.nm)) && lines.every(l => l.qty === '' || /^\d+ boxes$/.test(l.qty)) && !lines.some(l => /×|x\d/.test(l.qty)), lines.slice(0, 6));
    /* the line opens a sheet: which boxes it is for, each a way into that compartment */
    const many = await page.$('.list .item.shopline .qty:not(:empty)');
    const firstLine = many ? await many.evaluateHandle(e => e.closest('.item').querySelector('[data-act="line-open"]')) : await page.$('.list .item.shopline [data-act="line-open"]');
    const lineName = await firstLine.evaluate(e => e.querySelector('.nm').textContent);
    await firstLine.click(); await page.waitForTimeout(350);
    const lineSheet = await page.evaluate(() => ({ title: document.querySelector('#sheetTitle').textContent, head: (document.querySelector('#sheetBody .hint') || {}).textContent || '',
      rows: [...document.querySelectorAll('#sheetBody .item[data-act="slot"]')].map(r => r.querySelector('.nm').textContent), home: !!document.querySelector('#sheetBody [data-act="have"]') }));
    check('tapping a line opens a sheet named for it: how many boxes, that changing a box changes the list, a row per box, and Already at home at the foot',
      lineSheet.title === lineName && /^In \d+ box(es)? this week\. Changing a box changes the list\.$/.test(lineSheet.head) && lineSheet.rows.length >= 1 && lineSheet.rows.every(r => /^[A-Z][a-z]+day · /.test(r)) && lineSheet.home, lineSheet);
    await page.click('#sheetBody [data-act="have"]'); await page.waitForTimeout(350);
    check('Already at home in the sheet closes it and ticks the line behind', !(await page.$('.sheet.open')) && await page.evaluate(n => { const row = [...document.querySelectorAll('#view .item.shopline')].find(e => e.querySelector('.nm').textContent === n); return !!row && row.classList.contains('done') && document.activeElement && document.activeElement.getAttribute('data-act') === 'have'; }, lineName));
    await page.click('#view .item.done [data-act="have"] >> nth=0'); await page.waitForTimeout(300);
    await page.evaluate(n => { [...document.querySelectorAll('#view .item.shopline [data-act="line-open"]')].find(e => e.querySelector('.nm').textContent === n).click(); }, lineName); await page.waitForTimeout(350);   /* the row was redrawn: find it again by name */
    await page.click('#sheetBody .item[data-act="slot"] >> nth=0'); await page.waitForTimeout(350);
    check('and a row goes to that compartment\'s sheet', /Main|Side|Fruit|Sweet|Vegetable|Snack|Drink/.test(await page.textContent('#sheetTitle')) && !!(await page.$('#sheetBody [data-act="sheet-shuffle"]')), await page.textContent('#sheetTitle'));
    await backdropTap(page); await page.waitForTimeout(300);
    check('the empty box is drawn with a border that clears 3:1 of the row it sits on, in both themes',
      await page.evaluate(() => {
        const lin = c => (c /= 255) <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
        const L = s => { const [r,g,b] = s.match(/\d+/g).map(Number);
          return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b); };
        const box = document.querySelector('[data-act="have"] .box');
        const root = document.documentElement, was = root.getAttribute('data-theme');
        const ratio = () => {
          /* .item paints nothing of its own, so walk up for the colour actually behind the box */
          let bg = 'rgba(0, 0, 0, 0)';
          for (let e = box; e; e = e.parentElement) {
            const c = getComputedStyle(e).backgroundColor;
            if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
          }
          const l1 = L(getComputedStyle(box).borderTopColor), l2 = L(bg);
          const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
          return (hi + 0.05) / (lo + 0.05);
        };
        const out = {};
        for (const t of ['light', 'dark']) { root.setAttribute('data-theme', t); out[t] = ratio(); }
        if (was === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', was);
        return out.light >= 3 && out.dark >= 3;
      }));
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.click('[data-act="copy-list"]'); await page.waitForTimeout(250);
    const txt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('Copy puts the list on the clipboard grouped by aisle, one line a thing', /^Lunch shopping list\n\n[A-Z][a-z]+\n- /.test(txt) && txt.split('\n').filter(l => l.startsWith('- ')).length === (await page.$$eval('#view .list .item:not(.done)', a => a.length)), txt.slice(0, 80));
    await page.click('[data-act="help"]'); await page.waitForTimeout(300);
    check('the ? at the top opens help: questions, a way to write in, and the page on the site', (await page.$$eval('#sheetBody details', a => a.length)) >= 4 && !!(await page.$('#sheetBody a[data-feedback][href^="mailto:"]')) && !!(await page.$('#sheetBody a[href="/help.html"]')));
    await page.evaluate(() => document.querySelector('#sheetBody details summary').click()); await page.waitForTimeout(150);
    check('and an answer opens on a tap', await page.$eval('#sheetBody details', d => d.open));
    check('the ? still fits beside a long name and two lunchboxes', await page.evaluate(() => { const b = document.querySelector('[data-act="help"]').getBoundingClientRect(); return b.right <= window.innerWidth - 8 && document.documentElement.scrollWidth <= window.innerWidth; }));
    await sheetDone(page); await page.waitForTimeout(250);
    check('the share button shows only where the phone has a share sheet', (await page.$$eval('[data-act="send-list"]', a => a.length)) === (await page.evaluate(() => navigator.share ? 1 : 0)));
    /* Send carries the very text Copy does: stub the phone's share sheet and compare */
    await page.evaluate(() => { window.__shared = null; Object.defineProperty(navigator, 'share', { value: d => { window.__shared = d; return Promise.resolve(); }, configurable: true }); });
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150); await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
    await page.click('[data-act="send-list"]'); await page.waitForTimeout(250);
    const sent = await page.evaluate(() => window.__shared);
    check('Send hands the share sheet the same text Copy puts on the clipboard, under the same title', !!sent && sent.text === txt && sent.title === 'Lunch shopping list', sent && sent.text.slice(0, 80));
    check('and that text says how many boxes a thing is for, and names a dish only where it is more than one thing', txt.split('\n').filter(l => l.startsWith('- ')).every(l => !/ x\d/.test(l)) && /\(\d+ boxes\)/.test(txt) === (await page.$$eval('.list .item.shopline .qty', a => a.some(q => q.textContent))), txt.split('\n').slice(0, 8));
    await page.evaluate(() => { delete navigator.share; delete window.__shared; });
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150); await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
  }
  const head = await page.textContent('.count');
  await page.click('.list .item [data-act="have"]');
  await page.waitForTimeout(200);
  check('a pantry tick moves an item out of the buy count', head !== await page.textContent('.count'));
  /* the tap a parent makes twenty times in a row: render() throws the button away, so
     focus goes back on the row rather than to the top of the list */
  const tickRow = '.list .item:not(.done) [data-act="have"] >> nth=0';
  const tickedKey = await page.getAttribute(tickRow, 'data-key');
  await page.click(tickRow); await page.waitForTimeout(250);
  check('and focus lands back on the row that was ticked, not at the top of the list',
    await page.evaluate(k => { const a = document.activeElement;
      return !!a && a.getAttribute('data-act') === 'have' && a.getAttribute('data-key') === k; }, tickedKey), tickedKey);
  {
    /* once every box of the week has gone, Shop is next week's list, or the offer to plan it (A11) */
    const savedDoc = await page.evaluate(() => localStorage.getItem('lunchsorted'));
    /* a plan that is simply old (last week's, on a Tuesday) gets the same Plan the week the other tabs offer */
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const back = x => { const p = x.split('-').map(Number); const t = new Date(p[0], p[1] - 1, p[2] - 7); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); };
      d.kids.forEach(k => { if (!k.week) return; k.week.start = back(k.week.start); k.week.days.forEach(x => { x.d = back(x.d); }); k.next = null; });
      localStorage.setItem('lunchsorted', JSON.stringify(d)); });
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
    check('a plan that is simply from an earlier week gets Plan the week on Shop, as on Pack and Week', !/boxes are done/.test(await page.textContent('#view')) && !!(await page.$('[data-act="plan-all"]')) && (await page.$$eval('.list .item.shopline', a => a.length)) === 0);
    await page.evaluate(s => localStorage.setItem('lunchsorted', s), savedDoc);
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    /* the week's last box home (pack days Monday and Tuesday, Tuesday four o'clock): the coming plan lands next Monday */
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0]; k.settings.days = [1, 2]; k.week.days = k.week.days.filter(x => x.dow === 1 || x.dow === 2); k.next = null; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    await page.evaluate(() => window.__pinHour(16));
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200); await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
    check('once every box of the week has gone, Shop says so and offers to plan next week, with no stale lines', /boxes are done/.test(await page.textContent('#view')) && !!(await page.$('[data-act="plan-next"]')) && (await page.$$eval('.list .item.shopline', a => a.length)) === 0, (await page.textContent('#view')).slice(0, 160));
    await page.click('[data-act="plan-next"]'); await page.waitForTimeout(600);
    const nextPlanned = await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const t = new Date(); t.setHours(0,0,0,0); const ws = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) + 7); const iso = ws.getFullYear()+'-'+String(ws.getMonth()+1).padStart(2,'0')+'-'+String(ws.getDate()).padStart(2,'0'); return { next: !!k.next && k.next.start === iso, days: k.next ? k.next.days.length : 0 }; });
    check('and Plan next week from Shop plans the week after, shows its list under its own date, and can be taken back', nextPlanned.next && nextPlanned.days === 2 && (await page.$$eval('.list .item.shopline [data-when="next"]', a => a.length)) > 0 && /Next week.s list, for the week of/.test(await page.textContent('#view')) && !!(await page.$('#toast [data-act="undo"]')), [nextPlanned, await page.textContent('#toast')]);
    await page.click('[data-act="copy-list"]'); await page.waitForTimeout(250);
    const overTxt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('and the text sent then is next week\'s list under its own heading', /^Lunch shopping list\n\nNEXT WEEK\n/.test(overTxt), overTxt.slice(0, 60));
    await page.evaluate(() => window.__pinHour(9));
    /* on the weekend the plan that has gone by is behind us: Week shows the coming week, empty, and the arrow the one after */
    await page.evaluate(s => localStorage.setItem('lunchsorted', s), savedDoc);
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const back = x => { const p = x.split('-').map(Number); const t = new Date(p[0], p[1] - 1, p[2] - 7); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); };
      d.kids.forEach(k => { if (!k.week) return; k.week.start = back(k.week.start); k.week.days.forEach(x => { x.d = back(x.d); }); k.next = null; });
      localStorage.setItem('lunchsorted', JSON.stringify(d)); });
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(300);
    const weekNow = await page.evaluate(() => ({ title: document.querySelector('.view-title').textContent, empty: !!document.querySelector('.empty'), gone: document.querySelectorAll('.daycard.past').length, banner: [...document.querySelectorAll('.banner')].map(b => b.textContent).join(' | ') }));
    const comingMonday = await page.evaluate(() => { const t = new Date(); t.setHours(0,0,0,0); const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; let ws = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
      const ahead = k.settings.days.filter(dw => new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + ((dw + 6) % 7)) >= t).length; if (ahead < 2) ws = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7);   /* the week a fresh plan anchors to */
      return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ws.getMonth()] + ' ' + ws.getDate(); });
    check('with a plan whose every day has gone by, Week is the coming week, unplanned, with no day from the old plan, no "earlier week" banner, one plan button under the title and no arrow to a week after', weekNow.title === 'Week of ' + comingMonday && weekNow.empty && weekNow.gone === 0 && !/earlier week/.test(weekNow.banner) && (await page.$$eval('#view [data-act="plan-kid"]', a => a.length)) === 2 && !(await page.$('[data-act="week-ahead"]')), weekNow);
    await page.evaluate(s => localStorage.setItem('lunchsorted', s), savedDoc);
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    /* a week planned two weeks out on that weekend waits for its turn rather than becoming this week */
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
      const shift = (x, n) => { const p = x.split('-').map(Number); const t = new Date(p[0], p[1] - 1, p[2] + n); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); };
      const nxt = JSON.parse(JSON.stringify(k.week)); nxt.id = 'week_far'; nxt.start = shift(k.week.start, 7); nxt.days.forEach(x => { x.d = shift(x.d, 7); });
      k.week.start = shift(k.week.start, -7); k.week.days.forEach(x => { x.d = shift(x.d, -7); }); k.next = nxt;
      localStorage.setItem('lunchsorted', JSON.stringify(d)); });
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    check('a week planned two Mondays out does not become this week: the old plan goes to the archive and the coming week is open to plan', await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; return !k.week && !!k.next && k.next.id === 'week_far' && k.past.length > 0; }));
    await page.evaluate(s => localStorage.setItem('lunchsorted', s), savedDoc);
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    /* a pack day switched on is drawn into the week; switched off, it leaves the week; the change says so */
    await openPane(page, 'box');
    const dayOff = await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const on = k.settings.days; return [1,2,3,4,5,6,0].find(d => on.indexOf(d) < 0); });
    const daysBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.length);
    await page.click('[data-act="day"][data-d="' + dayOff + '"]'); await page.waitForTimeout(400);
    const afterOn = await page.evaluate(dw => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const day = k.week.days.find(x => x.dow === dw); const t = new Date(); t.setHours(0,0,0,0); const iso = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
      return { n: k.week.days.length, has: !!day, ahead: !day || day.d >= iso, filled: !!day && !!k.foods.find(f => f.id === day.slots.main), sorted: k.week.days.every((x, i, a) => !i || a[i-1].d < x.d) }; }, dayOff);
    check('switching a pack day on draws that day into the week, in its place, and says so', (afterOn.ahead ? afterOn.has && afterOn.filled && afterOn.n === daysBefore + 1 && afterOn.sorted : afterOn.n === daysBefore) && /added to the week|is on from next week/.test(await page.textContent('#toast')) && !!(await page.$('#toast [data-act="undo"]')), [afterOn, await page.textContent('#toast')]);
    await page.click('[data-act="day"][data-d="' + dayOff + '"]'); await page.waitForTimeout(400);
    const afterOff = await page.evaluate(dw => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; return { n: k.week.days.length, has: !!k.week.days.find(x => x.dow === dw), on: k.settings.days.indexOf(dw) > -1 }; }, dayOff);
    check('and switching it off takes it out again', !afterOff.on && afterOff.n === daysBefore && !afterOff.has, [afterOff, await page.textContent('#toast')]);
    await page.click('[data-act="box-done"]'); await page.waitForTimeout(200);
    /* the other phone's older copy still carries the day: it is dropped when the plan is read back, unless it has gone */
    await page.evaluate(dw => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0]; const t = new Date(); t.setHours(0,0,0,0);
      const ws = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)); const day = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + ((dw + 6) % 7));
      const iso = day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');
      k.week.days.push({ d: iso, dow: dw, slots: {}, lock: {}, kidPick: {}, over: {} }); k.week.days.sort((a, b) => a.d < b.d ? -1 : 1); localStorage.setItem('lunchsorted', JSON.stringify(d)); }, dayOff);
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    check('a day the pack days no longer hold is dropped when the plan is read back, so it never comes back from an older copy', await page.evaluate(({ dw, n }) => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; return !k.week.days.some(x => x.dow === dw) && k.week.days.length === n; }, { dw: dayOff, n: daysBefore }));
    check('and every day of the plan keeps its own stamp through the reload', await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.every(d => typeof d.updatedAt === 'string' && d.updatedAt.length > 10)));
    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
  }
  {
    /* No lunch today: a field trip, a sick day. The day comes off Pack and Shop, is never asked about, and Put it back undoes it. */
    const shopBefore = await page.$$eval('#view .item.shopline', a => a.length);
    await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
    const wasPacked = !!(await page.$('[data-act="pack-all"][aria-pressed="true"]'));
    if (!wasPacked) { await page.click('[data-act="pack-all"]'); await page.waitForTimeout(300); }   /* the snow-day call comes after the box was ticked */
    check('Pack offers No lunch today beside the box, packed or not', (await page.$$eval('[data-act="no-lunch"]', a => a.map(b => b.textContent.trim()))).join('|') === 'No lunch today', await page.$$eval('[data-act="no-lunch"]', a => a.map(b => b.textContent.trim())));
    await page.click('[data-act="no-lunch"]'); await page.waitForTimeout(350);
    check('and the day comes off: no tin, one line that says so, Put it back, a toast with Undo, and the ticks come off with it', (await page.$$eval('#view .tin', a => a.length)) === 0 && /No lunch today\. Nothing to pack, nothing on the list\./.test(await page.textContent('#view')) && (await page.$eval('[data-act="no-lunch"]', b => b.textContent.trim())) === 'Put it back' && /No lunch today — nothing to pack, nothing to buy/.test(await page.textContent('#toast')) && !!(await page.$('#toast [data-act="undo"]')) && await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const d = k.week.days.find(x => x.off); const row = k.packed[d.d] || {}; return Object.keys(row).length > 0 && Object.values(row).every(e => e.off === true); }));
    const offRow = await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const d = k.week.days.find(x => x.off); return { d: d.d, at: Object.values(k.packed[d.d]).map(e => e.at).sort().pop() }; });
    await page.click('#toast [data-act="undo"]'); await page.waitForTimeout(350);
    check('Undo puts the day back with its ticks', (await page.$$eval('#view .tin', a => a.length)) === 1 && (await page.getAttribute('[data-act="pack-all"]', 'aria-pressed')) === 'true' && await page.evaluate(() => !JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.some(x => x.off)));
    check('and the ticks come back stamped later than the un-ticks, so the next sync cannot take them off again', await page.evaluate(o => { const row = JSON.parse(localStorage.getItem('lunchsorted')).kids[0].packed[o.d] || {}; const es = Object.values(row); return es.length > 0 && es.every(e => !e.off && e.at > o.at); }, offRow), offRow);
    await page.click('[data-act="pack-all"]'); await page.waitForTimeout(300);   /* un-tick for the rest of the walk */
    await page.click('[data-act="no-lunch"]'); await page.waitForTimeout(350);
    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
    check('the shopping list drops that day\'s foods', (await page.$$eval('#view .item.shopline', a => a.length)) < shopBefore, [shopBefore, await page.$$eval('#view .item.shopline', a => a.length)]);
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(300);
    check('and Week shows the day as one line with no lock, no shuffle and no tin', await page.evaluate(() => { const c = [...document.querySelectorAll('.daycard')].find(d => /Today/.test(d.textContent)); return !!c && !c.querySelector('.tin') && !c.querySelector('[data-act="day-lock"]') && !c.querySelector('[data-act="shuffle-day"]') && /No lunch today/.test(c.textContent) && !!c.querySelector('[data-act="no-lunch"]'); }));
    await page.evaluate(() => window.__pinHour(16));
    await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
    check('at four nothing asks about a day with no lunch, and there is no dot', (await page.$$eval('.review, .card.fold', a => a.length)) === 0 && !(await page.$('nav.tabs .due')));
    await page.evaluate(() => window.__pinHour(9));
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200); await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
    await page.click('[data-act="no-lunch"]'); await page.waitForTimeout(350);
    check('Put it back brings the box back, and says so in the same word', (await page.$$eval('#view .tin', a => a.length)) === 1 && /Today’s lunch is back/.test(await page.textContent('#toast')) && await page.evaluate(() => !JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.some(d => d.off)));
    /* a later day, from Week: Coming up says so, and the kid's pick skips it */
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(300);
    const laterDay = await page.evaluate(() => { const cs = [...document.querySelectorAll('.daycard:not(.past)')]; const c = cs.find(d => !/Today/.test(d.querySelector('.dayhead').textContent)); return c ? c.querySelector('[data-act="no-lunch"]').getAttribute('data-day') : null; });
    check('every day still ahead offers No lunch on Week, and a day that has gone does not', !!laterDay && (await page.$$eval('.daycard.past [data-act="no-lunch"]', a => a.length)) === 0);
    await page.click('[data-act="no-lunch"][data-day="' + laterDay + '"]'); await page.waitForTimeout(350);
    await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
    check('Coming up says no lunch for that day', await page.evaluate(d => { const name = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(d + 'T00:00:00').getDay()]; const rows = [...document.querySelectorAll('#view .list .item')]; const row = rows.find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent.indexOf(name) === 0); return !!row && /no lunch/.test(row.textContent); }, laterDay));
    {
      /* the kid's pick goes to the next box still to pack: with today's in the bag that would be
         tomorrow's, and tomorrow has no lunch, so the button sits on the day after instead */
      await page.waitForTimeout(250);
      await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids[0].settings.kidPick = true; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
      await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
      await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
      if (!(await page.$('[data-act="pack-all"][aria-pressed="true"]'))) { await page.click('[data-act="pack-all"]'); await page.waitForTimeout(300); }
      const picks = await page.evaluate(d => { const name = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(d + 'T00:00:00').getDay()]; const rows = [...document.querySelectorAll('#view .list .item')].filter(r => r.querySelector('.nm')); const day = r => r.querySelector('.nm').textContent.trim().split(/\s/)[0]; return { off: name, with: rows.filter(r => r.querySelector('.pickwrap')).map(day), all: rows.map(day) }; }, laterDay);
      check('the kid\'s pick skips a day with no lunch: the button sits on the next box that has one', picks.with.length === 1 && picks.with[0] !== picks.off && picks.all.indexOf(picks.with[0]) > picks.all.indexOf(picks.off), picks);
      await page.click('[data-act="pack-all"]'); await page.waitForTimeout(300);   /* un-tick again for the rest of the walk */
      await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids[0].settings.kidPick = false; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
      await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
      await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
    }
    /* a re-plan leaves the day off, its foods as they were */
    const offFoods = await page.evaluate(d => JSON.stringify(JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.find(x => x.d === d).slots), laterDay);
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
    await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(400); await goShuffle(page);
    check('Plan the week keeps the day off, and leaves its foods as they were for Put it back', await page.evaluate(({ d, was }) => { const day = JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.find(x => x.d === d); return !!day && day.off === true && JSON.stringify(day.slots) === was; }, { d: laterDay, was: offFoods }));
    /* a rule switched on while the day was off takes its food out, and a day off takes no draw, so
       nothing refills it: the gap is filled when the day comes back, as the plan would have */
    await page.waitForTimeout(250);
    await page.evaluate(d => { const doc = JSON.parse(localStorage.getItem('lunchsorted')); doc.kids[0].week.days.find(x => x.d === d).slots.main = null; localStorage.setItem('lunchsorted', JSON.stringify(doc)); }, laterDay);
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(300);
    await page.click('[data-act="no-lunch"][data-day="' + laterDay + '"]'); await page.waitForTimeout(350);
    check('and Put it back on Week restores it', await page.evaluate(d => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const day = k.week.days.find(x => x.d === d); return !!day && !day.off; }, laterDay) && (await page.$$eval('.daycard:not(.past) .tin', a => a.length)) >= 2);
    check('with a compartment a rule had emptied while it was off filled again, not left at Nothing picked', await page.evaluate(d => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const day = k.week.days.find(x => x.d === d); return !!day.slots.main && k.foods.some(f => f.id === day.slots.main && !f.deletedAt); }, laterDay));
    if (wasPacked) { await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300); await page.click('[data-act="pack-all"]'); await page.waitForTimeout(300); }   /* leave the box as it was found */
    await page.evaluate(() => window.__pinHour(9));
    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
  }

  /* ------------------------------------------------------- writing one in
     One compartment, one day, a name the parent typed: on no list, never drawn,
     and never thrown away without a way back. */
  {
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
    const wDay = await page.$eval('.daycard:not(.past) [data-act="slot"][data-cat="main"]', e => e.getAttribute('data-day'));
    const foodsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.filter(f => !f.deletedAt && !f.once).length);
    await page.click('.daycard:not(.past) [data-act="slot"][data-cat="main"]'); await page.waitForTimeout(300);
    check('the compartment sheet offers a write-in', !!(await page.$('[data-act="write-in"]')));
    await page.click('[data-act="write-in"]'); await until(page, () => !!document.getElementById('wiName'));
    await page.fill('#wiName', 'Leftover spaghetti');
    await page.click('[data-act="write-save"]'); await page.waitForTimeout(350);

    const st = await page.evaluate((d) => {
      const a = JSON.parse(localStorage.getItem('lunchsorted')), k = a.kids[0];
      const day = k.week.days.find(x => x.d === d), f = k.foods.find(x => x.id === day.slots.main);
      return {name: f && f.n, once: f && f.once, kept: !!day.lock.main,
        onList: k.foods.filter(x => !x.deletedAt && !x.once).length,
        drawable: k.foods.some(x => !x.deletedAt && !x.once && x.n === 'Leftover spaghetti')};
    }, wDay);
    check('a write-in goes in that compartment, kept, flagged once', st.name === 'Leftover spaghetti' && st.once === true && st.kept, st);
    check('and it never joins the food list, so it is never drawn again', st.onList === foodsBefore && !st.drawable, st);
    check('the day says so, and the compartment carries a pencil beside the lock',
      (await page.$$eval('.daycard:not(.past) .chip', a => a.map(c => c.textContent))).includes('Written in')
      && (await page.$$eval('.daycard:not(.past) .cmp .wrote', a => a.length)) > 0);
    check('a day the app cannot read stops claiming the box has no protein',
      !(await page.$$eval('.daycard:not(.past) .chip', a => a.map(c => c.textContent))).includes('No protein'));

    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
    check('and it never reaches the shopping list, because it is already in the fridge',
      !(await page.$$eval('[data-act="have"] .nm', a => a.map(x => x.textContent))).some(n => /spaghetti/i.test(n)));
    await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(300);
    check('and it is not on the Foods tab',
      !(await page.$$eval('[data-act="food-open"] .nm', a => a.map(x => x.textContent))).some(n => /spaghetti/i.test(n)));

    /* it survives the draw it was written against, because it is kept */
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
    await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(400); await goShuffle(page);
    const survived = await page.evaluate((d) => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
      const f = k.foods.find(x => x.id === k.week.days.find(y => y.d === d).slots.main);
      return f && f.n; }, wDay);
    check('Plan the week leaves a write-in where the parent put it', survived === 'Leftover spaghetti', survived);

    /* and a reload rebuilds it from the whitelist still flagged once */
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(400);
    const afterBoot = await page.evaluate((d) => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
      const f = k.foods.find(x => x.id === k.week.days.find(y => y.d === d).slots.main);
      return {n: f && f.n, once: f && f.once}; }, wDay);
    check('and normFood carries the flag through a reload, so it does not become a food', afterBoot.n === 'Leftover spaghetti' && afterBoot.once === true, afterBoot);

    /* shuffling that one compartment is the path that used to eat it silently */
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
    await page.click('.daycard:not(.past) [data-act="slot"][data-cat="main"]'); await page.waitForTimeout(300);
    await page.click('[data-act="sheet-shuffle"]'); await page.waitForTimeout(350);
    const gone = await page.evaluate((d) => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
      const f = k.foods.find(x => x.id === k.week.days.find(y => y.d === d).slots.main);
      return f && f.n; }, wDay);
    check('Shuffle on the compartment replaces a write-in, and says which words it took', gone !== 'Leftover spaghetti'
      && /Leftover spaghetti/.test(await page.textContent('#toast')), gone);
    check('and the sheet gets out of the way, so the Undo can actually be tapped', !(await page.$('.sheet.open')));
    await tapUndoOn(page, 'and the toast is still up to tap that Undo on'); await page.waitForTimeout(350);
    const back = await page.evaluate((d) => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
      const f = k.foods.find(x => x.id === k.week.days.find(y => y.d === d).slots.main);
      return {n: f && f.n, live: f && !f.deletedAt}; }, wDay);
    check('and Undo puts the typed words back, off the tombstone', back.n === 'Leftover spaghetti' && back.live, back);
  }

  /* -------------------------------------------------- a photo on a food */
  {
    await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
    const target = await page.getAttribute('[data-act="food-photo"] >> nth=0', 'data-id');
    check('every food on the list has a thumbnail to tap, an emoji until there is a photo', (await page.$$eval('[data-act="food-photo"]', a => a.length)) > 10 && (await page.$$eval('[data-act="food-photo"] .ic', a => a.length)) > 10);
    /* the parent taps the thumbnail; the picker is a file input, fed a 600×400 picture drawn here */
    await page.click('[data-act="food-photo"] >> nth=0'); await page.waitForTimeout(200);
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d');
      g.fillStyle = '#c33'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#fc0'; g.fillRect(200, 100, 200, 200);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'lunch.png', { type: 'image/png' }));
      const inp = document.getElementById('photoIn'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    });
    await until(page, id => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const f = k.foods.find(x => x.id === id); return !!(f && f.img); }, target);
    const stored = await page.evaluate(id => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const f = k.foods.find(x => x.id === id); return { len: f.img.length, head: f.img.slice(0, 23) }; }, target);
    check('the photo is shrunk on the phone to a small JPEG stored with the food', stored.head === 'data:image/jpeg;base64,' && stored.len < 16000 && stored.len > 500, stored);
    check('and the Foods list shows it in place of the emoji', (await page.$$eval('[data-act="food-photo"] img.pic', a => a.length)) === 1);
    await page.click('[data-act="food-photo"][data-id="' + target + '"]'); await page.waitForTimeout(300);
    check('tapping it again offers another shot or removal', /Take another/.test(await page.textContent('#sheetBody')) && /Remove the photo/.test(await page.textContent('#sheetBody')));
    await page.click('[data-act="food-photo-clear"]'); await page.waitForTimeout(300);
    check('removing it puts the emoji back', (await page.$$eval('[data-act="food-photo"] img.pic', a => a.length)) === 0 && await page.evaluate(id => !JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.find(x => x.id === id).img, target));
    /* a hostile photo never survives normalisation */
    await page.evaluate(id => { const d = JSON.parse(localStorage.getItem('lunchsorted')); const f = d.kids[0].foods.find(x => x.id === id); f.img = 'data:text/html;base64,PHNjcmlwdD4='; localStorage.setItem('lunchsorted', JSON.stringify(d)); }, target);
    await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
    check('a photo that is not a JPEG data URL is dropped on load', await page.evaluate(id => !JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.find(x => x.id === id).img, target));
  }

  /* -------------------------------------------------- second lunchbox */
  await openGear(page);
  await page.waitForTimeout(200);
  await page.click('[data-act="add-kid"]');
  await page.waitForTimeout(350);
  await page.fill('#nkName', 'Sam');
  await page.click('[data-act="save-kid"]');
  await page.waitForTimeout(350);
  await page.click('[data-act="seed"]');
  await page.waitForTimeout(300);
  await openGear(page);
  await page.waitForTimeout(200);
  await page.click('[data-act="allergen"][data-k="gluten"]');
  await page.waitForTimeout(250);
  const rules = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.settings.avoidAllergens.join('+')));
  check('each lunchbox keeps its own rules', rules[0] !== rules[1], rules);

  /* ------------------------------------ a food goes in every box at once */
  await page.click('[data-act="tab"][data-tab="foods"]');
  await page.waitForTimeout(250);
  await page.click('[data-act="ideas"]');
  await page.waitForTimeout(350);
  const targets = await page.$$eval('[data-act="add-to"]', a => a.map(b => b.getAttribute('aria-pressed')));
  check('the idea bank asks which lunchboxes, with all of them on', targets.length === 2 && targets.every(v => v === 'true'), targets);

  const idea = await page.$$eval('[data-act="add-idea"]:not(.ticked)',
    a => (a.find(b => !/gluten|nuts|dairy|egg|soy|fish|sesame/i.test(b.textContent)) || {getAttribute: () => null}).getAttribute('data-name'));
  await page.click('[data-act="add-idea"][data-name="' + idea + '"]');
  await page.waitForTimeout(350);
  const landed = await page.evaluate(n => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.foods.some(f => !f.deletedAt && f.n === n)), idea);
  check('one tap adds the food to every lunchbox', landed.length === 2 && landed.every(Boolean), [idea, landed]);
  check('and the cursor stays on it too, which the kept scroll position does not prove',
    await page.evaluate(n => { const a = document.activeElement;
      return !!a && a.getAttribute('data-act') === 'add-idea' && a.getAttribute('data-name') === n; }, idea), idea);

  /* Two testers, the same morning: adding a food sent them back to the top of the bank,
     so a week's shopping was one tap and a long scroll, one tap and a long scroll. The
     sheet must not be redrawn under them, and a food tapped by mistake must come back off
     — but only a food this sitting put there. */
  const LIVE = n => page.evaluate(x => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.foods.some(f => !f.deletedAt && f.n === x)), n);
  const PRESSED = n => page.getAttribute('[data-act="add-idea"][data-name="' + n + '"]', 'aria-pressed');
  const AT = () => page.evaluate(() => document.getElementById('sheetBody').scrollTop);

  /* a food no rule of either box keeps out, so it lands on both and the removal is
     tested against both; scrolled to by hand, so the tap itself never moves the sheet */
  const idea1b = await page.$$eval('[data-act="add-idea"]:not(.ticked)',
    a => (a.find(b => !/gluten|nuts|dairy|egg|soy|fish|sesame/i.test(b.textContent)) || {getAttribute: () => null}).getAttribute('data-name'));
  await page.evaluate(n => document.querySelector('[data-act="add-idea"][data-name="' + n + '"]')
    .scrollIntoView({block: 'center'}), idea1b);
  await page.waitForTimeout(150);
  const wasAt = await AT();
  check('the idea bank is long enough that losing your place costs a scroll', wasAt > 0, wasAt);

  const beforeAdd = await LIVE(idea1b);
  await page.click('[data-act="add-idea"][data-name="' + idea1b + '"]');
  await page.waitForTimeout(350);
  const hadOn = await LIVE(idea1b);
  check('adding from the idea bank leaves the list exactly where it was', (await AT()) === wasAt, await AT());
  check('and the row it was tapped on is ticked where it stands, on every lunchbox',
    (await PRESSED(idea1b)) === 'true' && hadOn.length === 2 && hadOn.every(Boolean), [idea1b, hadOn]);

  await page.click('[data-act="add-idea"][data-name="' + idea1b + '"]');   /* tapped by mistake: tap it again */
  await page.waitForTimeout(350);
  /* the second tap undoes the first tap — not the name. A lunchbox that already had the
     food before the tap still has it after, because that add was somebody else's */
  check('tapping it again takes back exactly what that tap added, and nothing that was there before',
    (await LIVE(idea1b)).join() === beforeAdd.join(), [idea1b, beforeAdd, await LIVE(idea1b)]);
  check('and it unticks without redrawing the sheet under them',
    (await PRESSED(idea1b)) === 'false' && (await AT()) === wasAt);
  await tapUndoOn(page, 'and taking it back off offers Undo'); await page.waitForTimeout(350);
  check('and Undo puts it back on exactly the lunchboxes it came off, ticked again',
    (await LIVE(idea1b)).join() === hadOn.join() && (await PRESSED(idea1b)) === 'true', [idea1b, hadOn]);

  /* The half that cost three reviewers a finding: a row that was already ticked when the
     sheet opened was not put there by this sitting. It may be a food the parent wrote
     themselves — their photo, their amounts — that only shares a name with the bank, so
     it takes two taps, and the first one says what the second would cost. */
  await sheetDone(page); await page.waitForTimeout(250);
  await page.click('[data-act="ideas"]'); await page.waitForTimeout(350);
  check('reopening the sheet shows that food ticked', (await PRESSED(idea1b)) === 'true');
  await page.click('[data-act="add-idea"][data-name="' + idea1b + '"]');
  await page.waitForTimeout(300);
  check('one tap on a row that arrived ticked takes nothing off, and warns instead',
    (await LIVE(idea1b)).join() === hadOn.join() && /^That takes /.test(await page.textContent('#toast')),
    [idea1b, await page.textContent('#toast')]);
  check('and the row itself asks for the second tap',
    /tap again to take it off/i.test(await page.textContent('[data-act="add-idea"][data-name="' + idea1b + '"]')));

  /* and the arming is per row: a tap anywhere else puts the safety back on */
  const otherIdea = await page.$$eval('[data-act="add-idea"]',
    (a, n) => (a.find(b => b.getAttribute('data-name') !== n) || {}).getAttribute('data-name'), idea1b);
  await page.click('[data-act="add-idea"][data-name="' + otherIdea + '"]'); await page.waitForTimeout(300);
  check('arming one row is disarmed by a tap on any other',
    !/tap again to take it off/i.test(await page.textContent('[data-act="add-idea"][data-name="' + idea1b + '"]')));
  await page.click('[data-act="add-idea"][data-name="' + idea1b + '"]'); await page.waitForTimeout(300);
  await page.click('[data-act="add-idea"][data-name="' + idea1b + '"]'); await page.waitForTimeout(350);
  check('two taps in a row do take it off every lunchbox that had it',
    (await LIVE(idea1b)).every(v => v === false) && (await PRESSED(idea1b)) === 'false', await LIVE(idea1b));
  await tapUndoOn(page, 'and that offers Undo too'); await page.waitForTimeout(350);
  check('which puts it back on every one of them',
    (await LIVE(idea1b)).join() === hadOn.join(), [idea1b, hadOn, await LIVE(idea1b)]);

  /* a whole compartment at once, and one Undo for the lot */
  /* one named section, so a handler that ignored data-c and added the whole bank would fail */
  const CAT = 'fruit';
  const inCat = () => page.$$eval('.list.ideas[data-c="' + CAT + '"] [data-act="add-idea"]',
    a => ({total:a.length, off:a.filter(b => b.getAttribute('aria-pressed') === 'false').length}));
  const outsideOff = () => page.$$eval('.list.ideas:not([data-c="' + CAT + '"]) [data-act="add-idea"]',
    a => a.filter(b => b.getAttribute('aria-pressed') === 'false').length);
  const catBefore = await inCat(), otherBefore = await outsideOff();
  await page.click('[data-act="add-cat"][data-c="' + CAT + '"]'); await page.waitForTimeout(600);
  const catToast = await page.textContent('#toast');
  const catAfter = await inCat(), otherAfter = await outsideOff();
  check('Add all ticks every food in that section, and says how many of what',
    catBefore.off > 0 && catAfter.off === 0 && /^\d+ fruit added/.test(catToast), [catBefore, catAfter, catToast]);
  check('and the button goes, because it has nothing left to add',
    !(await page.$('[data-act="add-cat"][data-c="' + CAT + '"]')));
  check('and leaves every other section exactly as it was', otherAfter === otherBefore, [otherBefore, otherAfter]);
  await tapUndoOn(page, 'and offers one Undo for the lot'); await page.waitForTimeout(600);
  check('which takes that whole section back off again, and nothing else',
    (await inCat()).off === catBefore.off && (await outsideOff()) === otherBefore,
    [catBefore, await inCat()]);

  await page.click('[data-act="add-to"]');                     /* take the first box back out */
  await page.waitForTimeout(350);
  const only = await page.$$eval('[data-act="add-to"]', a => a.map(b => b.getAttribute('aria-pressed')));
  check('a box can be taken out of the next add', only[0] === 'false' && only[1] === 'true', only);
  /* an idea already on the list is in hand, not struck off, and still yours to change:
     no rule through the name, no dimming, and aria-pressed carrying the state because
     the row is a real toggle */
  const onList = await page.evaluate(() => {
    const on = document.querySelector('[data-act="add-idea"].ticked');
    const off = document.querySelector('[data-act="add-idea"]:not(.ticked)');
    if (!on || !off) return null;
    return { line: getComputedStyle(on.querySelector('.nm')).textDecorationLine,
             pressed: on.getAttribute('aria-pressed'),
             colour: getComputedStyle(on.querySelector('.nm')).color,
             plain: getComputedStyle(off.querySelector('.nm')).color };
  });
  check('an idea already on the list keeps its tick, loses the line, and says it is pressed', onList
    && !onList.line.includes('line-through') && onList.pressed === 'true', onList);
  check('and the tick alone carries it — the name is not dimmed the way a bought thing is',
    onList && onList.colour === onList.plain, onList);

  const idea2 = await page.$$eval('[data-act="add-idea"]:not(.ticked)',
    a => (a.find(b => !/gluten|nuts|dairy|egg|soy|fish|sesame/i.test(b.textContent)) || {getAttribute: () => null}).getAttribute('data-name'));
  const hadIt = await page.evaluate(n => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.foods.some(f => !f.deletedAt && f.n === n)), idea2);
  await page.click('[data-act="add-idea"][data-name="' + idea2 + '"]');
  await page.waitForTimeout(350);
  const landed2 = await page.evaluate(n => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.foods.some(f => !f.deletedAt && f.n === n)), idea2);
  check('and then the one weird food lands in that one box only',
    landed2[1] === true && landed2[0] === hadIt[0], [idea2, hadIt, landed2]);
  /* rules flag foods; they never refuse them: with Sam the only box, a food his
     rule keeps out still lands on his list, flagged, as Add your own always did */
  await sheetDone(page); await page.waitForTimeout(250);
  await page.click('[data-act="add-own"]'); await page.waitForTimeout(350);
  check('the add button says where the food will land', /Add to Sam$/.test((await page.textContent('#nfSave')).trim()), await page.textContent('#nfSave'));
  await page.fill('#nfName', 'Sourdough toast');
  await page.click('#nfAl .tg[data-v="gluten"]'); await page.waitForTimeout(100);
  await page.click('[data-act="save-own"]'); await page.waitForTimeout(400);
  const flaggedLanded = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const sam = d.kids.filter(k => !k.deletedAt).find(k => k.name === 'Sam');
    return sam.foods.some(f => !f.deletedAt && f.n === 'Sourdough toast');
  });
  check('a rule flags a food on the only box it is added to; it never refuses it',
    flaggedLanded && /so it is flagged/.test(await page.textContent('#toast')), await page.textContent('#toast'));
  await page.click('[data-act="ideas"]'); await page.waitForTimeout(350);
  await page.click('[data-act="add-to"]');                     /* put it back for the tests below */
  await page.waitForTimeout(350);
  await sheetDone(page);
  await page.waitForTimeout(300);


  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(250);
  check('filling a new lunchbox\'s list also plans it, so every lunchbox has a box to pack',
    await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted'))
      .kids.filter(k => !k.deletedAt).every(k => k.week && k.week.days.length)));

  /* ------------------------------ a parent may overrule their own rule */
  await page.click('[data-act="tab"][data-tab="week"]');
  await page.waitForTimeout(300);
  /* Sam's list was filled before the gluten rule was set, so it holds foods the
     rule now keeps out — exactly the case a parent overrules */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const sam = d.kids.filter(k => !k.deletedAt).find(k => k.name === 'Sam');
    document.querySelector('.boxtabs button[data-id="' + sam.id + '"]').click();
  });
  await page.waitForTimeout(350);
  await page.click('.tin .cmp[data-cat="main"]');
  await page.waitForTimeout(400);
  const breaks = await page.$$eval('[data-act="pick"]', a => {
    const hit = a.find(b => /tap to use it anyway/.test(b.textContent));
    return hit ? {id: hit.getAttribute('data-id'), meta: hit.querySelector('.meta').textContent} : null;
  });
  check('a food a rule keeps out is still offered, with the rule named on it',
    !!breaks && /gluten/i.test(breaks.meta), breaks);
  await page.click('[data-act="pick"][data-id="' + breaks.id + '"]');
  await page.waitForTimeout(400);
  const over = () => page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const k = d.kids.filter(x => !x.deletedAt).find(x => x.id === d.activeKidId);
    const day = k.week.days.find(x => (x.over || {}).main);
    return day ? {live: day.over.main === day.slots.main, day: day.d} : null;
  });
  check('picking it puts it in the box and records the override', (await over()) && (await over()).live);
  const flagged = await page.textContent('#view');
  check('and the day says so where the parent will see it', /Against the rules/.test(flagged));
  check('the compartment carries the mark too', (await page.$$eval('.tin .over', a => a.length)) > 0);

  /* on main the rules live behind the gear beside the lunchbox name */
  await page.click('[data-act="tab"][data-tab="week"]');
  await page.waitForTimeout(250);
  await openGear(page);
  await page.waitForTimeout(300);
  await page.click('[data-act="rule"][data-k="noIce"]');           /* any rule change sweeps the plan */
  await page.waitForTimeout(300);
  await page.click('[data-act="box-done"]');
  await page.waitForTimeout(400);
  check('a later rule change does not quietly undo the parent\'s override', (await over()) && (await over()).live);
  /* and leave the rule as it was found: with it on, this lunchbox has almost no
     mains at all, which starves the matching checks further down */
  await openGear(page);
  await page.waitForTimeout(300);
  await page.click('[data-act="rule"][data-k="noIce"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="box-done"]');
  await page.waitForTimeout(300);
  check('and the override survives the rule going back off as well', (await over()) && (await over()).live);
  /* the mark states a fact: with the gluten rule off, the food breaks nothing, so
     no "!" — the record stays, and the mark returns with the rule */
  await page.click('[data-act="tab"][data-tab="week"]');
  await page.waitForTimeout(250);
  await openGear(page);
  await page.waitForTimeout(300);
  await page.click('[data-act="allergen"][data-k="gluten"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="box-done"]');
  await page.waitForTimeout(400);
  check('with the rule switched off the mark goes, because there is no rule to overrule', (await page.$$eval('.tin .over', a => a.length)) === 0);
  await openGear(page);
  await page.waitForTimeout(300);
  await page.click('[data-act="allergen"][data-k="gluten"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="box-done"]');
  await page.waitForTimeout(400);
  check('and comes back with the rule, without the parent choosing again', (await page.$$eval('.tin .over', a => a.length)) > 0 && (await over()).live);

  await page.click('[data-act="tab"][data-tab="week"]');
  await page.waitForTimeout(300);
  const dayStr = (await over()).day;
  await page.click('.tin .cmp[data-cat="main"]');
  await page.waitForTimeout(400);
  /* the override is recorded against the food, not the compartment: choose a
     different one and the first food's permission does not come with it */
  const other = await page.$$eval('[data-act="pick"]',
    (a, id) => (a.find(b => b.getAttribute('data-id') !== id) || {getAttribute: () => null}).getAttribute('data-id'), breaks.id);
  await page.click('[data-act="pick"][data-id="' + other + '"]');
  await page.waitForTimeout(400);
  check('a food chosen by hand is locked, and remembered as chosen', await page.evaluate(d => {
    const doc = JSON.parse(localStorage.getItem('lunchsorted'));
    const k = doc.kids.filter(x => !x.deletedAt).find(x => x.id === doc.activeKidId);
    const day = k.week.days.find(x => x.d === d.day); return day.lock.main === true && !!day.chosen && day.chosen.main === day.slots.main;
  }, {day: dayStr}) && /locked/.test(await page.textContent('#toast')), await page.textContent('#toast'));
  check('swapping the compartment ends that food\'s override', await page.evaluate(d => {
    const doc = JSON.parse(localStorage.getItem('lunchsorted'));
    const k = doc.kids.filter(x => !x.deletedAt).find(x => x.id === doc.activeKidId);
    const day = k.week.days.find(x => x.d === d.day);
    const over = (day.over || {}).main;
    /* the permission is gone, not merely pointing somewhere else: it is either
       absent or it names the food that is actually in the box now */
    return day.slots.main !== d.first && over !== d.first && (!over || over === day.slots.main);
  }, {day: dayStr, first: breaks.id}));

  /* a permission for one food must not survive that food leaving and coming back */
  await page.click('[data-act="tab"][data-tab="week"]');
  await page.waitForTimeout(300);
  await page.click('.tin .cmp[data-cat="sweet"]');
  await page.waitForTimeout(400);
  const sweetBad = await page.$$eval('[data-act="pick"]', a => {
    const hit = a.find(b => /tap to use it anyway/.test(b.textContent));
    return hit ? hit.getAttribute('data-id') : null;
  });
  if (sweetBad) {
    await page.click('[data-act="pick"][data-id="' + sweetBad + '"]');
    await page.waitForTimeout(400);
    await page.click('.tin .cmp[data-cat="sweet"]');
    await page.waitForTimeout(400);
    await page.click('[data-act="sheet-shuffle"][data-cat="sweet"]');
    await page.waitForTimeout(400);
    await sheetDone(page);
    await page.waitForTimeout(250);
  }
  check('and a re-draw hands the permission back rather than leaving it for the next food',
    await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('lunchsorted'));
      return doc.kids.filter(k => !k.deletedAt).every(k => !k.week || k.week.days.every(day =>
        Object.keys(day.over || {}).every(c => day.over[c] === day.slots[c])));
    }), sweetBad || 'no rule-breaking sweet to override');


  /* ------------------------------------------- one week across two boxes */
  await page.click('[data-act="tab"][data-tab="week"]');
  await page.waitForTimeout(250);
  const pills = await page.$$eval('.boxtabs button', a => a.map(b => b.textContent.trim()));
  check('two lunchboxes get a row of tabs to move between their plans', pills.length === 2, pills);

  await page.click('.boxtabs button:last-child'); await page.waitForTimeout(300);
  check('a tab is one tap to the next lunchbox', await page.evaluate(() => document.querySelector('.boxtabs [aria-current="true"]') === document.querySelector('.boxtabs button:last-child')));
  await page.click('.boxtabs button:first-child'); await page.waitForTimeout(300);

  /* the settings carry the same strip, so switching which box you are setting
     up is the same gesture as switching which box you are planning */
  await openGear(page); await page.waitForTimeout(300);
  const boxPills = await page.$$eval('.boxtabs button', a => a.map(b => b.textContent.trim()));
  check('the lunchbox settings carry the same tabs as Pack and Week', boxPills.length === 2, boxPills);
  check('and no state pins on them: packed and owed are a Pack concern', (await page.$$eval('.boxtabs .pin', a => a.length)) === 0);
  check('and the header does not repeat the name the strip already carries', (await page.$$eval('#who .kidbtn', a => a.length)) === 0);
  const firstName = await page.inputValue('#kidName');
  await page.click('.boxtabs button:last-child'); await page.waitForTimeout(350);
  check('a tab changes which lunchbox is being set up', (await page.inputValue('#kidName')) !== firstName);
  check('Add a lunchbox sits with the household switches above the tabs, and Remove with the box it removes', await page.evaluate(() => {
    const add = document.querySelector('[data-act="add-kid"]'), del = document.querySelector('[data-act="del-kid"]');
    const strip = document.querySelector('.boxtabs'), rules = [...document.querySelectorAll('#view h3')].find(h => /School rules/.test(h.textContent));
    return !!add && !!del && !!strip && !!rules
      && add.getBoundingClientRect().top < strip.getBoundingClientRect().top
      && del.getBoundingClientRect().top > rules.getBoundingClientRect().top;
  }));
  check('and the settings say what they are, with the way out, at the very top', await page.evaluate(() => {
    const done = document.querySelector('[data-act="box-done"]'), strip = document.querySelector('.boxtabs');
    return !!done && done.getBoundingClientRect().top < strip.getBoundingClientRect().top && done.getBoundingClientRect().top < 200;
  }));
  await page.click('.boxtabs button:first-child'); await page.waitForTimeout(300);
  await page.click('[data-act="box-done"]'); await page.waitForTimeout(250);

  /* ------------------------------------- shop is the household's, always */
  await page.click('[data-act="tab"][data-tab="shop"]');
  await page.waitForTimeout(300);
  check('the shopping list offers no lunchbox to switch to, because it covers them all',
    await page.evaluate(() => !document.querySelector('#who .kidbtn') && !document.querySelector('.boxtabs') && !document.querySelector('#who [data-act="box-settings"]')));
  check('and says whose list it is without counting to two', /both lunchboxes/.test(await page.textContent('#view .view-sub')));
  check('and every lunchbox is in it', await page.evaluate(() => {
    const kids = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt && k.week);
    const lines = [...document.querySelectorAll('#view .list .item .nm')].map(m => m.textContent.trim().toLowerCase());
    /* each lunchbox's planned foods, as what is bought for them, are on the one list */
    return kids.length > 0 && kids.every(k => k.week.days.some(d => Object.values(d.slots).some(id => { const f = k.foods.find(x => x.id === id); return f && (f.buy && f.buy.length ? f.buy : [f.n]).some(b => lines.includes(b.toLowerCase())); })));
  }));


  /* ----------------------------------------- pack swipes like the plan */
  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(300);
  check('with two lunchboxes Pack stacks them rather than tabbing: the first box open, the second one line', (await page.$$eval('.boxtabs', a => a.length)) === 0
    && (await page.$$eval('#view .tin', a => a.length)) === 1 && (await page.$$eval('[data-act="box-open"]', a => a.length)) === 1
    && /not packed \u00b7 \d parts/.test(await page.textContent('[data-act="box-open"]')), await page.textContent('[data-act="box-open"]'));
  const secondBox = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), ks = d.kids.filter(k => !k.deletedAt), k = ks[1];
    const day = k.week.days.find(x => x.d >= new Date().toISOString().slice(0,10));
    return {day: day && day.d, kid: k.id, name: k.name, line: document.querySelector('[data-act="box-open"]').getAttribute('data-kid') === k.id,
      lineHeight: document.querySelector('[data-act="box-open"]').getBoundingClientRect().height};
  });
  check('the line is the second lunchbox\'s, named, and a 44px target', secondBox.line && new RegExp(secondBox.name).test(await page.textContent('[data-act="box-open"]')) && secondBox.lineHeight >= 44, secondBox);
  if (secondBox.day) {
    await page.click('[data-act="box-open"]'); await page.waitForTimeout(300);
    check('tapping the line opens that box in place, under the first', (await page.$$eval('#view .tin', a => a.length)) === 2 && (await page.$$eval('[data-act="box-open"]', a => a.length)) === 0
      && (await page.$$eval('[data-act="pack-all"]', a => a.length)) === 2);
    const wasPacked = await page.getAttribute(`[data-act="pack-all"][data-kid="${secondBox.kid}"]`, 'aria-pressed');
    if (wasPacked === 'true') { await page.click(`[data-act="pack-all"][data-kid="${secondBox.kid}"]`); await page.waitForTimeout(300); await page.click('[data-act="box-open"]'); await page.waitForTimeout(300); }
    await page.click(`[data-act="pack-all"][data-kid="${secondBox.kid}"]`); await page.waitForTimeout(300);
    check('Packed folds it back to one line that says so, with the time', (await page.$$eval('#view .tin', a => a.length)) === 1
      && /\u2713 packed \d{1,2}:\d\d (am|pm)/.test(await page.textContent('[data-act="box-open"]')), await page.textContent('[data-act="box-open"]'));
    await page.click('[data-act="box-open"]'); await page.waitForTimeout(300);
    await page.click(`[data-act="pack-all"][data-kid="${secondBox.kid}"]`); await page.waitForTimeout(300);   /* un-tick: leave the fixture as it was */
    check('and un-packing it leaves it open, not packed', (await page.$$eval('#view .tin', a => a.length)) === 2 && (await page.getAttribute(`[data-act="pack-all"][data-kid="${secondBox.kid}"]`, 'aria-pressed')) === 'false');
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150); await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  }


  /* --------------------------- three o'clock: the box is home, ask now */
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  check('before three, nothing is asked about a box that is still at school',
    (await page.$$eval('.review', a => a.length)) === 0 && !(await page.$('nav.tabs .due')));
  await page.evaluate(() => window.__pinHour(15));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  const askedToday = await page.$$eval('.review', a => a.length);
  const folds = () => page.$$eval('.card.fold', a => a.map(e => e.textContent.trim()));
  check('from three, it asks about today\'s box, one card open, the other box\'s question one line, and Pack carries the dot',
    askedToday === 1 && /Today/.test(await page.$eval('.review .view-sub', e => e.textContent)) && (await folds()).length === 1 && !!(await page.$('nav.tabs .due')), [askedToday, await folds()]);
  check('the line names the box and asks the question', /^\S.* · Today’s box came home\. How did it go\?/.test((await folds())[0]), await folds());
  const firstAsked = await page.getAttribute('[data-act="review-later-all"]', 'data-kid');
  await page.click('.card.fold[data-act="review-now"]'); await page.waitForTimeout(300);
  check('tapping the line opens that box\'s card and folds the first', (await page.$$eval('.review', a => a.length)) === 1 && (await page.getAttribute('[data-act="review-later-all"]', 'data-kid')) !== firstAsked && (await folds()).length === 1);
  await page.click('[data-act="review-later-all"]'); await page.waitForTimeout(300);
  check('Answer later folds that card to a line that says it is waiting, and the other box\'s card opens in its place',
    (await page.$$eval('.review', a => a.length)) === 1 && (await page.getAttribute('[data-act="review-later-all"]', 'data-kid')) === firstAsked && /Waiting for your answer\./.test((await folds())[0]) && !!(await page.$('nav.tabs .due')), await folds());
  await page.click('[data-act="review-later-all"]'); await page.waitForTimeout(300);
  check('a second Answer later folds the other, so nothing is asked and the dot still says it is owed', (await page.$$eval('.review', a => a.length)) === 0 && (await folds()).length === 2 && !!(await page.$('nav.tabs .due')));
  /* the hold is kept on the phone, not in the page: a reload keeps both lines folded */
  await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__pinHour(15));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('Answer later holds across a reload', (await page.$$eval('.review', a => a.length)) === 0 && (await folds()).every(t => /Waiting for your answer/.test(t)) && (await folds()).length === 2, await folds());
  await page.click('[data-act="review-now"] >> nth=0'); await page.waitForTimeout(300);
  check('Answer now brings the question back', (await page.$$eval('.review', a => a.length)) === 1);
  await page.click('[data-act="review-later-all"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__pinHour(17));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('and stays out of the way for the rest of that afternoon', (await page.$$eval('.review', a => a.length)) === 0);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('until Pack is tapped again: the dot is a door, and the questions come back', (await page.$$eval('.review', a => a.length)) === 1 && (await folds()).length === 1);

  /* each lunchbox has its own box-home time; the question, the dot and the reminder follow it */
  await openPane(page, 'box');
  const homeKid = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).activeKidId);
  check('the lunchbox settings say when the box comes home, three by default', (await page.$eval('#homeAt', e => e.value)) === '15:00' && /When does the box come home\?/.test(await page.textContent('#view')));
  await page.selectOption('#homeAt', '17:30'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('at five, a box that comes home at half past is not asked about yet; the other box\'s is', (await page.$$eval('.review', a => a.length)) === 1 && (await folds()).length === 0 && (await page.getAttribute('[data-act="review-later-all"]', 'data-kid')) !== homeKid && !!(await page.$('nav.tabs .due')));
  /* the reminder on the phone follows the same time: stub the plugin, flip the switch, read what was scheduled */
  await page.evaluate(() => {
    window.__ln = { scheduled: [], asked: 0 };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
      cancel: async () => {}, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => { window.__ln.asked++; return { display: 'granted' }; },
      schedule: async o => { window.__ln.scheduled = o.notifications; } } } };
  });
  await openPane(page, 'box');
  check('the reminder switch is named for the box coming home, not three o\'clock', await page.evaluate(() => {
    const t = document.querySelector('#view').textContent; return !/Remind us at three/.test(t) && !!document.querySelector('[data-act="review-reminder"]') && /Remind us when the box is home/.test(t); }));
  await page.click('[data-act="review-reminder"]'); await page.waitForTimeout(700);
  const lnPlanned = await page.evaluate(() => window.__ln.scheduled.filter(n => n.id >= 2000).map(n => ({ id: n.id, at: new Date(n.schedule.at).getHours() * 60 + new Date(n.schedule.at).getMinutes(), day: new Date(n.schedule.at).getDate(), title: n.title })));   /* the evening pick reminders sit below 2000 */
  const todayD = await page.evaluate(() => new Date().getDate());
  check('the reminder is scheduled for the box\'s own time: half past five today for this box, and both times tomorrow',
    lnPlanned.length >= 3 && lnPlanned[0].day === todayD && lnPlanned[0].at === 17 * 60 + 30 && /How did .*box go\?/.test(lnPlanned[0].title)
      && lnPlanned.some(n => n.day !== todayD && n.at === 15 * 60) && lnPlanned.some(n => n.day !== todayD && n.at === 17 * 60 + 30) && lnPlanned.every(n => n.id >= 2000 && n.id < 2007), lnPlanned);
  await page.click('[data-act="review-reminder"]'); await page.waitForTimeout(500);
  await page.evaluate(() => { delete window.Capacitor; delete window.__ln; });
  await page.evaluate(() => window.__pinHour(18));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('at six it is asked about too', (await page.$$eval('.review', a => a.length)) === 1 && (await folds()).length === 1);
  /* the switch: a lunchbox that is never asked */
  await openPane(page, 'box');
  await page.click('[data-act="review-on"]'); await page.waitForTimeout(300);
  check('Ask what came home turns the question off for this lunchbox, and says so', (await page.getAttribute('[data-act="review-on"]', 'aria-pressed')) === 'false' && /We won’t ask/.test(await page.textContent('#toast')));
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('and Pack asks about the other box only, with the dot for it', (await page.$$eval('.review', a => a.length)) === 1 && (await folds()).length === 0 && (await page.getAttribute('[data-act="review-later-all"]', 'data-kid')) !== homeKid && !!(await page.$('nav.tabs .due')));
  await openPane(page, 'box');
  await page.click('[data-act="review-on"]'); await page.waitForTimeout(200);
  await page.selectOption('#homeAt', '15:00'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('switched back on, with the box home at three again, both are asked', (await page.$$eval('.review', a => a.length)) === 1 && (await folds()).length === 1);
  /* yesterday's question is not lost when today's box comes home: it waits behind it */
  await page.evaluate(id => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids.find(x => x.id === id); const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0,0,0,0);
    const iso = y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0');
    const slots = {}; for (const c of ['main','side','fruit','sweet']) { const f = k.foods.find(x => x.c === c && !x.deletedAt); if (f) slots[c] = f.id; }
    k.past = (k.past || []).concat([{d: iso, dow: y.getDay(), slots, lock: {}, kidPick: {}}]); k.packed = k.packed || {}; k.packed[iso] = {main:{at:new Date().toISOString(), by:null}};
    localStorage.setItem('lunchsorted', JSON.stringify(d)); }, homeKid);
  await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__pinHour(18));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('with yesterday\'s box never answered, today\'s is asked about first', (await page.$$eval('.review', a => a.length)) === 1 && /Today/.test(await page.$eval('.review .view-sub', e => e.textContent)));
  const openKid = await page.getAttribute('[data-act="review-later-all"]', 'data-kid');
  await page.click('[data-act="eat-all"]'); await page.waitForTimeout(300);
  const mid = await page.evaluate(() => ({ cards: [...document.querySelectorAll('.review .view-sub')].map(e => e.textContent), folds: [...document.querySelectorAll('.card.fold')].map(e => e.textContent.trim()), view: document.querySelector('#view').textContent }));
  check('and once it is answered, the other box\'s today comes up first, its own answer stays on screen, and yesterday\'s waits behind, named', mid.cards.length === 1 && /Today/.test(mid.cards[0]) && /Today: all eaten/.test(mid.view) && (openKid !== homeKid || mid.folds.some(t => /Yesterday’s box came home/.test(t))), mid);
  await page.click('[data-act="eat-all"]'); await page.waitForTimeout(300);
  check('with both boxes answered, yesterday\'s question opens, named as yesterday\'s, under the answers', (await page.$$eval('.review .view-sub', a => a.map(e => e.textContent))).some(t => /Yesterday/.test(t)) && /box go yesterday\?/.test(await page.textContent('.review')) && (await page.$$eval('[data-act="eat-change"]', a => a.length)) === 2, (await page.textContent('#view')).slice(0, 240));
  check('yesterday\'s card is a real one: All eaten, four answers a food, Skip at the foot', await page.evaluate(() => { const c = document.querySelector('.review'); return !!c && !!c.querySelector('[data-act="eat-all"]') && c.querySelectorAll('.seg.four').length > 0 && !!c.querySelector('[data-act="eat-skip"]'); }));
  await page.click('[data-act="eat-skip"]'); await page.waitForTimeout(300);
  check('Skip puts it to rest', (await page.$$eval('.review, .card.fold', a => a.length)) === 0);
  /* leave the fixture as it was: nothing answered, no box in the past, and both questions held */
  await page.evaluate(id => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids.forEach(k => { k.eaten = {}; if (k.id === id) { k.past = (k.past || []).slice(0, -1); } }); localStorage.setItem('lunchsorted', JSON.stringify(d)); localStorage.removeItem('lunchsorted-later'); }, homeKid);
  await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__pinHour(17));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  await page.click('[data-act="review-later-all"]'); await page.waitForTimeout(300);
  await page.click('[data-act="review-later-all"]'); await page.waitForTimeout(300);
  /* a night-before household is packing tomorrow's box by now */
  const packSub = () => page.$eval('#view .view-sub', e => e.textContent);
  check('a household that packs in the morning still sees today\'s box in the evening', /Today/.test(await packSub()));
  await openPane(page, 'box');
  await page.click('[data-act="pack-when"][data-v="evening"]'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('say you pack the night before and, from three, Pack shows tomorrow\'s box', /Tomorrow/.test(await packSub()));
  await page.evaluate(() => window.__pinHour(19));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('and at seven the box you came to pack sits above the questions about today',
    await page.evaluate(() => { const v = document.querySelector('#view'); const tin = v.querySelector('.tin'), card = v.querySelector('.review'); return !!tin && (!card || tin.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
  check('a day whose box is home is no longer a button on Week', (await page.$$eval('.daycard:first-of-type .cmp[data-act="slot"]', a => a.length)) === 0);
  await page.evaluate(() => window.__pinHour(7));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('but in the morning, before the box has gone, it is still today\'s', /Today/.test(await packSub()));
  await openPane(page, 'box');
  await page.click('[data-act="pack-when"][data-v="morning"]'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__pinHour(9));
  await page.reload(); await page.waitForTimeout(600);
  check('and a new open before three has nothing to ask yet: the box is back at school', (await page.$$eval('.review', a => a.length)) === 0 && !(await page.$('nav.tabs .due')));

  /* ------------------------------------ one plan across the two boxes */
  await openPane(page, 'box');
  check('matching the boxes is on by default, and only offered once there are two',
    await page.evaluate(() => document.querySelector('[data-act="align"]').getAttribute('aria-pressed') === 'true'));

  /* planAll leads with the fullest food list, and the seeding is random — so
     which box leads is a coin toss. Land it on the box without the extra
     allergen: the strict one can be left with no eligible mains at all, and a
     lead with an empty week gives the comparison below nothing to compare. */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const ks = d.kids.filter(k => !k.deletedAt);
    const live = k => k.foods.filter(f => !f.deletedAt);
    const strict = ks.slice().sort((a, b) => b.settings.avoidAllergens.length - a.settings.avoidAllergens.length)[0];
    const lead = ks.find(k => k !== strict);
    const stamp = new Date().toISOString();
    while (live(strict).length >= live(lead).length) {
      const drop = live(strict).find(f => f.c !== 'main');
      if (!drop) break;
      drop.deletedAt = stamp;
    }
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForTimeout(700);
  await openPane(page, 'account');
  await page.click('[data-act="clear-week"]');
  await page.waitForTimeout(150);
  await page.click('[data-act="clear-week"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(250);
  await page.click('[data-act="plan-all"]');
  await page.waitForTimeout(400);
  const align = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const t = new Date(); t.setHours(0,0,0,0);
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const t0 = iso(t);
    const key = s => String(s).trim().toLowerCase().replace(/\s+/g,' ');
    const live = k => k.foods.filter(f => !f.deletedAt);
    const ks = d.kids.filter(k => !k.deletedAt && k.week);
    /* the fullest list leads, exactly as planAll picks it */
    const lead = ks.slice().sort((a, b) => live(b).length - live(a).length || ks.indexOf(a) - ks.indexOf(b))[0];
    const other = ks.filter(k => k !== lead)[0];
    const name = (k, id) => { const f = live(k).find(f => f.id === id); return f ? key(f.n) : null; };
    let same = 0, unexplained = 0; const miss = [];
    lead.week.days.filter(x => x.d >= t0).forEach(da => {
      const db = other.week.days.find(x => x.d === da.d);
      if (!db) return;
      Object.keys(da.slots).forEach(c => {
        const want = name(lead, da.slots[c]);
        if (!want || !(c in db.slots)) return;
        if (name(other, db.slots[c]) === want) { same++; return; }
        /* the only reasons to differ: this box has no such food, or its rules keep it out */
        const mine = live(other).filter(f => f.c === c && key(f.n) === want);
        const blocked = !mine.length || mine.every(f => (f.al || []).some(x => other.settings.avoidAllergens.includes(x)));
        if (!blocked) { unexplained++; miss.push([da.d, c, want, name(other, db.slots[c])]); }
      });
    });
    return {same, unexplained, boxes: ks.length, miss, lead: lead.name,
      leadDrew: lead.week.days.filter(x => x.d >= t0 && x.slots.main).length};
  });
  check('the lead box drew a week at all, so the comparison means something',
    align.leadDrew > 0, align);
  check('planning the week gives both boxes the same foods', align.boxes === 2 && align.same > 0, align);
  /* with matching on, Plan the week on Week is the household's draw too */
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(500); await goShuffle(page);
  check('Plan the week with Match the boxes on draws every box, and says so in the new words', /Weeks planned/.test(await page.textContent('#toast')) && /boxes match|compartments? differ/.test(await page.textContent('#toast')) && !/drawn/.test(await page.textContent('#toast')), await page.textContent('#toast'));
  /* the sheet: pick boxes, the rest keep theirs, and Undo puts it all back */
  const weeksBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => JSON.stringify(k.week.days.map(d => d.slots))));
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
  check('with two boxes, Plan the week asks whose, all on, and says matching is on',
    (await page.$$eval('#shKids .tg[aria-pressed="true"]', a => a.length)) === 2 && /Matching is on/.test(await page.textContent('#sheetBody')));
  await page.click('#shKids .tg >> nth=0'); await page.waitForTimeout(100);          /* leave the first box out */
  await page.click('[data-act="shuffle-go"]'); await page.waitForTimeout(500);
  const weeksAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => JSON.stringify(k.week.days.map(d => d.slots))));
  check('a box left out of the shuffle keeps exactly what it had', weeksAfter[0] === weeksBefore[0]);
  await page.click('.daycard:not(.past) [data-act="shuffle-day"] >> nth=0'); await page.waitForTimeout(300);
  check('a day\'s Shuffle starts with only the box on screen ticked', (await page.$$eval('#shKids .tg[aria-pressed="true"]', a => a.length)) === 1);
  await sheetDone(page); await page.waitForTimeout(200);
  await tapUndoOn(page, 'and the shuffle offers Undo'); await page.waitForTimeout(400);
  const weeksUndone = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => JSON.stringify(k.week.days.map(d => d.slots))));
  check('Undo puts the shuffled box back as it was', weeksUndone[1] === weeksBefore[1], {before: weeksBefore[1].slice(0,60), undone: weeksUndone[1].slice(0,60)});

  /* ------------------------------------------- planning the week after */
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  check('the week header offers Next beside the title, one labelled button',
    (await page.$$eval('[data-act="week-ahead"]', a => a.length)) === 1 && (await page.getAttribute('[data-act="week-ahead"]', 'aria-label')) === 'Next week'
    && await page.$eval('[data-act="week-ahead"]', b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44));
  check('and the date, Next and Plan the week share one line on a phone', await page.evaluate(() => {
    const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const t = document.querySelector('.view-title'), n = document.querySelector('[data-act="week-ahead"]'), p = document.querySelector('[data-act="plan-kid"]');
    return !!(t && n && p) && Math.abs(mid(t) - mid(n)) < 12 && Math.abs(mid(n) - mid(p)) < 12
      && n.getBoundingClientRect().left > t.getBoundingClientRect().left
      && p.getBoundingClientRect().left > n.getBoundingClientRect().left;
  }));
  check('every control in the week header is a 44px target',
    await page.$$eval('.titlerow .btn, .titlerow .iconbtn', a => a.length >= 2 && a.every(b => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44)));
  check('the whole week is Plan the week; a day carries a lock and a shuffle, each an icon with its spoken name and a 44px target',
    /^Plan the week$/.test((await page.textContent('[data-act="plan-kid"]')).trim())
    && /^Shuffle [A-Z][a-z]+day$/.test(await page.getAttribute('.daycard:not(.past) [data-act="shuffle-day"] >> nth=0', 'aria-label'))
    && /^Lock [A-Z][a-z]+day$/.test(await page.getAttribute('.daycard:not(.past) [data-act="day-lock"] >> nth=0', 'aria-label'))
    && await page.evaluate(() => {
      const d = document.querySelector('.daycard:not(.past) [data-act="shuffle-day"]'), l = document.querySelector('.daycard:not(.past) [data-act="day-lock"]');
      const box = e => e.getBoundingClientRect();
      return !d.textContent.trim() && box(d).width >= 44 && box(d).height >= 44 && box(l).width >= 44 && box(l).height >= 44 && Math.abs(box(d).top - box(l).top) < 2;
    }));
  {
    /* the day lock: every compartment with a food in it, at once, and Plan the week leaves them alone */
    const dayOf = () => page.evaluate(() => { const b = document.querySelector('.daycard:not(.past) [data-act="day-lock"]'); return b.getAttribute('data-day'); });
    const lockDay = await dayOf();
    const slotsBefore = await page.evaluate(d => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0]; return JSON.stringify(k.week.days.find(x => x.d === d).slots); }, lockDay);
    await page.click('.daycard:not(.past) [data-act="day-lock"] >> nth=0'); await page.waitForTimeout(300);
    const locked = await page.evaluate(d => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0], day = k.week.days.find(x => x.d === d);
      return Object.keys(day.slots).filter(c => day.slots[c]).every(c => day.lock[c]); }, lockDay);
    check('the lock on a day locks every compartment in it, says so, and the icon closes', locked && / locked$/.test(await page.textContent('#toast'))
      && (await page.getAttribute('.daycard:not(.past) [data-act="day-lock"] >> nth=0', 'aria-pressed')) === 'true'
      && /is locked/.test(await page.getAttribute('.daycard:not(.past) [data-act="day-lock"] >> nth=0', 'aria-label')), await page.textContent('#toast'));
    await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(400); await goShuffle(page);
    const slotsAfter = await page.evaluate(d => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0]; return JSON.stringify(k.week.days.find(x => x.d === d).slots); }, lockDay);
    check('and Plan the week leaves a locked day exactly as it was', slotsAfter === slotsBefore, {before: slotsBefore, after: slotsAfter});
    await page.click('.daycard:not(.past) [data-act="shuffle-day"] >> nth=0'); await page.waitForTimeout(300);
    if (await page.$('#shKids')) { await page.click('[data-act="shuffle-go"]'); await page.waitForTimeout(300); }
    check('Shuffle on a locked day says the day is locked, and changes nothing', / is locked/.test(await page.textContent('#toast')) && (await page.evaluate(d => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0]; return JSON.stringify(k.week.days.find(x => x.d === d).slots); }, lockDay)) === slotsBefore, await page.textContent('#toast'));
    check('and the other lunchbox\'s same day is left alone by the lock', await page.evaluate(d => { const ks = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt); if (ks.length < 2 || !ks[1].week) return true;
      const day = ks[1].week.days.find(x => x.d === d); return !day || !Object.keys(day.slots).some(c => day.slots[c] && day.lock[c]); }, lockDay));
    await page.click('.daycard:not(.past) [data-act="day-lock"] >> nth=0'); await page.waitForTimeout(300);
    check('a second tap unlocks it', (await page.getAttribute('.daycard:not(.past) [data-act="day-lock"] >> nth=0', 'aria-pressed')) === 'false' && /unlocked$/.test(await page.textContent('#toast')));
  }
  const thisWeekTitle = await page.$eval('.view-title', e => e.textContent.trim());
  await page.click('[data-act="week-ahead"][data-v="1"]'); await page.waitForTimeout(300);
  const nextTitle = await page.$eval('.view-title', e => e.textContent.trim());
  check('the arrow shows the week after, unplanned, with a button to plan it',
    nextTitle !== thisWeekTitle && /^Week of /.test(nextTitle) && /Plan next week/.test(await page.textContent('#view')) && /Nothing planned for next week yet/.test(await page.textContent('#view')) && (await page.getAttribute('[data-act="week-ahead"]', 'aria-label')) === 'Back to this week', {thisWeekTitle, nextTitle});
  const curBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => JSON.stringify(k.week)));
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300); await goShuffle(page);
  const aheadPlan = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => ({days: k.next ? k.next.days.length : 0, start: k.next && k.next.start, packDays: k.settings.days.length, weekStart: k.week.start})));
  check('planning it draws every pack day of the week after, for every box', aheadPlan.every(x => x.days === x.packDays && x.start > x.weekStart), aheadPlan);
  const curAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => JSON.stringify(k.week)));
  check('and this week is untouched by it', JSON.stringify(curAfter) === JSON.stringify(curBefore));
  check('the week after has no gone days, so every compartment is a button', (await page.$$eval('.daycard .cmp[data-act="slot"]', a => a.length)) > 0 && (await page.$$eval('.daycard.past', a => a.length)) === 0);
  await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
  check('Shop adds a Next week section once it is planned', /Next week/.test(await page.textContent('#view')));
  /* One pantry row behind two rows on screen: the tick must come back to the week it was
     made in, not to whichever of the two the list drew first. The draw overlaps the two
     weeks heavily on its own — 28 rows of 30 — but nothing seeds it, so the pair is put
     there rather than hoped for: next week's first main goes into the last day of this
     week, which is the day furthest from having gone. */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const k = d.kids.filter(x => !x.deletedAt)[0];
    const twin = k.next.days[0].slots.main;
    k.week.days[k.week.days.length - 1].slots.main = twin;
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.reload(); await page.waitForTimeout(600);
  await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(300);
  const dupe = await page.evaluate(() => {
    const keys = w => [].slice.call(document.querySelectorAll('[data-act="have"][data-when="'+w+'"]')).map(b => b.getAttribute('data-key'));
    const now = keys('now');
    return keys('next').filter(k => now.indexOf(k) > -1)[0] || null;
  });
  check('a food put in both weeks lists once under each week', !!dupe, dupe);
  if(!dupe) check('ticking the next-week row leaves focus on that row, not on this week\u2019s twin',
    false, 'the pair was never built, so nothing was tested');
  if(dupe){
    const dupeDone = k => page.evaluate(x => [].slice.call(document.querySelectorAll('#view [data-act="have"]'))
      .filter(b => b.getAttribute('data-key') === x).map(b => b.closest('.item').classList.contains('done')), k);
    const was = await dupeDone(dupe);
    const at = await page.evaluate(k => [].slice.call(document.querySelectorAll('[data-act="have"][data-when="next"]'))
      .map(b => b.getAttribute('data-key')).indexOf(k), dupe);
    await page.click('[data-act="have"][data-when="next"] >> nth=' + at); await page.waitForTimeout(250);
    check('ticking the next-week row leaves focus on that row, not on this week\u2019s twin',
      await page.evaluate(k => { const a = document.activeElement;
        return !!a && a.getAttribute('data-key') === k && a.getAttribute('data-when') === 'next'; }, dupe), dupe);
    const nowDone = await dupeDone(dupe);
    check('and one tick turns both rows, because both are the one pantry row',
      was.length === 2 && nowDone.length === 2 && nowDone.every(v => v === !was[0]), {dupe, was, nowDone});
  }
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  check('and coming back to Week lands on this week', (await page.getAttribute('[data-act="week-ahead"]', 'aria-label')) === 'Next week');
  /* when this week has gone, the week after becomes this week */
  const rolled = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const back = (s, n) => { const [y,m,dd] = s.split('-').map(Number); const t = new Date(y, m-1, dd - n); return iso(t); };
    d.kids.filter(k => !k.deletedAt).forEach(k => {
      k.week.start = back(k.week.start, 14); k.week.days.forEach(x => x.d = back(x.d, 14));   /* this week was two weeks ago */
      k.next.start = back(k.next.start, 14); k.next.days.forEach(x => x.d = back(x.d, 14));   /* the week after is last week... */
      k.next.start = back(k.next.start, -7); k.next.days.forEach(x => x.d = back(x.d, -7));   /* ...no: this week */
    });
    localStorage.setItem('lunchsorted', JSON.stringify(d));
    return d.kids.filter(k => !k.deletedAt).map(k => k.next.start);
  });
  await page.reload(); await page.waitForTimeout(700);
  check('a week that has gone rolls over: the week after is now this week, and nothing is planned after it',
    await page.evaluate(starts => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return d.kids.filter(k => !k.deletedAt).every((k, i) => k.week && k.week.start === starts[i] && !k.next); }, rolled), rolled);
  check('and only differs where a box\'s rules or its own list say otherwise', align.unexplained === 0, align);


  /* --------------------- matching never overrides the three-week rest */
  /* Rigged so the answer cannot come down to the draw: the lead box is left
     with exactly one main, so every day it holds is that food; the follower
     holds the same food (rested) and one other it can have instead. */
  const rested = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const ks = d.kids.filter(k => !k.deletedAt);
    const live = k => k.foods.filter(f => !f.deletedAt);
    const key = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
    const lead = ks[0], other = ks[1];
    /* the follower's own rules must allow both foods, or the test proves nothing.
       An earlier check switched its no-ice-pack rule on, which leaves it almost
       no mains at all — this is that lunchbox's fixture, so put it back. */
    const st = other.settings;
    st.noIce = false;
    const blocked = f => (f.al || []).some(a => st.avoidAllergens.includes(a))
      || (st.noHeat && (f.t || []).includes('heat'))
      || (st.noIce && (f.t || []).includes('ice'))
      || (st.shortWindow && (f.t || []).includes('messy'));
    const mains = live(other).filter(f => f.c === 'main' && !blocked(f));
    const shared = live(lead).filter(f => f.c === 'main')
      .find(f => mains.some(g => key(g.n) === key(f.n)));
    if (!shared) return null;
    const mine = mains.find(f => key(f.n) === key(shared.n));
    const spare = mains.find(f => f.id !== mine.id);
    if (!spare) return null;
    const stamp = new Date().toISOString();
    /* the lead can draw nothing else */
    lead.foods.forEach(f => { if (f.c === 'main' && f.id !== shared.id) f.deletedAt = stamp; });
    /* The follower must be able to afford the rest: the rule itself allows a
       rested food back when the list is too short for the week. Pad its allowed
       mains well past the days ahead with copies of one it can have, and keep
       the lead the fullest list by copying sides into it — thinning the
       follower, as this rig once did, is what made the rule's exception fire. */
    const clone = (f, k, i) => Object.assign({}, f, {id: 'food_rig' + i.toString(36), kidId: k.id, n: f.n + ' ' + (i + 1), createdAt: stamp, updatedAt: stamp});
    let i = 0;
    while (live(other).filter(f => f.c === 'main' && f.id !== mine.id && !blocked(f)).length < 8) other.foods.push(clone(spare, other, i++));
    const filler = live(lead).find(f => f.c !== 'main') || live(other).find(f => f.c !== 'main');
    while (filler && live(lead).length <= live(other).length) lead.foods.push(clone(filler, lead, i++));
    const spares = live(other).filter(f => f.c === 'main' && f.id !== mine.id && !blocked(f)).length;
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const back = n => { const t = new Date(); t.setDate(t.getDate() - n); return iso(t); };
    other.eaten = other.eaten || {};
    other.eaten[back(7)] = {main:{foodId:mine.id, r:'left', at:stamp, by:null}};
    other.eaten[back(8)] = {main:{foodId:mine.id, r:'left', at:stamp, by:null}};
    localStorage.setItem('lunchsorted', JSON.stringify(d));
    return {restedId: mine.id, spareId: spare.id, otherId: other.id, leadId: lead.id,
      leadMainId: shared.id, name: mine.n, spares: spares};
  });
  check('a came-home-twice food the lead box still holds can be set up', !!rested, rested);
  await page.reload();
  await page.waitForTimeout(800);
  await openPane(page, 'account');
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(350);
  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(250);
  await page.click('[data-act="plan-all"]');
  await page.waitForTimeout(600);
  const restCheck = await page.evaluate(r => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const lead = d.kids.find(k => k.id === r.leadId), other = d.kids.find(k => k.id === r.otherId);
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const t0 = iso(new Date());
    const ahead = other.week.days.filter(x => x.d >= t0);
    return {
      leadHolds: lead.week.days.filter(x => x.d >= t0).every(x => x.slots.main === r.leadMainId),
      days: ahead.length,
      onRested: ahead.filter(x => x.slots.main === r.restedId).length,
      filled: ahead.filter(x => !!x.slots.main).length,
      spares: r.spares
    };
  }, rested);
  check('the lead box really is holding that food every day, so the test can prove anything',
    restCheck.leadHolds && restCheck.days > 0 && restCheck.spares >= restCheck.days, restCheck);
  check('matching a lunchbox to the others never wakes a food that is resting',
    restCheck.onRested === 0 && restCheck.filled === restCheck.days, restCheck);

  /* ------------------------------------------------- transfer round trip */
  const dump = await page.evaluate(() => localStorage.getItem('lunchsorted'));
  await openPane(page, 'account');
  await page.click('[data-act="import-open"]');
  await page.waitForTimeout(350);
  await page.fill('#impText', '{"hello":"world"}');
  await page.click('[data-act="import-do"]');
  await page.waitForTimeout(250);
  check('arbitrary JSON is refused', (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).length)) === 2);
  await page.fill('#impText', '{"foods":[],"settings":{},"week":{"days":[{}]}}');
  await page.click('[data-act="import-do"]');
  await page.waitForTimeout(250);
  check('a broken legacy save is refused with a message, not a crash', /not Lunch Sorted data/i.test(await page.textContent('#toast')) && errors.length === 0, errors);
  await page.fill('#impText', JSON.stringify({app:'fiveboxes', schema:2, account:JSON.parse(dump)}));   /* an export made under the previous name */
  await page.click('[data-act="import-do"]');           /* first tap arms */
  await page.waitForTimeout(200);
  await page.click('[data-act="import-do"]');           /* second applies */
  await page.waitForTimeout(400);
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.name));
  check('a real export imports back intact', imported.length === 2 && imported.includes('Sam'), imported);

  /* ---------------------------------------------------------- migration */
  await page.evaluate(v1 => {
    localStorage.clear();
    localStorage.setItem('lunchbox-tin-v1', JSON.stringify(v1));
  }, V1_SAVE);
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(500);
  const migrated = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    return {schema:d.schema, name:k.name, foods:k.foods.length, days:k.settings.days.join(','),
      weekDays:k.week ? k.week.days.length : 0,
      slotResolves: k.week ? !!k.foods.find(f => f.id === k.week.days[0].slots.main) : false,
      packed:Object.keys(k.packed).length, pantry:Object.keys(d.pantry).length,
      stamped: !!(k.createdAt && k.foods[0].updatedAt && k.foods[0].deletedAt === null)};
  });
  check('a v1 save migrates whole',
    migrated.schema === 2 && migrated.name === 'Nora' && migrated.foods === 4 &&
    migrated.days === '1,3,5' && migrated.weekDays === 1 && migrated.slotResolves &&
    migrated.packed === 1 && migrated.pantry === 1 && migrated.stamped, migrated);

  /* ----------------------------------------------------- did they eat it? */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0,0,0,0);
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    k.week.days[0].d = iso(y); k.week.days[0].dow = y.getDay();   /* pretend the first box was yesterday */
    const t = new Date(); t.setHours(0,0,0,0); const ws = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)); k.week.start = iso(ws);
    k.week.days.push(Object.assign(JSON.parse(JSON.stringify(k.week.days[0])), { d: iso(t), dow: t.getDay(), lock: {}, kidPick: {}, over: {} }));   /* and today's box, unlocked, so the week is still this week and Week shows yesterday as a day that has gone */
    if (k.settings.days.indexOf(t.getDay()) < 0) k.settings.days.push(t.getDay());   /* today is a pack day, or the day would be dropped as one the pack days no longer hold */
    const c = new Date(); c.setDate(c.getDate() - 3); k.week.createdAt = c.toISOString();   /* and that the plan existed then */
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(500);
  check("the morning after, it asks how the box went", (await page.$$eval('.review', a => a.length)) === 1);
  /* on Week that day has gone: one line, no lock, no shuffle, and a read-only sheet behind it */
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(300);
  check('a day that has gone offers no No lunch', (await page.$$eval('.daycard.past [data-act="no-lunch"]', a => a.length)) === 0 && (await page.$$eval('.daycard.past', a => a.length)) >= 1);
  check('a day that has gone has no lock and no shuffle, only its line, which says it is not answered yet', (await page.$$eval('.daycard.past [data-act="day-lock"], .daycard.past [data-act="shuffle-day"], .daycard.past .cmp', a => a.length)) === 0 && (await page.$$eval('.daycard.past [data-act="gone-open"]', a => a.length)) >= 1 && (await page.$eval('.daycard.past .gone-line .qty', e => e.textContent)) === 'not answered');
  check('and the page does not scroll sideways for it', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const goneLabel = await page.getAttribute('.daycard.past [data-act="gone-open"] >> nth=0', 'aria-label');
  await page.click('.daycard.past [data-act="gone-open"] >> nth=0'); await page.waitForTimeout(350);
  check('the line opens the box as it was packed, with nothing on the sheet that could change it', /box, as packed: /.test(goneLabel) && /What was packed stays\./.test(await page.textContent('#sheetBody')) && (await page.$$eval('#sheetBody [data-act]', a => a.length)) === 0 && (await page.$$eval('#sheetBody .item', a => a.length)) >= 1, goneLabel);
  await backdropTap(page); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  check('All eaten is the first thing on the card, one tap, and Skip waits at the foot saying what it does', await page.evaluate(() => {
    const c = document.querySelector('.review'), all = c.querySelector('[data-act="eat-all"]'), skip = c.querySelector('[data-act="eat-skip"]'), seg = c.querySelector('.seg');
    return !!(all && skip && seg) && all.classList.contains('primary') && !!(all.compareDocumentPosition(seg) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !!(seg.compareDocumentPosition(skip) & Node.DOCUMENT_POSITION_FOLLOWING) && /nothing counted/.test(skip.textContent) && all.getBoundingClientRect().height >= 44;
  }));
  const reviewedFood = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; return k.week.days[0].slots.main; });
  await page.click('.review .seg button[data-cat="main"][data-r="left"]');
  await page.waitForTimeout(200);
  check('a partial answer keeps the card open', (await page.$$eval('.review', a => a.length)) === 1);
  await page.click('[data-act="eat-all"]');
  await page.waitForTimeout(250);
  check('answering closes the card', (await page.$$eval('.review', a => a.length)) === 0);
  check('what was answered stays on screen with a way to change it',
    (await page.$$eval('[data-act="eat-change"]', a => a.length)) === 1 && /all eaten/i.test(await page.textContent('#view')));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(300);
  check('and the gone line on Week says so in three words', (await page.$eval('.daycard.past .gone-line .qty', e => e.textContent)) === 'all eaten' && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(500);
  check('and it is still there after the app is reopened', (await page.$$eval('[data-act="eat-change"]', a => a.length)) === 1);
  await page.click('[data-act="eat-change"]'); await page.waitForTimeout(200);
  check('Change re-opens the card', (await page.$$eval('.review', a => a.length)) === 1);
  await page.click('.review .seg button[data-cat="main"][data-r="left"]'); await page.waitForTimeout(150);
  for (const c of ['side','fruit','sweet']) { if (await page.$('.review .seg button[data-cat="'+c+'"]')) { await page.click('.review .seg button[data-cat="'+c+'"][data-r="ate"]'); await page.waitForTimeout(120); } }
  check('and answering again closes it', (await page.$$eval('.review', a => a.length)) === 0);
  const summaryText = await page.textContent('#view');
  check('the summary names the food that came home', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], f = k.foods.find(x => x.id === k.week.days[0].slots.main);
    return f && document.querySelector('#view').textContent.includes(f.n + ' came home'); }), summaryText.slice(0, 200));
  await page.click('[data-act="eat-change"]'); await page.waitForTimeout(200);
  check('each food has a fourth answer, Didn’t get to it, and the four still clear 44px', await page.evaluate(() => {
    const segs = [...document.querySelectorAll('.review .seg')];
    return segs.length > 0 && segs.every(s => s.querySelectorAll('button').length === 4 && /Didn’t get to it/.test(s.querySelector('[data-r="none"]').textContent)
      && [...s.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44));
  }));
  await page.click('.review .seg button[data-cat="main"][data-r="none"]'); await page.waitForTimeout(150);
  for (const c of ['side','fruit','sweet']) { if (await page.$('.review .seg button[data-cat="'+c+'"]')) { await page.click('.review .seg button[data-cat="'+c+'"][data-r="ate"]'); await page.waitForTimeout(120); } }
  check('Didn’t get to it closes the card like any answer, and the summary says so in words', (await page.$$eval('.review', a => a.length)) === 0 && /didn’t get to the/i.test(await page.textContent('#view')), (await page.textContent('#view')).match(/didn.t get to[^<]{0,40}/));
  check('and it is recorded as nothing to learn from, not as came home', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const row = Object.values(k.eaten || {})[0];
    return !!row && row.main.r === 'none' && row.main.foodId === k.week.days[0].slots.main;
  }));
  await page.click('[data-act="eat-change"]'); await page.waitForTimeout(200);
  await page.click('[data-act="eat-all"]'); await page.waitForTimeout(250);
  check('outcomes are stored against the food, with who and when', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    const rows = Object.values(k.eaten || {});
    return rows.length === 1 && Object.values(rows[0]).every(e => e.foodId && e.r === 'ate' && e.at && e.by);
  }));
  /* two "came home" in a row rests a food and says so */
  await page.evaluate(id => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    const iso = n => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(0,0,0,0);
      return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
    k.eaten = {}; k.eaten[iso(2)] = {main:{foodId:id, r:'left'}}; k.eaten[iso(4)] = {main:{foodId:id, r:'left'}};
    d.activeKidId = k.id;                                    /* shuffle THIS lunchbox below */
    for (let i = 0; i < 6; i++) k.foods.push({id:'test_main_'+i, kidId:k.id, n:'Test main '+i, c:'main',
      t:['protein','soft'], a:'deli', al:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null});
    localStorage.setItem('lunchsorted', JSON.stringify(d));    /* enough mains that resting one costs nothing */
  }, reviewedFood);
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(500);
  await page.click('[data-act="tab"][data-tab="foods"]');
  await page.waitForTimeout(250);
  check('a food that keeps coming home says so in plain words, with a date',
    /came home twice · on hold until [A-Z][a-z]{2} \d{1,2}/.test(await page.textContent('#view')) && !/resting|taking a break/.test(await page.textContent('#view')), (await page.textContent('#view')).match(/came home[^<]{0,60}/));
  let restedDrawn = 0;
  for (let i = 0; i < 5; i++) {
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
    await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(250); await goShuffle(page);
    restedDrawn += await page.evaluate(id => { const t = new Date(); t.setHours(0,0,0,0); const iso = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
      return JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.filter(x => x.d >= iso && x.slots.main === id).length; }, reviewedFood);   /* a day that has gone keeps what was packed */
  }
  check('the draw leaves a resting food out', restedDrawn === 0, restedDrawn);
  await page.evaluate(id => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    const iso = n => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(0,0,0,0);
      return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
    k.eaten[iso(2)] = {main:{foodId:id, r:'none'}}; k.eaten[iso(4)] = {main:{foodId:id, r:'none'}};
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  }, reviewedFood);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  check('two Didn’t get to it in a row is not two came home: the food is not put on hold', !/on hold until/.test(await page.textContent('#view')));
  await page.evaluate(id => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    const iso = n => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(0,0,0,0);
      return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
    k.eaten[iso(2)] = {main:{foodId:id, r:'left'}}; k.eaten[iso(4)] = {main:{foodId:id, r:'left'}};
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  }, reviewedFood);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
  let restedRedrawn = 0;
  for (let i = 0; i < 5; i++) {
    await page.click('.daycard:not(.past) [data-act="shuffle-day"] >> nth=0'); await page.waitForTimeout(200); await goShuffle(page);
    restedRedrawn += await page.evaluate(id => { const t = new Date(); t.setHours(0,0,0,0); const iso = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
      return JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.filter(x => x.d >= iso && x.slots.main === id).length; }, reviewedFood);
  }
  check('and so does a single re-draw', restedRedrawn === 0, restedRedrawn);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids[0].eaten = {}; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(400);

  /* ------------------------------------------------ friction: targets, sheet, words */
  const small = async () => page.$$eval('.btn.sm, .tg, .kidbtn, .seg button, .x, .cmp[data-act], nav.tabs button, .item[data-act], .card.fold, .iconbtn, .star', a =>
    a.filter(e => e.checkVisibility()).map(e => ({h: Math.round(e.getBoundingClientRect().height), t: e.textContent.trim().slice(0,20)})).filter(x => x.h < 44));
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(250);
  const smallSetup = await small();
  check('every tappable control on Account is at least 44px tall', smallSetup.length === 0, smallSetup);
  /* Subscription only exists where billing is switched on; the rest always are, in this
     order, and the first and fourth name what is behind them rather than a fixed word */
  check('Account is a short list of named rows, in order', await page.evaluate(() =>
    [...document.querySelectorAll('#view .item')].filter(e => e.dataset.act === 'pane' || e.dataset.act === 'help')
      .map(e => e.querySelector('.nm').textContent).filter(t => t !== 'Subscription').join('|') === 'This phone|Household|Lunchbox|Contact support'),
    await page.evaluate(() => [...document.querySelectorAll('#view .item .nm')].map(e => e.textContent)));
  await openPane(page, 'household');
  await page.click('[data-act="go-signin"]'); await page.waitForTimeout(400);
  check('Sign in on the Household page opens the sign-in card itself, with the email field ready', await page.evaluate(() => document.activeElement && document.activeElement.id === 'signinEmail') && !(await page.$('#paneTitle')));
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(250);
  check('signed out, the first row offers this phone rather than an account there is none of', await page.evaluate(() => {
    const r = document.querySelector('#view .item[data-pane="account"]');
    return !!r && r.querySelector('.nm').textContent === 'This phone' && /Backup/.test(r.querySelector('.meta').textContent);
  }));
  check('and every row clears 44px', await page.$$eval('#view .item', a => a.length >= 4 && a.every(e => e.getBoundingClientRect().height >= 44)));
  /* Subscription is absent without STRIPE_*, so it is swept in the billing run instead */
  for (const pane of ['account', 'household']) {
    await openPane(page, pane);
    const smallPane = await small();
    check('every tappable control on the ' + pane + ' page is at least 44px tall', smallPane.length === 0, smallPane);
    await page.click('[data-act="pane-done"]'); await page.waitForTimeout(200);
    check('Done on the ' + pane + ' page comes back to the rows', (await page.$$eval('#view .item[data-act="pane"]', a => a.length)) >= 3);
  }
  /* Contact support is the same door as the "?" in the corner */
  await page.click('.topbar [data-act="help"], #who [data-act="help"]'); await page.waitForTimeout(300);
  const helpOrder = () => page.evaluate(() => {
    const b = document.querySelector('#sheetBody'), q = b.querySelector('details'), m = b.querySelector('a[data-feedback]');
    return { questions: [...b.querySelectorAll('details summary')].map(e => e.textContent).join('|'), mailFirst: !!(q && m) && !!(m.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING),
      asQuestion: q ? [getComputedStyle(q.querySelector('summary')).textTransform, Math.round(parseFloat(getComputedStyle(q.querySelector('summary')).fontSize))] : null };
  });
  const fromCorner = await helpOrder();
  check('the help sheet\'s questions render as questions, not as section labels', !!fromCorner.asQuestion && fromCorner.asQuestion[0] === 'none' && fromCorner.asQuestion[1] === 15, fromCorner.asQuestion);
  check('and from the ? the answers come first, the mail buttons under them', !fromCorner.mailFirst && /Something is wrong/.test(await page.textContent('#sheetBody')));
  check('and no answer says draw, resting or kept', !/\b(?:re)?draws?\b|\bdrawn\b|\bresting\b|\brest(?:s|ed)\b|\bkept\b(?!\s+(?:\w+\s+)?out\b|\s+(?:on|there|for)\b)/i.test(await page.textContent('#sheetBody')), (await page.textContent('#sheetBody')).match(/[^.]*\b((?:re)?draws?|drawn|resting|rest(?:s|ed)|kept)\b[^.]*/i));
  await sheetDone(page); await page.waitForTimeout(250);
  await page.click('#view .item[data-act="help"]'); await page.waitForTimeout(300);
  const fromSupport = await helpOrder();
  check('Contact support opens the same help sheet as the "?" in the corner', fromSupport.questions === fromCorner.questions && /Something is wrong/.test(await page.textContent('#sheetBody')));
  check('and there the two mail buttons come first, above the answers', fromSupport.mailFirst);
  await sheetDone(page); await page.waitForTimeout(250);
  /* Lunchboxes is the settings, reached without leaving Account */
  await openPane(page, 'box');
  check('Account \u2192 Lunchboxes opens the lunchbox settings and leaves the bottom bar on Account', await page.evaluate(() =>
    /School rules/.test(document.querySelector('#view').textContent) &&
    document.querySelector('nav.tabs [data-tab="setup"]').getAttribute('aria-current') === 'true'));
  await page.click('[data-act="box-done"]'); await page.waitForTimeout(250);
  check('and Done comes back to the Account rows, not to Week', (await page.$$eval('#view .item[data-act="pane"]', a => a.length)) >= 3);
  await openPane(page, 'box');   /* the one pane a bottom tab has to clear from under a lunchbox tab */
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  check('tapping a bottom tab closes an open page there and then', await page.evaluate(() =>
    !/School rules/.test(document.querySelector('#view').textContent) && !document.querySelector('[data-act="box-done"]')));
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(250);
  check('and the tab it lands on is the one that was tapped, with its rows back', (await page.$$eval('#view .item[data-act="pane"]', a => a.length)) >= 3);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await openGear(page); await page.waitForTimeout(250);
  check('the day-of-week chips are named in full for a screen reader', (await page.$$eval('.dow .tg[aria-label]', a => a.length)) === 7);
  const smallBox = await small();
  check('and on the lunchbox settings', smallBox.length === 0, smallBox);
  await page.click('[data-act="box-done"]'); await page.waitForTimeout(150);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  const smallFoods = await small();
  check('and on Foods', smallFoods.length === 0, smallFoods);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  const smallWeek = await small();
  check('and on Week', smallWeek.length === 0, smallWeek);
  await page.click('.cmp[data-act="slot"] >> nth=0'); await page.waitForTimeout(350);
  const sheetOpen = await page.evaluate(() => ({vis: getComputedStyle(document.getElementById('sheet')).visibility,
    lock: document.body.style.overflow, keep: (() => { const b = document.querySelector('#sheet [data-act="sheet-lock"]'); return !!b && /^Lock /.test(b.getAttribute('aria-label') || '') && b.getBoundingClientRect().width >= 44; })()}));
  check('opening a compartment sheet locks the page behind it and carries the lock, 44px and named for a screen reader',
    sheetOpen.vis === 'visible' && sheetOpen.lock === 'hidden' && sheetOpen.keep, sheetOpen);
  await backdropTap(page); await page.waitForTimeout(350);
  const sheetShut = await page.evaluate(() => ({vis: getComputedStyle(document.getElementById('sheet')).visibility, lock: document.body.style.overflow}));
  check('closing it unlocks the page and hides the sheet from focus', sheetShut.vis === 'hidden' && sheetShut.lock === '', sheetShut);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  await page.click('[data-act="add-own"]'); await page.waitForTimeout(350);
  const tagWords = await page.$$eval('#nfTags .tg', a => a.filter(e => e.checkVisibility()).map(e => e.textContent.trim()));   /* a closed <details> hides by content-visibility, so offsetParent is not enough */
  check('food tags are written for a parent, with the long tail folded away',
    tagWords.includes('Has protein') && tagWords.includes('Needs an ice pack') && tagWords.length <= 6 && (await page.$$eval('details.more', a => a.length)) === 1, tagWords);
  await page.fill('#nfName', 'Test seaweed snack');
  await page.click('[data-nf="tag"][data-v="crunchy"]');
  await page.click('details.more summary'); await page.waitForTimeout(150);
  await page.click('[data-nf="tag"][data-v="salty"]');
  await page.click('[data-act="save-own"]'); await page.waitForTimeout(300);
  const savedTags = await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    const f = k.foods.filter(x => x.n === 'Test seaweed snack').pop(); return f ? f.t : null; });
  check('a tag chosen under More is saved with the food', Array.isArray(savedTags) && savedTags.includes('salty') && savedTags.includes('crunchy'), savedTags);

  /* --------------------------------------------- optional slots and richer rules */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0], ts = new Date().toISOString();
    const mk = (id, n, c, tags) => ({id, kidId:k.id, n, c, t:tags, a:'other', al:[], createdAt:ts, updatedAt:ts, deletedAt:null});
    k.foods.push(mk('t_choc', 'Chocolate buttons', 'sweet', ['sweet']));
    k.foods.push(mk('t_ice',  'Test cold main', 'main', ['protein','soft','ice']));
    k.foods.push(mk('t_messy','Test messy side', 'side', ['messy']));
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await openGear(page); await page.waitForTimeout(200);
  check('seeds & sesame is a keep-out option', (await page.$$eval('[data-act="allergen"][data-k="seeds"]', a => a.length)) === 1);
  await page.click('[data-act="compartment"][data-k="snack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="compartment"][data-k="drink"]'); await page.waitForTimeout(250);
  const slotState = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return {on: !!(k.settings.slots && k.settings.slots.snack && k.settings.slots.drink),
      snacks: k.foods.filter(f => f.c==='snack' && !f.deletedAt).length,
      drinks: k.foods.filter(f => f.c==='drink' && !f.deletedAt).length,
      filled: (() => { const t = new Date(); t.setHours(0,0,0,0); const iso = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); return k.week.days.filter(dy => dy.d >= iso).every(dy => dy.slots.snack && dy.slots.drink); })()};
  });
  check('switching a compartment on seeds it and fills this week', slotState.on && slotState.snacks > 0 && slotState.drinks > 0 && slotState.filled, slotState);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  const perTin = await page.$$eval('.tin', tins => tins.map(t => t.querySelectorAll('.cmp').length));
  check('the tin grows to six compartments', perTin.length > 0 && perTin.every(n => n === 6), perTin);
  await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
  check('drinks land on the shopping list under their own aisle', (await page.textContent('#view')).toLowerCase().includes('drinks'));
  await openGear(page); await page.waitForTimeout(200);
  await page.click('[data-act="kidpick-on"]'); await page.waitForTimeout(200);          /* this lunchbox's kid gets a say too, the whole box at a time */
  await page.click('[data-act="kidpick-mode"][data-v="boxes"]'); await page.waitForTimeout(200);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="kid-start"] >> nth=-1'); await page.waitForTimeout(250);
  check("whole-box picking offers two boxes, each with all six compartments", (await page.$$eval('.kidmode .pickbox', a => a.length)) === 2 && (await page.$$eval('.kidmode .pickbox >> nth=0 >> .mini .cmp', a => a.length)) === 6);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  await openGear(page); await page.waitForTimeout(200);
  await page.click('[data-act="rule"][data-k="noChoc"]');
  await page.click('[data-act="rule"][data-k="noIce"]');
  await page.click('[data-act="rule"][data-k="shortWindow"]');
  await page.waitForTimeout(250);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  const foodsText = await page.textContent('#view');
  check('"no chocolate or candy" flags chocolate', foodsText.includes('chocolate or candy'));
  check('"no ice pack" flags foods that must stay cold', foodsText.includes('needs an ice pack'));
  check('"short eating time" flags fiddly foods', foodsText.includes('fiddly for a short lunch'));
  const excluded = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return ['t_choc','t_ice','t_messy'].some(id => k.week.days.some(dy => Object.values(dy.slots).includes(id)));
  });
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300); await goShuffle(page);
  const excludedAfter = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return ['t_choc','t_ice','t_messy'].some(id => k.week.days.some(dy => Object.values(dy.slots).includes(id)));
  });
  check('a re-draw keeps every rule-breaking food out of the box', !excludedAfter, excludedAfter);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    k.settings.noChoc = k.settings.noIce = k.settings.shortWindow = false;
    k.foods = k.foods.filter(f => !/^t_/.test(f.id));
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* ------------------------------------------- correctness: rules, compartments, picks */
  const isoOff = n => { const x = new Date(); x.setDate(x.getDate()+n); x.setHours(0,0,0,0);
    return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };

  /* a rule tightened after the draw clears even a locked compartment */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0], ts = new Date().toISOString();
    k.foods.push({id:'t_dairy', kidId:k.id, n:'Test cheese stick', c:'side', t:['protein','soft'], a:'dairy', al:['dairy'], createdAt:ts, updatedAt:ts, deletedAt:null});
    k.settings.avoidAllergens = ['nuts'];
    const tt = new Date(); tt.setHours(0,0,0,0); const tiso = tt.getFullYear()+'-'+String(tt.getMonth()+1).padStart(2,'0')+'-'+String(tt.getDate()).padStart(2,'0');
    const live = k.week.days.find(x => x.d >= tiso) || k.week.days[0];   /* a day still ahead: one that has gone is never rewritten */
    live.slots.side = 't_dairy'; live.lock.side = true;
    d.activeKidId = k.id;
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await openGear(page); await page.waitForTimeout(200);
  await page.click('[data-act="allergen"][data-k="dairy"]'); await page.waitForTimeout(300);
  const afterRule = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const t = new Date(); t.setHours(0,0,0,0); const iso = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
    const live = k.week.days.find(x => x.d >= iso) || k.week.days[0];
    return {side: live.slots.side, locked: live.lock.side};
  });
  check('a rule change clears a locked compartment that now breaks it and draws again',
    afterRule.side !== 't_dairy' && afterRule.side !== null && !afterRule.locked, afterRule);
  check('and says so', (await page.textContent('#toast')).includes('rules'));
  await page.click('[data-act="allergen"][data-k="dairy"]'); await page.waitForTimeout(200);

  /* a word typed into the avoid list sweeps the plan, and the sweep is saved */
  const avoidTarget = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return k.foods.find(f => f.id === day.slots.side).n; });
  await page.fill('#avoidText', avoidTarget);
  await page.locator('#avoidText').blur(); await page.waitForTimeout(300);   /* change fires on blur, as it does for a person */
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  check('a food typed into the avoid list is out of the week after a reload', await page.evaluate(name => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    const t = new Date(); t.setHours(0,0,0,0); const iso = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
    return k.settings.avoidText === name && !k.week.days.some(d => { if (d.d < iso) return false; const f = k.foods.find(x => x.id === d.slots.side); return f && f.n === name; }); }, avoidTarget), avoidTarget);   /* a day that has gone keeps what was packed */
  /* the avoid list matches whole words: "ham" keeps ham out and lets graham crackers in */
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0], t = new Date().toISOString();
    ['Graham crackers|side', 'Ham & cheese sandwich|main', 'Peaches|fruit', 'Sugar snap peas|side', 'Goldfish crackers|side'].forEach(x => { const [n, c] = x.split('|'); if (!k.foods.some(f => f.n === n && !f.deletedAt)) k.foods.push({id:'test_'+n.replace(/\W+/g, '_').toLowerCase(), kidId:k.id, n, c, t:[], a:'snacks', al:[], createdAt:t, updatedAt:t, deletedAt:null}); });
    k.settings.avoidText = 'ham, pea'; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(300);
  const avoidRows = await page.$$eval('#view .item', a => Object.fromEntries(a.map(e => [ (e.querySelector('.nm') || {}).textContent || '', /on your avoid list/.test(e.textContent) ]).filter(x => x[0])));
  check('"ham" and "pea" on the avoid list keep out ham and peas, whole words, and let graham crackers and peaches through',
    avoidRows['Ham & cheese sandwich'] === true && avoidRows['Sugar snap peas'] === true && avoidRows['Graham crackers'] === false && avoidRows['Peaches'] === false, avoidRows);
  /* a bank food a household still carries under its old name is the bank's food: ticked in the idea bank, not "one of your own" */
  await page.click('[data-act="ideas"]'); await page.waitForTimeout(400);
  check('a food kept under the bank\'s old name is ticked in the idea bank under its new one', await page.$eval('[data-act="add-idea"][data-name="Cheddar fish crackers"]', b => b.getAttribute('aria-pressed') === 'true' && b.classList.contains('ticked')));
  await page.click('[data-act="add-idea"][data-name="Cheddar fish crackers"]'); await page.waitForTimeout(300);   /* the first tap arms, the second takes it off */
  await page.click('[data-act="add-idea"][data-name="Cheddar fish crackers"]'); await page.waitForTimeout(300);
  check('and un-ticking it takes the old-named food off, since it is the same food', await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; const f = k.foods.find(x => x.n === 'Goldfish crackers'); return !!f && !!f.deletedAt; }) && (await page.$eval('[data-act="add-idea"][data-name="Cheddar fish crackers"]', b => b.getAttribute('aria-pressed') === 'false')));
  await page.click('#sheetClose'); await page.waitForTimeout(300);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0]; k.foods = k.foods.filter(f => !/^test_/.test(f.id)); k.settings.avoidText = ''; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await openGear(page); await page.waitForTimeout(200);

  /* switching a compartment off takes it out of the week and off the list */
  if ((await page.getAttribute('[data-act="compartment"][data-k="drink"]', 'aria-pressed')) !== 'true') {
    await page.click('[data-act="compartment"][data-k="drink"]'); await page.waitForTimeout(250); }   /* on */
  await page.click('[data-act="compartment"][data-k="drink"]'); await page.waitForTimeout(250);       /* off */
  const ghost = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return k.week.days.some(dy => dy.slots.drink);
  });
  check('switching a compartment off clears it from this week', !ghost);
  await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
  const drinkNames = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.filter(f => f.c === 'drink').map(f => f.n));
  const shopText = await page.textContent('#view');
  check('and no drink is left on the shopping list', drinkNames.length > 0 && !drinkNames.some(n => shopText.includes(n)), drinkNames);

  /* the kid picks again, part by part this time: the mark is fresh, and stopping early keeps the one choice made */
  await openGear(page); await page.waitForTimeout(200);
  await page.click('[data-act="kidpick-mode"][data-v="parts"]'); await page.waitForTimeout(200);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="kid-start"]'); await page.waitForTimeout(250);
  await page.click('.kidmode .pick >> nth=1'); await page.waitForTimeout(200);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);          /* stopping early keeps the one choice made */
  const kidKept = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    const day = k.week.days.find(x => x.kidPick && Object.keys(x.kidPick).length) || k.week.days[0];
    return {locked: day.lock.main, picker: day.kidPick && day.kidPick.main && day.kidPick.main.picker,
      by: d.members.some(m => m.id === (day.kidPick && day.kidPick.main && day.kidPick.main.by))};
  });
  check('a choice the kid already made survives Stop, locked and attributed', kidKept.locked && kidKept.picker === 'kid' && kidKept.by, kidKept);
  check('and only that day carries a mark', await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0]; return k.week.days.filter(x => x.kidPick && Object.keys(x.kidPick).length).length === 1; }));

  /* a manual swap clears the "picked" mark */
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  await page.click('.daycard:not(.past) .tin .cmp[data-cat="main"] >> nth=0'); await page.waitForTimeout(350);
  /* the food in the compartment is the one going in the box, so it is never ruled through */
  const inSlotRow = await page.$$eval('#sheetBody [data-act="pick"].ticked', a => a.map(b => ({
    line: getComputedStyle(b.querySelector('.nm')).textDecorationLine,
    said: (b.querySelector('.sr-only') || {}).textContent || '' })));
  check('the swap sheet marks the food in the box without ruling it through', inSlotRow.length === 1
    && !inSlotRow[0].line.includes('line-through') && inSlotRow[0].said === 'In the box', inSlotRow);
  await page.click('#sheetBody .item:not(.ticked) >> nth=0'); await page.waitForTimeout(300);
  const starGone = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return !day.kidPick || !day.kidPick.main;
  });
  check('a manual swap clears the kid-picked mark', starGone);

  /* "Re-draw this one" on a kept compartment un-keeps it */
  await page.click('.daycard:not(.past) .tin .cmp[data-cat="side"] >> nth=0'); await page.waitForTimeout(350);
  if ((await page.getAttribute('[data-act="sheet-lock"]', 'aria-pressed')) !== 'true') { await page.click('[data-act="sheet-lock"]'); await page.waitForTimeout(200); }
  await page.click('[data-act="sheet-shuffle"]'); await page.waitForTimeout(350);
  check('re-drawing a kept compartment on purpose clears the keep', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return day.lock.side === false && !!day.slots.side; }));
  check('and says so, in the word a parent sees', /unlocked/i.test(await page.textContent('#toast')) && !/kept/i.test(await page.textContent('#toast')), await page.textContent('#toast'));
  await backdropTap(page); await page.waitForTimeout(300);

  /* an in-place re-draw leaves the days already gone exactly as they were */
  const pastKept = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const t = new Date(); t.setHours(0,0,0,0);
    const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    k.settings.days = [1,2,3,4,5,6,0];               /* seven pack days, so the week is still live on a weekend */
    const pick = c => k.foods.filter(f => f.c === c && !f.deletedAt).map(f => f.id);
    k.week = {id:'week_test', kidId:k.id, start:iso(mon), createdAt:new Date(mon).toISOString(), updatedAt:new Date().toISOString(), days:[]};
    for (let i = 0; i < 7; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i);
      const slots = {}, lock = {}; ['main','side','fruit','sweet'].forEach(c => { slots[c] = pick(c)[i % pick(c).length] || null; lock[c] = false; });
      k.week.days.push({d:iso(x), dow:(i+1)%7, slots, lock, kidPick:{}}); }
    localStorage.setItem('lunchsorted', JSON.stringify(d));
    const filled = o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v)));
    return k.week.days.filter(x => x.d < iso(t)).map(x => filled(x.slots));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300); await goShuffle(page);
  const pastAfter = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const filled = o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v)));
    return {slots: k.week.days.filter(x => x.d < iso(t)).map(x => filled(x.slots)), n: k.week.days.length};
  });
  check('a re-draw in place keeps the days already gone exactly as they were (vacuous on a Monday)',
    pastAfter.n === 7 && JSON.stringify(pastAfter.slots) === JSON.stringify(pastKept), {before: pastKept, after: pastAfter});
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids[0].settings.days = [1,2,3,4,5]; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  check('and offers no Shuffle on a day that has gone', (await page.$$eval('.daycard.past [data-act="shuffle-day"]', a => a.length)) === 0);

  /* the pack view names the last day of a plan that has gone by */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    k.week.days.forEach((dy, i) => { const x = new Date(); x.setDate(x.getDate() - 14 + i); x.setHours(0,0,0,0);
      dy.d = x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); });
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  const gone = await page.evaluate(() => ({ sub: (t => (t.previousElementSibling || t.parentElement.previousElementSibling).textContent)(document.querySelector('.view-title')),   /* the header, not the review card; the title sits in a row with No lunch */
    last: JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.map(x => x.d).sort().pop(),
    all: JSON.parse(localStorage.getItem('lunchsorted')).kids.map(k => (k.deletedAt ? 'x' : '') + (k.week ? k.week.days.map(x => x.d).join(' ') : '-')) }));
  check('"Already packed" shows the last day of the old plan', gone.sub.includes('Already packed') &&
    gone.sub.includes(String(parseInt(gone.last.slice(8), 10))), gone);
  /* and the review does not ask about a box planned after the fact */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    k.eaten = {}; k.packed = {}; k.past = []; k.week.createdAt = new Date().toISOString();   /* nothing archived: only this plan */
    const y = new Date(); y.setDate(y.getDate()-1); y.setHours(0,0,0,0);
    k.week.days[k.week.days.length-1].d = y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0');
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  check('the review never asks about a box that was planned after the day', (await page.$$eval('.review', a => a.length)) === 0);

  /* a fresh plan started mid-week only covers days still ahead */
  await openPane(page, 'account');
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(250);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(350); await goShuffle(page);
  check('a brand-new plan never includes days that have already happened', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const today = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
    return k.week.days.length > 0 && k.week.days.every(dy => dy.d >= today);
  }));

  /* a lunchbox with no foods is announced, and the title counts what is on screen */
  await openGear(page); await page.waitForTimeout(200);
  await page.click('[data-act="add-kid"]'); await page.waitForTimeout(350);
  await page.fill('#nkName', 'Nobody'); await page.click('[data-act="save-kid"]'); await page.waitForTimeout(350);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  const packText = await page.textContent('#view');
  check('a lunchbox with no foods is announced on the pack view', packText.includes('Nobody has no foods yet'));
  check('the title counts the boxes actually shown', !(await page.textContent('h2.view-title')).endsWith('boxes'));
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted'));
    d.kids = d.kids.filter(k => k.name !== 'Nobody'); d.activeKidId = d.kids[0].id; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* -------------------------------------------------- safety: bad data can't brick it */
  const goodDoc = await page.evaluate(() => localStorage.getItem('lunchsorted'));
  const brickers = {
    'a lunchbox with no foods':      d => { delete d.kids[0].foods; },
    'a lunchbox with no settings':   d => { delete d.kids[0].settings; },
    'a week whose days are not a list': d => { d.kids[0].week.days = {}; },
    'a null lunchbox in the list':   d => { d.kids.push(null); },
    'a lunchbox with no packed map': d => { delete d.kids[0].packed; }
  };
  for (const [name, mutate] of Object.entries(brickers)) {
    await page.evaluate(([raw, fnSrc]) => {
      const d = JSON.parse(raw); (new Function('d', fnSrc))(d);
      localStorage.setItem('lunchsorted', JSON.stringify(d));
    }, [goodDoc, mutate.toString().replace(/^[^{]*\{|\}$/g, '')]);
    await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
    const alive = await page.evaluate(() => !!document.querySelector('nav.tabs') && document.querySelectorAll('#view *').length > 5);
    check('storage with '+name+' still opens', alive);
  }
  await page.evaluate(raw => localStorage.setItem('lunchsorted', raw), goodDoc);

  /* an unreadable save is kept, not overwritten */
  await page.evaluate(() => localStorage.setItem('lunchsorted', '{"schema":2,"kids":[{"name":"Precious"'));
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  const kept = await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('lunchsorted-backup-') && localStorage.getItem(k).includes('Precious')));
  check('an unreadable save is backed up before anything is written', kept);
  check('and the app says so', (await page.textContent('#view')).includes('could not be read'));
  await page.evaluate(() => { Object.keys(localStorage).filter(k => k.startsWith('lunchsorted-backup-')).forEach(k => localStorage.removeItem(k)); });
  await page.evaluate(raw => localStorage.setItem('lunchsorted', raw), goodDoc);

  /* hostile ids are neutralised at the boundary */
  await page.evaluate(raw => {
    const d = JSON.parse(raw);
    d.kids[0].id = 'kid_"><img src=x onerror="window.__pwned=1">';
    d.kids[0].foods.forEach(f => f.kidId = d.kids[0].id);
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  }, goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  check('a hostile id in stored data cannot inject markup', await page.evaluate(() => !window.__pwned && !document.querySelector('img[src="x"]')));
  await page.evaluate(raw => localStorage.setItem('lunchsorted', raw), goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* a food called Constructor is just a food */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0], ts = new Date().toISOString();
    k.foods.push({id:'t_ctor', kidId:k.id, n:'Constructor', c:'side', t:['crunchy'], a:'snacks', al:[], createdAt:ts, updatedAt:ts, deletedAt:null});
    k.week.days[0].slots.side = 't_ctor';
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
  check('a food named "Constructor" does not crash the shopping list', (await page.textContent('#view')).includes('Constructor'));

  /* destructive actions */
  await page.click('.list .item [data-act="have"]'); await page.waitForTimeout(150);            /* tick one pantry row */
  await openPane(page, 'account');
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(200);
  check('"Clear the plans" needs a second tap', (await page.textContent('[data-act="clear-week"]')).includes('again'));
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(250);
  const afterClear = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return {week: d.kids[0].week, pantry: Object.keys(d.pantry).length}; });
  check('clearing the plans leaves the shopping ticks alone', afterClear.week === null && afterClear.pantry >= 1, afterClear);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300); await goShuffle(page);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(200);
  const firstFood = await page.textContent('.list .item .nm');
  await page.click('[data-act="del-food"]'); await page.waitForTimeout(200);
  await tapUndoOn(page, 'deleting a food offers Undo'); await page.waitForTimeout(250);
  check('Undo puts the food back', (await page.textContent('#view')).includes(firstFood.trim()));

  /* A week already drawn is a plan the parent made and may be shopping for tonight.
     Taking a food off the list is a decision about the weeks after it, so the boxes
     that already hold the food keep it, marked, until they are redrawn — rather than
     going blank on a parent who will not remember why they are looking at an empty box. */
  const inBox = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    const t = new Date(); t.setHours(0,0,0,0);
    const today = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
    /* strictly ahead, so crossing 3pm mid-run cannot turn it into a day that has gone */
    const day = k.week.days.find(x => x.d > today && Object.keys(x.slots).some(c => x.slots[c]));
    const cat = Object.keys(day.slots).find(c => day.slots[c]);
    const id = day.slots[cat];
    return {day:day.d, cat, id, name:k.foods.find(f => f.id === id).n};
  });
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  await page.click('[data-act="del-food"][data-id="' + inBox.id + '"]'); await page.waitForTimeout(350);
  const afterOff = await page.evaluate(g => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    const day = k.week.days.find(x => x.d === g.day);
    return {slot:day.slots[g.cat], onList:k.foods.some(f => f.id === g.id && !f.deletedAt)};
  }, inBox);
  check('taking a food off the list leaves the boxes already drawn holding it',
    afterOff.slot === inBox.id && afterOff.onList === false, [inBox.name, afterOff]);

  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(350);
  const weekText = await page.textContent('#view');
  check('and that compartment still names the food, marked off the list, rather than going blank',
    weekText.includes(inBox.name) && /off the list/.test(weekText), inBox.name);

  /* and it is off the list for every draw from here on */
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  check('while the food is gone from the food list itself',
    !(await page.$('[data-act="del-food"][data-id="' + inBox.id + '"]')));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(350); await goShuffle(page);
  check('and a redraw replaces it, which is when the box lets it go',
    await page.evaluate(g => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
      return !k.week.days.some(day => Object.keys(day.slots).some(c => day.slots[c] === g.id));
    }, inBox), inBox.name);

  /* "A day that has gone is never rewritten" — taking a food off the list is no exception.
     Nothing covered this on either route out, which is how both of them came to clear a
     Monday that had already been eaten. A day is pushed onto the week behind yesterday's
     date, holding the same food a day still ahead holds. */
  const goneSetup = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    const ahead = k.week.days.find(x => Object.keys(x.slots).some(c => x.slots[c]));
    const cat = Object.keys(ahead.slots).find(c => ahead.slots[c]), id = ahead.slots[cat];
    const t = new Date(); t.setDate(t.getDate() - 1);
    const past = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
    const slots = {}; Object.keys(ahead.slots).forEach(c => slots[c] = null); slots[cat] = id;
    const lock = {}; Object.keys(ahead.lock).forEach(c => lock[c] = false); lock[cat] = true;
    k.week.days.unshift({d: past, dow: ((t.getDay()+6)%7)+1, slots, lock, kidPick:{}, over:{}});
    localStorage.setItem('lunchsorted', JSON.stringify(d));
    return {past, cat, id, name: k.foods.find(f => f.id === id).n};
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(500);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  await page.click('[data-act="del-food"][data-id="' + goneSetup.id + '"]'); await page.waitForTimeout(300);
  const afterDel = await page.evaluate(g => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    const gone = k.week.days.find(x => x.d === g.past);
    return {goneSlot: gone && gone.slots[g.cat], goneLock: gone && gone.lock[g.cat],
      aheadStillHolds: k.week.days.some(x => x.d > g.past && x.slots[g.cat] === g.id),
      tombstoned: k.foods.some(f => f.id === g.id && !!f.deletedAt)};
  }, goneSetup);
  check('removing a food leaves a day that has gone exactly as it was packed',
    afterDel.goneSlot === goneSetup.id && afterDel.goneLock === true, afterDel);
  check('while the food itself goes, and the days still ahead keep it until they are redrawn',
    afterDel.tombstoned && afterDel.aheadStillHolds, afterDel);
  await tapUndoOn(page, 'and that delete is still offering Undo'); await page.waitForTimeout(250);

  /* The same rule from the other side, with the better fixture: their block pushed the
     clock past three rather than injecting a past-dated day, which is the other half of
     what dayGone() means. Under the rule Liz confirmed no day loses the food at all, so
     a day that has gone is the strongest case rather than the only one. Signed out here
     on purpose: moving the clock makes these records newer than everything stamped after
     them, which would tilt any merge that followed. */
  {
    const todaySlot = await page.evaluate(t => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0];
      const d = (k.week ? k.week.days : []).find(y => y.d === t);
      if (!d) return null;
      const c = Object.keys(d.slots).find(x => d.slots[x]);
      return c ? { id: d.slots[c], day: d.d, cat: c } : null;
    }, pinnedDay);
    check('today is in the planned week, with a compartment filled', !!todaySlot, { pinnedDay, todaySlot });
    if (todaySlot) {
      await page.evaluate(() => window.__pinHour(16));          /* the box is home */
      await page.click(`[data-act="del-food"][data-id="${todaySlot.id}"]`); await page.waitForTimeout(400);
      const kept = await page.evaluate(g => {
        const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0];
        const d = (k.week ? k.week.days : []).find(y => y.d === g.day);
        return { slot: !!(d && d.slots[g.cat] === g.id), off: !k.foods.some(f => f.id === g.id && !f.deletedAt) };
      }, todaySlot);
      check('a day that has gone keeps exactly what was packed, the food being off the list notwithstanding', kept.slot, { ...todaySlot, ...kept });
      check('and it still comes off the list', kept.off, kept);
      if ((await page.$$eval('#toast.show [data-act="undo"]', a => a.length)) === 1) { await page.click('#toast.show [data-act="undo"]'); await page.waitForTimeout(400); }
      await page.evaluate(() => window.__pinHour(9));

      /* the Undo behind a write-in keeps the same rule: offered before three, it refuses
         after, and the compartment keeps the words rather than being rewritten */
      await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
      await page.click(`[data-act="slot"][data-day="${todaySlot.day}"][data-cat="${todaySlot.cat}"]`); await page.waitForTimeout(300);
      await page.click('[data-act="write-in"]'); await until(page, () => !!document.getElementById('wiName'));
      await page.fill('#wiName', 'Leftover rice'); await page.click('[data-act="write-save"]'); await page.waitForTimeout(350);
      check('writing into today before three offers Undo', (await page.$$eval('#toast.show [data-act="undo"]', a => a.length)) === 1);
      await page.evaluate(() => window.__pinHour(16));          /* the box is home */
      if ((await page.$$eval('#toast.show [data-act="undo"]', a => a.length)) === 1) { await page.click('#toast.show [data-act="undo"]'); await page.waitForTimeout(300); }
      const late = await page.evaluate(g => {
        const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0];
        const d = (k.week ? k.week.days : []).find(y => y.d === g.day), f = d && k.foods.find(y => y.id === d.slots[g.cat]);
        return { n: f && f.n, once: !!(f && f.once), live: !!(f && !f.deletedAt), toast: document.getElementById('toast').textContent };
      }, todaySlot);
      check('and tapped after three it leaves the day as it was packed, and says so', /That day has gone/.test(late.toast) && late.n === 'Leftover rice' && late.once && late.live, late);
      await page.evaluate(() => window.__pinHour(9));
    }
  }

  /* erase really erases, old names included */
  await page.evaluate(() => { localStorage.setItem('lunchbox-tin', localStorage.getItem('lunchsorted')); localStorage.setItem('lunchbox-tin-v1', '{"foods":[],"settings":{}}'); localStorage.setItem('fiveboxes-backup-1', '{"old":1}'); localStorage.setItem('lunchsorted-backup-2', '{"old":2}'); });
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
  {
    await page.click('#view .item[data-act="help"]'); await page.waitForTimeout(300);
    const href = await page.getAttribute('#sheetBody [data-feedback]', 'href');
    const body = decodeURIComponent((href.split('body=')[1] || ''));
    check('Contact support opens the help sheet, whose bug report carries the build, the phone and the household shape, and never a food name',
      /^mailto:hello@lunchsorted\.app\?subject=/.test(href) && /Build: lunchsorted-v\d+ \(web\)/.test(body) && /Phone: Mozilla/.test(body) && /Lunchboxes: \d+ · foods: \d+/.test(body) && /What happened:/.test(body) && !/grape|banana|cracker|yogurt/i.test(body.replace(/^Phone:.*$/m, '')), body.slice(0, 300));
  }
  await sheetDone(page); await page.waitForTimeout(250);
  await openPane(page, 'account');
  await page.click('[data-act="clear-all"]'); await page.waitForTimeout(150);
  await page.click('[data-act="clear-all"]'); await page.waitForTimeout(300);
  check('"Erase everything" also removes the copies saved under the old name, and the backups',
    await page.evaluate(() => !localStorage.getItem('lunchbox-tin') && !localStorage.getItem('lunchbox-tin-v1') && !Object.keys(localStorage).some(k => k.startsWith('lunchsorted-backup-') || k.startsWith('fiveboxes-backup-'))));
  await page.evaluate(raw => localStorage.setItem('lunchsorted', raw), goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* pruning keeps the document bounded */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0];
    k.packed['2020-01-06'] = {main:{at:'2020-01-06T08:00:00Z', by:null}};
    k.eaten['2020-01-06'] = {main:{foodId:k.foods[0].id, r:'ate', at:'2020-01-06T15:00:00Z', by:null}};
    /* one of the bank's, and one the parent wrote: only the first is the app's to sweep */
    k.foods.push({id:'t_old', kidId:k.id, n:'Turkey & cheese roll-ups', c:'main', t:[], a:'deli', al:[], createdAt:'2020-01-01T00:00:00Z', updatedAt:'2020-01-01T00:00:00Z', deletedAt:'2020-01-02T00:00:00Z'});
    k.foods.push({id:'t_mine', kidId:k.id, n:'Grandma\u2019s zucchini muffins', c:'side', t:[], a:'other', al:[], createdAt:'2020-01-01T00:00:00Z', updatedAt:'2020-01-01T00:00:00Z', deletedAt:'2020-01-02T00:00:00Z'});
    /* a write-in is one day's leftovers, not a food the parent would ever look for again */
    k.foods.push({id:'t_once', kidId:k.id, n:'Leftover shepherd\u2019s pie', c:'main', t:[], a:'other', al:[], once:true, createdAt:'2020-01-01T00:00:00Z', updatedAt:'2020-01-01T00:00:00Z', deletedAt:'2020-01-02T00:00:00Z'});
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300); await goShuffle(page);
  check('a re-plan prunes ancient ticks, outcomes and the bank\u2019s tombstones', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return !k.packed['2020-01-06'] && !k.eaten['2020-01-06'] && !k.foods.some(f => f.id === 't_old');
  }));
  /* a food in the parent's own words cannot be tapped back out of the bank, so it is
     not the sweep's to take: it waits in Taken off until they put it back or replace it */
  check('but a food the parent wrote themselves is kept, however old, to be put back',
    await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.some(f => f.id === 't_mine' && f.deletedAt)));
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  check('and it is on the Foods tab under Taken off, with a way back',
    /Taken off/.test(await page.textContent('#view'))
    && (await page.$$eval('[data-act="food-back"]', a => a.length)) >= 1);
  /* Taken off is for words a parent cannot get back. A write-in was one day's leftovers,
     swept the moment nothing points at it, and putting it back would mean nothing. */
  check('but a write-in is swept, not archived',
    !/Leftover shepherd/.test(await page.textContent('#view'))
    && (await page.$$eval('[data-act="food-back"]', a => a.map(b => b.getAttribute('data-id')))).indexOf('t_once') < 0);
  await page.click('[data-act="food-back"][data-id="t_mine"]'); await page.waitForTimeout(300);
  check('Put back puts it back on the list', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return k.foods.some(f => f.id === 't_mine' && !f.deletedAt);
  }));
  await tapUndoOn(page, 'and that offers Undo'); await page.waitForTimeout(300);
  check('which takes it off again', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return k.foods.some(f => f.id === 't_mine' && !!f.deletedAt);
  }));

  /* the site is served under its real CSP (the server above enforces netlify.toml) */
  check('the app runs under the generated Content-Security-Policy', !!POLICIES['/app/*'] && POLICIES['/app/*'].includes('sha256-'));
  check('the marketing pages carry a CSP too', !!POLICIES['/index.html'] && !!POLICIES['/privacy.html'] && !!POLICIES['/terms.html'] && !!POLICIES['/help.html'] && !!POLICIES['/feedback.html'] && !!POLICIES['/thanks.html'] && /googletagmanager/.test(POLICIES['/index.html']) && !/googletagmanager/.test(POLICIES['/help.html']));

  /* --------------------------------------------- the old name's data survives */
  for (const oldKey of ['fiveboxes', 'lunchbox-tin']) {
    await page.evaluate(k => {
      const doc = localStorage.getItem('lunchsorted');
      localStorage.clear();
      localStorage.setItem(k, doc);                     /* saved under one of the app's earlier names */
    }, oldKey);
    await page.goto(BASE+'/app/');
    await page.waitForTimeout(500);
    check('data saved as "'+oldKey+'" is read and carried forward', await page.evaluate(k => {
      const d = JSON.parse(localStorage.getItem('lunchsorted') || 'null'); return !!(d && d.kids && d.kids.length) && !localStorage.getItem(k); }, oldKey));
  }

  /* ------------------------------------------------------ accounts + sync */
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(250);
  check('signed out, Setup offers a sign-in link and no member list', (await page.$$eval('#signinEmail', a => a.length)) === 1 && (await page.$$eval('[data-act="signout"]', a => a.length)) === 0);
  check('a stranger cannot read a household', (await page.evaluate(() => fetch('/api/household').then(r => r.status))) === 401);
  await page.fill('#signinEmail', 'not-an-email'); await page.click('[data-act="signin-request"]'); await page.waitForTimeout(200);
  check('a bad address is refused before it leaves the phone', /does not look like an email/i.test(await page.textContent('#toast')));
  await page.fill('#signinEmail', 'liz@example.com'); await page.press('#signinEmail', 'Enter');
  await until(page, () => !!document.querySelector('[data-dev-link]'));
  const devLink = await page.getAttribute('[data-dev-link]', 'href');
  check('Enter sends the link', !!devLink && devLink.includes('/api/auth/verify?t='), devLink);
  check('the sign-in field is styled like the others and tall enough', await page.$eval('#signinEmail', e => getComputedStyle(e).borderRadius !== '0px' && e.getBoundingClientRect().height >= 44));
  const tokenOnly = devLink.split('t=')[1];
  const forged = await page.evaluate(t => fetch('/api/auth/verify', {method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'t='+encodeURIComponent(t)}).then(r => r.status), tokenOnly);
  check('a form posted from anywhere but the sign-in page is refused', forged === 403, forged);
  await page.goto(devLink); await page.waitForTimeout(300);
  check('the link shows a button rather than signing in on sight, so a mail scanner cannot spend it', /Sign in as liz@example\.com/.test(await page.content()));
  await page.goto(devLink); await page.waitForTimeout(200);
  check('following the link twice does not spend it', /Sign in as/.test(await page.content()));
  await page.click('button[type="submit"]'); await page.waitForURL(/\/app\//); await page.waitForLoadState('load');
  await until(page, () => /liz@example\.com/.test(document.querySelector('#view').textContent));
  check('one tap signs in and lands back on the Account tab, whose rows name the household', page.url().endsWith('/app/') &&
    await page.evaluate(() => { const v = document.querySelector('#view'); return /liz@example\.com/.test(v.textContent) && v.querySelectorAll('[data-act="pane"]').length >= 3; }), page.url());
  const welcomes = (to) => mails.filter(m => m.to === to && /Everything is on for three weeks/.test(m.subject));
  check('a first sign-in gets one welcome email, with a way to stop reminders', welcomes('liz@example.com').length === 1 && /\/api\/auth\/mail-stop\?t=[a-f0-9]{32}/.test(welcomes('liz@example.com')[0].text) && /\/app\//.test(welcomes('liz@example.com')[0].text));
  {
    /* the planner reports its own breakages: a synthetic error event is enough to reach the table, and the numbers page lists it */
    const synthetic = () => window.dispatchEvent(new ErrorEvent('error', { message: 'smoke: a synthetic break for liz@example.com', filename: location.href, lineno: 12, colno: 3 }));
    await page.evaluate(synthetic);
    let errRows = [];
    for (let i = 0; i < 50 && !errRows.length; i++) { await page.waitForTimeout(100); errRows = (await db.query('SELECT kind, message, place, build, agent FROM app_errors')).rows; }
    check('a broken screen reaches the app_errors table with the build and the place, the email blanked, no household named',
      errRows.length === 1 && errRows[0].kind === 'error' && errRows[0].message === 'smoke: a synthetic break for [email]' && errRows[0].place === '/app/:12:3' && errRows[0].build === APP_BUILD && /Chrom|Safari|Mozilla/.test(errRows[0].agent || ''), errRows);
    await page.evaluate(synthetic); await page.waitForTimeout(400);
    check('the same break is not reported twice from one load', (await db.query('SELECT count(*)::int AS n FROM app_errors')).rows[0].n === 1);
    /* a page opened from an invite or the beta link carries its code in the address the browser stamps on every stack frame; both ends cut it */
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'smoke: a break with a link in it', filename: location.href, lineno: 7, colno: 1, error: { stack: 'boom@' + location.origin + '/app/?join=SECRETCODE&beta=BETA-9999:7:1' } })));
    let linkRow = null;
    for (let i = 0; i < 50 && !linkRow; i++) { await page.waitForTimeout(100); linkRow = (await db.query("SELECT stack FROM app_errors WHERE message = 'smoke: a break with a link in it'")).rows[0]; }
    check('the phone cuts the query off every link in a stack before the report leaves it', !!linkRow && /\/app\/:7:1/.test(linkRow.stack) && !/join=|SECRETCODE|beta=/.test(linkRow.stack), linkRow);
    await page.evaluate(() => { window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new TypeError('Failed to fetch') })); window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('smoke: a refused promise') })); });
    let refused = null;
    for (let i = 0; i < 50 && !refused; i++) { await page.waitForTimeout(100); refused = (await db.query("SELECT kind, stack FROM app_errors WHERE message = 'smoke: a refused promise'")).rows[0]; }
    check('a promise refused with nobody catching it is reported as one, and a network that is down is not', !!refused && refused.kind === 'rejection' && /refused promise/.test(refused.stack || '') && (await db.query("SELECT count(*)::int AS n FROM app_errors WHERE message LIKE '%Failed to fetch%'")).rows[0].n === 0, refused);
    const serverStrip = await fetch(NODE_BASE + '/api/errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'rejection', message: 'smoke: the server cuts links too, see http://x.test/app/?beta=B-1', stack: 'at x (http://x.test/app/?join=ABC#f:1:1)', build: 'lunchsorted-v0' }) });
    const stripped = (await db.query("SELECT message, stack FROM app_errors WHERE build = 'lunchsorted-v0'")).rows[0];
    check('and the server cuts them again whatever the phone sent', serverStrip.status === 204 && !!stripped && stripped.message === 'smoke: the server cuts links too, see http://x.test/app/' && stripped.stack === 'at x (http://x.test/app/:1:1)', stripped);
    /* Safari and Firefox write a frame as name@address: on a real domain that is shaped like an email, and must not be blanked as one */
    const iphone = await fetch(NODE_BASE + '/api/errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'error', message: 'smoke: an iPhone stack, and a note to pat@example.com', stack: 'render@https://lunchsorted.app/app/:4321:17\nglobal code@https://lunchsorted.app/app/:7000:3\nsent by pat@example.com', build: 'lunchsorted-v1' }) });
    const frames = (await db.query("SELECT message, stack FROM app_errors WHERE build = 'lunchsorted-v1'")).rows[0];
    check('an iPhone’s stack keeps its frames, and an address beside them is still blanked', iphone.status === 204 && !!frames && frames.message === 'smoke: an iPhone stack, and a note to [email]' && frames.stack === 'render@https://lunchsorted.app/app/:4321:17\nglobal code@https://lunchsorted.app/app/:7000:3\nsent by [email]', frames);
    /* the User-Agent arrives outside the 8 KB the body is held to: a very long one is cut before it is read, not after.
       Straight to the handler: Node's own server would turn a header this long away before the function saw it */
    const t0ua = Date.now();
    const longAgent = await errorsHandler(new Request('http://127.0.0.1/api/errors', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'a'.repeat(60000) }, body: JSON.stringify({ kind: 'error', message: 'smoke: a very long browser name', build: 'lunchsorted-v2' }) }), { ip: '127.0.0.1' });
    const agentRow = (await db.query("SELECT agent FROM app_errors WHERE build = 'lunchsorted-v2'")).rows[0];
    check('a browser name of sixty thousand letters is cut to two hundred without a second spent on it', longAgent.status === 204 && !!agentRow && agentRow.agent.length === 200 && Date.now() - t0ua < 1000, [longAgent.status, agentRow && agentRow.agent.length, Date.now() - t0ua]);
    const crossOrigin = await fetch(NODE_BASE + '/api/errors', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    const crossSite = await fetch(NODE_BASE + '/api/errors', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' });
    check('a report from another site is refused before it is read', crossOrigin.status === 403 && crossSite.status === 403, [crossOrigin.status, crossSite.status]);
    check('one IPv6 prefix is one address to the throttle, and a mapped IPv4 is itself', ipBucket('2001:db8:1:2:3:4:5:6') === '2001:0db8:0001:0002::/64' && ipBucket('2001:db8::1') === '2001:0db8:0000:0000::/64' && ipBucket('::ffff:1.2.3.4') === '1.2.3.4' && ipBucket('1.2.3.4') === '1.2.3.4');
    const errGet = await fetch(NODE_BASE + '/api/errors'), errJunk = await fetch(NODE_BASE + '/api/errors', { method: 'POST', body: 'not json' });
    check('the error endpoint answers nothing to a GET and refuses junk', errGet.status === 404 && errJunk.status === 400, [errGet.status, errJunk.status]);
    /* a flood from more addresses than the hourly caps can see stops at the table's ceiling, not the database's. The
       filler is two hours old and each report comes from a fresh address, so only the ceiling can turn one away */
    const flood = (message, ip) => errorsHandler(new Request('http://127.0.0.1/api/errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'error', message, build: 'lunchsorted-v3' }) }), { ip });
    const marks = async ip => (await db.query('SELECT count(*)::int AS n FROM rate_events WHERE key = $1', ['err:' + ipKey(ip)])).rows[0].n;
    const had = (await db.query('SELECT count(*)::int AS n FROM app_errors')).rows[0].n;
    await db.query(`INSERT INTO app_errors (at, build, kind, message) SELECT now() - interval '2 hours', 'lunchsorted-v3', 'error', 'smoke: filler ' || g FROM generate_series(1, $1::int) g`, [ERRORS_KEPT - had - 1]);
    const lastRoom = await flood('smoke: the last report there is room for', '203.0.113.7');
    const atCeiling = (await db.query('SELECT count(*)::int AS n FROM app_errors')).rows[0].n;
    check('the report that brings the error table to its ceiling is kept', lastRoom.status === 204 && atCeiling === ERRORS_KEPT, [lastRoom.status, atCeiling, ERRORS_KEPT]);
    const pastIt = await flood('smoke: one past the ceiling', '203.0.113.8');
    const past = (await db.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE message = 'smoke: one past the ceiling')::int AS it FROM app_errors")).rows[0];
    const pastTicks = await marks('203.0.113.8');
    check('past the ceiling a report is still answered 204 and grows nothing, not even the throttle',
      pastIt.status === 204 && past.n === ERRORS_KEPT && past.it === 0 && pastTicks === 0, [pastIt.status, past, pastTicks]);
    /* a week after a flood its rows are off this week's list, and without this line the page would read as a quiet week */
    const fullAdmin = await page.evaluate(() => fetch('/api/admin').then(r => r.text()));
    const oldestKept = (await db.query('SELECT min(at) AS t FROM app_errors')).rows[0].t;
    const roomFrom = new Date(new Date(oldestKept).getTime() + 30 * 86400000).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
    check('and the numbers page says the table is full, and that room comes back thirty days after its oldest row',
      /The table is full, so new reports are being dropped/.test(fullAdmin) && fullAdmin.includes('as the oldest pass thirty days, from about ' + roomFrom), [roomFrom, fullAdmin.match(/Broken screens this week[\s\S]{0,500}/)?.[0]]);
    check('the limits are the ones the README gives: twenty an hour from one address, two hundred in all, ten thousand rows',
      EACH_AN_HOUR === 20 && ROWS_AN_HOUR === 200 && ERRORS_KEPT === 10000, [EACH_AN_HOUR, ROWS_AN_HOUR, ERRORS_KEPT]);
    await db.query("DELETE FROM app_errors WHERE build = 'lunchsorted-v3'");
    /* everyone's hourly cap: filled to one short with rows from five minutes ago, the next report is kept and one more from a fresh address is not */
    const inHour = async () => (await db.query("SELECT count(*)::int AS n FROM app_errors WHERE at > now() - interval '1 hour'")).rows[0].n;
    await db.query(`INSERT INTO app_errors (at, build, kind, message) SELECT now() - interval '5 minutes', 'lunchsorted-v3', 'error', 'smoke: this hour ' || g FROM generate_series(1, $1::int) g`, [ROWS_AN_HOUR - (await inHour()) - 1]);
    const hourLast = await flood('smoke: the last report this hour has room for', '203.0.113.9');
    const hourFull = await inHour();
    await flood('smoke: one past the hour', '203.0.113.10');
    const hourPast = (await db.query("SELECT count(*)::int AS n FROM app_errors WHERE message = 'smoke: one past the hour'")).rows[0].n;
    check('everyone\'s hourly cap keeps the report that reaches it, and one past it from a fresh address writes nothing',
      hourLast.status === 204 && hourFull === ROWS_AN_HOUR && hourPast === 0 && (await marks('203.0.113.10')) === 0, [hourFull, ROWS_AN_HOUR, hourPast]);
    await db.query("DELETE FROM app_errors WHERE build = 'lunchsorted-v3'");
    /* one address's hourly cap, with everyone's far off */
    for (let i = 1; i <= EACH_AN_HOUR + 1; i++) await flood('smoke: from one address, ' + i, '203.0.113.11');
    const fromOne = (await db.query("SELECT count(*)::int AS n FROM app_errors WHERE message LIKE 'smoke: from one address, %'")).rows[0].n;
    check('one address\'s hourly cap keeps what it allows and writes nothing for the report after',
      fromOne === EACH_AN_HOUR && (await marks('203.0.113.11')) === EACH_AN_HOUR, [fromOne, EACH_AN_HOUR]);
    await db.query("DELETE FROM app_errors WHERE build = 'lunchsorted-v3'");
    /* what Postgres cannot hold goes to the database as U+FFFD: half an emoji at the start (sent alone) and at the end (left by
       the cut at 300), and a NUL between. PGlite would store the halves as U+FFFD itself, so the check reads the values handed to
       the driver, not the row, and asks TextEncoder rather than the server's own pattern whether each value is whole */
    const REPLACED = String.fromCharCode(0xFFFD), NUL = String.fromCharCode(0), LOW_HALF = String.fromCharCode(0xDE00);
    const realSql = globalThis.__LS_SQL; let sent = null;
    globalThis.__LS_SQL = Object.assign(async (strings, ...vals) => { if (typeof strings !== 'string' && strings.join('').includes('INSERT INTO app_errors')) sent = vals; return realSql(strings, ...vals); }, { transaction: realSql.transaction });
    try { await flood(LOW_HALF + 'x'.repeat(296) + NUL + 'y' + '\u{1F34E}', '203.0.113.12'); } finally { globalThis.__LS_SQL = realSql; }
    const whole = v => new TextDecoder().decode(new TextEncoder().encode(v)) === v && !v.includes(NUL);
    check('a NUL and half an emoji, sent alone or left by a cut, reach the database as U+FFFD, and nothing Postgres cannot hold does',
      !!sent && sent.includes(REPLACED + 'x'.repeat(296) + REPLACED + 'y' + REPLACED) && sent.every(v => typeof v !== 'string' || whole(v)), sent && sent.filter(v => typeof v === 'string').map(v => JSON.stringify(v.slice(0, 2) + '...' + v.slice(-3))));
    await db.query("DELETE FROM app_errors WHERE build = 'lunchsorted-v3'");
    /* commonest first: a message seen twice outranks a later one seen once */
    await db.query(`INSERT INTO app_errors (at, build, kind, message) VALUES (now() - interval '20 minutes', 'lunchsorted-v3', 'error', 'smoke: seen on two phones'), (now() - interval '20 minutes', 'lunchsorted-v3', 'error', 'smoke: seen on two phones'), (now(), 'lunchsorted-v3', 'error', 'smoke: seen once, later')`);
    const anonAdmin = await fetch(NODE_BASE + '/api/admin');
    const adminPage = await page.evaluate(() => fetch('/api/admin').then(r => r.text().then(t => ({ status: r.status, text: t, csp: r.headers.get('content-security-policy') }))));
    check('the numbers page asks a stranger to sign in, and shows the person in ADMIN_EMAILS real counts',
      anonAdmin.status === 401 && adminPage.status === 200 && /by the numbers/i.test(adminPage.text) && /households/.test(adminPage.text) && /default-src 'none'/.test(adminPage.csp), [anonAdmin.status, adminPage.status]);
    check('the numbers page lists the week\'s broken screens', /Broken screens/.test(adminPage.text) && /a synthetic break/.test(adminPage.text));
    const twice = adminPage.text.indexOf('smoke: seen on two phones'), once = adminPage.text.indexOf('smoke: seen once, later');
    check('the commonest is listed first, and the page says how full the table is without calling it full',
      twice > -1 && once > twice && new RegExp('holds \\d[\\d,]* of the ' + ERRORS_KEPT.toLocaleString('en-US') + ' it keeps').test(adminPage.text) && !/The table is full/.test(adminPage.text), [twice, once]);
    await db.query("DELETE FROM app_errors WHERE build = 'lunchsorted-v3'");
    /* thirty-one messages seen twice fill the twenty commonest and more, and a new one seen once still shows, among the newest of the rest */
    await db.query(`INSERT INTO app_errors (at, build, kind, message) SELECT now() - interval '30 minutes', 'lunchsorted-v3', 'error', 'smoke: seen twice, ' || (g % 31) FROM generate_series(0, 61) g`);
    await db.query(`INSERT INTO app_errors (build, kind, message) VALUES ('lunchsorted-v3', 'error', 'smoke: new this minute')`);
    const kinds = (await db.query("SELECT count(*)::int AS n FROM (SELECT 1 FROM app_errors WHERE at > now() - interval '7 days' GROUP BY message, build, place) g")).rows[0].n;
    const mixed = await page.evaluate(() => fetch('/api/admin').then(r => r.text()));
    const listedRows = ((mixed.match(/<table class="kv errs">[\s\S]*?<\/table>/) || [''])[0].match(/<tr>/g) || []).length;
    check('past the twenty commonest, a new break seen once is still listed, after them, and the page says how many there were',
      mixed.includes('smoke: new this minute') && mixed.indexOf('smoke: new this minute') > mixed.indexOf('smoke: seen twice, ') && listedRows === 30 && mixed.includes(kinds.toLocaleString('en-US') + ' distinct this week'), [kinds, listedRows]);
    await db.query("DELETE FROM app_errors WHERE build = 'lunchsorted-v3'");
    check('and shows the funnel, with this household signed up and planned', /The funnel/.test(adminPage.text) && /Planned a week<\/td><td>1 \/ 1/.test(adminPage.text) && /Signed up<\/td><td>1 \/ 1/.test(adminPage.text), adminPage.text.match(/The funnel[\s\S]{0,600}/)?.[0]);
    /* the one script that sorts the rosters is allowed by its own hash and nothing else */
    const inline = adminPage.text.match(/<script>([\s\S]*?)<\/script>/g) || [];
    const only = adminPage.text.match(/<script>([\s\S]*?)<\/script>/);
    const hash = only && crypto.createHash('sha256').update(only[1], 'utf8').digest('base64');
    const scriptSrc = (adminPage.csp.match(/script-src ([^;]*)/) || [, ''])[1];
    check('the one script on the numbers page is allowed by its own hash and nothing else',
      inline.length === 1 && scriptSrc === `'sha256-${hash}'`, [inline.length, scriptSrc]);
  }
  const spent = await page.evaluate(u => fetch(u).then(r => r.status), devLink);
  check('a used link is gone', spent === 410, spent);
  await until(page, () => fetch('/api/household').then(r => r.json()).then(j => j.version >= 1 && !!j.doc));
  const srv = await page.evaluate(() => fetch('/api/household').then(r => r.json()));
  {
    const kinds = (await db.query('SELECT kind FROM milestones WHERE household_id = $1 ORDER BY kind', [srv.household.id])).rows.map(r => r.kind);
    check('signing up and pushing a planned week leave two milestones and nothing else', kinds.join() === 'first_plan,signed_up', kinds);
    /* week two is measured from the household row: eight days old, one open, one row; then the row is put back so the trial is untouched */
    await db.query("UPDATE households SET created_at = now() - interval '8 days' WHERE id = $1", [srv.household.id]);
    await page.evaluate(() => fetch('/api/household').then(r => r.status));
    const later = (await db.query('SELECT kind FROM milestones WHERE household_id = $1 ORDER BY kind', [srv.household.id])).rows.map(r => r.kind);
    await db.query('UPDATE households SET created_at = now() WHERE id = $1', [srv.household.id]);
    check('an open between seven and fourteen days after sign-in is the week-two milestone', later.join() === 'first_plan,signed_up,week_two', later);
  }
  check("this phone's lunches became the household on the server", !!(srv.doc && srv.doc.kids.length >= 1 && srv.version >= 1 && srv.me.role === 'owner'), {version: srv.version, role: srv.me && srv.me.role});
  check('the person on this phone is a member the document already knew', await page.evaluate(m => JSON.parse(localStorage.getItem('lunchsorted')).members.some(x => x.id === m) && localStorage.getItem('lunchsorted-device') === m, srv.me.memberId));
  const stale = await page.evaluate(v => fetch('/api/household', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({doc: JSON.parse(localStorage.getItem('lunchsorted')), version: v - 1})}).then(r => r.status), srv.version);
  check('a push with a stale version is refused with 409', stale === 409, stale);

  /* the other parent already uses the app on their own phone */
  await openPane(page, 'household');
  await page.click('[data-act="invite"]'); await until(page, () => !!document.querySelector('#inviteUrl'));
  const inviteUrl = await page.inputValue('#inviteUrl');
  check('an invite link is made', /\/app\/\?join=/.test(inviteUrl), inviteUrl);
  const ctx2 = await phone();
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errors.push(String(e.message)));
  await p2.goto(BASE+'/app/'); await p2.waitForTimeout(400);
  await p2.fill('#obName', 'Ollie'); await p2.click('[data-act="ob-go"]'); await p2.waitForTimeout(400);   /* Sam has his own lunches already */
  await p2.click('[data-act="ob-later"]'); await p2.waitForTimeout(200);
  await p2.goto(inviteUrl); await p2.waitForLoadState('load');
  await until(p2, () => /invited you to share/i.test(document.querySelector('#view').textContent));
  check('the invite opens at the top of Setup, naming who sent it', await p2.evaluate(() => { const v = document.querySelector('#view'); return /liz@example\.com|Liz/.test(v.textContent) && /invited you to share/i.test(v.textContent) && !!v.querySelector('#signinEmail'); }), (await p2.textContent('#view')).slice(0, 160));
  await p2.fill('#signinEmail', 'sam@example.com'); await p2.click('[data-act="signin-request"]');
  await until(p2, () => !!document.querySelector('#signinCode'));
  const devCode = await p2.evaluate(() => fetch('/api/auth/request', {method:'POST', headers:{'content-type':'application/json'}, body:'{"email":"sam@example.com"}'}).then(r => r.json()).then(j => j.devCode));
  /* Enter in the code field presses Sign in, and a key held down repeats: each repeat was one more
     try of the code, and a code takes eight wrong tries, so a mistyped code held for a moment spent
     itself. The key is held here, with the first try held open so the field is still there for
     every repeat, and the code goes once. */
  let letGo = () => {}; const holding = new Promise(r => { letGo = r; });
  let codeTries = 0; const holdCode = async route => { if (route.request().method() === 'POST') codeTries++; await holding; await route.continue(); };
  await p2.route('**/api/auth/code', holdCode);
  await p2.fill('#signinCode', devCode.toLowerCase()); await p2.focus('#signinCode');
  await p2.keyboard.down('Enter'); await p2.keyboard.down('Enter'); await p2.keyboard.down('Enter'); await p2.keyboard.up('Enter');
  await p2.waitForTimeout(250);
  const tries = codeTries;
  letGo();
  await until(p2, () => /Join their household/.test(document.querySelector('#view').textContent));
  await p2.unroute('**/api/auth/code', holdCode);
  check('a held Enter in the code field tries the code once, not once a repeat', tries === 1, tries);
  check('the code from the email signs in without leaving the app, and offers the household', /Join their household/.test(await p2.textContent('#view')) && await p2.evaluate(() => fetch('/api/household').then(r => r.status)) === 200);
  /* App Review's account: a standing code, no email, and the code is no good for anyone else */
  {
    const before = mails.length;
    const r1 = await p2.evaluate(() => fetch('/api/auth/request', {method:'POST', headers:{'content-type':'application/json'}, body:'{"email":"review@example.com"}'}).then(r => r.json()));
    const wrongAddress = await p2.evaluate(() => fetch('/api/auth/code', {method:'POST', headers:{'content-type':'application/json'}, body:'{"email":"sam@example.com","code":"REVU-2468"}'}).then(r => r.status));
    const ctxRv = await phone(); const prv = await ctxRv.newPage();
    await prv.goto(BASE+'/app/');
    const signedIn = await prv.evaluate(() => fetch('/api/auth/code', {method:'POST', headers:{'content-type':'application/json'}, body:'{"email":"review@example.com","code":"revu 2468"}'}).then(r => r.status));
    const who = await prv.evaluate(() => fetch('/api/auth/me').then(r => r.json()));
    const linkMails = mails.slice(before).filter(m => m.to === 'review@example.com' && /sign-in link/.test(m.subject));   /* the welcome email on first sign-in is fine; the link email is not */
    check('the review account signs in with its standing code, gets no sign-in email, and the code opens nothing else', r1.ok && !r1.devLink && linkMails.length === 0 && wrongAddress !== 200 && signedIn === 200 && who.user && who.user.email === 'review@example.com', {r1, wrongAddress, signedIn, who, linkMails: linkMails.length});
    await ctxRv.close();
  }
  const codeAgain = await p2.evaluate(c => fetch('/api/auth/code', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({email:'sam@example.com', code:c})}).then(r => r.status), devCode);
  check('a code works once', codeAgain === 410, codeAgain);
  {
    /* What a stranger can make the sign-in routes write is bounded, and no row there names an address. Straight to the
       handler, each call from a connection of its own, so the suite's own 127.0.0.1 keeps its hourly twenty. Only the
       sign-in routes' rows are counted, so a phone's push landing meanwhile cannot move a count, and the digests are
       worked out here rather than with the code's own digest() */
    const auth = (route, body, ip, headers = {}) => authHandler(new Request('http://127.0.0.1/api/auth/' + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), { ip });
    const marks = async () => (await db.query("SELECT count(*)::int AS n FROM rate_events WHERE key LIKE 'link%' OR key LIKE 'code%' OR key LIKE 'verify%'")).rows[0].n;
    const links = async () => (await db.query('SELECT count(*)::int AS n FROM magic_links')).rows[0].n;
    const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
    const wide = n => Array.from({ length: n }, () => String.fromCodePoint(0x4E00 + crypto.randomInt(20000))).join('');   /* three bytes a letter */
    const before = [await marks(), await links()], answers = [];
    for (let i = 0; i < 200; i++) answers.push((await auth('code', { email: wide(60) + i + '@' + wide(200) + '.com', code: 'ABCD-EFGH' }, i % 2 ? `2001:db8:${i.toString(16)}::1` : `203.0.113.${i}`)).status);
    check('two hundred invented addresses in three-byte letters, from as many connections, write nothing through the code route and are each told the code is wrong',
      (await marks()) === before[0] && (await links()) === before[1] && answers.every(s => s === 410), [(await marks()) - before[0], [...new Set(answers)]]);
    /* a code with its email waiting: eight wrong tries, from however many connections, then even the right code is refused,
       with the same answer every time; a new email brings a code with eight of its own */
    const asked = await (await auth('request', { email: 'guess@example.com' }, '198.51.100.7')).json();
    const tries = [];
    for (let i = 0; i < CODE_TRIES + 4; i++) tries.push((await auth('code', { email: 'guess@example.com', code: 'ZZZZ-ZZZ' + (i % 8 + 2) }, `198.51.100.${10 + i}`)).status);
    const right = (await auth('code', { email: 'guess@example.com', code: asked.devCode }, '198.51.100.99')).status;
    const spent = (await db.query("SELECT code_tries AS n, code_used_at IS NULL AS unused FROM magic_links WHERE email = 'guess@example.com'")).rows;
    const again = await (await auth('request', { email: 'guess@example.com' }, '198.51.100.8')).json();
    const freshReply = await auth('code', { email: 'guess@example.com', code: 'ZZZZ-ZZZZ' }, '198.51.100.8');
    const fresh = freshReply.status, answer = (await freshReply.json()).error;
    const counted = (await db.query("SELECT code_tries AS n FROM magic_links WHERE email = 'guess@example.com' ORDER BY created_at")).rows.map(r => r.n);
    check('a code takes eight wrong tries, from however many connections, then refuses even the right code with the same answer as a wrong one, which says to ask for a new email, and a new email brings a code with eight of its own',
      !!asked.devCode && !!again.devCode && tries.every(s => s === 410) && right === 410 && spent.length === 1 && spent[0].n === CODE_TRIES && spent[0].unused && fresh === 410 && counted.join() === `${CODE_TRIES},1` && /ask for a new email/.test(answer),
      [tries, right, spent, fresh, counted, answer]);
    const keys = (await db.query('SELECT key FROM rate_events')).rows.map(r => r.key);
    const shaped = k => k === 'link:all' || k === 'link:review' || /^(link|link-ip):[0-9a-f]{24}$/.test(k), signInKeys = keys.filter(k => /^(link|code)/.test(k));
    check('the counts are kept under a digest of the address or the connection, the code route keeps none, and no mark in the table carries an address, the suite\'s own sign-ins included',
      keys.includes('link:' + sha('guess@example.com')) && keys.includes('link:' + sha('liz@example.com')) && keys.includes('link:' + sha('sam@example.com')) && keys.includes('link-ip:' + sha('198.51.100.7'))
        && !keys.some(k => k.startsWith('code:')) && signInKeys.every(shaped) && !keys.some(k => k.includes('@')),
      signInKeys.filter(k => !shaped(k)).slice(0, 3));
    /* one IPv6 /64 is one connection: twenty let through from twenty of its addresses, the twenty-first turned away, the next /64 still goes */
    const sent = [];
    for (let i = 1; i <= LINKS_FROM_ONE; i++) sent.push((await auth('request', { email: `six${i}@example.com` }, `2001:db8:77:1:${i.toString(16)}::1`)).status);
    const had = await marks();
    const past = await auth('request', { email: 'six-past@example.com' }, '2001:db8:77:1:ffff:ffff:ffff:ffff');
    const grew = (await marks()) - had;
    const nextBlock = await auth('request', { email: 'six-next@example.com' }, '2001:db8:77:2::1');
    check('an IPv6 /64 is one connection to the sign-in limit: twenty from twenty of its addresses, then one turned away without a row written, and the next /64 still goes',
      sent.every(s => s === 200) && past.status === 429 && grew === 0 && nextBlock.status === 200, [sent, past.status, grew, nextBlock.status]);
    const thrice = [];
    for (let i = 0; i < LINKS_TO_ONE; i++) thrice.push((await auth('request', { email: 'thrice@example.com' }, `192.0.2.${10 + i}`)).status);
    const had2 = await marks();
    const fourth = await auth('request', { email: 'thrice@example.com' }, '192.0.2.99');
    check('three links a quarter hour to one address, and a fourth is turned away without a row written',
      thrice.every(s => s === 200) && fourth.status === 429 && (await marks()) === had2, [thrice, fourth.status]);
    /* the day's count: topped up with marks from twenty-five hours ago it still lets a request through, and topped up from
       twenty-three hours ago it turns one away, with no row, no link and no email, while App Review's address, which is sent
       no email, still gets its code and leaves the day's count alone. The filler goes in a finally, or every sign-in after
       this would be told the app is busy */
    const inDay = async () => (await db.query("SELECT count(*)::int AS n FROM rate_events WHERE key = 'link:all' AND at > now() - interval '1 day'")).rows[0].n;
    const fill = async hours => db.query("INSERT INTO rate_events (key, at) SELECT 'link:all', now() - make_interval(hours => $2::int) FROM generate_series(1, $1::int)", [LINKS_A_DAY - await inDay(), hours]);
    let early, busy, wrote, reviewed;
    try {
      await fill(25);
      early = (await auth('request', { email: 'early@example.com' }, '192.0.2.199')).status;
      await db.query("DELETE FROM rate_events WHERE key = 'link:all' AND at < now() - interval '1 day'");
      await fill(23);
      const [m0, l0, e0] = [await marks(), await links(), mails.length];
      busy = (await auth('request', { email: 'late@example.com' }, '192.0.2.200')).status;
      wrote = [(await marks()) - m0, (await links()) - l0, mails.length - e0];
      const [d0, l1, e1] = [await inDay(), await links(), mails.length];
      reviewed = [(await auth('request', { email: 'review@example.com' }, '192.0.2.198')).status, (await inDay()) - d0, (await links()) - l1, mails.length - e1];
    } finally { await db.query("DELETE FROM rate_events WHERE key = 'link:all' AND at < now() - interval '22 hours'"); }
    check('once the day\'s sign-in emails are spent a request is turned away, and writes no row, no link and no email',
      busy === 503 && wrote.join() === '0,0,0', [busy, wrote]);
    check('and App Review\'s address, which is sent no email, still gets its code then, without a mark on the day\'s count or an email',
      reviewed.join() === '200,0,1,0', reviewed);
    /* the mail provider refusing a send (its daily cap): the parent is told sign-in is busy, not that something broke, and the
       counts stay, so refused sends cannot run past the limits */
    const realPush = mails.push;
    mails.push = () => { throw new Error('Resend 429: daily quota reached'); };
    const [m2, l2] = [await marks(), await links()];
    let refused; try { refused = await auth('request', { email: 'refused@example.com' }, '192.0.2.197'); } finally { mails.push = realPush; }
    const refusedBody = await refused.json();
    check('a sign-in email the mail provider refuses is answered as busy, and still counts against the limits',
      refused.status === 503 && /busy/.test(refusedBody.error) && (await marks()) - m2 === 3 && (await links()) - l2 === 1, [refused.status, refusedBody, (await marks()) - m2]);
    /* a burst queued on the lock past its 50 ms: the database cancels the wait (55P03), the request is answered as busy, and
       nothing of it is written. Postgres here has one connection, so the cancel is handed in by the hook */
    const realTx = globalThis.__LS_SQL.transaction, cutSaid = [], realCutError = console.error;
    globalThis.__LS_SQL.transaction = async () => { throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }); };
    console.error = (...a) => { cutSaid.push(a.join(' ')); };
    const [m3, l3] = [await marks(), await links()];
    let queued, queuedAgain; try { queued = await auth('request', { email: 'queued@example.com' }, '192.0.2.196'); queuedAgain = await auth('request', { email: 'queued-too@example.com' }, '192.0.2.193'); }
    finally { globalThis.__LS_SQL.transaction = realTx; console.error = realCutError; }
    check('a request whose wait on the lock is cut is answered as busy and writes nothing, and the log says so once, not once a request',
      queued.status === 503 && queuedAgain.status === 503 && /busy/.test((await queued.json()).error) && (await marks()) === m3 && (await links()) === l3
        && cutSaid.filter(l => /queued past 50 ms on the lock/.test(l)).length === 1, [queued.status, queuedAgain.status, cutSaid]);
    /* the wait is cut by the transaction's own first statement, SET LOCAL, which ends with it: a plain SET would outlive the
       transaction on Neon's pooled connection and cut the lock waits of whatever ran on it next, any route's */
    const handed = [];
    globalThis.__LS_SQL.transaction = fn => realTx(q => { const qs = fn(q); handed.push(qs.map(([strings]) => strings.join('?').replace(/\s+/g, ' ').trim())); return qs; });
    let lockAsked; try { lockAsked = await auth('request', { email: 'locked@example.com' }, '192.0.2.194'); } finally { globalThis.__LS_SQL.transaction = realTx; }
    const leftSet = (await db.query('SHOW lock_timeout')).rows[0].lock_timeout;
    check('the wait on the lock is cut by the transaction\'s own first statement, SET LOCAL, and nothing of it outlives the transaction',
      lockAsked.status === 200 && handed.length === 1 && handed[0][0] === "SET LOCAL lock_timeout = '50ms'" && /pg_advisory_xact_lock/.test(handed[0][1]) && leftSet === '0', [lockAsked.status, handed, leftSet]);
    /* housekeeping that fails is logged and never fails the sign-in that paid for it */
    const realSql = globalThis.__LS_SQL, realRandom = Math.random, heard = [], realError = console.error;
    globalThis.__LS_SQL = Object.assign(async (strings, ...vals) => { if (typeof strings !== 'string' && strings.join('').includes('DELETE FROM rate_events WHERE ctid')) throw new Error('No answer from the database'); return realSql(strings, ...vals); }, { transaction: realSql.transaction });
    Math.random = () => 0; console.error = (...a) => { heard.push(a.join(' ')); };
    let swept; try { swept = await auth('request', { email: 'swept@example.com' }, '192.0.2.195'); } finally { globalThis.__LS_SQL = realSql; Math.random = realRandom; console.error = realError; }
    check('a sign-in whose housekeeping fails still goes out, and the failure is logged in our own words',
      swept.status === 200 && heard.some(l => /^api-auth: housekeeping No answer from the database/.test(l)), [swept.status, heard]);
    /* every window forgets on time: counts from a minute or an hour past it let a request through, and from just inside turn it away */
    const place = (key, n, minutes) => db.query("INSERT INTO rate_events (key, at) SELECT $1, now() - make_interval(mins => $3::int) FROM generate_series(1, $2::int)", [key, n, minutes]);
    await place('link:' + sha('old-quarter@example.com'), LINKS_TO_ONE, 16); await place('link:' + sha('new-quarter@example.com'), LINKS_TO_ONE, 14);
    await place('link-ip:' + sha('192.0.2.240'), LINKS_FROM_ONE, 61); await place('link-ip:' + sha('192.0.2.241'), LINKS_FROM_ONE, 59);
    const forgot = [early,
      (await auth('request', { email: 'old-quarter@example.com' }, '192.0.2.242')).status, (await auth('request', { email: 'new-quarter@example.com' }, '192.0.2.243')).status,
      (await auth('request', { email: 'old-hour@example.com' }, '192.0.2.240')).status, (await auth('request', { email: 'new-hour@example.com' }, '192.0.2.241')).status];
    check('each sign-in limit forgets on time: the day\'s, the hour\'s and the quarter hour\'s counts from just past the window let a request through, and from just inside turn it away',
      forgot.join() === '200,200,429,200,429', forgot);
    /* the link's own route counts nothing, and a stranger's page posting from its visitors' browsers is turned away first */
    const m1 = await marks();
    const bogus = await auth('verify', { token: 'x'.repeat(43), kind: 'native' }, '192.0.2.201');
    const formElsewhere = await authHandler(new Request('http://127.0.0.1/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 't=abc' }), { ip: '192.0.2.202' });
    const crossSite = await auth('request', { email: 'csrf@example.com' }, '192.0.2.203', { 'sec-fetch-site': 'cross-site' });
    check('the link\'s own route writes no row, for a token nobody was sent or a form from elsewhere, and a sign-in request from another site is refused before anything is written',
      bogus.status === 410 && formElsewhere.status === 403 && crossSite.status === 403 && (await marks()) === m1, [bogus.status, formElsewhere.status, crossSite.status]);
    /* migration 0011 takes the counts from before digests, which held an address, and nothing else, and runs again harmlessly */
    const m11 = fs.readFileSync(path.join(ROOT, '..', 'netlify', 'database', 'migrations', '0011_code_tries.sql'), 'utf8').replace(/--[^\n]*/g, '').split(';').map(x => x.trim()).filter(Boolean);
    await db.query("INSERT INTO rate_events (key) VALUES ('link:old@example.com'), ('code:old@example.com'), ('link:' || $1)", [sha('old@example.com')]);
    for (const statement of m11) await db.query(statement);
    const oldLeft = (await db.query("SELECT key FROM rate_events WHERE key IN ('link:old@example.com', 'code:old@example.com', 'link:' || $1)", [sha('old@example.com')])).rows.map(r => r.key);
    check('migration 0011 clears the counts from before digests, which held an address, leaves a digest\'s, and runs again harmlessly',
      m11.length === 2 && oldLeft.join() === 'link:' + sha('old@example.com'), [m11.length, oldLeft]);
    await db.query("DELETE FROM rate_events WHERE key = 'link:' || $1", [sha('old@example.com')]);
    /* the numbers in the code are the words in the README: change one and the other has to follow */
    const said = fs.readFileSync(path.join(ROOT, '..', 'README.md'), 'utf8').replace(/\s+/g, ' ');
    const words = { 3: 'three', 8: 'eight', 20: 'twenty', 2000: 'two thousand' };
    const phrases = [`at most ${words[LINKS_TO_ONE]} times a quarter hour to one address`, `${words[LINKS_FROM_ONE]} times an hour from one connection`, `${words[LINKS_A_DAY]} times a day in all`, `A code gets ${words[CODE_TRIES]} tries`];
    check('the sign-in limits are the ones the README gives, in its own words: three a quarter hour to an address, twenty an hour from a connection, two thousand a day, eight tries a code',
      phrases.every(p => said.includes(p)), phrases.filter(p => !said.includes(p)));
  }
  await p2.click('[data-act="join-accept"]');
  await until(p2, () => /you share their lunches/i.test(document.querySelector('#toast').textContent) || /Parent/.test(document.querySelector('#view').textContent));
  await until(page, () => fetch('/api/household').then(r => r.json()).then(j => j.members.length === 2));
  check('a second phone joining is a milestone on the household', (await db.query("SELECT count(*)::int AS n FROM milestones WHERE kind = 'second_phone'")).rows[0].n === 1);
  await page.goto(BASE+'/app/'); await page.waitForLoadState('load'); await page.waitForTimeout(800);
  const ownerKids = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => k.name).sort());
  const samKids = await p2.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => k.name).sort());
  check("joining with lunches of his own brings Ollie into the household on both phones", JSON.stringify(samKids) === JSON.stringify(ownerKids) && samKids.includes('Ollie') && samKids.length >= 2, {ownerKids, samKids});
  await openPane(p2, 'household');
  const memberText = await p2.textContent('#view');
  check('both parents are listed, by name, with the address as the small print', /Parent/.test(memberText) && /sam@example\.com/.test(memberText) && /liz@example\.com/.test(memberText) && !/sam\.example/.test(memberText));
  check('Sam kept the member he already was', await p2.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return d.members.filter(m => !m.deletedAt).length === 2 && d.members.some(m => m.id === localStorage.getItem('lunchsorted-device')); }));
  const notOwner = await p2.evaluate(id => fetch('/api/household/remove', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({userId:id})}).then(r => r.status), srv.me.userId);
  check('only the owner can remove someone', notOwner === 403, notOwner);
  {
    /* someone who is removed, or leaves, takes their invites with them: a link they made while they
       were in the household must not be their way back in afterwards */
    const { createInvite, consumeInvite, findOrCreateUser } = await import('../netlify/lib/auth.js');
    const kim = await findOrCreateUser('kim@example.com');
    await db.query("INSERT INTO household_members (household_id, user_id, role, member_id) VALUES ($1, $2, 'adult', 'mem_kimsmoke')", [srv.household.id, kim.id]);
    const kept = await createInvite(srv.household.id, kim.id, 'adult');
    const peekLive = await fetch(NODE_BASE + '/api/household/invite?code=' + kept);
    await db.query('DELETE FROM household_members WHERE household_id = $1 AND user_id = $2', [srv.household.id, kim.id]);   /* what Remove and Leave both do */
    const peekGone = await fetch(NODE_BASE + '/api/household/invite?code=' + kept);
    const usedGone = await consumeInvite(kept, kim.id);
    check('an invite is good only while whoever made it is still in the household', peekLive.status === 200 && peekGone.status === 410 && usedGone === null, [peekLive.status, peekGone.status, usedGone]);
    /* asked back as a caretaker, she must not find the link she made as a parent alive again */
    await db.query("INSERT INTO household_members (household_id, user_id, role, member_id) VALUES ($1, $2, 'helper', 'mem_kimsmoke')", [srv.household.id, kim.id]);
    const peekHelper = await fetch(NODE_BASE + '/api/household/invite?code=' + kept);
    const usedHelper = await consumeInvite(kept, kim.id);
    check('and it stays dead if they come back as a caretaker', peekHelper.status === 410 && usedHelper === null, [peekHelper.status, usedHelper]);
    await db.query('DELETE FROM users WHERE id = $1', [kim.id]);   /* and the invite goes with her */
  }

  /* an edit on each phone reaches the other; an un-tick holds */
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  await page.click('[data-act="add-own"]'); await page.waitForTimeout(350);
  await page.fill('#nfName', 'Shared test food'); await page.click('[data-act="save-own"]');
  await until(page, () => fetch('/api/household').then(r => r.json()).then(j => JSON.stringify(j.doc).includes('Shared test food')));
  await p2.click('[data-act="tab"][data-tab="shop"]'); await p2.waitForTimeout(300);
  const pantryKey = await p2.getAttribute('.list .item [data-act="have"] >> nth=0', 'data-key');
  await p2.click('.list .item [data-act="have"] >> nth=0');
  await until(p2, k => !!JSON.parse(localStorage.getItem('lunchsorted')).pantry[k], pantryKey);   /* the save is debounced */
  const first = await p2.evaluate(k => JSON.parse(localStorage.getItem('lunchsorted')).pantry[k].have, pantryKey);
  check('a pantry tick reaches the server', await until(p2, a => fetch('/api/household').then(r => r.json()).then(j => !!j.doc.pantry[a.k] && j.doc.pantry[a.k].have === a.v), {k: pantryKey, v: first}), {pantryKey, first});
  await p2.click('.list .item [data-act="have"] >> nth=0');                                   /* and straight back */
  check('an un-tick reaches the server as a row, not an absence', await until(p2, a => fetch('/api/household').then(r => r.json()).then(j => !!j.doc.pantry[a.k] && j.doc.pantry[a.k].have === !a.v), {k: pantryKey, v: first}), {pantryKey, first});
  await p2.goto(BASE+'/app/'); await p2.waitForLoadState('load');
  check('a food added on one phone reaches the other', await until(p2, () => JSON.parse(localStorage.getItem('lunchsorted')).kids.some(k => k.foods.some(f => f.n === 'Shared test food'))));
  await page.goto(BASE+'/app/'); await page.waitForLoadState('load');
  const held = await until(page, a => { const p = JSON.parse(localStorage.getItem('lunchsorted')).pantry[a.k]; return !!p && p.have === !a.v; }, {k: pantryKey, v: first});
  const holdDetail = held ? null : await page.evaluate(async k => ({
    local: JSON.parse(localStorage.getItem('lunchsorted')).pantry[k] || null,
    server: await fetch('/api/household').then(r => r.json()).then(j => ({v: j.version, row: j.doc.pantry[k] || null, me: j.me.memberId})),
    line: (document.getElementById('syncLine') || {}).textContent || document.querySelector('#view').textContent.slice(0, 120),
    device: localStorage.getItem('lunchsorted-device'), errors: window.__errs || null }), pantryKey);
  check('an un-tick on the other phone holds here instead of coming back', held, holdDetail ? {pantryKey, first, ...holdDetail, pageErrors: errors.slice(-3)} : {pantryKey, first});

  /* Undo, with a sync landing inside the toast's six seconds. Every pull and
     every 409 merge hands S a document normalizeAccount has rebuilt food by
     food and day by day, so an Undo holding the records themselves writes into
     a document the app has already let go of: the food stayed deleted, every
     compartment it filled stayed empty, and the toast still said "Put back".
     Driven the way it happens on a real pair of phones -- the other one gets
     to the server first, so this one's push comes back 409 and merges. */
  {
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
    if (await page.$('[data-act="plan-kid"]')) { await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300); await goShuffle(page); }
    /* a day still ahead: a day that has gone is not the delete's to clear, and
       the check below pins that the other way round */
    const liveSlot = () => page.evaluate(t => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0];
      for (const d of (k.week ? k.week.days : [])) {
        if (d.d <= t) continue;
        const c = Object.keys(d.slots).find(x => d.slots[x]);
        if (c) return { id: d.slots[c], day: d.d, cat: c };
      }
      return null;
    }, pinnedDay);
    let slot = await liveSlot();
    check('the signed-in phone has a planned week to delete a food out of', !!slot, slot);
    if (!slot) throw new Error('no planned slot to run the Undo race against');
    check('the week it planned reached the server', await until(page, id => fetch('/api/household').then(r => r.json()).then(j => JSON.stringify(j.doc).includes(id)), slot.id), slot);

    /* the other phone's push, sent straight to the server so this one's cached
       version is left behind without the app being told: its next push is a
       certain 409, and the marker food can only reach this phone by the merge */
    const aheadOnServer = async marker => page.evaluate(async m => {
      const j = await fetch('/api/household').then(r => r.json());
      const doc = JSON.parse(JSON.stringify(j.doc)), ts = new Date().toISOString();
      const k = doc.kids.filter(x => !x.deletedAt)[0];
      k.foods.push({ id: 't_' + m, kidId: k.id, n: m, c: 'side', t: [], a: 'snacks', al: [], buy: [], createdAt: ts, updatedAt: ts, deletedAt: null });
      k.updatedAt = ts; doc.updatedAt = ts;
      return fetch('/api/household', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc, version: j.version }) }).then(r => r.status);
    }, marker);
    const merged = async marker => until(page, m => JSON.parse(localStorage.getItem('lunchsorted')).kids.some(k => k.foods.some(f => f.n === m && !f.deletedAt)), marker, 5500);   /* the merge measured up to 3.4s on a fast Mac; a CI runner is slower, and the toast is up for 6s */
    const settled = () => until(page, () => fetch('/api/household').then(r => r.json()).then(j => j.doc.updatedAt === JSON.parse(localStorage.getItem('lunchsorted')).updatedAt));
    const tapUndo = async () => { const up = await tapUndoOn(page, 'the toast is still up to tap Undo on'); if(up) await page.waitForTimeout(500); return up; };

    check('the other phone gets its change in first', await aheadOnServer('RaceOne') === 200);
    await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(300);
    await page.click(`[data-act="del-food"][data-id="${slot.id}"]`); await page.waitForTimeout(150);
    check('deleting a food on a signed-in phone offers Undo', (await page.$$eval('#toast [data-act="undo"]', a => a.length)) === 1);
    check('and their document merges in, rebuilt record by record, while that toast is still up', await merged('RaceOne'));
    /* the merge is by record stamp, so the tombstone this phone just wrote has to be the
       newer record or the server's live copy wins and there is nothing left to undo */
    const stamps = await page.evaluate(async id => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0], f = k.foods.find(y => y.id === id);
      const j = await fetch('/api/household').then(r => r.json()), rf = j.doc.kids.filter(x => !x.deletedAt)[0].foods.find(y => y.id === id);
      return { now: new Date().toISOString(), local: f && { updatedAt: f.updatedAt, deletedAt: f.deletedAt }, server: rf && { updatedAt: rf.updatedAt, deletedAt: rf.deletedAt } };
    }, slot.id);
    check('and the food is still off the list after it: the tombstone was the newer record', !!(stamps.local && stamps.local.deletedAt), stamps);
    await tapUndo();
    const back = await page.evaluate(x => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(y => !y.deletedAt)[0];
      const f = k.foods.find(y => y.id === x.id), d = (k.week ? k.week.days : []).find(y => y.d === x.day);
      return { alive: !!(f && !f.deletedAt), inSlot: !!(d && d.slots[x.cat] === x.id), toast: document.getElementById('toast').textContent };
    }, slot);
    /* Under the rule Liz confirmed the compartment never lost the food, so what the merge
       could have broken is the list side: an Undo holding the record itself would have
       un-deleted a food in a document S had already let go of, and said so. */
    check('Undo after that merge puts the food back on the list, against the document that replaced it',
      back.alive && /Put back/.test(back.toast), back);
    check('and the compartment it was drawn into was never disturbed by any of it', back.inSlot, back);
    check('and Undo never says "Put back" over a food it did not restore', back.alive || !/Put back/.test(back.toast), back);

    /* the photo Undo runs the same race. The photo arrives the way one taken on the other
       phone would: on the server, then down to this phone by its pull. It used to be written
       into localStorage under a page that still had the Undo's push due, stamped a second
       ahead of the clock to win the boot pull's merge, and it failed now and then under load
       (2026-09-25). Now this phone's own push lands first, so nothing on the page is left to
       write over the seed, and the server copy is stamped just after every copy of the food,
       so the pull keeps it. That stamp is "now" rather than ahead of it only because the
       suite's clock never runs backwards (SUITE_START); a seed stamped after the photo
       removal below would win the merge and hand Undo a photo that was never gone, which
       the check before Undo is there to catch. */
    check('this phone\u2019s own push has landed (photo)', await settled());
    const seedPut = await page.evaluate(async id => {
      const j = await fetch('/api/household').then(r => r.json());
      const doc = JSON.parse(JSON.stringify(j.doc)), k = doc.kids.filter(x => !x.deletedAt)[0], f = k.foods.find(x => x.id === id);
      const mine = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0].foods.find(x => x.id === id);
      const after = t => t ? new Date(Date.parse(t) + 1).toISOString() : '';
      const ts = [new Date().toISOString(), after(f.updatedAt), after(mine && mine.updatedAt)].sort().pop();
      f.img = 'data:image/jpeg;base64,' + 'A'.repeat(600); f.updatedAt = ts;
      return fetch('/api/household', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc, version: j.version }) }).then(r => r.status);
    }, slot.id);
    check('the photo reaches the server', seedPut === 200, seedPut);
    await page.goto(BASE+'/app/'); await page.waitForLoadState('load');
    const seeded = await until(page, id => { const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0]; const f = k.foods.find(y => y.id === id); return !!(f && f.img); }, slot.id);
    check('the food carries a photo to remove', seeded, slot.id);
    if (!seeded) throw new Error('photo seed did not take; the rest of the block would click a sheet that never opens');
    /* if waking stamped the document, its push goes out before the other phone's PUT, not during it */
    check('this phone\u2019s own push has landed (after the photo)', await settled());
    check('the other phone gets in first again', await aheadOnServer('RaceTwo') === 200);
    await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(300);
    await page.click(`[data-act="food-photo"][data-id="${slot.id}"]`); await page.waitForTimeout(300);
    await page.click('[data-act="food-photo-clear"]'); await page.waitForTimeout(150);
    check('and their document merges in while the photo toast is up', await merged('RaceTwo'));
    const gone = await page.evaluate(id => {
      const f = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0].foods.find(y => y.id === id);
      return { img: !!(f && f.img), updatedAt: f && f.updatedAt, now: new Date().toISOString() };
    }, slot.id);
    check('and the photo is still gone after it: the removal was the newer record, so Undo has something to undo', !gone.img, gone);
    await tapUndo();
    const pic = await page.evaluate(id => {
      const f = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0].foods.find(y => y.id === id);
      return { img: !!(f && f.img), toast: document.getElementById('toast').textContent };
    }, slot.id);
    check('Undo after that merge puts the photo back', pic.img && /Put back/.test(pic.toast), pic);
    check('and never says "Put back" over a photo it did not restore', pic.img || !/Put back/.test(pic.toast), pic);

    /* The other Undos run the same race: a write-in saved, cleared, shuffled over and
       chosen over; a box un-ticked; a recipe saved onto a food and a recipe removed.
       Each one used to hold the records themselves. Between races the phone's own push
       is waited for on the server, so the other phone's PUT is not itself the 409. */
    const serverHas = (what, arg) => until(page, a => fetch('/api/household').then(r => r.json()).then(j => {
      const k = j.doc.kids.filter(x => !x.deletedAt)[0];
      if (a.what === 'food-live') return k.foods.some(f => f.id === a.arg && !f.deletedAt);
      if (a.what === 'slot') return (k.week ? k.week.days : []).some(d => d.d === a.arg.day && d.slots[a.arg.cat] === a.arg.id);
      if (a.what === 'packed') return !!(k.packed[a.arg] && Object.values(k.packed[a.arg]).some(r => !r.off));
      if (a.what === 'recipe-live') return (j.doc.recipes || []).some(r => r.id === a.arg && !r.deletedAt);
      return false;
    }), {what, arg});
    const undoUp = async re => (await page.$$eval('#toast [data-act="undo"]', a => a.length)) === 1 && re.test(await page.textContent('#toast'));
    const openSlot = async () => { await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250); await page.click(`[data-act="slot"][data-day="${slot.day}"][data-cat="${slot.cat}"]`); await page.waitForTimeout(300); };
    const writeIn = async name => { await openSlot(); await page.click('[data-act="write-in"]'); await until(page, () => !!document.getElementById('wiName')); await page.fill('#wiName', name); };
    const slotState = () => page.evaluate(x => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(y => !y.deletedAt)[0];
      const d = (k.week ? k.week.days : []).find(y => y.d === x.day), f = d && k.foods.find(y => y.id === d.slots[x.cat]);
      return { id: d && d.slots[x.cat], n: f && f.n, once: !!(f && f.once), live: !!(f && !f.deletedAt), toast: document.getElementById('toast').textContent };
    }, slot);

    /* a write-in saved: Undo takes the words out and puts the food back */
    await writeIn('Leftover curry');
    check('this phone\u2019s own push has landed (third)', await settled());
    check('the other phone gets in first, a third time', await aheadOnServer('RaceThree') === 200);
    await page.click('[data-act="write-save"]'); await page.waitForTimeout(150);
    check('writing one in offers Undo', await undoUp(/Leftover curry/));
    check('and their document merges in while that toast is up', await merged('RaceThree'));
    await tapUndo();
    const ws = await slotState();
    check('Undo after that merge takes the typed words out and puts the food back', ws.id === slot.id && /Put back/.test(ws.toast), ws);
    check('and the words it took out are tombstoned, not left live on no list', await page.evaluate(() => !JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(y => !y.deletedAt)[0].foods.some(f => f.n === 'Leftover curry' && !f.deletedAt)));

    /* a write-in cleared: Undo puts the words back off the tombstone */
    await writeIn('Leftover curry'); await page.click('[data-act="write-save"]'); await page.waitForTimeout(300);
    const wiId = (await slotState()).id;
    check('a write-in reaches the server', await serverHas('food-live', wiId), wiId);
    check('this phone\u2019s own push has landed (fourth)', await settled());
    check('the other phone gets in first, a fourth time', await aheadOnServer('RaceFour') === 200);
    await openSlot(); await page.click('[data-act="write-clear"]'); await page.waitForTimeout(150);
    check('clearing it offers Undo', await undoUp(/cleared/));
    check('and their document merges in while that toast is up', await merged('RaceFour'));
    await tapUndo();
    const wc = await slotState();
    check('Undo after that merge puts the typed words back in the compartment', wc.id === wiId && wc.live && wc.once && /Put back/.test(wc.toast), wc);

    /* a write-in shuffled over */
    check('and the put-back reaches the server', await serverHas('slot', { day: slot.day, cat: slot.cat, id: wiId }));
    check('this phone\u2019s own push has landed (fifth)', await settled());
    check('the other phone gets in first, a fifth time', await aheadOnServer('RaceFive') === 200);
    await openSlot(); await page.click('[data-act="sheet-shuffle"]'); await page.waitForTimeout(150);
    check('shuffling over a write-in offers Undo', await undoUp(/shuffled away/));
    check('and their document merges in while that toast is up', await merged('RaceFive'));
    await tapUndo();
    const sh = await slotState();
    check('Undo after that merge puts the typed words back, off the tombstone', sh.id === wiId && sh.live && sh.once && /Put back/.test(sh.toast), sh);

    /* a write-in chosen over, off the list */
    check('and that put-back reaches the server', await serverHas('slot', { day: slot.day, cat: slot.cat, id: wiId }));
    check('this phone\u2019s own push has landed (sixth)', await settled());
    check('the other phone gets in first, a sixth time', await aheadOnServer('RaceSix') === 200);
    await openSlot();
    const pickId = await page.$eval('[data-act="pick"]:not(.done)', b => b.getAttribute('data-id'));
    await page.click(`[data-act="pick"][data-id="${pickId}"]`); await page.waitForTimeout(150);
    check('choosing off the list over a write-in offers Undo', await undoUp(/took the write-in|stays flagged/));
    check('and their document merges in while that toast is up', await merged('RaceSix'));
    await tapUndo();
    const pk = await slotState();
    check('Undo after that merge puts the typed words back where the parent put them', pk.id === wiId && pk.live && pk.once && /Put back/.test(pk.toast), pk);
    await openSlot(); await page.click('[data-act="write-clear"]'); await page.waitForTimeout(300);   /* the fixture goes on without it */

    /* a box un-ticked */
    await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(300);
    const packDay = await page.$eval('[data-act="pack-all"]', b => b.getAttribute('data-day'));
    const wasPacked = (await page.$eval('[data-act="pack-all"]', b => b.getAttribute('aria-pressed'))) === 'true';
    const packedState = () => page.evaluate(d => {
      const k = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(y => !y.deletedAt)[0];
      const row = k.packed[d] || {}, day = (k.week ? k.week.days : []).find(y => y.d === d);
      const cats = Object.keys(day ? day.slots : {}).filter(c => day.slots[c] && k.foods.some(f => f.id === day.slots[c] && !f.deletedAt));
      return { ticked: cats.length > 0 && cats.every(c => row[c] && !row[c].off), toast: document.getElementById('toast').textContent };
    }, packDay);
    if (!wasPacked) { await page.click('[data-act="pack-all"]'); await page.waitForTimeout(200); }
    check('the box is ticked', (await packedState()).ticked, packDay);
    check('and the tick reaches the server', await serverHas('packed', packDay));
    check('this phone\u2019s own push has landed (seventh)', await settled());
    check('the other phone gets in first, a seventh time', await aheadOnServer('RaceSeven') === 200);
    await page.click('[data-act="pack-all"]'); await page.waitForTimeout(150);
    check('un-ticking offers Undo', await undoUp(/unpacked/));
    check('and their document merges in while that toast is up', await merged('RaceSeven'));
    await tapUndo();
    check('Undo after that merge ticks the box again', (await packedState()).ticked, await packedState());
    if (!wasPacked) { await page.click('[data-act="pack-all"]'); await page.waitForTimeout(200); }   /* as it was found */

    /* a recipe saved onto a food, then one removed */
    const foodName = await page.evaluate(id => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0].foods.find(f => f.id === id).n, slot.id);
    const pasteRecipe = async () => {
      await page.click('[data-act="tab"][data-tab="recipes"]'); await page.waitForTimeout(300);
      await page.click('[data-act="recipe-import"]'); await until(page, () => !!document.getElementById('riText'));
      await page.fill('#riText', `${foodName}\nServes 2\nPrep 5 minutes\n1 cup cooked rice\n2 tbsp soy sauce\n1. Mix the rice and the sauce.\n2. Pack it cold.`);
      await page.click('[data-act="recipe-paste"]'); await until(page, () => !!document.getElementById('rsName'));
    };
    const recipeState = () => page.evaluate(n => {
      const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const r = (d.recipes || []).filter(x => x.n.toLowerCase() === n.toLowerCase()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      return { id: r && r.id, live: !!(r && !r.deletedAt), steps: r ? r.steps.length : -1,
        linked: r ? d.kids.flatMap(k => k.foods).filter(f => f.recipeId === r.id && !f.deletedAt).length : 0, toast: document.getElementById('toast').textContent };
    }, foodName);
    await pasteRecipe();
    check('this phone\u2019s own push has landed (eighth)', await settled());
    check('the other phone gets in first, an eighth time', await aheadOnServer('RaceEight') === 200);
    await page.click('[data-act="recipe-save"]'); await page.waitForTimeout(150);
    check('saving a recipe onto a food offers Undo', await undoUp(/Saved to your recipes, and onto/));
    check('and their document merges in while that toast is up', await merged('RaceEight'));
    await tapUndo();
    const rs = await recipeState();
    check('Undo after that merge takes the recipe back off the library and off the food', !!rs.id && !rs.live && rs.linked === 0, rs);

    await pasteRecipe(); await page.click('[data-act="recipe-save"]'); await page.waitForTimeout(300);
    const rec = await recipeState();
    check('a recipe saved onto a food is live and linked', rec.live && rec.linked >= 1, rec);
    check('and reaches the server', await serverHas('recipe-live', rec.id), rec.id);
    check('this phone\u2019s own push has landed (ninth)', await settled());
    check('the other phone gets in first, a ninth time', await aheadOnServer('RaceNine') === 200);
    await page.click('[data-act="tab"][data-tab="recipes"]'); await page.waitForTimeout(300);
    await page.click(`[data-act="cook-recipe"][data-id="${rec.id}"]`); await page.waitForTimeout(300);
    await page.click('[data-act="recipe-delete"]'); await page.waitForTimeout(150);
    check('removing a recipe offers Undo', await undoUp(/Recipe removed/));
    check('and their document merges in while that toast is up', await merged('RaceNine'));
    const mid = await recipeState();
    check('and the removal survives the merge: the tombstone travels, and the other phone\u2019s live copy does not bring it back', !!mid.id && !mid.live, mid);
    await tapUndo();
    const rd = await recipeState();
    check('Undo after that merge puts the recipe back with its steps, hooks the food up again, and says so', rd.live && rd.steps === 2 && rd.linked >= 1 && /Put back/.test(rd.toast), rd);

    /* a food of the parent's own put back from under Taken off: the Undo behind that
       held the food and the lunchbox themselves */
    check('this phone\u2019s own push has landed (tenth)', await settled());
    await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(300);
    await page.click(`[data-act="del-food"][data-id="${slot.id}"]`); await page.waitForTimeout(400);
    check('a food with a photo waits under Taken off, with a way back', (await page.$$eval(`[data-act="food-back"][data-id="${slot.id}"]`, a => a.length)) === 1);
    check('and its removal reaches the server', await until(page, id => fetch('/api/household').then(r => r.json()).then(j => j.doc.kids.filter(x => !x.deletedAt)[0].foods.some(f => f.id === id && f.deletedAt)), slot.id));
    check('the other phone gets in first, a tenth time', await aheadOnServer('RaceTen') === 200);
    await page.click(`[data-act="food-back"][data-id="${slot.id}"]`); await page.waitForTimeout(150);
    check('putting it back offers Undo', await undoUp(/back on the list/));
    check('and their document merges in while that toast is up', await merged('RaceTen'));
    await tapUndo();
    const fb = await page.evaluate(id => {
      const f = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(x => !x.deletedAt)[0].foods.find(y => y.id === id);
      return { off: !!(f && f.deletedAt), toast: document.getElementById('toast').textContent };
    }, slot.id);
    check('Undo after that merge takes it off again, and says so', fb.off && /Taken off again/.test(fb.toast), fb);
    await page.click(`[data-act="food-back"][data-id="${slot.id}"]`); await page.waitForTimeout(300);   /* back on the list, as it was found */

  }

  /* a helper sees the pack list and cannot change the plan */
  await openPane(page, 'household');
  await page.click('[data-act="invite-helper"]'); await until(page, () => !!document.querySelector('#inviteUrl'));
  const helperUrl = await page.inputValue('#inviteUrl');
  const ctx3 = await phone();
  const p3 = await ctx3.newPage(); p3.on('pageerror', e => errors.push(String(e.message)));
  await p3.goto(helperUrl); await p3.waitForLoadState('load');
  await until(p3, () => /help with the lunches/i.test(document.querySelector('#view').textContent));
  await p3.fill('#signinEmail', 'gran@example.com'); await p3.click('[data-act="signin-request"]');
  await until(p3, () => !!document.querySelector('[data-dev-link]'));
  const link3 = await p3.getAttribute('[data-dev-link]', 'href');
  await p3.goto(link3); await p3.click('button[type="submit"]'); await p3.waitForURL(/\/app\//); await p3.waitForLoadState('load');
  await until(p3, () => /Join their household/.test(document.querySelector('#view').textContent));
  await p3.click('[data-act="join-accept"]'); await until(p3, () => /Read-only on this phone/.test(document.querySelector('#view').textContent));
  check('a caretaker is told why the app will not let them change anything, on the tab they land on', /Read-only on this phone — checkmarks stay here/.test(await p3.textContent('#view')));
  const helperState = await p3.evaluate(() => fetch('/api/household').then(r => r.json()));
  check('a helper gets the plan and the foods in it, and nothing else', helperState.me.role === 'helper' && helperState.doc.kids.every(k => k.settings.avoidAllergens.length === 0 && k.foods.every(f => f.al.length === 0)) && helperState.members.every(m => !m.email || m.userId === helperState.me.userId));
  /* a write-in must reach the caretaker still marked one, or their copy turns it into
     a food on the Foods tab and a line on the shopping list for what is already home */
  check('a write-in reaches a caretaker still flagged once, so it stays off their lists',
    helperState.doc.kids.every(k => (k.foods || []).every(f => f.once === !!f.once))
    && helperState.doc.kids.flatMap(k => k.foods || []).filter(f => /Leftover/i.test(f.n)).every(f => f.once === true),
    helperState.doc.kids.flatMap(k => (k.foods || []).map(f => ({n: f.n, once: f.once}))).filter(f => /Leftover/i.test(f.n)));
  /* the library is the household's, so a caretaker is sent only the recipes for the
     boxes they can see, and never where a parent found one */
  check('a caretaker gets the recipes for the boxes they are packing, not the whole library, and not their sources',
    Array.isArray(helperState.doc.recipes)
    && helperState.doc.recipes.every(r => !r.src && !r.url)
    && helperState.doc.recipes.every(r => helperState.doc.kids.some(k => k.foods.some(f => f.recipeId === r.id))),
    (helperState.doc.recipes || []).map(r => r.n));
  const helperPut = await p3.evaluate(v => fetch('/api/household', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({doc: JSON.parse(localStorage.getItem('lunchsorted')), version:v})}).then(r => r.status), helperState.version);
  check("a helper's push is refused", helperPut === 403, helperPut);
  await p3.click('[data-act="tab"][data-tab="week"]'); await p3.waitForTimeout(250);
  check('and a helper sees no Shuffle button and no swap cue, only the week', (await p3.$$eval('[data-act="plan-kid"],[data-act="shuffle-day"],.cmp .swap', a => a.length)) === 0 && (await p3.$$eval('.cmp', a => a.length)) > 0);
  {
    const HELPER_OK = new Function('return [' + (APP_SRC.match(/var HELPER_OK = \[([\s\S]*?)\];/) || [, ''])[1] + ']')();
    const drawn = {};
    const sweep = async (where) => { const acts = await p3.$$eval('body [data-act]', a => a.filter(e => !e.closest('#toast') && e.checkVisibility()).map(e => e.getAttribute('data-act'))); acts.forEach(x => { if (!HELPER_OK.includes(x)) drawn[x] = where; }); };
    for (const tab of ['pack', 'week', 'foods', 'shop', 'recipes', 'setup']) {
      await p3.click(`[data-act="tab"][data-tab="${tab}"]`); await p3.waitForTimeout(300);
      await sweep(tab);
    }
    for (const pane of ['account', 'household']) { await openPane(p3, pane); await sweep('pane:' + pane); await p3.click('[data-act="pane-done"]'); await p3.waitForTimeout(200); }
    /* the Lunchboxes sheet: with two lunchboxes its button is on Account, the box pages carrying the folder tabs instead */
    const sheetTab = (await p3.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).length)) > 1 ? 'setup' : 'week';
    await p3.click(`[data-act="tab"][data-tab="${sheetTab}"]`); await p3.waitForTimeout(250);
    const sheetThere = !!(await p3.$('[data-act="kidsheet"]'));
    if (sheetThere) { await p3.click('[data-act="kidsheet"]'); await p3.waitForTimeout(300); await sweep('sheet:lunchboxes'); await backdropTap(p3); await p3.waitForTimeout(300); }
    check('nothing is drawn for a caretaker only to refuse: every control they can see is one they may use', Object.keys(drawn).length === 0 && sheetThere, [drawn, sheetThere]);
    {
      /* two states the household on this phone is not in, reached by changing the server's answer on its way in; the
         phone's own copy is put back after. First, a food a parent wrote and then took off while it is still in a box:
         a caretaker sees it under Taken off, with no Put back to refuse them. */
      await p3.waitForTimeout(250);
      const snap3 = await p3.evaluate(() => localStorage.getItem('lunchsorted'));
      await p3.route('**/api/household', async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const resp = await route.fetch(); const j = await resp.json(); const at = new Date().toISOString();
        if (j && j.doc && Array.isArray(j.doc.kids)) j.doc.kids.forEach((k, i) => k.foods.push({ id: 'food_smoketaken' + i, kidId: k.id, n: 'Smoke pickle plate', c: 'side', t: [], a: 'other', al: [], buy: null, once: false, recipeId: null, img: null, createdAt: at, updatedAt: at, deletedAt: at }));
        return route.fulfill({ response: resp, json: j });
      });
      await p3.reload(); await p3.waitForLoadState('load');
      await p3.click('[data-act="tab"][data-tab="foods"]');
      const takenShown = await until(p3, () => /Taken off/.test(document.querySelector('#view').textContent) && /Smoke pickle plate/.test(document.querySelector('#view').textContent));
      check('a food taken off is listed for a caretaker with no Put back', takenShown && (await p3.$$eval('[data-act="food-back"]', a => a.length)) === 0, [takenShown, (await p3.textContent('#view')).replace(/\s+/g, ' ').slice(-200)]);
      await p3.unroute('**/api/household');
      /* then the same walk with nothing planned. A caretaker is sent only the foods in the boxes, so an unplanned household
         reaches them as lunchboxes with no foods at all: every empty page has to stand without a button they cannot
         use, or a word telling them to add foods. */
      await p3.route('**/api/household', async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const resp = await route.fetch(); const j = await resp.json();
        if (j && j.doc && Array.isArray(j.doc.kids)) j.doc.kids.forEach(k => { k.week = null; k.next = null; k.foods = []; });
        return route.fulfill({ response: resp, json: j });
      });
      await p3.waitForTimeout(250);
      await p3.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids.forEach(k => { k.week = null; k.next = null; k.foods = []; }); localStorage.setItem('lunchsorted', JSON.stringify(d)); });
      await p3.reload(); await p3.waitForLoadState('load');
      await until(p3, () => /Nothing planned yet/.test(document.querySelector('#view').textContent));   /* the pull has answered: the page knows whose phone this is */
      const bare = {}; let words = '';
      for (const tab of ['pack', 'week', 'foods', 'shop']) {
        await p3.click(`[data-act="tab"][data-tab="${tab}"]`); await p3.waitForTimeout(300);
        const acts = await p3.$$eval('body [data-act]', a => a.filter(e => !e.closest('#toast') && e.checkVisibility()).map(e => e.getAttribute('data-act')));
        acts.forEach(x => { if (!HELPER_OK.includes(x)) bare[x] = tab; });
        words += ' ' + tab + ': ' + (await p3.textContent('#view'));
      }
      check('and with nothing planned, every empty page stands without a button a caretaker cannot use or a word telling them to add foods',
        Object.keys(bare).length === 0 && !/Add foods|Add a few things|Fill the list|idea bank|no foods yet/i.test(words) && /Nothing planned yet/.test(words), [bare, words.replace(/\s+/g, ' ').slice(0, 400)]);
      await p3.unroute('**/api/household');
      await p3.waitForTimeout(250);
      await p3.evaluate(s => localStorage.setItem('lunchsorted', s), snap3);
      await p3.reload(); await p3.waitForLoadState('load');
      await until(p3, () => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return !!document.querySelector('#view .tin, #view .daycard') && d.kids.some(k => k.week && k.week.days.length && (k.foods || []).length) && !d.kids.some(k => (k.foods || []).some(f => /Smoke pickle plate/.test(f.n))); });
    }
    await p3.click('[data-act="tab"][data-tab="week"]'); await p3.waitForTimeout(250);
  }
  await p3.click('.daycard:not(.past) .cmp >> nth=0'); await p3.waitForTimeout(200);
  check('and a compartment is not a button for a caretaker: nothing is drawn only to refuse', (await p3.$$eval('.cmp[data-act], .cmp button', a => a.length)) === 0 && (await p3.$$eval('.daycard:not(.past) .cmp', a => a.every(c => c.tagName === 'DIV' && !c.getAttribute('aria-label')))), await p3.$$eval('.daycard:not(.past) .cmp', a => a.map(c => c.tagName + (c.getAttribute('aria-label') || ''))));
  {
    /* the roster on the numbers page: who else is on an account, and when each of them was last active */
    const { standard } = (await adminStats()).roster;
    const sam = standard.find(x => x.email === 'sam@example.com') || {};
    const gran = standard.find(x => x.email === 'gran@example.com') || {};
    check('the roster names the second parent and the caretaker on an account, with the day each was last active',
      sam.role === 'Parent' && gran.role === 'Caretaker' && sam.hh === gran.hh &&
      /gran@example\.com \(caretaker, last active [A-Z]/.test(sam.others) && /sam@example\.com \(parent, last active [A-Z]/.test(gran.others),
      [sam, gran]);
    check('and every row of that household says the same thing was added to it',
      standard.filter(x => x.hh === sam.hh).every(x => x.household === 'A parent and a caretaker'),
      standard.filter(x => x.hh === sam.hh).map(x => x.household));
    const granDays = (await db.query(`SELECT days_seen AS n FROM users WHERE email = 'gran@example.com'`)).rows[0].n;
    check('signing in counts that day straight away, without waiting for the hourly touch', granDays === 1, granDays);
    check('while someone who has signed in and never made a household is marked as having none', standard.some(x => x.role === 'No household' && x.plan === '' && x.household === ''), standard.map(x => [x.email, x.role]));
  }
  await ctx3.close();

  /* a returning parent on a fresh phone signs in from the first screen and gets the lunches back */
  {
    /* what the household calls Sam before he signs in anywhere new: the name must survive, not become "Sam" from the address */
    const samId = await p2.evaluate(() => localStorage.getItem('lunchsorted-device'));
    await p2.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); const me = d.members.find(m => m.id === localStorage.getItem('lunchsorted-device')); me.name = 'Dad'; me.updatedAt = new Date().toISOString(); localStorage.setItem('lunchsorted', JSON.stringify(d)); });
    await p2.evaluate(() => fetch('/api/household').then(r => r.json()).then(j => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return fetch('/api/household', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({doc:d, version:j.version})}); }));
    const ctxR = await phone(); const pr = await ctxR.newPage(); pr.on('pageerror', e => errors.push(String(e.message)));
    await pr.goto(BASE+'/app/'); await pr.waitForTimeout(300);
    check('the first screen offers sign-in to someone who already has an account', (await pr.$$eval('[data-act="ob-signin"]', a => a.length)) === 1);
    await pr.click('[data-act="ob-signin"]'); await pr.waitForTimeout(200);
    check('and that screen says welcome back, with a way back to the questions', /Welcome back/.test(await pr.textContent('#view')) && /set up from scratch/.test(await pr.textContent('#view')));
    await pr.fill('#signinEmail', 'sam@example.com'); await pr.press('#signinEmail', 'Enter'); await until(pr, () => !!document.querySelector('[data-dev-link]'));
    check('after sending, a returning parent is not offered a week that does not exist yet', (await pr.$$eval('[data-act="ob-later"]', a => a.filter(b => /See the week/.test(b.textContent)).length)) === 0);
    await pr.goto(await pr.getAttribute('[data-dev-link]', 'href')); await pr.click('button[type="submit"]'); await pr.waitForURL(/\/app\//); await pr.waitForLoadState('load');
    const backWith = await until(pr, () => !!document.querySelector('.tin') && JSON.parse(localStorage.getItem('lunchsorted')).kids.some(k => k.foods.length));
    check('the fresh phone shows the household\'s own lunchbox, not its empty placeholder', backWith && await pr.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); const live = d.kids.filter(k => !k.deletedAt); return live.length === 2 && live.some(k => k.id === d.activeKidId && k.foods.length > 0); }), await pr.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.map(k => [k.name, k.foods.length, !!k.deletedAt])));
    check('and the household still calls him what it called him', await pr.evaluate(id => { const d = JSON.parse(localStorage.getItem('lunchsorted')); const me = d.members.find(m => m.id === id); return !!me && me.name === 'Dad' && localStorage.getItem('lunchsorted-device') === id && d.members.filter(m => !m.deletedAt).length === 2; }, samId), await pr.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).members.map(m => [m.id, m.name, !!m.deletedAt])));
    check('the link brings the household back onto the fresh phone', backWith, backWith ? '' : await pr.evaluate(() => ({ kids: JSON.parse(localStorage.getItem('lunchsorted')).kids.map(k => [k.name, k.foods.length]), ob: !!JSON.parse(localStorage.getItem('lunchsorted')).onboardedAt, view: document.querySelector('#view').textContent.replace(/\s+/g, ' ').slice(0, 120) })));
    await ctxR.close();
  }

  /* sign out clears the phone and sends anything unsent first; delete removes the household everywhere */
  await p2.click('[data-act="tab"][data-tab="setup"]'); await p2.waitForTimeout(250);
  await p2.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids[0].name = 'Ollie Unsent'; d.kids[0].updatedAt = new Date().toISOString(); localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await p2.reload(); await p2.waitForLoadState('load'); await openPane(p2, 'account'); await until(p2, () => !!document.querySelector('[data-act="signout"]'));
  await p2.click('[data-act="signout"]'); await p2.waitForTimeout(250);
  check('Sign out asks first: the first tap arms the button, says what goes, and clears nothing',
    /Tap again to sign out/.test(await p2.textContent('[data-act="signout"]')) && /clears this phone/.test(await p2.textContent('#toast'))
    && (await p2.$$eval('[data-act="disarm"]', a => a.length)) === 1
    && await p2.evaluate(() => !!JSON.parse(localStorage.getItem('lunchsorted')).onboardedAt), await p2.textContent('[data-act="signout"]'));
  await p2.click('[data-act="disarm"]'); await p2.waitForTimeout(200);
  check('and Stay stands it down', /^Sign out$/.test((await p2.textContent('[data-act="signout"]')).trim()));
  await p2.click('[data-act="signout"]'); await p2.waitForTimeout(200);
  await p2.click('[data-act="signout"]'); await until(p2, () => !!document.querySelector('.ob') && !!localStorage.getItem('lunchsorted'));
  const cleared = await p2.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return !d.onboardedAt && !d.kids.some(k => k.foods.length) && !d.kids.some(k => k.name === 'Ollie'); });
  const onServer = (await db.query(`SELECT h.doc FROM households h JOIN household_members m ON m.household_id = h.id JOIN users u ON u.id = m.user_id WHERE u.email = 'sam@example.com'`)).rows[0];
  check('signing out sends the last change, then leaves the phone blank at onboarding', cleared && !!onServer && onServer.doc.kids.some(k => k.name === 'Ollie Unsent'), [cleared, onServer && onServer.doc.kids.map(k => k.name)]);
  await ctx2.close();
  await openPane(page, 'account');
  /* the one irreversible act asks for the word, and says what goes before it asks */
  const deleteWarning = await page.textContent('#view');
  check('deleting says it cannot be undone and names everything that goes', await page.evaluate(() => {
    const t = document.querySelector('#view').textContent;
    return /not undoable/.test(t) && /no copy afterwards/.test(t) && /Your sign-in/.test(t) && /Copy your lunches/.test(t);
  }), deleteWarning.replace(/\s+/g, ' ').slice(0, 260));
  check('and never names a backup button this browser does not have', await page.evaluate(() =>
    !!document.querySelector('[data-act="save-file"]') === /save a backup file/i.test(document.querySelector('#view').textContent)));
  check('signed in there is no erase-this-phone button to mistake for it',
    (await page.$$eval('[data-act="clear-all"]', a => a.length)) === 0 && /nothing to erase from this phone alone/.test(await page.textContent('#view')));
  check('and the button will not fire until DELETE is typed', await page.$eval('[data-act="delete-account"]', b => b.disabled));
  await page.fill('#deleteConfirm', 'delete me'); await page.waitForTimeout(120);
  check('a near miss does not arm it', await page.$eval('[data-act="delete-account"]', b => b.disabled));
  await page.fill('#deleteConfirm', 'DELETE'); await page.waitForSelector('[data-act="delete-account"]:not([disabled])');
  check('and the word itself does', !(await page.$eval('[data-act="delete-account"]', b => b.disabled)));
  /* left standing, the word armed the page for the next visit and for the next person */
  await page.click('[data-act="pane-done"]'); await page.waitForTimeout(250);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  await openPane(page, 'account'); await page.waitForTimeout(250);
  check('leaving the page throws the typed word away rather than leaving it armed',
    (await page.inputValue('#deleteConfirm')) === '' && await page.$eval('[data-act="delete-account"]', b => b.disabled));
  await page.fill('#deleteConfirm', 'DELETE'); await page.waitForSelector('[data-act="delete-account"]:not([disabled])');
  const lizKey = 'link:' + crypto.createHash('sha256').update('liz@example.com').digest('hex').slice(0, 24);
  const lizMarks = async () => (await db.query('SELECT count(*)::int AS n FROM rate_events WHERE key = $1', [lizKey])).rows[0].n;
  const lizHad = await lizMarks();
  await page.click('[data-act="delete-account"]'); await until(page, () => !!document.querySelector('.ob') && !!localStorage.getItem('lunchsorted'));   /* the fresh document lands after the save debounce */
  const afterDelete = await page.evaluate(() => fetch('/api/household').then(r => r.status));
  check('deleting the account signs out, removes the household from the server, and starts this phone over',
    afterDelete === 401 && (await page.$$eval('.ob', a => a.length)) === 1 &&
    await page.evaluate(() => !JSON.parse(localStorage.getItem('lunchsorted')).kids.some(k => k.foods.length)));
  const rowsLeft = await db.query(`SELECT (SELECT count(*)::int FROM households) AS h, (SELECT count(*)::int FROM users WHERE email='liz@example.com') AS u`);
  check('and the rows are really gone', rowsLeft.rows[0].u === 0, rowsLeft.rows[0]);
  check('and so are the sign-in counts kept under a digest of the address', lizHad > 0 && (await lizMarks()) === 0, [lizHad, await lizMarks()]);
  await page.evaluate(raw => localStorage.setItem('lunchsorted', raw), goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(500);

  /* ------------------------------------------------- the database address */
  {
    /* the same leak as the two keys', for the database (security review of the Resend key fix,
       2026-09-30): the driver's error about an address it cannot read, or cannot send, quotes it
       whole, password and all, and every function logs what it throws. The build refuses an address
       pasted with more than the address, a running function too, and what the driver says about a
       connection never leaves db.js. The addresses here are made up, with a short password, and
       whatever would go out goes to a port fetch never opens */
    const dbLib = await import('../netlify/lib/db.js');
    const { neon, neonConfig, NeonDbError } = await import('@neondatabase/serverless');
    const { inspect, format } = await import('node:util');
    const PW = 'Dq7Wm42', hidden = (s) => !/Dq7|Wm42|made-up/.test(String(s)), shown = (e) => e ? [e.message, e.stack, inspect(e)].join('\n') : '';
    const ALONE = `postgresql://owner:${PW}@ep-made-up-1.example.invalid/lunch?sslmode=require&channel_binding=require`;
    const pasted = [`DATABASE_URL='${ALONE}'`, `psql '${ALONE}'`, `'${ALONE}'`, `"${ALONE}"`, ALONE.replace('@', '\n@'), ALONE.replace('made-up-1', 'made-up 1'),
      String.fromCharCode(0x200b) + ALONE, ALONE.replace('postgresql:', 'https:'), ' \r\n'];   /* Neon's .env line, its psql command, quotes, a line break inside, a space in the host, an invisible letter from a web page, not an address, nothing */
    const unread = [ALONE.replace('.invalid/', '.invalid:99999/'), ALONE.replace(PW, PW + '%zz')];   /* the shape lets these by; the driver cannot read them */
    const VARS = ['SITE_ENV', 'CONTEXT', 'NETLIFY_DATABASE_URL', 'NETLIFY_DB_URL', 'STAGING_DATABASE_URL', 'DEV_DB_URL'];
    /* until the block ends the driver goes nowhere but the port fetch never opens, so a query that
       ran later than it should would still stay on this machine */
    const endpoint = neonConfig.fetchEndpoint; neonConfig.fetchEndpoint = 'http://127.0.0.1:9/';
    /* the environment, the suite's own database and the driver's fetch are read before the first
       await, by databaseUrl(), sql() and a handler alike, so each goes back at once, before anything
       else in this process can see them */
    const using = (vars, work, fetchFn) => {
      const was = { v: VARS.map(k => process.env[k]), s: globalThis.__LS_SQL, fn: neonConfig.fetchFunction };
      for (const k of VARS) delete process.env[k];
      Object.assign(process.env, vars); delete globalThis.__LS_SQL; neonConfig.fetchFunction = fetchFn;
      try { return work(); }
      finally { VARS.forEach((k, i) => { if (was.v[i] === undefined) delete process.env[k]; else process.env[k] = was.v[i]; }); globalThis.__LS_SQL = was.s; neonConfig.fetchFunction = was.fn; }
    };
    const told = (vars) => using(vars, () => { try { return { url: dbLib.databaseUrl() }; } catch (e) { return { refused: String(e.message) }; } });
    const refusals = pasted.map(v => told({ SITE_ENV: 'preview', STAGING_DATABASE_URL: v }));
    const named = [told({ SITE_ENV: 'production', NETLIFY_DATABASE_URL: pasted[1] }), told({ SITE_ENV: 'production', NETLIFY_DB_URL: pasted[2] }), told({ SITE_ENV: 'staging', DEV_DB_URL: pasted[0] }),
      told({ CONTEXT: 'deploy-preview', STAGING_DATABASE_URL: pasted[3] }), told({ CONTEXT: 'branch-deploy', STAGING_DATABASE_URL: pasted[5] }), told({ SITE_ENV: 'dev', DEV_DB_URL: pasted[6] }),
      told({ SITE_ENV: 'production', NETLIFY_DATABASE_URL: ' \n', NETLIFY_DB_URL: ALONE })];   /* without SITE_ENV, Netlify's CONTEXT decides; nothing but whitespace is refused, even beside a good older name */
    const taken = [told({ SITE_ENV: 'preview', STAGING_DATABASE_URL: ALONE }), told({ SITE_ENV: 'staging', STAGING_DATABASE_URL: '\n ' + ALONE + '\r\n' }), told({ SITE_ENV: 'production', NETLIFY_DATABASE_URL: ALONE.replace('postgresql:', 'postgres:') }), told({ SITE_ENV: 'production', STAGING_DATABASE_URL: ALONE })];
    check('a database address pasted with more than the address is refused in every context, whether SITE_ENV or Netlify\'s CONTEXT names it, in words that name the variable read and hold nothing of it, and nothing but whitespace is refused, not skipped; the address alone, or with whitespace around it, is taken',
      refusals.every(r => r.refused && /^STAGING_DATABASE_URL (must be postgres:\/\/ or postgresql:\/\/|holds only spaces or line breaks)/.test(r.refused) && hidden(r.refused)) &&
      /^NETLIFY_DATABASE_URL must be/.test(named[0].refused) && /^NETLIFY_DB_URL must be/.test(named[1].refused) && /^DEV_DB_URL must be/.test(named[2].refused) &&
      /^STAGING_DATABASE_URL must be/.test(named[3].refused) && /^STAGING_DATABASE_URL must be/.test(named[4].refused) && /^DEV_DB_URL must be/.test(named[5].refused) &&
      /^NETLIFY_DATABASE_URL holds only spaces or line breaks/.test(named[6].refused) && named.every(r => hidden(r.refused)) &&
      taken[0].url === ALONE && taken[1].url === ALONE && taken[2].url === ALONE.replace('postgresql:', 'postgres:') && taken[3].url === '',
      { refusals, named, taken: taken.map(t => t.refused || (t.url === '' ? 'none' : 'taken')) });

    /* the premise, with the driver on its own: its words about the address quote it whole */
    const driverSays = (url, fetchFn) => using({}, () => { try { return neon(url)`SELECT 1`.then(() => null, e => e); } catch (e) { return Promise.resolve(e); } }, fetchFn);
    const theirs = await Promise.all([...pasted.slice(0, 7), ...unread].map(u => driverSays(u)));   /* not the last two: it names no part of an address that is not one, or of nothing */
    check('the premise, as the security review found: the driver\'s own error quotes the address, password and all, whether it cannot read it or fetch will not send it',
      theirs.every(e => !!e && shown(e).includes(PW)) && /is not a valid URL/.test(theirs[0].message) && /invalid header value/.test(theirs[4].message), theirs.map(e => e && e.message.slice(0, 60)));

    /* what leaves db.js. The hook spoils the address on its way into the real fetch, as a line break
       pasted inside it would, and answers, or breaks off, in the worst words it can */
    const spoil = (url, init) => fetch(url, { ...init, headers: { ...init.headers, 'Neon-Connection-String': init.headers['Neon-Connection-String'].replace('@', '\n@') } });
    const answer = (status, body) => () => Promise.resolve(new Response(body, { status }));
    const unique = JSON.stringify({ message: 'duplicate key value violates unique constraint "entitlements_apple_original_transaction_id_key"', code: '23505', severity: 'ERROR', detail: 'Key (apple_original_transaction_id)=(2000000000000400) already exists.', constraint: 'entitlements_apple_original_transaction_id_key' });
    const one = JSON.stringify({ fields: [{ name: 'n', dataTypeID: 23 }], rows: [['1']], command: 'SELECT', rowCount: 1 });
    const viaSql = (url, fetchFn, text, value = 1) => using({ SITE_ENV: 'preview', STAGING_DATABASE_URL: url }, () => {
      try { const q = dbLib.sql(); return (text ? q('SELECT 1 AS n') : q`SELECT ${value}::int AS n`).then(rows => ({ rows }), e => ({ e })); } catch (e) { return Promise.resolve({ e }); }
    }, fetchFn);
    const ESCAPED = ALONE.replace(PW, 'Dq7%7bWm42'), loop = {}; loop.self = loop;   /* a password with a percent escape in it; a value no query can carry */
    const SIGMA = String.fromCharCode(0x3a3), SIGMA_URL = ALONE.replace(PW, 'Dq7Wm%CE%A3');   /* a capital sigma lowercases one way alone and another inside a word */
    const proxy = (message) => answer(400, JSON.stringify({ message, code: '' }));   /* Neon's proxy checks the password itself and sends its own refusals with an empty code */
    const logged = [], watching = async (work) => { const was = {};
      for (const m of ['log', 'info', 'warn', 'error', 'debug']) { was[m] = console[m]; console[m] = (...a) => { logged.push(format(...a)); was[m].apply(console, a); }; }
      try { return await work(); } finally { Object.assign(console, was); } };
    const anon = () => new Request('http://localhost/api/apple/link', { method: 'POST', headers: { authorization: 'Bearer ' + 'a'.repeat(24), 'content-type': 'application/json' }, body: '{}' });
    const [unreadable, spoiled, closed, refusedQuery, echoed, down, junk, fine, fineText, hinted, escaped, unsent, proxied, proxiedLeak, sigma, appleAnswer] = await watching(() => Promise.all([
      viaSql(unread[0]), viaSql(ALONE, spoil), viaSql(ALONE),
      viaSql(ALONE, answer(400, unique)), viaSql(ALONE, answer(400, JSON.stringify({ message: 'no such endpoint in ' + ALONE, code: 'XX000' }))),
      viaSql(ALONE, answer(503, 'upstream said ' + ALONE)), viaSql(ALONE, answer(200, 'not json: ' + ALONE)),
      viaSql(ALONE, answer(200, one)), viaSql(ALONE, answer(200, one), true),
      /* a refusal with the password in a field that is not words, and one with a percent escape in the other case */
      viaSql(ALONE, answer(400, JSON.stringify({ message: 'no such role', code: '28000', hint: ['try ' + PW] }))), viaSql(ESCAPED, answer(400, JSON.stringify({ message: 'password Dq7%7BWm42 is wrong', code: '28P01' }))),
      viaSql(ALONE, answer(200, one), false, loop),
      viaSql(ALONE, proxy('password authentication failed for user "owner"')), viaSql(ALONE, proxy('no endpoint for ' + ALONE)),
      viaSql(SIGMA_URL, answer(400, JSON.stringify({ message: 'role pw Dq7Wm' + SIGMA + 'x is wrong', code: '28P01' }))),
      /* and through api-apple, which had no last catch: anyone can send a bearer token of the right shape, and the first thing it meets is a query */
      using({ SITE_ENV: 'preview', STAGING_DATABASE_URL: ALONE }, () => appleHandler(anon()), spoil).then(async r => ({ status: r.status, body: await r.json() }))]));
    const ours = [unreadable, spoiled, closed, echoed, down, junk, hinted, escaped, unsent, proxiedLeak, sigma].map(r => r.e);
    check('but what leaves db.js holds none of it, in its message, its stack or anything it carries, whether the driver could not read the address, fetch would not send it, nothing answered, or an answer quoted it',
      ours.every(e => !!e && hidden(shown(e)) && e.cause === undefined && !(e instanceof NeonDbError) && !/unique|duplicate/i.test(e.message)) &&
      /^STAGING_DATABASE_URL could not be read as a database address \(/.test(unreadable.e.message) && /^No answer from the database \(/.test(spoiled.e.message) && /^No answer from the database \(/.test(closed.e.message) &&
      /^The database refused a query in words that hold the password/.test(echoed.e.message) && echoed.e.code === 'XX000' &&
      /^The database refused a query in words that hold the password/.test(hinted.e.message) && hinted.e.code === '28000' &&
      /^The database refused a query in words that hold the password/.test(escaped.e.message) && escaped.e.code === '28P01' &&
      /^The database refused a query in words that hold the password/.test(proxiedLeak.e.message) && proxiedLeak.e.code === undefined &&
      /^The database refused a query in words that hold the password/.test(sigma.e.message) && sigma.e.code === '28P01' &&
      /^The database answered 503, but not with a result \(/.test(down.e.message) &&
      /^A query could not be sent to the database, or its answer could not be read \(/.test(junk.e.message) && /^A query could not be sent to the database, or its answer could not be read \(/.test(unsent.e.message),
      ours.map(e => e && e.message));
    check('while a refusal the database answered with comes through in its own words, with the code api-apple reads, the proxy\'s own with its empty code too, and a result comes back as before',
      refusedQuery.e instanceof NeonDbError && refusedQuery.e.code === '23505' && /^duplicate key value violates unique constraint/.test(refusedQuery.e.message) &&
      proxied.e instanceof NeonDbError && proxied.e.code === '' && proxied.e.message === 'password authentication failed for user "owner"' &&
      JSON.stringify(fine.rows) === '[{"n":1}]' && JSON.stringify(fineText.rows) === '[{"n":1}]', { refused: refusedQuery.e && refusedQuery.e.message, proxied: proxied.e && proxied.e.message, fine, fineText });
    check('and api-apple, reached anonymously while the database cannot be, answers 500 in its own words and logs ours',
      appleAnswer.status === 500 && appleAnswer.body.error === 'Something went wrong on our side' && logged.some(l => /^api-apple Error: No answer from the database \(/.test(l)), { appleAnswer, logged });
    /* a transaction, as the sign-in limits take one (sql().transaction), goes through the same door: what the driver says
       about it is told in the same fixed words, and its results come back one list of rows a statement */
    const viaTx = (url, fetchFn) => using({ SITE_ENV: 'preview', STAGING_DATABASE_URL: url }, () => {
      try { return dbLib.sql().transaction(q => [q`SELECT 1 AS n`, q`SELECT ${1}::int AS n`]).then(results => ({ results }), e => ({ e })); } catch (e) { return Promise.resolve({ e }); }
    }, fetchFn);
    const bothRows = JSON.stringify({ results: [JSON.parse(one), JSON.parse(one)] });
    const [txSpoiled, txDown, txEchoed, txFine] = await watching(() => Promise.all([
      viaTx(ALONE, spoil), viaTx(ALONE, answer(503, 'upstream said ' + ALONE)),
      viaTx(ALONE, answer(400, JSON.stringify({ message: 'no such endpoint in ' + ALONE, code: 'XX000' }))), viaTx(ALONE, answer(200, bothRows))]));
    check('and a transaction, as the sign-in limits take one, goes through the same door: nothing of the address in what it throws, and its results come back one list of rows a statement',
      [txSpoiled, txDown, txEchoed].every(r => !!r.e && hidden(shown(r.e)) && r.e.cause === undefined && !(r.e instanceof NeonDbError)) &&
      /^No answer from the database \(/.test(txSpoiled.e.message) && /^The database answered 503, but not with a result \(/.test(txDown.e.message) &&
      /^The database refused a query in words that hold the password/.test(txEchoed.e.message) && txEchoed.e.code === 'XX000' && JSON.stringify(txFine.results) === '[[{"n":1}],[{"n":1}]]',
      { spoiled: txSpoiled.e && txSpoiled.e.message, down: txDown.e && txDown.e.message, echoed: txEchoed.e && txEchoed.e.message, fine: txFine.results });
    check('and nothing this process wrote to its console meanwhile holds the address, whichever console method it came through', logged.length >= 1 && logged.every(l => hidden(l)), logged);
    /* the driver's own query ran again at every await; the suite's database never did */
    let asked = 0, twice = null;
    const counted = () => { asked++; return Promise.resolve(new Response(one, { status: 200 })); }, hookWas = neonConfig.fetchFunction;
    neonConfig.fetchFunction = counted;   /* in place across both awaits, so a second run would be counted, not sent */
    try { const p = using({ SITE_ENV: 'preview', STAGING_DATABASE_URL: ALONE }, () => dbLib.sql()`SELECT ${1}::int AS n`, counted); twice = await p; await p; }
    finally { neonConfig.fetchFunction = hookWas; }
    check('and a query runs once, however often it is awaited, as the suite\'s own database runs it', asked === 1 && JSON.stringify(twice) === '[{"n":1}]', { asked, twice });
    neonConfig.fetchEndpoint = endpoint;

    /* the build, spawned with its environment spelled out, so nothing of this machine's reaches it.
       Past the check it would go to Neon, so a preload points the driver at the port fetch never
       opens, and spoils the address on its way, as a line break pasted inside it would */
    const { spawnSync } = await import('node:child_process');
    const preload = 'data:text/javascript,' + encodeURIComponent(`import { neonConfig } from ${JSON.stringify(import.meta.resolve('@neondatabase/serverless'))};
      neonConfig.fetchEndpoint = 'http://127.0.0.1:9/';
      const none = () => Promise.resolve(new Response(JSON.stringify({ fields: [{ name: 'name', dataTypeID: 25 }], rows: [], command: 'SELECT', rowCount: 0 }), { status: 200 }));
      neonConfig.fetchFunction = process.env.SMOKE_REFUSAL
        ? (url, init) => process.env.SMOKE_FILES_ONLY && /schema_migrations/.test(JSON.parse(init.body).query) ? none() : Promise.resolve(new Response(process.env.SMOKE_REFUSAL, { status: 400 }))
        : (url, init) => fetch(url, { ...init, headers: { ...init.headers, 'Neon-Connection-String': init.headers['Neon-Connection-String'].replace('@', '\\n@') } });`);
    const build = (env) => spawnSync(process.execPath, ['--import', preload, path.join(ROOT, '..', 'scripts', 'migrate.mjs')], { env, encoding: 'utf8', timeout: 30000 });
    const out = (r) => r.stdout + r.stderr;
    const refused = build({ SITE_ENV: 'preview', STAGING_DATABASE_URL: pasted[1] }), prod = build({ SITE_ENV: 'production', NETLIFY_DATABASE_URL: pasted[0] }),
      both = build({ SITE_ENV: 'preview', STAGING_DATABASE_URL: pasted[4], STRIPE_SECRET_KEY: 'sk_test_Pasted42\n' }),
      cannot = build({ SITE_ENV: 'preview', STAGING_DATABASE_URL: unread[1] }), alone = build({ SITE_ENV: 'preview', STAGING_DATABASE_URL: '\n' + ALONE + '\n' });
    check('and the build refuses the deploy over it, loudly, naming the variable and not the address, and names the Stripe key too when both are bad',
      refused.status === 1 && /deploy refused: STAGING_DATABASE_URL must be/.test(refused.stderr) && prod.status === 1 && /deploy refused: NETLIFY_DATABASE_URL must be/.test(prod.stderr) &&
      both.status === 1 && /deploy refused: STRIPE_SECRET_KEY must be/.test(both.stderr) && /deploy refused: STAGING_DATABASE_URL must be/.test(both.stderr) && !out(both).includes('Pasted42') &&
      [refused, prod, both].every(r => hidden(out(r)) && !/migrate:/.test(r.stdout)),
      { refused: [refused.status, out(refused)], prod: [prod.status, out(prod)], both: [both.status, out(both)] });
    check('while an address it lets by, alone or with a line break around it, goes on to the database, and the build tells what the driver said in fixed words, never its own',
      cannot.status === 1 && /migrate failed: STAGING_DATABASE_URL could not be read as a database address/.test(cannot.stderr) && alone.status === 1 && /migrate failed: No answer from the database/.test(alone.stderr) &&
      [cannot, alone].every(r => hidden(out(r)) && !/deploy refused/.test(r.stderr)), { cannot: [cannot.status, out(cannot)], alone: [alone.status, out(alone)] });
    /* the preload answers with the refusal it is handed: every statement, or, with SMOKE_FILES_ONLY, a migration's alone */
    const refusal = (words, filesOnly) => build({ SITE_ENV: 'preview', STAGING_DATABASE_URL: ALONE, SMOKE_REFUSAL: JSON.stringify(words), ...(filesOnly ? { SMOKE_FILES_ONLY: '1' } : {}) });
    const exists = refusal({ message: 'relation "households" already exists', code: '42P07', severity: 'ERROR', position: '14' }, true),
      wrong = refusal({ message: 'password authentication failed for user "owner"', code: '' }), leaky = refusal({ message: 'password authentication failed for user "owner" with ' + PW, code: '' });
    check('and a migration the database refuses fails the build in the database\'s own words, naming the file, with its code and where it stopped; a wrong password the proxy refuses before any file, in its words too; unless they hold the password',
      exists.status === 1 && /migrate failed: 0001_\w+\.sql: relation "households" already exists \(code 42P07, position 14\)/.test(exists.stderr) &&
      wrong.status === 1 && /migrate failed: password authentication failed for user "owner"$/m.test(wrong.stderr) &&
      leaky.status === 1 && /migrate failed: The database refused a query in words that hold the password, so they are left out$/m.test(leaky.stderr) && [exists, wrong, leaky].every(r => hidden(out(r))),
      { exists: [exists.status, out(exists)], wrong: [wrong.status, out(wrong)], leaky: [leaky.status, out(leaky)] });
  }

  /* ------------------------------------------------------------ billing */
  const bcfgOff = await page.evaluate(() => fetch('/api/billing').then(r => r.json()));
  check('with no Stripe in the deploy nothing is gated', bcfgOff.enabled === false);
  /* the key guard: a live key can never serve a branch, a test key can never serve production */
  const putEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };   /* unset goes back unset, not as 'undefined' */
  const said = (env, key) => { const was = { e: process.env.SITE_ENV, k: process.env.STRIPE_SECRET_KEY }; process.env.SITE_ENV = env; process.env.STRIPE_SECRET_KEY = key;
    try { stripeLib.stripeKey(); return null; } catch (e) { return String(e.message); } finally { putEnv('SITE_ENV', was.e); putEnv('STRIPE_SECRET_KEY', was.k); } };
  const guard = (env, key) => said(env, key) !== null;
  {
    const { siteEnv } = await import('../netlify/lib/db.js');
    const was = process.env.SITE_ENV; delete process.env.SITE_ENV;
    process.env.CONTEXT = 'branch-deploy'; const a = siteEnv();
    process.env.CONTEXT = 'deploy-preview'; const b = siteEnv();
    delete process.env.CONTEXT; const c = siteEnv();
    process.env.SITE_ENV = was;
    check('without SITE_ENV a function still knows a branch deploy from production, from Netlify\'s CONTEXT', a === 'staging' && b === 'preview' && c === 'production', [a, b, c]);
  }
  {
    const { siteUrl } = await import('../netlify/lib/db.js');
    const was = { e: process.env.SITE_ENV, u: process.env.URL, d: process.env.DEPLOY_PRIME_URL };
    process.env.SITE_ENV = 'staging'; process.env.URL = 'https://lunchsorted.app'; process.env.DEPLOY_PRIME_URL = 'https://dev--lunchsorted.netlify.app';
    const staging = siteUrl(new Request('https://dev--lunchsorted.netlify.app/api/auth/request'));
    process.env.SITE_ENV = 'production';
    const prod = siteUrl(new Request('https://evil.example/api/auth/request'));
    process.env.SITE_ENV = was.e; if (was.u === undefined) delete process.env.URL; else process.env.URL = was.u; if (was.d === undefined) delete process.env.DEPLOY_PRIME_URL; else process.env.DEPLOY_PRIME_URL = was.d;
    check('a staging link comes back to staging, and a production link never takes its host from the request', staging === 'https://dev--lunchsorted.netlify.app' && prod === 'https://lunchsorted.app', [staging, prod]);
  }
  check('a test key in production, or a live key anywhere else, refuses to start', guard('production', 'sk_test_x') && guard('staging', 'sk_live_x') && !guard('production', 'sk_live_x') && !guard('staging', 'sk_test_x'));
  {
    /* a key pasted with a line break or a space, before it, after it or inside it, is not a key:
       refused in every context, so the build fails and the last good deploy stays live, and a
       function handed one anyway takes billing as off. In the authorization header a line break
       makes fetch refuse the request in words that quote the header, key and all, and every caller
       logs those words (security review, 2026-09-30). The refusal names the variable, never the
       value. A NUL would do the same, but the environment cannot hold one */
    const hidden = (s) => !String(s).includes('Pasted42') && !/(sk|rk)_(live|test)_/.test(String(s));
    const bad = [['production', 'sk_live_Pasted42\n'], ['staging', 'sk_test_Pasted42\n'], ['production', 'sk_live_Pasted42\r\n'], ['production', '\nsk_live_Pasted42'], ['production', 'sk_live_Past\ned42'], ['production', 'sk_live_Pasted42 ']].map(([env, key]) => said(env, key));
    check('a key pasted with a line break or a space, wherever it falls, refuses to start in any context, in words that hold no key; the key alone starts',
      bad.every(m => !!m && /^STRIPE_SECRET_KEY must be/.test(m) && hidden(m)) && said('production', 'sk_live_Pasted42') === null && said('staging', 'rk_test_Pasted42') === null, bad);
    const logged = [], was = { ce: console.error, e: process.env.SITE_ENV, k: process.env.STRIPE_SECRET_KEY, y: process.env.STRIPE_PRICE_YEAR, w: stripeLib.billingEnabled.warned };
    console.error = (...a) => { logged.push(a.map(String).join(' ')); };
    process.env.SITE_ENV = 'production'; process.env.STRIPE_SECRET_KEY = 'sk_live_Pasted42\n'; process.env.STRIPE_PRICE_YEAR = 'price_year'; stripeLib.billingEnabled.warned = false;
    let on = null;
    try { on = stripeLib.billingEnabled(); }
    finally { console.error = was.ce; stripeLib.billingEnabled.warned = was.w; putEnv('SITE_ENV', was.e); putEnv('STRIPE_SECRET_KEY', was.k); putEnv('STRIPE_PRICE_YEAR', was.y); }
    check('a running function handed one anyway takes billing as off rather than throwing on every household request, and its one log line holds no key', on === false && logged.length === 1 && /^billing off: STRIPE_SECRET_KEY must be/.test(logged[0]) && hidden(logged[0]), logged);
    const { spawnSync } = await import('node:child_process');
    const build = (key) => spawnSync(process.execPath, [path.join(ROOT, '..', 'scripts', 'migrate.mjs')], { env: { SITE_ENV: 'production', STRIPE_SECRET_KEY: key }, encoding: 'utf8', timeout: 30000 });
    const refused = build('sk_live_Pasted42\n'), built = build('sk_live_Pasted42');
    check('and the build refuses the deploy over it, loudly, naming the variable and not the key; the key alone builds',
      refused.status === 1 && /deploy refused: STRIPE_SECRET_KEY must be/.test(refused.stderr) && hidden(refused.stdout + refused.stderr) && built.status === 0 && /no database URL, skipping/.test(built.stdout),
      { refused: [refused.status, refused.stderr], built: [built.status, built.stdout, built.stderr] });
  }
  {
    /* and whatever fetch throws, what leaves stripe() is ours. The key here is whole: the hook spoils
       the header on its way into the real fetch, as a line break pasted before the key would, and
       points it at a port fetch never opens, so nothing leaves the machine */
    const { inspect } = await import('node:util');
    const KEY = 'sk_test_Spoiled42', shown = (e) => e ? [e.message, e.stack, inspect(e)].join('\n') : '';
    const spoil = (url, init) => url.endsWith('/unread')
      ? Promise.resolve(new Response(new ReadableStream({ start(c) { c.error(new TypeError('cut off: ' + init.headers.authorization)); } })))   /* an answer that breaks off, in the worst words */
      : fetch('http://127.0.0.1:9/', { ...init, headers: { ...init.headers, authorization: init.headers.authorization.replace('Bearer ', 'Bearer \n') } });
    const theirs = await spoil('https://api.stripe.com/v1/prices/price_year', { method: 'GET', headers: { authorization: 'Bearer ' + KEY } }).then(() => null, e => e);
    const hook = globalThis.__LS_STRIPE_FETCH, was = { k: process.env.STRIPE_SECRET_KEY, y: process.env.STRIPE_PRICE_YEAR };
    globalThis.__LS_STRIPE_FETCH = spoil; process.env.STRIPE_SECRET_KEY = KEY; process.env.STRIPE_PRICE_YEAR = 'price_year'; stripeLib.forgetPrices();
    /* all four read the key and hand their first request to fetch before their first await, so the key
       and the hook go back at once, before a request from the open page can see either. The cancel is the
       one a deleted account or a join makes: its read-back after the failed DELETE comes later, with the
       hook and key back, so it reaches the ordinary stub, hears 'active', and logs its own failure */
    const direct = stripeLib.stripe('GET', '/prices/price_year').then(() => null, e => e), viaPrices = stripeLib.priceInfo().then(() => null, e => e), cancel = stripeLib.cancelSubscription('sub_spoiled'),
      broken = stripeLib.stripe('POST', '/prices/unread', {}).then(() => null, e => e);
    globalThis.__LS_STRIPE_FETCH = hook; putEnv('STRIPE_SECRET_KEY', was.k); putEnv('STRIPE_PRICE_YEAR', was.y);
    const logged = [], ce = console.error; console.error = (...a) => { logged.push(a.map(String).join(' ')); ce.apply(console, a); };
    let ours = null, asked = null, cut = null;
    try { ours = await direct; asked = await viaPrices; await cancel; cut = await broken; } finally { console.error = ce; stripeLib.forgetPrices(); }
    check('fetch\'s own refusal of that header quotes the key, as the security review found', shown(theirs).includes('Spoiled42'), theirs && theirs.message);
    check('but what stripe() throws in its place names no part of it, in its message, its stack or anything it carries, and the prices read and the cancel say no more, in what they throw or log',
      !!ours && /^No answer from Stripe/.test(ours.message) && !/Spoiled42|Bearer/.test(shown(ours)) && ours.cause === undefined && !!asked && !shown(asked).includes('Spoiled42') &&
      logged.some(l => /^billing: could not cancel sub_spoiled No answer from Stripe/.test(l)) && !logged.some(l => l.includes('Spoiled42')),
      { ours: ours && ours.message, asked: asked && asked.message, logged });
    check('an answer that breaks off while it is read, after a POST Stripe may have acted on, is told apart from no answer, in fixed words of its own',
      !!cut && /^Stripe answered, but the answer could not be read/.test(cut.message) && !/Spoiled42|Bearer/.test(shown(cut)) && cut.cause === undefined, cut && cut.message);
  }
  {
    /* the same leak for the Resend key (found beside the Stripe one, 2026-09-30): send() put
       RESEND_API_KEY into the authorization header, a line break before the key or inside it made
       fetch refuse the request in words that quote the header, and the sign-in function, the welcome
       and both reminder jobs log those words. The build refuses anything but the key alone. A running
       function cannot, as that would stop every sign-in link: it drops whitespace around the key, and
       refuses before fetch sees it only a key that could never work. The fake keys are short, so
       nothing mistakes them for real ones */
    const mailLib = await import('../netlify/lib/mail.js');
    const { inspect } = await import('node:util');
    const KEY = 're_Qx7_Zk42', hidden = (s) => !/Qx7|Zk42/.test(String(s)), shown = (e) => e ? [e.message, e.stack, inspect(e)].join('\n') : '';
    const told = (key) => { const was = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = key;
      try { return mailLib.resendKey() === key ? null : 'changed'; } catch (e) { return String(e.message); } finally { putEnv('RESEND_API_KEY', was); } };
    const pasted = [KEY + '\n', KEY + '\r\n', '\n' + KEY, 're_Qx7\n_Zk42', KEY + ' ', ' ' + KEY, 're_Qx7 _Zk42', ' \n', '"' + KEY + '"', 'Bearer ' + KEY].map(told);
    check('a Resend key pasted with a line break, a space or anything else, wherever it falls, is refused in words that hold no key; the key alone, underscores and all, is not',
      pasted.every(m => !!m && /^RESEND_API_KEY must be/.test(m) && hidden(m)) && told(KEY) === null && told('re_Qx7Zk42') === null, pasted);
    const { spawnSync } = await import('node:child_process');
    const build = (env) => spawnSync(process.execPath, [path.join(ROOT, '..', 'scripts', 'migrate.mjs')], { env: { SITE_ENV: 'production', ...env }, encoding: 'utf8', timeout: 30000 });
    const refused = build({ RESEND_API_KEY: KEY + '\n' }), both = build({ RESEND_API_KEY: KEY + '\n', STRIPE_SECRET_KEY: 'sk_live_Pasted42\n' });
    const built = build({ RESEND_API_KEY: KEY }), builtBoth = build({ RESEND_API_KEY: KEY, STRIPE_SECRET_KEY: 'sk_live_Pasted42' }), bare = build({});
    const saw = (b) => (b.stdout.match(/^migrate: keys the build can see, each the key alone: (.*)$/m) || [])[1];
    check('and the build refuses the deploy over it, loudly, naming the variable and not the key, and names both at once when Stripe\'s is bad too; the key alone builds',
      refused.status === 1 && /deploy refused: RESEND_API_KEY must be/.test(refused.stderr) && hidden(refused.stdout + refused.stderr) && built.status === 0 && /no database URL, skipping/.test(built.stdout) &&
      both.status === 1 && /deploy refused: STRIPE_SECRET_KEY must be/.test(both.stderr) && /deploy refused: RESEND_API_KEY must be/.test(both.stderr) && hidden(both.stderr) && !both.stderr.includes('Pasted42'),
      { refused: [refused.status, refused.stderr], built: [built.status, built.stdout, built.stderr], both: [both.status, both.stderr] });
    check('and a build that goes through names the keys it could see, and never what they hold, so one without the Builds scope shows by its absence',
      saw(built) === 'RESEND_API_KEY' && builtBoth.status === 0 && saw(builtBoth) === 'STRIPE_SECRET_KEY, RESEND_API_KEY' && bare.status === 0 && saw(bare) === 'none' &&
      [built, builtBoth, bare].every(b => hidden(b.stdout + b.stderr) && !(b.stdout + b.stderr).includes('Pasted42')),
      [built, builtBoth, bare].map(b => [b.status, b.stdout]));
    /* production's build must see a key: a deploy without one could send no sign-in link (security
       review of v27, L4). Netlify's own CONTEXT marks a production build, whatever SITE_ENV says, so
       the local run above, with SITE_ENV production and no CONTEXT, is not held to it, nor are
       previews and branch deploys, while a production build with SITE_ENV saying otherwise is. With
       Stripe's key bad as well, both refusals are told at once */
    const prodBare = build({ CONTEXT: 'production' }), prodKey = build({ CONTEXT: 'production', RESEND_API_KEY: KEY }), prodBoth = build({ CONTEXT: 'production', STRIPE_SECRET_KEY: 'sk_test_Pasted42' });
    const prodStaging = build({ CONTEXT: 'production', SITE_ENV: 'staging' });
    const previewBare = build({ CONTEXT: 'deploy-preview', SITE_ENV: 'preview' }), stagingBare = build({ CONTEXT: 'branch-deploy', SITE_ENV: 'staging' });
    const absent = /deploy refused: RESEND_API_KEY is absent from this production build, or not scoped to Builds \(the build cannot tell which\)/;
    check('a production build that cannot see a Resend key, absent or not scoped to Builds, refuses the deploy in words that say both, whatever SITE_ENV says; with the key it builds, and previews, branch deploys and a local run go on without one',
      prodBare.status === 1 && absent.test(prodBare.stderr) && prodStaging.status === 1 && absent.test(prodStaging.stderr) &&
      prodBoth.status === 1 && /deploy refused: STRIPE_SECRET_KEY in production is not a live key/.test(prodBoth.stderr) && absent.test(prodBoth.stderr) &&
      prodKey.status === 0 && saw(prodKey) === 'RESEND_API_KEY' && previewBare.status === 0 && saw(previewBare) === 'none' && stagingBare.status === 0 && saw(stagingBare) === 'none' && bare.status === 0 &&
      [prodBare, prodStaging, prodBoth, prodKey, previewBare, stagingBare].every(b => hidden(b.stdout + b.stderr) && !(b.stdout + b.stderr).includes('Pasted42')),
      [prodBare, prodStaging, prodBoth, prodKey, previewBare, stagingBare].map(b => [b.status, b.stdout, b.stderr]));
    /* send() goes past the capture only while __LS_MAIL is away, and __LS_RESEND_FETCH takes its
       request. Each send here reads the key and the hook and hands the request over before its first
       await, so all three go back at once, before anything else in this process can see them. What
       this process writes to its standard output and error while the sends run is kept, and passed
       on: every console method writes through them, and no line of it may hold the key */
    const msg = { to: 'resend-check@example.com', subject: 'x', text: 'x', html: '<p>x</p>' };
    const sending = (key, hook, call = () => mailLib.send(msg)) => { const was = { m: globalThis.__LS_MAIL, k: process.env.RESEND_API_KEY, h: globalThis.__LS_RESEND_FETCH };
      globalThis.__LS_MAIL = null; process.env.RESEND_API_KEY = key; globalThis.__LS_RESEND_FETCH = hook;
      try { return call().then(() => null, e => e); } finally { globalThis.__LS_MAIL = was.m; putEnv('RESEND_API_KEY', was.k); globalThis.__LS_RESEND_FETCH = was.h; } };
    const logged = [], watching = async (work) => { const was = { out: process.stdout.write, err: process.stderr.write };
      process.stdout.write = function (chunk, ...rest) { logged.push(String(chunk)); return was.out.call(this, chunk, ...rest); };
      process.stderr.write = function (chunk, ...rest) { logged.push(String(chunk)); return was.err.call(this, chunk, ...rest); };
      try { return await work(); } finally { process.stdout.write = was.out; process.stderr.write = was.err; } };
    const heard = [], answer = (url, init) => { heard.push(init.headers.authorization); return Promise.resolve(new Response('{"id":"sent"}', { status: 200 })); };
    const refusal = (url, init) => { heard.push(init.headers.authorization); return Promise.resolve(new Response('{"statusCode":403,"message":"API key is invalid","name":"validation_error"}', { status: 403 })); };
    const around = await watching(() => Promise.all([KEY + '\n', '\n' + KEY, ' ' + KEY + '\r\n'].map(k => sending(k, answer))));
    check('but a running function sends with the key alone when a line break or a space only sits around it, since refusing there would stop every sign-in link',
      around.every(e => e === null) && heard.length === 3 && heard.every(h => h === 'Bearer ' + KEY), { around: around.map(e => e && e.message), heard });
    /* what fetch will not put in a header: a line break (refused in words that quote the header whole),
       any other control character but tab, and anything beyond Latin-1, such as the zero-width space a
       copy from a web page can carry, which trim() leaves where it is */
    const cannot = /^RESEND_API_KEY has a line break or a character no request can carry in it, so nothing was sent/, empty = /^RESEND_API_KEY holds only spaces or line breaks, so nothing was sent/;
    const ch = String.fromCharCode, never = [['re_Qx7\n_Zk42', cannot], ['re_Qx7\r_Zk42', cannot], ['re_Qx7' + ch(0x0b) + '_Zk42', cannot], ['re_Qx7' + ch(0x7f) + '_Zk42', cannot], [ch(0x200b) + KEY, cannot], [' \r\n', empty]];
    const nevers = await watching(() => Promise.all(never.map(([k]) => sending(k, answer))));
    check('and a key fetch could never send, with a line break, another control character or one beyond Latin-1 left in it, or nothing once trimmed, is refused before fetch sees it, each in its own words, none holding the key',
      nevers.every((e, i) => !!e && never[i][1].test(e.message) && hidden(shown(e))) && heard.length === 3, nevers.map(e => e && e.message));
    /* the refusal here is the test's own, as in the guard below: this shows where the key goes */
    const through = await watching(() => Promise.all(['re_Qx7 _Zk42', 're_Qx7\t_Zk42'].map(k => sending(k, refusal))));
    check('while a key with anything else fetch can carry, a space or a tab inside it say, goes to Resend as it is, and Resend\'s refusal comes back',
      through.every(e => !!e && /^Resend 403: /.test(e.message)) && heard.length === 5 && heard[3] === 'Bearer re_Qx7 _Zk42' && heard[4] === 'Bearer re_Qx7\t_Zk42', { through: through.map(e => e && e.message), heard });
    /* the key itself is whole from here on: the hook spoils the header on its way into the real fetch,
       as a line break pasted before the key would, and points it at a port fetch never opens, so
       nothing leaves the machine */
    const spoil = (url, init) => fetch('http://127.0.0.1:9/', { ...init, headers: { ...init.headers, authorization: init.headers.authorization.replace('Bearer ', 'Bearer \n') } });
    const theirs = await spoil('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + KEY } }).then(() => null, e => e);
    check('the premise, as for Stripe: fetch\'s own refusal of a line break before the key quotes the key whole, so without send()\'s catch the lines below would hold it',
      shown(theirs).includes(KEY), theirs && theirs.message);
    const broken = (url, init) => Promise.resolve(new Response(new ReadableStream({ start(c) { c.error(new TypeError('cut off: ' + init.headers.authorization)); } }), { status: 502 }));   /* an error answer that breaks off, in the worst words */
    /* an error answer that quotes what it was sent, at length, as JSON writes it: the authorization header, where a tab inside the
       key becomes a written-out \t, and a real sign-in email's text, where the code follows a written-out line break */
    const echoing = (url, init) => Promise.resolve(new Response('{"message":"invalid: ' + JSON.stringify(init.headers.authorization) + ' in ' + JSON.stringify(JSON.parse(init.body).text) + '"} ' + 'x'.repeat(2000), { status: 422 }));
    const magic = () => mailLib.sendMagicLink('resend-check@example.com', 'https://lunchsorted.app/api/auth/verify?t=Tok3nQx7Tok3n', 'ABCD-EF23');
    const hang = (url, init) => new Promise((_, reject) => init.signal   /* the real four-second timer, then the worst words */
      ? init.signal.addEventListener('abort', () => reject(new DOMException('gave up on ' + init.headers.authorization, 'TimeoutError')), { once: true })
      : reject(new Error('no time limit: ' + init.headers.authorization)));
    const t0 = Date.now();
    const [none, cut, words, echoed, echoedSpaced, echoedTab, late] = await watching(async () => {
      const slow = sending(KEY, hang);
      return [...await Promise.all([sending(KEY, spoil), sending(KEY, broken), sending(KEY, refusal), sending(KEY, echoing, magic), sending('re_Qx7 _Zk42', echoing, magic), sending('re_Qx7\t_Zk42', echoing, magic)]), await slow];
    });
    const waited = Date.now() - t0;
    check('but what send() throws in its place names no part of it, in its message, its stack or anything it carries, whether no answer came, an error answer broke off, or the four seconds ran out',
      !!none && /^No answer from Resend \(/.test(none.message) && !!late && late.message === none.message && waited >= 3900 && waited < 10000 &&
      !!cut && /^Resend answered with an error, but the answer could not be read/.test(cut.message) && [none, cut, late].every(e => hidden(shown(e)) && !/Bearer/.test(shown(e)) && e.cause === undefined),
      { none: none && none.message, cut: cut && cut.message, late: late && late.message, waited });
    /* a guard, not a proof: the answer is the test's own. Resend's error answers never quote a key
       (resend.com/docs/api-reference/errors), so its words are kept for the log */
    check('and Resend\'s own words about a refusal still come through',
      !!words && words.message === 'Resend 403: {"statusCode":403,"message":"API key is invalid","name":"validation_error"}', words && words.message);
    check('cut short, with the key, the sign-in link\'s token and its code blanked wherever they sit, should an answer ever quote a sign-in email back, a key with a space or a tab inside included',
      [echoed, echoedSpaced, echoedTab].every(e => !!e && /^Resend 422: \{"message":"invalid: "Bearer /.test(e.message) && /type this code instead/.test(e.message) && e.message.length <= 'Resend 422: '.length + 300 && hidden(shown(e)) && !e.message.includes('ABCD-EF23')),
      [echoed, echoedSpaced, echoedTab].map(e => e && e.message));
    /* and through the sign-in function: a link that cannot be sent is answered as busy, logged in a line of
       its own, and a welcome that cannot be sent never fails the sign-in.
       Unlike the sends above, the capture, the key and the hook stay away across two whole handler
       calls and their database waits; the page is signed out and idle, so nothing else sends mail
       meanwhile. Called straight, with no client address, so this machine's sign-in allowance is not
       spent; the two addresses leave no row behind, as the numbers page counts every one */
    const post = (p, body) => authHandler(new Request('http://localhost' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {});
    const asked = await (await post('/api/auth/request', { email: 'resend-welcome@example.com' })).json();   /* its link is captured as usual */
    const was = { m: globalThis.__LS_MAIL, k: process.env.RESEND_API_KEY, h: globalThis.__LS_RESEND_FETCH };
    let link = null, signedIn = null;
    await watching(async () => {
      globalThis.__LS_MAIL = null; process.env.RESEND_API_KEY = KEY; globalThis.__LS_RESEND_FETCH = spoil;
      try {
        link = await post('/api/auth/request', { email: 'resend-link@example.com' });
        signedIn = await post('/api/auth/verify', { token: new URL(asked.devLink).searchParams.get('t'), kind: 'native' });
      } finally { globalThis.__LS_MAIL = was.m; putEnv('RESEND_API_KEY', was.k); globalThis.__LS_RESEND_FETCH = was.h; }
    });
    const counted = ['resend-welcome@example.com', 'resend-link@example.com'].map(e => 'link:' + crypto.createHash('sha256').update(e).digest('hex').slice(0, 24));   /* each address's sign-in count is a digest of it */
    await db.query(`DELETE FROM users WHERE email LIKE 'resend-%@example.com'`); await db.query(`DELETE FROM magic_links WHERE email LIKE 'resend-%@example.com'`); await db.query('DELETE FROM rate_events WHERE key IN ($1, $2)', counted);
    check('and a sign-in link that cannot be sent is answered as busy, while a welcome that cannot be sent still signs in, each logged in our own words',
      !!link && link.status === 503 && !!signedIn && signedIn.status === 200 && logged.some(l => /^api-auth: the sign-in email was refused No answer from Resend/.test(l)) && logged.some(l => /^welcome email No answer from Resend/.test(l)),
      { link: link && link.status, signedIn: signedIn && signedIn.status, logged });
    check('and nothing this process wrote to its standard output or error while the sends ran holds the key, whatever wrote it', logged.length >= 2 && logged.every(l => hidden(l)), logged);
  }
  const WH = 'whsec_test_secret';
  const sign = (body, t = Math.floor(Date.now() / 1000), secret = WH) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  check('a webhook signature is checked against the raw body and the clock',
    stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}'), WH) && !stripeLib.verifyWebhook('{"a":2}', sign('{"a":1}'), WH) &&
    !stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}', Math.floor(Date.now() / 1000) - 600), WH) && !stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}', undefined, 'whsec_other'), WH) && !stripeLib.verifyWebhook('{"a":1}', '', WH));
  check('the period end is read from either shape of subscription',
    stripeLib.periodEnd({ current_period_end: 1800000000 }) === '2027-01-15T08:00:00.000Z' && stripeLib.periodEnd({ items: { data: [{ current_period_end: 1800000000 }] } }) === '2027-01-15T08:00:00.000Z' && stripeLib.periodEnd({}) === null);

  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_WEBHOOK_SECRET: WH, STRIPE_PRICE_YEAR: 'price_year', STRIPE_PRICE_LIFETIME: 'price_life', STRIPE_PRICE_MONTH: 'price_month' });
  {
    /* Stripe that never answers: the call gives up after eight seconds, in the words for no answer, so a webhook never sits
       until Netlify ends it with its event marked seen and nothing done. The real timer; only this one path hangs */
    const stub = globalThis.__LS_STRIPE_FETCH, started = Date.now();
    globalThis.__LS_STRIPE_FETCH = (url, init) => new URL(url).pathname !== '/v1/subscriptions/sub_hang' ? stub(url, init) : new Promise((_, reject) => init.signal
      ? init.signal.addEventListener('abort', () => reject(new DOMException('gave up on ' + init.headers.authorization, 'TimeoutError')), { once: true })
      : reject(new Error('no time limit: ' + init.headers.authorization)));
    let hung = null;   /* a guard at fifteen seconds, so a time limit that never comes fails here rather than holding the run */
    try { hung = await Promise.race([stripeLib.stripe('GET', '/subscriptions/sub_hang').then(() => null, e => e), new Promise(r => setTimeout(() => r(new Error('still waiting after fifteen seconds')), 15000))]); }
    finally { globalThis.__LS_STRIPE_FETCH = stub; }
    const waited = Date.now() - started;
    check('a Stripe call that never answers gives up after eight seconds, in the words for no answer, with no key in them',
      !!hung && /^No answer from Stripe/.test(hung.message) && !/sk_test_stub|Bearer/.test(String(hung.stack) + hung.message) && waited >= 7900 && waited < 15000, { message: hung && hung.message, waited });
  }
  const ctxB = await browser.newContext({ viewport:{width:375,height:812}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });   /* a phone's Safari, not the app */
  await pinClock(ctxB);
  await ctxB.route(/^https:\/\/fonts\.g(oogleapis|static)\.com\//, r => r.abort());
  const pb = await ctxB.newPage(); pb.on('pageerror', e => errors.push(String(e.message)));
  await pb.route('https://checkout.stripe.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe checkout</title>' }));
  await pb.route('https://billing.stripe.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe portal</title>' }));
  await pb.goto(BASE+'/app/'); await pb.waitForTimeout(400);
  await pb.fill('#obName', 'Remy'); await pb.click('[data-act="ob-go"]'); await pb.waitForTimeout(400);
  /* this time the link is asked for from the onboarding screen itself */
  await pb.fill('#signinEmail', 'remy-parent@example.com'); await pb.press('#signinEmail', 'Enter');
  await until(pb, () => !!document.querySelector('[data-dev-link]'));
  check('the onboarding screen sends the link and then offers the code, the week, or another address',
    /Sent to remy-parent@example\.com/.test(await pb.textContent('#view')) && (await pb.$$eval('#signinCode', a => a.length)) === 1 && (await pb.$$eval('[data-act="ob-resend"]', a => a.length)) === 1);
  await pb.click('[data-act="ob-resend"]'); await pb.waitForTimeout(200);
  check('and "wrong address" goes back to the field', (await pb.$$eval('#signinEmail', a => a.length)) === 1);
  await pb.click('[data-act="ob-later"]'); await pb.waitForTimeout(300);
  check('skipping lands on the week', await pb.getAttribute('nav.tabs [aria-current="true"]', 'data-tab') === 'week');
  {
    const ctxW = await phone(); const pw = await ctxW.newPage(); pw.on('pageerror', e => errors.push(String(e.message)));
    await pw.goto(BASE+'/app/'); await pw.waitForTimeout(300); await pw.fill('#obName', 'Wren'); await pw.click('[data-act="ob-go"]'); await pw.waitForTimeout(300);
    await pw.fill('#signinEmail', 'wren-parent@example.com'); await pw.press('#signinEmail', 'Enter'); await until(pw, () => !!document.querySelector('[data-dev-link]'));
    check('the sent screen names the address and says to tap on this phone', /Sent to wren-parent@example\.com\. Tap the link on this phone/.test(await pw.textContent('#view')));
    await pw.goto(await pw.getAttribute('[data-dev-link]', 'href')); await pw.click('button[type="submit"]'); await pw.waitForURL(/\/app\//); await pw.waitForLoadState('load');
    await until(pw, () => document.querySelector('nav.tabs [aria-current="true"]') && document.querySelector('nav.tabs [aria-current="true"]').getAttribute('data-tab') === 'week' && !!document.querySelector('.tin'));
    check('a parent who taps the link from onboarding lands on the week it promised, signed in', await pw.getAttribute('nav.tabs [aria-current="true"]', 'data-tab') === 'week' && await pw.evaluate(() => fetch('/api/auth/me').then(r => r.json()).then(j => j.user && j.user.email === 'wren-parent@example.com')));
    await ctxW.close();
  }
  /* A beta code waiting on a signed-out phone: the sign-in card under the beta's banner offers no plan to
     keep or get, since the banner says what signing in brings, free forever. Tapping Keep there used to put
     the price sheet up just as the beta switched on. The same card offers it again once no code waits. */
  {
    const cB = await phone(); const pB = await cB.newPage(); pB.on('pageerror', e => errors.push(String(e.message)));
    await pB.goto(BASE + '/app/'); await pB.waitForTimeout(300);
    if (await until(pB, () => !!document.querySelector('#obName'), null, 5000)) { await pB.fill('#obName', 'Bea'); await pB.click('[data-act="ob-go"]'); await pB.waitForTimeout(300); }
    await pB.goto(BASE + '/app/?beta=BETA-TEST-1234'); await pB.waitForLoadState('load');
    const card = await until(pB, () => /Sign in and the beta switches on/.test(document.getElementById('view').textContent) && !!document.querySelector('#signinEmail'));
    const billed = await until(pB, () => { try { return JSON.parse(localStorage.getItem('lunchsorted-billing')).enabled === true; } catch (e) { return false; } });
    const noKeep = card && billed && !(await pB.$('[data-act="upgrade"][data-why="keep"]'));
    await pB.evaluate(() => localStorage.removeItem('lunchsorted-beta'));
    if (card) { await pB.click('[data-act="tab"][data-tab="pack"]'); await pB.click('[data-act="tab"][data-tab="setup"]'); await pB.waitForTimeout(250); }
    const keepBack = card && !!(await pB.$('[data-act="upgrade"][data-why="keep"]'));
    check('with a beta code waiting, the sign-in card offers no plan to keep or get under the free forever its banner promises, and offers it again once none waits', noKeep && keepBack, { card, billed, noKeep, keepBack });
    await cB.close();
  }
  /* the link opened somewhere else: a browser with no lunches must not become the household */
  {
    const ctxI = await phone(); const pi = await ctxI.newPage(); pi.on('pageerror', e => errors.push(String(e.message)));
    await pi.goto(BASE+'/app/'); await pi.waitForTimeout(300); await pi.fill('#obName', 'Ivy'); await pi.click('[data-act="ob-go"]'); await pi.waitForTimeout(300);
    await pi.fill('#signinEmail', 'ivy-parent@example.com'); await pi.press('#signinEmail', 'Enter'); await until(pi, () => !!document.querySelector('[data-dev-link]'));
    const link = await pi.getAttribute('[data-dev-link]', 'href');
    const code = mails.filter(m => m.to === 'ivy-parent@example.com' && /sign-in link/.test(m.subject)).pop().text.match(/\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/)[1];
    const ctxJ = await phone(); const pj = await ctxJ.newPage(); pj.on('pageerror', e => errors.push(String(e.message)));
    await pj.goto(link); await pj.click('button[type="submit"]'); await pj.waitForURL(/\/app\//); await pj.waitForLoadState('load');
    await until(pj, () => /go back there and type the code/.test(document.querySelector('#view').textContent));
    const stillEmpty = (await db.query(`SELECT h.doc FROM households h JOIN users u ON u.id = h.owner_user_id WHERE u.email = 'ivy-parent@example.com'`)).rows[0];
    check('a link opened in another browser signs it in, says the lunches are elsewhere, offers sign-out, and does not push an empty household', !!stillEmpty && stillEmpty.doc === null && (await pj.$$eval('#obName', a => a.length)) === 1 && (await pj.$$eval('[data-act="signout"]', a => a.length)) === 1);
    await pi.evaluate(() => localStorage.setItem('lunchsorted-after', 'pantry'));   /* they were checking the pantry when the sign-in was asked for */
    await pi.fill('#signinCode', code); await pi.click('[data-act="signin-code"]');
    const codeIn = await until(pi, () => !document.querySelector('#signinCode') && (!!document.querySelector('.tin') || /What to buy/.test(document.querySelector('#view').textContent)));
    check('the typed code lands the parent back where they were, as the link does', await until(pi, () => { const t = document.querySelector('nav.tabs button[aria-current="true"]'); return !!t && t.getAttribute('data-tab') === 'shop'; }), await pi.$eval('nav.tabs button[aria-current="true"]', e => e.getAttribute('data-tab')).catch(() => 'no tab'));
    const pushed = await until(pi, () => fetch('/api/household').then(r => r.json()).then(j => !!j.doc && j.doc.kids.some(k => k.name === 'Ivy')));
    check('the code still works after the link was spent elsewhere, and typed where the week was built it makes that copy the household', codeIn && pushed, [codeIn, pushed, await pi.textContent('#toast').catch(() => '')]);
    await pj.reload(); await pj.waitForLoadState('load');
    await until(pj, () => !!document.querySelector('.tin') || /Ivy/.test(document.querySelector('#view').textContent));
    const pjKids = await pj.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.map(k => k.name));
    check('and the other browser picks the lunches up on its next open', pjKids.includes('Ivy'), pjKids);
    await ctxI.close(); await ctxJ.close();
  }
  /* the first three weeks: everything on, the premium pieces wearing a tag */
  const setBorn = (daysAgo) => pb.evaluate(n => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.createdAt = new Date(Date.now() - n * 86400000).toISOString(); localStorage.setItem('lunchsorted', JSON.stringify(d)); }, daysAgo);
  await pb.reload(); await pb.waitForLoadState('load'); await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(300);
  check('a new household has everything on for 21 days and the Subscription row says so', /Subscription\s*On for 21 more days/.test(await pb.textContent('#view')));
  await openPane(pb, 'plan');
  check('and the Subscription page offers the plan', (await pb.$$eval('[data-act="upgrade"][data-why="keep"]', a => a.length)) === 1,
    (await pb.textContent('#view')).replace(/\s+/g, ' ').slice(0, 240));
  await pb.click('[data-act="pane-done"]'); await pb.waitForTimeout(200);
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  check('the premium pieces wear a green star while they are on, 44px around the glyph, with a spoken name', (await pb.$$eval('.star', a => a.length)) >= 1
    && await pb.$$eval('.star', a => a.every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44 && /Household plan/.test(b.getAttribute('aria-label'))))
    && (await pb.$$eval('.chip.good, .chip.lock', a => a.length)) === 0);
  check('and the star is explained once, on the first screen that shows one', /marks what the Household plan keeps on/.test(await pb.textContent('#view')));
  await pb.click('[data-act="star-ok"]'); await pb.waitForTimeout(200);
  check('OK puts the line away for good', !/marks what the Household plan keeps on/.test(await pb.textContent('#view')) && (await pb.$$eval('.star', a => a.length)) >= 1);
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('and a second lunchbox just works', (await pb.$$eval('#nkName', a => a.length)) === 1);
  await sheetDone(pb); await pb.waitForTimeout(300);
  await pb.click('[data-act="kidpick-on"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="tab"][data-tab="pack"]'); await pb.waitForTimeout(250);
  check('kid\'s pick is on, with the star beside it', (await pb.$$eval('[data-act="kid-start"]', a => a.length)) === 1 && (await pb.$$eval('.pickwrap .star', a => a.length)) === 1);
  await pb.click('.pickwrap .star'); await pb.waitForTimeout(300);
  check('and the star opens the plan sheet, which says why', /Letting them pick/.test(await pb.textContent('#sheetBody')));
  await sheetDone(pb); await pb.waitForTimeout(250);
  /* Pack this box and the pick moves down to the next day, in Coming up, where the day and
     its foods share the row with the tag. The tag will not wrap, so it used to take the row
     and leave the day a column one letter wide: "Wednesday" read down the screen. */
  await pb.click('[data-act="pack-all"]'); await pb.waitForTimeout(250);
  check('and the day it lands on still reads across the row, not one letter at a time', await pb.evaluate(() => {
    const row = document.querySelector('.item.pickday'); if(!row) return false;
    const grow = row.querySelector('.grow');
    return !!grow && grow.getBoundingClientRect().width > row.getBoundingClientRect().width * 0.5;   /* the collapse measured 2% of the row; half is nowhere near it, and does not depend on the tag being there */
  }), await pb.evaluate(() => { const r = document.querySelector('.item.pickday'); return r ? [Math.round(r.getBoundingClientRect().width), Math.round(r.querySelector('.grow').getBoundingClientRect().width)] : 'no pick row'; }));
  /* and the other half of the same squeeze: the card hides what overflows it, so a tag and a
     button that cannot break in two leave the parent a button with its right-hand edge cut off.
     That one only bites on the narrowest phone, so this check is the one place the suite is not
     375 wide — at 375 it passes whether or not the fix is there, which is no check at all. */
  await pb.setViewportSize({width:320, height:812}); await pb.waitForTimeout(250);
  check('and neither the tag nor the button is cut off by the card, on the narrowest phone', await pb.evaluate(() => {
    const row = document.querySelector('.item.pickday'); if(!row) return false;
    const list = row.closest('.list').getBoundingClientRect();
    return [...row.querySelectorAll('button, .chip')].every(e => e.getBoundingClientRect().right <= list.right);
  }), await pb.evaluate(() => { const r = document.querySelector('.item.pickday'); if(!r) return 'no pick row';
    const l = r.closest('.list').getBoundingClientRect();
    return [...r.querySelectorAll('button, .chip')].map(e => e.textContent.trim().slice(0,18)+': '+Math.round(e.getBoundingClientRect().right - l.right)); }));
  await pb.setViewportSize({width:375, height:812}); await pb.waitForTimeout(250);   /* the rest of this fixture is a 375 phone */
  await pb.click('[data-act="pack-all"]'); await pb.waitForTimeout(250);   /* un-tick: the box reads unpacked again, though the off rows stay */
  check('no banner nags in week one', (await pb.$$eval('.banner', a => a.filter(b => /three weeks/.test(b.textContent)).length)) === 0);
  await setBorn(19); await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('with three days left the app says so, once, in one line', /Everything is on for [23] more days\./.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="upgrade"][data-why="keep"]', a => a.length)) >= 1, (await pb.textContent('#view')).match(/Everything is on[^.]*\./));
  /* the filled button on a banner used to take the banner's own ink: brown on green in light, orange on green in dark */
  const bannerContrast = () => pb.evaluate(() => {
    const b = document.querySelector('.banner .btn.primary'); if(!b) return 0;
    const lum = c => { const m = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(v => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const cs = getComputedStyle(b), a = lum(cs.color), bg = lum(cs.backgroundColor);
    return Math.round(((Math.max(a, bg) + 0.05) / (Math.min(a, bg) + 0.05)) * 10) / 10;
  });
  const lightC = await bannerContrast();
  await pb.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await pb.waitForTimeout(50);
  const darkC = await bannerContrast();
  await pb.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  check('and the banner\'s filled button can be read in both themes', lightC >= 4.5 && darkC >= 4.5, [lightC, darkC]);
  await pb.click('[data-act="trial-dismiss"]'); await pb.waitForTimeout(200); await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('and Later means later', !/Everything is on for/.test(await pb.textContent('#view')));
  await setBorn(30); await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('when the three weeks are up it says so, once, and the plan sheet is one tap away', /three weeks are up/.test(await pb.textContent('#view')));
  await pb.click('[data-act="trial-dismiss"]'); await pb.waitForTimeout(200);
  check('kid\'s pick is now locked in place', (await pb.$$eval('[data-act="kid-start"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="upgrade"][data-why="kidpick"]', a => a.length)) === 1);
  await pb.click('[data-act="upgrade"][data-why="kidpick"]'); await pb.waitForTimeout(300);
  check('and tapping it explains, in the sheet', /Letting them pick/.test(await pb.textContent('#sheetBody')));
  await sheetDone(pb); await pb.waitForTimeout(300);
  /* yesterday's box was packed, so this morning asks how it went: locked, with the question still visible */
  await pb.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0]; const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0,0,0,0);
    const iso = y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0');
    const slots = {}; for (const c of ['main','side','fruit','sweet']) { const f = k.foods.find(x => x.c === c && !x.deletedAt); if (f) slots[c] = f.id; }
    k.past = [{d: iso, dow: y.getDay(), slots, lock: {}, kidPick: {}}]; k.packed = k.packed || {}; k.packed[iso] = {main:{at:new Date().toISOString(), by:null}};
    localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('the after-school review is locked in place: the card says what it is, the answers wait for the plan, and nothing else asks', /How the box went is part of the Household plan\./.test(await pb.textContent('#view')) && !/How did .*box go\?/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="review-later-all"], .card.fold', a => a.length)) === 0 && (await pb.$$eval('[data-act="eat-set"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="upgrade"][data-why="review"]', a => a.length)) === 1 && (await pb.$$eval('[data-act="upgrade"][data-why="review"] .starmark', a => a.length)) === 1);
  await pb.click('[data-act="tab"][data-tab="shop"]'); await pb.waitForTimeout(250);
  check('the shopping list is still free, the pantry tick is not', (await pb.$$eval('[data-act="have"]', a => a.length)) > 0 && /part of the Household plan/.test(await pb.textContent('#view')));
  const tickedKey2 = await pb.getAttribute('[data-act="have"]', 'data-key');
  await pb.click('[data-act="have"]'); await pb.waitForTimeout(300);
  check('a pantry tick opens the sheet instead', /pantry that remembers/.test(await pb.textContent('#sheetBody')) && await pb.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lunchsorted')).pantry).length === 0));
  /* this tap returns before anything is redrawn, so nothing else was ever going to move the cursor */
  check('and the sheet has the cursor, where it used to stay on the line behind a dialog', await pb.evaluate(() => !!document.activeElement && document.activeElement.id === 'sheetTitle'));
  const putAway = await sheetDone(pb); await pb.waitForTimeout(300);
  check('which goes back to the line that was ticked once the sheet is put away', putAway && await pb.evaluate(k => { const a = document.activeElement;
    return !!a && a.getAttribute('data-act') === 'have' && a.getAttribute('data-key') === k && !a.closest('#sheet'); }, tickedKey2), tickedKey2);
  const bcfg = await pb.evaluate(() => fetch('/api/billing').then(r => r.json()));
  check('the plans and their prices come from Stripe, not the app', bcfg.enabled === true && bcfg.prices.year.amount === 1999 && bcfg.prices.month.amount === 299 && bcfg.prices.year.interval === 'year', bcfg);
  {
    const { billingEnabled } = await import('../netlify/lib/stripe.js');
    const life = process.env.STRIPE_PRICE_LIFETIME; delete process.env.STRIPE_PRICE_LIFETIME;
    check('billing no longer needs a forever price to be on', billingEnabled() === true);
    process.env.STRIPE_PRICE_LIFETIME = life;
  }
  check('and the founding price is marked in Stripe, on the yearly price, not in the app', bcfg.prices.year.founding === true && bcfg.prices.month.founding === false, bcfg.prices);
  {
    /* one price Stripe cannot find drops that price alone. In production the forever id named a
       price live mode did not have, which blanked the yearly and monthly prices on the site and the
       web plan sheet, and the founding line on the iPhone's (2026-09-30) */
    const saved = { STRIPE_PRICE_LIFETIME: process.env.STRIPE_PRICE_LIFETIME, STRIPE_PRICE_YEAR: process.env.STRIPE_PRICE_YEAR };
    const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
    const logged = [], was = console.error;
    /* a request that throws, or an answer that is not JSON, fails the checks below rather than the suite */
    const ask = async () => { stripeLib.forgetPrices(); const r = await fetch(NODE_BASE + '/api/billing'); return { cache: r.headers.get('cache-control') || '', body: await r.json().catch(() => ({})) }; };
    const reads = () => stripeCalls.filter(c => c.path.startsWith('/v1/prices/')).length;
    const got = {};
    console.error = (...a) => { logged.push(a.map(String).join(' ')); was.apply(console, a); };
    try {
      process.env.STRIPE_PRICE_LIFETIME = 'price_gone'; got.gone = await ask();
      restore(); got.healed = await stripeLib.priceInfo();   /* not forgotten first: nothing partial was kept */
      process.env.STRIPE_PRICE_YEAR = 'price_gone'; got.noYear = await ask();
      restore(); delete process.env.STRIPE_PRICE_LIFETIME; got.cleared = await ask();   /* production, once its forever id is cleared */
    } catch (e) { got.error = String(e); }
    finally { console.error = was; restore(); stripeLib.forgetPrices(); }
    const { gone = { body: {} }, healed, noYear = { body: {} }, cleared = { body: {} } } = got, pr = gone.body.prices || {}, cl = cleared.body.prices || {};
    check('a forever price Stripe cannot find drops that line alone: the answer still carries the yearly and monthly prices and the founding mark',
      gone.body.enabled === true && !!pr.year && pr.year.amount === 1999 && pr.year.founding === true && !!pr.month && pr.month.amount === 299 && pr.lifetime === null, got);
    check('and the log names the variable holding it, and the answer is asked for again within the minute',
      logged.some(l => /^billing: prices STRIPE_PRICE_LIFETIME price_gone: No such price/.test(l)) && /max-age=60$/.test(gone.cache), { logged, cache: gone.cache });
    check('and an answer with a price missing is not remembered: the next ask, with Stripe answering, has all three',
      !!healed && !!healed.lifetime && healed.lifetime.amount === 7900 && !!healed.month && healed.month.amount === 299, got);
    check('without the yearly price there are still no prices at all, as before',
      noYear.body.enabled === true && noYear.body.prices === null && /max-age=60$/.test(noYear.cache) && logged.some(l => /^billing: prices STRIPE_PRICE_YEAR price_gone:/.test(l)), got);
    check('with the forever id cleared, as production\'s is to be, the yearly and monthly are a whole answer, sent for the hour',
      cl.lifetime === null && !!cl.year && cl.year.amount === 1999 && !!cl.month && cl.month.amount === 299 && /max-age=3600$/.test(cleared.cache), got);
    const back = await ask(), before = reads(); await stripeLib.priceInfo();
    check('and with every id good again the whole answer is back, sent for the hour and remembered: asked again, Stripe is not',
      !!back.body.prices && !!back.body.prices.lifetime && back.body.prices.lifetime.amount === 7900 && /max-age=3600$/.test(back.cache) && reads() === before, { back, reads: reads() - before });
  }
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  check('with the three weeks over, Add wears the star and opens the plan instead of the lunchbox sheet', (await pb.$$eval('[data-act="add-kid"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="upgrade"][data-why="lunchbox"]', a => a.length)) === 1);
  await pb.click('[data-act="upgrade"][data-why="lunchbox"]'); await pb.waitForTimeout(350);
  check('signed out, a second lunchbox opens the Household plan sheet with a sign-in button', (await pb.$$eval('#nkName', a => a.length)) === 0 && (await pb.$$eval('[data-act="go-signin"]', a => a.length)) === 1 && /second lunchbox/i.test(await pb.textContent('#sheetBody')));
  await pb.click('[data-act="go-signin"]'); await pb.waitForTimeout(300);
  check('and that button lands on the sign-in field', await pb.evaluate(() => document.activeElement && document.activeElement.id === 'signinEmail'));
  await pb.fill('#signinEmail', 'pat@example.com'); await pb.press('#signinEmail', 'Enter');
  await until(pb, () => !!document.querySelector('[data-dev-link]'));
  await pb.goto(await pb.getAttribute('[data-dev-link]', 'href')); await pb.click('button[type="submit"]'); await pb.waitForURL(/\/app\//); await pb.waitForLoadState('load');
  await until(pb, () => /pat@example\.com/.test(document.querySelector('#view').textContent) && !!document.querySelector('[data-act="pane"][data-pane="plan"]'));
  check('signed in from a phone\'s Safari, the app says how to put it on the home screen, step by step, once', /bottom right/.test(await pb.textContent('#view')) && /Add to Home Screen/.test(await pb.textContent('#view')) && !!(await pb.$('.banner.hot [data-act="home-ok"]')));
  await pb.$eval('[data-act="home-ok"]', b => b.click()); await pb.waitForTimeout(200);   /* the resumed sheet sits over it in this flow; the tap itself is what is under test */
  check('and OK puts it away for good', !/Add to Home Screen/.test(await pb.textContent('#view')) && (await pb.evaluate(() => localStorage.getItem('lunchsorted-home-seen'))) === '1');
  const resumed = await until(pb, () => document.querySelector('#sheet').classList.contains('open') && /second lunchbox/i.test(document.querySelector('#sheetBody').textContent));
  check('after signing in, the plan sheet comes back on its own for the lunchbox they were adding', resumed);
  await sheetDone(pb); await pb.waitForTimeout(300);
  await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(250);   /* the sheet opened over the Lunchbox page they were on; the rows are one tap away */
  check('signed in and free, the Subscription row says Not on', /Subscription\s*Not on/.test(await pb.textContent('#view')));
  await openPane(pb, 'plan');
  check('and the Subscription page offers the plan with no billing to manage', /Your plan\s*Free/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="portal"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="upgrade"]', a => a.length)) >= 1);
  await pb.click('[data-act="pane-done"]'); await pb.waitForTimeout(200);

  /* a food in the parent's own words is the plan; the idea bank is free for good, and
     nothing a household already added is ever taken off the list */
  await pb.click('[data-act="tab"][data-tab="foods"]'); await pb.waitForTimeout(300);
  const foodsBefore = await pb.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.filter(f => !f.deletedAt).length);
  check('lapsed, Add your own wears a lock and keeps its place on the page',
    (await pb.$$eval('[data-act="upgrade"][data-why="food"]', a => a.length)) === 1
    && (await pb.$$eval('[data-act="add-own"]', a => a.length)) === 0);
  check('and the free way in sits beside it, not three screens back',
    (await pb.$$eval('[data-act="ideas"]', a => a.filter(b => /idea bank/i.test(b.textContent)).length)) >= 1);
  check('and every food already on the list is still there and still planned', foodsBefore > 0 &&
    (await pb.$$eval('.item .nm', a => a.length)) > 0 && !/no foods/i.test(await pb.textContent('#view')), foodsBefore);
  await pb.click('[data-act="tab"][data-tab="recipes"]'); await pb.waitForTimeout(350);
  check('lapsed, the Recipes tab is still there to cook from, with the idea bank free and importing locked',
    (await pb.$$eval('[data-act="cook-recipe"]', a => a.length)) >= 2
    && (await pb.$$eval('[data-act="upgrade"][data-why="recipe"]', a => a.length)) === 1
    && (await pb.$$eval('[data-act="recipe-import"]', a => a.length)) === 0);
  await pb.click('[data-act="upgrade"][data-why="recipe"]'); await pb.waitForTimeout(350);
  check('and the plan sheet says what is locked and what is not',
    /The two the app comes with stay free to cook from/.test(await pb.textContent('#sheetBody')), await pb.textContent('#sheetBody'));
  await sheetDone(pb); await pb.waitForTimeout(250);
  await pb.click('[data-act="tab"][data-tab="foods"]'); await pb.waitForTimeout(350);
  await pb.click('[data-act="upgrade"][data-why="food"]'); await pb.waitForTimeout(350);
  check('tapping the lock opens the plan sheet, not the form',
    (await pb.$$eval('#nfName', a => a.length)) === 0 && /own words/i.test(await pb.textContent('#sheetBody')));
  await sheetDone(pb); await pb.waitForTimeout(250);
  /* the idea bank must still add, or "free for good" is not true */
  await pb.click('[data-act="ideas"]'); await pb.waitForTimeout(350);
  const freeIdea = await pb.$('#sheetBody [data-act="add-idea"]:not(.ticked)');
  if (freeIdea) { await freeIdea.click(); await pb.waitForTimeout(500); }
  await sheetDone(pb); await pb.waitForTimeout(250);
  check('and the idea bank still adds a food on a lapsed household',
    (await pb.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.filter(f => !f.deletedAt).length)) > foodsBefore, foodsBefore);
  /* the sheet left open across the last night of the trial must refuse at save time */
  const countFoods = () => pb.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.filter(f => !f.deletedAt).length);
  const beforeSave = await countFoods();
  await pb.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-act','save-own'); document.body.appendChild(b); b.click(); b.remove(); });
  await pb.waitForTimeout(500);   /* save() is debounced, so the read has to outlive it */
  check('and a save that slips through while gated adds nothing, and says why', (await countFoods()) === beforeSave
    && /own words/i.test(await pb.textContent('#sheetBody')), beforeSave);
  await sheetDone(pb); await pb.waitForTimeout(250);
  await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(250);

  /* The navigation does not open this sheet. The app reads upgrade=1, takes it out of the
     address bar straight away, and opens the plan only once the boot's own GET /api/household
     has come back with a session — so the thing to wait for is the sheet, not the load event,
     and load fires long before it. It arrives in about a quarter of a second against until()'s
     fifteen, so a miss is not slowness: it is that reply never landing, and the app has already
     spent the intent it would need to try again. Keep the reply, then, for the FAIL to name. */
  const bootReplies = [];
  const keepReply = r => { if(r.url().includes('/api/household')) bootReplies.push(r.request().method()+' '+r.status()); };
  const keepFail  = r => { if(r.url().includes('/api/household')) bootReplies.push(r.request().method()+' never answered'); };
  const fresh = f => { if(f === pb.mainFrame()) bootReplies.length = 0; };   /* the last page's tail is not this boot's */
  pb.on('response', keepReply); pb.on('requestfailed', keepFail); pb.on('framenavigated', fresh);
  await pb.goto(BASE+'/app/?upgrade=1'); await pb.waitForLoadState('load');
  const viaMail = await until(pb, () => document.querySelector('#sheet').classList.contains('open') && /Household plan/.test(document.querySelector('#sheetBody').textContent));
  pb.off('response', keepReply); pb.off('requestfailed', keepFail); pb.off('framenavigated', fresh);
  check('the link in a reminder email opens the plan sheet on arrival', viaMail && !pb.url().includes('upgrade='),
    viaMail ? undefined : {household: bootReplies, url: pb.url(), screen: await pb.evaluate(() => ({
      sheet: document.querySelector('#sheet').className,
      title: document.querySelector('#sheetTitle').textContent,
      view: document.querySelector('#view').textContent.replace(/\s+/g, ' ').slice(0, 160)
    })).catch(e => String(e))});
  /* Nobody tapped for this sheet. It takes the cursor all the same, and the browser, which has seen
     no touch on this page and so rings whatever a script focuses, draws nothing round the title of
     the sheet that sells the plan. */
  check('that sheet has the cursor on its title, and no ring round it', await pb.evaluate(() => { const t = document.getElementById('sheetTitle');
    return document.activeElement === t && getComputedStyle(t).outlineStyle === 'none'; }));
  const mailDone = await sheetDone(pb); await pb.waitForTimeout(300);
  /* the boot drew the page before the sheet came, so nothing had the cursor to go back to: the first heading in the view takes it */
  check('and Done, with nothing that had the cursor to go back to, lands on the first heading in the view', mailDone && await pb.evaluate(() => { const a = document.activeElement;
    return !!a && a === document.querySelector('#view h2, #view h3'); }));
  check('a signed-in parent who is not in ADMIN_EMAILS gets not-found from the numbers page', (await pb.evaluate(() => fetch('/api/admin').then(r => r.status))) === 404);
  const noCustomer = await pb.evaluate(() => fetch('/api/billing/portal', {method:'POST'}).then(r => r.status));
  check('there is no billing to manage before anything is bought', noCustomer === 404, noCustomer);
  await until(pb, () => fetch('/api/household').then(r => r.json()).then(j => j.version >= 1));
  const patState = await pb.evaluate(() => fetch('/api/household').then(r => r.json()));
  /* Subscription's rows as "label: value", read until they are the ones wanted or 15 seconds go by */
  const planRows = async want => {
    let rows = [];
    for (const end = Date.now() + 15000; Date.now() < end; await pb.waitForTimeout(250)) {
      rows = await pb.$$eval('#view .kv', a => a.map(r => Array.from(r.children).map(c => c.textContent.trim()).join(': ')));
      if (JSON.stringify(rows) === JSON.stringify(want)) break;
    }
    return rows;
  };
  /* ---- the beta link: free forever for the first BETA_CAP households, switched on from the app once signed in */
  {
    const entPat = async () => (await db.query(`SELECT plan, source, status FROM entitlements WHERE household_id = ${patState.household.id}`)).rows[0];
    const betaPage = await (await fetch(NODE_BASE + '/beta')).text();
    check('the beta page says how many spots are left and links into the app with the code', /2 spots left/.test(betaPage) && betaPage.includes('/app/?beta=BETA-TEST-1234') && (betaPage.match(/<script/g) || []).length === 1 && /<script src="\/ga\.js" defer>/.test(betaPage) && /15 years/.test(betaPage) && /class="qr"><svg/.test(betaPage) && !/<script|on\w+=/.test(betaPage.slice(betaPage.indexOf('class="qr"'))), betaPage.slice(0, 200));
    const wrong = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-NOPE-0000' }) }).then(r => r.status));
    check('a wrong beta code grants nothing', wrong === 404 && ((await entPat()) || {}).plan !== 'lifetime', wrong);
    check('a stranger cannot claim the beta', (await fetch(NODE_BASE + '/api/billing/beta', { method: 'POST', body: JSON.stringify({ code: 'BETA-TEST-1234' }) })).status === 401);
    /* Opened on the first open after an update, so the note is owed. The first tries cannot get through
       (a 503, as when Stripe cannot be reached to stop a subscription): Account, where the link lands,
       says so with Try again over the note, and Pack keeps the note. The 503 is the test's own, so no
       claim reaches the server and none counts against the hour's five. Then Try again goes through,
       and the claim's own banner hands the note back. */
    await pb.evaluate(() => localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'));
    const unreachable = r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Stripe could not be reached' }) });
    await pb.route('**/api/billing/beta', unreachable);
    await pb.goto(BASE + '/app/?beta=BETA-TEST-1234'); await pb.waitForLoadState('load');
    const tryAgain = await until(pb, () => !!document.querySelector('.banner [data-act="beta-retry"]'));
    if (NOTE_TEXT) {
      check('a claim that cannot get through says so on Account, with Try again, over the note the update owes', tryAgain && (await pb.$$eval('[data-act="whats-new"]', a => a.length)) === 0);
      await pb.click('[data-act="tab"][data-tab="pack"]'); await pb.waitForTimeout(250);
      check('and Pack keeps the note meanwhile', (await pb.$$eval('[data-act="whats-new"]', a => a.length)) === 1 && !(await pb.$('[data-act="beta-retry"]')));
      await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(250);
    } else check('a claim that cannot get through says so on Account, with Try again', tryAgain);
    await pb.unroute('**/api/billing/beta', unreachable);
    /* Try again goes out and is held a moment, while the price sheet goes up over Subscription, as a sign-in
       that came back to a gated page can put it up. When the claim lands paid, the sheet is put away. */
    let release = () => {}; const held = new Promise(r => { release = r; });
    const hold = async route => { await held; await route.continue(); };
    await pb.route('**/api/billing/beta', hold);
    if (await until(pb, () => !!document.querySelector('.banner [data-act="beta-retry"]'), null, 3000)) await pb.click('.banner [data-act="beta-retry"]');
    await openPane(pb, 'plan');
    const buyUp = await until(pb, () => !!document.querySelector('#view [data-act="upgrade"]'), null, 5000);
    if (buyUp) await pb.click('#view [data-act="upgrade"]');
    const priceUp = buyUp && await sheetIsOpen(pb) && /Household plan/.test(await pb.textContent('#sheetTitle'));
    release();
    const priceGone = priceUp && await until(pb, () => !document.querySelector('#sheet').classList.contains('open'), null, 10000);
    await pb.unroute('**/api/billing/beta', hold);
    check('a price sheet up when the beta lands is put away: nothing is offered for sale over a free forever', priceUp && priceGone, { buyUp, priceUp, priceGone });
    let got = null; for (let i = 0; i < 40 && !(got && got.plan === 'lifetime'); i++) { await pb.waitForTimeout(250); got = await entPat(); }
    check('opening the beta link while signed in switches the household to forever, marked as the beta', !!got && got.plan === 'lifetime' && got.source === 'code' && got.status === 'active', got);
    check('the code leaves the address bar and the phone once used', !/beta=/.test(pb.url()) && (await pb.evaluate(() => localStorage.getItem('lunchsorted-beta'))) === null);
    await until(pb, () => /The beta is on/.test(document.querySelector('#view').textContent));
    check('and the app says so where it stays, in green', !!(await pb.$('.banner.good [data-act="notice-dismiss"]')));
    check('once: no toast says the same words over the banner', await pb.evaluate(() => { const t = document.querySelector('#toast');
      return !(t && t.classList.contains('show') && /free forever/.test(t.textContent)); }));
    check('and a screen reader is told, as the toast used to tell it', await pb.evaluate(() => { const s = document.getElementById('say');
      return !!s && s.getAttribute('aria-live') === 'polite' && /The beta is on/.test(s.textContent); }));
    const betaOK = !!(await pb.$('.banner [data-act="notice-dismiss"]'));
    if (betaOK) { await pb.click('.banner [data-act="notice-dismiss"]'); await pb.waitForTimeout(250); }
    const notesUp = await pb.$$eval('[data-act="whats-new"]', a => a.length);
    if (NOTE_TEXT) {
      check('and its OK hands the banner back to the note the update owed', betaOK && notesUp === 1);
      if (betaOK && notesUp === 1) { await pb.click('[data-act="whats-new"]'); await sheetDone(pb); await pb.waitForTimeout(300); }
    } else check('and its OK clears it, with no note to hand back', betaOK && notesUp === 0);
    await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(250);
    check('a beta household has the feedback strip on every tab', !!(await pb.$('.betabar a[href="/feedback.html"], .betabar [data-act="help-site"]')) && /Beta tester/.test(await pb.textContent('.betabar')));
    /* the strip is on every tab, and its own rule had squeezed the button to 40px, under the 44px every button keeps */
    const betaTap = await pb.$$eval('.betabar .btn', a => a.map(b => { const r = b.getBoundingClientRect(); return {h: r.height, w: r.width}; }));
    check('and its Send feedback button is a full 44px to tap', betaTap.length === 1 && betaTap[0].h >= 44 && betaTap[0].w >= 44, betaTap);
    await pb.click('[data-act="tab"][data-tab="foods"]'); await pb.waitForTimeout(250);
    check('on Foods too', !!(await pb.$('.betabar')));
    check('the beta page counts it', /1 spot left/.test(await (await fetch(NODE_BASE + '/beta')).text()));
    /* nobody paid for it: no price, though Stripe has one for forever (as staging's does), and no word of buying it */
    await pb.click('[data-act="tab"][data-tab="setup"]');
    const betaCaption = await pb.textContent('[data-act="pane"][data-pane="plan"] .meta');
    await openPane(pb, 'plan');
    const betaRows = await planRows(['Your plan: Household, free forever']);
    const lifePrice = await pb.evaluate(() => { try { return JSON.parse(localStorage.getItem('lunchsorted-billing')).prices.lifetime.amount; } catch (e) { return null; } });
    const betaCard = await pb.$eval('#view .card', c => ({ controls: c.querySelectorAll('button, a').length, emptyRows: [...c.querySelectorAll('.row')].filter(r => !r.children.length).length }));
    check('a beta household\'s Subscription says free forever, with no cost line and nothing about buying it, though Stripe has a forever price',
      lifePrice === 7900 && betaCaption === 'Free forever' && JSON.stringify(betaRows) === JSON.stringify(['Your plan: Household, free forever']) && betaCard.controls === 0 && betaCard.emptyRows === 0,
      { lifePrice, betaCaption, betaRows, betaCard });
    await openPane(pb, 'account');
    const betaGone = await pb.$$eval('#view li', a => a.map(l => l.textContent));
    check('and the delete warning calls it your free forever plan, as every other screen does, not a purchase', betaGone.includes('Your free forever plan, which does not come back') && !betaGone.some(l => /purchase|paid/i.test(l)), betaGone);
    const again = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-TEST-1234' }) }).then(r => r.json().then(j => ({ status: r.status, already: j.already }))));
    check('claiming twice is fine and says so', again.status === 200 && again.already === true, again);
    await db.query(`UPDATE entitlements SET plan = 'household', source = 'stripe', status = 'active', stripe_subscription_id = 'sub_beta_x' WHERE household_id = ${patState.household.id}`);
    const payingCalls = stripeCalls.length;
    const paying = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-TEST-1234' }) }).then(r => r.json().then(j => ({ status: r.status, paying: j.paying }))));
    check('a household paying for the plan is refused the beta, so its card is not charged for nothing, and its subscription is left alone',
      paying.status === 409 && paying.paying === true && (await entPat()).plan === 'household' && !stripeCalls.slice(payingCalls).some(c => c.path.startsWith('/v1/subscriptions/')), paying);
    /* its first charge failed when the three weeks ended: the row reads ended while Stripe goes on retrying the card, so
       the claim goes through and cancels that subscription before forever is written over it. Left running, a retry that
       went through would bill a free forever every year, with nothing on the row to find it by. The claim asks Stripe
       first, since the row can be behind it, and Stripe here is a stub that remembers what it cancelled: a first charge
       being retried, a plan paid for, one long ended, one it has no record of, no answer at all, an answer that says no
       state (a page that is not JSON, null, or a bare string), a cancel it refuses, a cancel whose answer is lost on the way back, and a
       checkout that lands on the row while the claim waits on Stripe.
       The throttles are not what these check, so each claim starts this parent's hourly counts again: its five claims,
       and the twenty billing requests the checkouts further down need, keep their room */
    const claimNow = async () => {
      await db.query(`DELETE FROM rate_events WHERE key IN ('beta:${patState.me.userId}', 'billing:${patState.me.userId}')`);
      return pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-TEST-1234' }) }).then(r => r.json().then(j => ({ status: r.status, paying: j.paying === true }))));
    };
    const lapsedOn = sub => db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'canceled', stripe_subscription_id = '${sub}' WHERE household_id = ${patState.household.id}`);
    const rowNow = async () => (await db.query(`SELECT plan, source, status, stripe_subscription_id AS sub FROM entitlements WHERE household_id = ${patState.household.id}`)).rows[0];
    const isForever = r => r.plan === 'lifetime' && r.source === 'code' && r.status === 'active' && r.sub === null;
    /* a claim, what it asked Stripe about subscriptions, and the row after it */
    const asked = async () => { const from = stripeCalls.length, { status, paying } = await claimNow();
      return { status, paying, calls: stripeCalls.slice(from).filter(c => c.path.startsWith('/v1/subscriptions/')).map(c => c.method + ' ' + c.path.split('/').pop()), row: await rowNow() }; };
    const stripeStub = globalThis.__LS_STRIPE_FETCH, ended = new Set();
    const answer = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.__LS_STRIPE_FETCH = async (url, init) => {
      const path = new URL(url).pathname, id = path.replace(/^\/v1\/subscriptions\//, '');
      if (!/^sub_(x|paid|gone|unknown|down|odd|null|str|stuck|cut|race)$/.test(id)) return stripeStub(url, init);
      stripeCalls.push({ method: init.method, path });
      if (id === 'sub_down') throw new TypeError('fetch failed');
      if (id === 'sub_unknown' || (ended.has(id) && init.method === 'DELETE')) return answer({ error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such subscription: '${id}'` } }, 404);
      if (id === 'sub_odd') return new Response('<html>a proxy page, not Stripe</html>', { status: 200 });
      if (id === 'sub_null') return new Response('null', { status: 200 });
      if (id === 'sub_str') return new Response('"canceled"', { status: 200 });   /* a state, but not a subscription with one */
      if (init.method === 'GET') return answer(id === 'sub_paid' ? { id, object: 'subscription', status: 'active' }
        : id === 'sub_gone' || ended.has(id) ? { id, object: 'subscription', status: 'canceled' }
        : { id, object: 'subscription', status: 'past_due', trial_end: 1790000000, items: { data: [{ current_period_start: 1790000000 }] } });   /* the first charge, when the free weeks ended */
      if (id === 'sub_stuck') return answer({ error: { type: 'api_error', message: 'stub: not now' } }, 500);
      if (id === 'sub_race') await db.query(`UPDATE entitlements SET plan = 'household', source = 'stripe', status = 'active', stripe_subscription_id = 'sub_new' WHERE household_id = ${patState.household.id}`);
      ended.add(id);
      return id === 'sub_cut' ? { ok: true, status: 200, text: () => Promise.reject(new Error('connection reset')) } : answer({ id, object: 'subscription', status: 'canceled' });
    };
    try {
      /* the other parent paid before, so the card behind the portal is theirs */
      const [payer] = (await db.query(`INSERT INTO users (email) VALUES ('payer@example.com') RETURNING id`)).rows;
      await lapsedOn('sub_x'); await db.query(`UPDATE entitlements SET paid_by = ${payer.id} WHERE household_id = ${patState.household.id}`);
      const retrying = await asked();
      check('a household whose first charge failed gets the beta, and the subscription Stripe is still retrying is cancelled first',
        retrying.status === 200 && JSON.stringify(retrying.calls) === JSON.stringify(['GET sub_x', 'DELETE sub_x']) && isForever(retrying.row), retrying);
      const payerNow = (await db.query(`SELECT paid_by FROM entitlements WHERE household_id = ${patState.household.id}`)).rows[0].paid_by;
      check('and whoever claims is not made the payer: the card and its invoices stay the other parent\'s', retrying.status === 200 && payerNow === payer.id, { status: retrying.status, payerNow, payer: payer.id });
      await db.query(`DELETE FROM users WHERE id = ${payer.id}`);   /* the numbers page counts every person */
      await lapsedOn('sub_paid');
      const paid = await asked();
      check('one Stripe says is paid for, its news not yet on the row, is refused like any paying household, and left running',
        paid.status === 409 && paid.paying && JSON.stringify(paid.calls) === JSON.stringify(['GET sub_paid']) && paid.row.status === 'canceled' && paid.row.sub === 'sub_paid', paid);
      await lapsedOn('sub_down');
      const down = await asked();
      await lapsedOn('sub_odd');
      const odd = await asked();
      await lapsedOn('sub_null');
      const nothing = await asked();
      await lapsedOn('sub_str');
      const bare = await asked();
      await lapsedOn('sub_stuck');
      const stuck = await asked();
      check('if Stripe cannot be reached, answers without saying what state it is in, or will not cancel it, the claim waits, with the subscription still on the row',
        down.status === 503 && JSON.stringify(down.calls) === JSON.stringify(['GET sub_down']) && down.row.plan === 'free' && down.row.sub === 'sub_down'
        && odd.status === 503 && JSON.stringify(odd.calls) === JSON.stringify(['GET sub_odd']) && odd.row.plan === 'free' && odd.row.sub === 'sub_odd'
        && nothing.status === 503 && JSON.stringify(nothing.calls) === JSON.stringify(['GET sub_null']) && nothing.row.plan === 'free' && nothing.row.sub === 'sub_null'
        && bare.status === 503 && JSON.stringify(bare.calls) === JSON.stringify(['GET sub_str']) && bare.row.plan === 'free' && bare.row.sub === 'sub_str'
        && stuck.status === 503 && JSON.stringify(stuck.calls) === JSON.stringify(['GET sub_stuck', 'DELETE sub_stuck', 'GET sub_stuck']) && stuck.row.plan === 'free' && stuck.row.sub === 'sub_stuck',
        { down, odd, nothing, bare, stuck });
      await lapsedOn('sub_gone');
      const gone = await asked();
      await lapsedOn('sub_unknown');
      const unknown = await asked();
      await lapsedOn('sub_cut');
      const cut = await asked();
      check('one Stripe ended long ago, or has no record of, is left as it is, and one cancelled with its answer lost is read back: none holds the claim up',
        gone.status === 200 && JSON.stringify(gone.calls) === JSON.stringify(['GET sub_gone']) && isForever(gone.row)
        && unknown.status === 200 && JSON.stringify(unknown.calls) === JSON.stringify(['GET sub_unknown']) && isForever(unknown.row)
        && cut.status === 200 && JSON.stringify(cut.calls) === JSON.stringify(['GET sub_cut', 'DELETE sub_cut', 'GET sub_cut']) && isForever(cut.row),
        { gone, unknown, cut });
      const secondFrom = stripeCalls.length, cancelledBefore = await stripeLib.cancelSubscription('sub_x');
      const secondCalls = stripeCalls.slice(secondFrom).map(c => c.method + ' ' + c.path.split('/').pop()), refused = await stripeLib.cancelSubscription('sub_stuck');
      check('cancelling one Stripe cancelled before counts as done on its no-such-subscription answer alone, and one it will not cancel does not',
        cancelledBefore === true && JSON.stringify(secondCalls) === JSON.stringify(['DELETE sub_x']) && refused === false, { cancelledBefore, secondCalls, refused });
      await lapsedOn('sub_race');
      const race = await asked();
      const raceAgain = await claimNow();
      check('a checkout that lands while the claim waits on Stripe is not written over: the claim waits, and its next go is refused as paying',
        race.status === 503 && race.row.plan === 'household' && race.row.status === 'active' && race.row.sub === 'sub_new' && raceAgain.status === 409 && raceAgain.paying, { race, raceAgain });
    } finally { globalThis.__LS_STRIPE_FETCH = stripeStub; }
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL WHERE household_id = ${patState.household.id}`);
    process.env.BETA_CAP = '1';
    const fullPage = await (await fetch(NODE_BASE + '/beta')).text();
    check('at the cap the page says the beta is full and takes an email for the list', /beta is full/.test(fullPage) && /name="waitlist"/.test(fullPage) && /value="beta-full"/.test(fullPage) && /action="\/on-the-list\.html"/.test(fullPage) && !/Join the beta/.test(fullPage));
    await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'canceled', stripe_subscription_id = 'sub_full' WHERE household_id = ${patState.household.id}`);
    process.env.BETA_CAP = '0';                                   /* closed: nobody else gets in, whatever the count */
    const fullCalls = stripeCalls.length;
    const full = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-TEST-1234' }) }).then(r => r.json().then(j => ({ status: r.status, full: j.full }))));
    check('and a claim past the cap is refused, before Stripe is asked about the subscription on its row', full.status === 409 && full.full === true && !stripeCalls.slice(fullCalls).some(c => c.path.startsWith('/v1/subscriptions/')), full);
    /* a tester's first sign-in gets the beta welcome, not the three-weeks one: the flag rides on the link and the code */
    {
      const rq = await (await fetch(NODE_BASE + '/api/auth/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'betawelcome@example.com', beta: true }) })).json();
      check('a sign-in link asked for with a beta code waiting carries the mark', /&b=1$/.test(rq.devLink || ''), rq);
      const tok = new URL(rq.devLink).searchParams.get('t');
      const v = await fetch(NODE_BASE + '/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok, kind: 'native', beta: true }) });
      const w = mails.filter(m => m.to === 'betawelcome@example.com' && /beta/.test(m.subject));
      check('and the welcome says free forever, not three weeks', v.status === 200 && w.length === 1 && /free forever/.test(w[0].subject) && !mails.some(m => m.to === 'betawelcome@example.com' && /three weeks/.test(m.subject)), w.map(m => m.subject));
      check('and invites them to the testers\' Facebook group', w.length === 1 && /fb\.me\/g\//.test(w[0].text) && /private Facebook group/.test(w[0].html));
    }
    process.env.BETA_CAP = '2';
    await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'none', event_at = NULL, paid_by = NULL, stripe_customer_id = NULL, stripe_subscription_id = NULL, stripe_price_id = NULL WHERE household_id = ${patState.household.id}`);   /* back to a fresh household for the checkout tests */
    await pb.reload(); await pb.waitForLoadState('load'); await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(300);
  }
  const inviteFree = await pb.evaluate(() => fetch('/api/household/invite', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}).then(r => r.status));
  check('the server refuses an invite from a free household', inviteFree === 402, inviteFree);
  await db.query(`UPDATE households SET doc = jsonb_set(doc, '{createdAt}', to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) WHERE id = ${patState.household.id}`);
  const inviteTrial = await pb.evaluate(() => fetch('/api/household/invite', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}).then(r => r.status));
  await db.query(`UPDATE households SET doc = jsonb_set(doc, '{createdAt}', to_jsonb(to_char(now() AT TIME ZONE 'UTC' - interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) WHERE id = ${patState.household.id}`);
  check('but allows one while the three weeks are running, by the document\'s own birthday', inviteTrial === 200, inviteTrial);
  {
    const { trialStart } = await import('../netlify/lib/trial.js');
    const old = new Date(Date.now() - 40 * 86400000).toISOString(), fresh = new Date().toISOString(), future = '2099-01-01T00:00:00Z';
    const was = process.env.BILLING_SINCE; delete process.env.BILLING_SINCE;
    const a = trialStart({ doc_created: future, created_at: old }), b = trialStart({ doc_created: old, created_at: fresh }), c = trialStart({ doc_created: 'yesterday', created_at: fresh });
    process.env.BILLING_SINCE = fresh;
    const d = trialStart({ doc_created: old, created_at: old });
    if (was === undefined) delete process.env.BILLING_SINCE; else process.env.BILLING_SINCE = was;
    check('the server takes the earlier of the document\'s birthday and its own row, so a phone can only shorten its trial, and a household older than billing starts its three weeks the day billing began',
      a.toISOString() === old && b.toISOString() === old && c.toISOString() === fresh && d.toISOString() === fresh, [a, b, c, d]);
  }
  {
    /* days added by hand in the database lengthen the three weeks, on the server and on the phone alike */
    const hid = patState.household.id;
    await db.query(`UPDATE households SET trial_extra_days = 30 WHERE id = ${hid}`);
    const inviteExtended = await pb.evaluate(() => fetch('/api/household/invite', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}).then(r => r.status));
    const st = await pb.evaluate(() => fetch('/api/household').then(r => r.json()));
    await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
    await openPane(pb, 'household');
    const invites = await pb.$$eval('[data-act="invite"], [data-act="invite-helper"]', a => a.length);
    check('days added to a household\'s trial by hand reopen it: the server allows the invite and the app offers both invites again',
      inviteExtended === 200 && st.household.trialExtraDays === 30 && invites === 2, [inviteExtended, st.household && st.household.trialExtraDays, invites]);
    {
      /* A sheet the server opens after a tap goes back to whatever had the cursor when it came, and that
         must never be a button waiting for its second tap, or Delete once DELETE has been typed. The
         invite is held until the button is ready and has the cursor (where a parent on a keyboard
         would leave it), then refused, as an out-of-date plan would be. Without the guard, Done hands
         the cursor to the button, and one Enter clears every plan, or deletes the account. Enter is
         pressed only once the cursor is known to be safe, so a failure fails its own check and does
         not clear the household every later check reads. */
      const isInvite = u => u.pathname === '/api/household/invite';
      const refusedWith = async (ready, act) => {
        let release = () => {}; const gate = new Promise(r => { release = r; });
        const refuse = async route => { await gate; await route.fulfill({status: 402, contentType: 'application/json', body: JSON.stringify({error: 'Sharing is part of the Household plan'})}); };
        const out = {};
        await pb.route(isInvite, refuse);
        try {
          await openPane(pb, 'household');
          out.asked = !!(await pb.$('[data-act="invite"]'));
          if (out.asked) await pb.click('[data-act="invite"]', {timeout: 5000});
          await openPane(pb, 'account');
          out.ready = await ready();
          out.onIt = await pb.evaluate(w => { const a = document.activeElement; return !!a && a.getAttribute('data-act') === w; }, act);
        } finally { release(); }
        out.came = out.asked && await until(pb, () => document.querySelector('#sheet').classList.contains('open') && /Household plan/.test(document.querySelector('#sheetTitle').textContent), null, 5000);
        out.closed = !!out.came && await sheetDone(pb); await pb.waitForTimeout(300);
        out.where = await pb.evaluate(() => { const a = document.activeElement || document.body; return {tag: a.tagName, id: a.id, act: a.getAttribute('data-act')}; });
        await pb.unroute(isInvite, refuse);
        return out;
      };
      const weeks = () => pb.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => !!k.week)));
      const weeksWere = await weeks();
      const armedCase = await refusedWith(async () => {
        const b = await pb.$('[data-act="clear-week"]'); if (!b) return false;
        await b.click();
        if (!/Tap again to clear/.test(await pb.textContent('[data-act="clear-week"]'))) return false;
        await pb.focus('[data-act="clear-week"]'); return true;
      }, 'clear-week');
      if (armedCase.where.id === 'paneTitle') { await pb.keyboard.press('Enter'); await pb.waitForTimeout(300); }
      check('a sheet the server opens after a tap never hands the cursor to a button waiting for its second tap: Done lands on the page\u2019s title, and Enter clears nothing',
        armedCase.ready && armedCase.onIt && armedCase.came && armedCase.closed && armedCase.where.id === 'paneTitle' && /true/.test(weeksWere) && (await weeks()) === weeksWere, {armedCase, weeksWere});
      if (await pb.$('[data-act="pane-done"]')) { await pb.click('[data-act="pane-done"]'); await pb.waitForTimeout(200); }   /* any other tap takes the arming off */
      const deleteCase = await refusedWith(async () => {
        if (!(await pb.$('#deleteConfirm'))) return false;
        await pb.fill('#deleteConfirm', 'DELETE');
        const on = await pb.evaluate(() => { const b = document.querySelector('[data-act="delete-account"]'); return !!b && !b.disabled; });
        if (on) await pb.focus('[data-act="delete-account"]');
        return on;
      }, 'delete-account');
      check('nor to Delete once DELETE has been typed: Done lands on the page\u2019s title', deleteCase.ready && deleteCase.onIt && deleteCase.came && deleteCase.closed && deleteCase.where.id === 'paneTitle', deleteCase);
      if (await pb.$('#deleteConfirm')) await pb.fill('#deleteConfirm', '');
      if (await pb.$('[data-act="pane-done"]')) { await pb.click('[data-act="pane-done"]'); await pb.waitForTimeout(200); }   /* and any other tap forgets the typed word */
    }
    await db.query(`UPDATE households SET trial_extra_days = 0 WHERE id = ${hid}`);
    await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  }
  await openPane(pb, 'household');
  check('with the three weeks over, both invites wear the star and open the plan', (await pb.$$eval('[data-act="invite"], [data-act="invite-helper"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="upgrade"][data-why="share"]', a => a.length)) === 2);
  await pb.click('[data-act="upgrade"][data-why="share"]'); await pb.waitForTimeout(300);
  check('and the app opens the plan sheet instead, with both prices, the founding line and no forever', /other parent/i.test(await pb.textContent('#sheetBody')) && /\$19\.99 a year/.test(await pb.textContent('#sheetBody')) && /\$2\.99 a month/.test(await pb.textContent('#sheetBody')) && /Founding price: yours for as long as you stay subscribed/.test(await pb.textContent('#sheetBody')) && !/forever/i.test(await pb.textContent('#sheetBody')) && (await pb.$$eval('#sheetBody [data-plan="lifetime"]', a => a.length)) === 0);
  const monthly = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"month"}'}).then(r => r.json()));
  check('the monthly price opens a subscription checkout of its own', !!monthly.url && stripeCalls.some(c => c.path === '/v1/checkout/sessions' && c.params['line_items[0][price]'] === 'price_month' && c.params.mode === 'subscription' && c.params['subscription_data[metadata][plan]'] === 'month'));
  check('links in the sheet use the accent, not browser blue', await pb.$eval('#sheetBody a[href="/terms.html"]', a => getComputedStyle(a).color !== 'rgb(0, 0, 238)' && getComputedStyle(a).color !== 'rgb(0, 0, 255)'));
  const ownerCheckout = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.json()));
  check('checkout is opened on the server, for this household, on Stripe\'s page', ownerCheckout.url === 'https://checkout.stripe.com/c/pay/cs_test_1' &&
    stripeCalls.some(c => c.path === '/v1/checkout/sessions' && c.params.client_reference_id === String(patState.household.id) && c.params.mode === 'subscription' && c.params['line_items[0][price]'] === 'price_year' && c.params.customer_email === 'pat@example.com' && /\/app\/\?paid=1$/.test(c.params.success_url) && c.params['automatic_tax[enabled]'] === 'true' && c.auth === 'Bearer sk_test_stub'), stripeCalls.slice(-1));
  check('a household whose three weeks are over is charged the day it buys', !stripeCalls.filter(c => c.path === '/v1/checkout/sessions').pop().params['subscription_data[trial_end]']);
  {
    /* bought inside the three weeks: first charged when they end, so no free day is lost */
    const { trialEnd } = await import('../netlify/lib/trial.js');
    const hid = patState.household.id;
    const [was] = (await db.query(`SELECT created_at, doc->>'createdAt' AS doc_created FROM households WHERE id = ${hid}`)).rows;
    const born = new Date(Date.now() - 5 * 86400000).toISOString();
    await db.query(`UPDATE households SET created_at = '${born}', doc = jsonb_set(doc, '{createdAt}', to_jsonb('${born}'::text)) WHERE id = ${hid}`);
    await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.json()));
    const inTrial = stripeCalls.filter(c => c.path === '/v1/checkout/sessions').pop().params;
    const st = await pb.evaluate(() => fetch('/api/household').then(r => r.json()));
    check('the household\'s state tells the app the same date, so the sheet promises only what checkout does', st.chargeLater && Math.floor(new Date(st.chargeLater).getTime() / 1000) === Number(inTrial['subscription_data[trial_end]']), st.chargeLater);
    const want = Math.floor(trialEnd({ created_at: born, doc_created: born }).getTime() / 1000);
    check('bought inside the three weeks, the first charge is set for the day they end, and the session says so for the webhook',
      Number(inTrial['subscription_data[trial_end]']) === want && inTrial['metadata[charge_later]'] === '1', [inTrial['subscription_data[trial_end]'], want]);
    const late = new Date(Date.now() - 20 * 86400000).toISOString();
    await db.query(`UPDATE households SET created_at = '${late}', doc = jsonb_set(doc, '{createdAt}', to_jsonb('${late}'::text)) WHERE id = ${hid}`);
    await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.json()));
    check('and in its last day, too close for Stripe, it is charged the day it is bought, and the state says so', !stripeCalls.filter(c => c.path === '/v1/checkout/sessions').pop().params['subscription_data[trial_end]'] && (await pb.evaluate(() => fetch('/api/household').then(r => r.json()))).chargeLater === null);
    await db.query(`UPDATE households SET created_at = $1, doc = jsonb_set(doc, '{createdAt}', to_jsonb($2::text)) WHERE id = ${hid}`, [was.created_at, was.doc_created]);
  }
  /* left over from when the iPhone app opened Stripe in Safari: the server still honours client:'ios' and back.html
     still hands a result back to the app, though the page no longer takes this path (ios/README.md) */
  const sessionsBefore = stripeCalls.filter(c => c.path === '/v1/checkout/sessions').length;
  const iosCheckout = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year","client":"ios"}'}).then(async r => ({ status: r.status, body: await r.json() })));
  check('a checkout asked for from the iPhone app is refused, since it sells through the App Store, and Stripe is never asked', iosCheckout.status === 403 && iosCheckout.body.appStore === true && stripeCalls.filter(c => c.path === '/v1/checkout/sessions').length === sessionsBefore, iosCheckout);
  const backPage = await pb.evaluate(() => fetch('/back.html?paid=1').then(r => r.text().then(t => ({status: r.status, csp: r.headers.get('content-security-policy'), text: t}))));
  check('and that page carries the result into the app under its own policy', backPage.status === 200 && /lunchsorted:\/\/back/.test(backPage.text) && /default-src 'none'/.test(backPage.csp) && /sha256-/.test(backPage.csp) && !/http-equiv="refresh"/.test(backPage.text));
  {
    const pback = await ctx.newPage(); const handoffs = [];
    await pback.route(/^lunchsorted:\/\//, r => { handoffs.push(r.request().url()); r.abort(); });
    await pback.goto(BASE+'/back.html?paid=0', {waitUntil:'commit'}).catch(() => {}); await pback.waitForTimeout(400);   /* the page hands off at once, so "load" never fires */
    check('backing out of Stripe on the phone says nothing was charged, and the hand-off carries the result', /Nothing was charged/.test(await pback.textContent('h1')) && (await pback.getAttribute('#back', 'href')) === 'lunchsorted://back?paid=0', {handoffs, href: await pback.getAttribute('#back', 'href')});
    await pback.close();
  }
  {
    const ctxApp = await browser.newContext({ viewport:{width:375,height:812}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LunchSortedApp/1' });
    await pinClock(ctxApp);
    await ctxApp.route(/^https:\/\/fonts\.g(oogleapis|static)\.com\//, r => r.abort());
    const pa = await ctxApp.newPage(); pa.on('pageerror', e => errors.push(String(e.message)));
    await pa.goto(BASE+'/app/'); await pa.waitForTimeout(300);
    await pa.click('[data-act="ob-signin"]'); await pa.waitForTimeout(200);
    await pa.fill('#signinEmail', 'app@example.com'); await pa.press('#signinEmail', 'Enter'); await until(pa, () => !!document.querySelector('[data-dev-link]'));
    check('inside the iPhone app, the email step leads with the code, since a tapped link opens Safari', /Type the code/.test(await pa.textContent('#view')));
    await pa.click('[data-act="ob-later"]'); await pa.waitForTimeout(200);
    await pa.click('[data-act="ob-skip"]'); await pa.waitForTimeout(300);
    await openPane(pa, 'account');
    check('and Setup does not tell an app to add itself to the Home Screen', !/Add to Home Screen/.test(await pa.textContent('#view')) && /on this phone/.test(await pa.textContent('#view')));
    await ctxApp.close();
  }
  stripeCalls.length = 0; globalThis.__LS_STRIPE_NO_TAX = true;
  await pb.click('[data-act="buy"][data-plan="year"]'); await pb.waitForURL(/checkout\.stripe\.com/); 
  check('when Stripe Tax is not set up yet, the checkout is retried without it and still opens', pb.url().startsWith('https://checkout.stripe.com/') && stripeCalls.filter(c => c.path === '/v1/checkout/sessions').length === 2 && stripeCalls.filter(c => c.path === '/v1/checkout/sessions')[1].params['automatic_tax[enabled]'] === 'false');
  globalThis.__LS_STRIPE_NO_TAX = false;
  const anon = await fetch(NODE_BASE+'/api/billing/checkout', { method: 'POST', body: '{}' });
  check('a stranger cannot open a checkout', anon.status === 401);

  /* Stripe calls back */
  const hook = async (ev, opts = {}) => { if (ev.livemode === undefined) ev.livemode = false; const body = JSON.stringify(ev); const r = await fetch(NODE_BASE+'/api/billing/webhook', { method:'POST', headers: { 'content-type':'application/json', 'stripe-signature': opts.sig === undefined ? sign(body, opts.t) : opts.sig }, body }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const ent = async () => (await db.query(`SELECT plan, source, status, cancel_at_period_end AS cape, current_period_end AS pe, stripe_customer_id AS cust, stripe_subscription_id AS sub FROM entitlements WHERE household_id = ${patState.household.id}`)).rows[0];
  const t0 = Math.floor(Date.now() / 1000);
  const completed = { id: 'evt_1', type: 'checkout.session.completed', created: t0, data: { object: { id: 'cs_test_1', mode: 'subscription', payment_status: 'paid', customer: 'cus_pat', subscription: 'sub_pat', client_reference_id: String(patState.household.id), metadata: { household_id: String(patState.household.id), plan: 'year' } } } };
  const forgedHook = await hook(completed, { sig: 't=1,v1=deadbeef' });
  check('an unsigned webhook is refused and grants nothing', forgedHook.status === 400 && (await ent()).plan === 'free');
  const wrongMode = await hook(Object.assign({}, completed, { id: 'evt_live', livemode: true }));
  check('a live-mode event is refused outside production, whatever secret was pasted', wrongMode.status === 400 && (await ent()).plan === 'free');
  const noise = await hook({ id: 'evt_noise', type: 'invoice.paid', created: t0, data: { object: {} } });
  check('an event type we do not handle is acknowledged without touching the database', noise.status === 200 && noise.body.ignored === true && (await db.query(`SELECT count(*)::int AS n FROM stripe_events WHERE id='evt_noise'`)).rows[0].n === 0);
  /* the database fails once mid-apply: the event must not count as seen */
  const realSql = globalThis.__LS_SQL; let blow = true;
  globalThis.__LS_SQL = Object.assign(async (strings, ...vals) => { if (blow && typeof strings !== 'string' && strings.join('').includes('INSERT INTO entitlements')) { blow = false; throw new Error('neon blinked'); } return realSql(strings, ...vals); }, { transaction: realSql.transaction });
  const blinked = await hook(completed);
  globalThis.__LS_SQL = realSql;
  await db.query(`INSERT INTO rate_events (key) VALUES ('checkout:${patState.household.id}:999999:cs_other_open')`);   /* another checkout still open for the household when this one is paid */
  stripeCalls.length = 0;
  const ok = await hook(completed);
  check('a paid checkout closes any other still open for the household and clears the marks', stripeCalls.some(c => c.path === '/v1/checkout/sessions/cs_other_open/expire') && (await db.query(`SELECT count(*)::int AS n FROM rate_events WHERE key LIKE 'checkout:${patState.household.id}:%'`)).rows[0].n === 0);
  check('a delivery that failed mid-apply is retried by Stripe and applied the second time', blinked.status === 500 && ok.status === 200 && !ok.body.duplicate && (await ent()).plan === 'household', [blinked.status, ok.body]);
  check('a signed checkout.session.completed makes the household paid, with the renewal date from the subscription itself', (await ent()).status === 'active' && (await ent()).cust === 'cus_pat' && (await ent()).sub === 'sub_pat' && new Date((await ent()).pe).getTime() === PERIOD_END * 1000 && stripeCalls.some(c => c.method === 'GET' && c.path === '/v1/subscriptions/sub_pat'), await ent());
  const paidKinds = async (h) => (await db.query(`SELECT count(*)::int AS n FROM milestones WHERE household_id = ${h} AND kind = 'paid'`)).rows[0].n;
  check('a checkout that took the money is the household\'s paid milestone', (await paidKinds(patState.household.id)) === 1);
  const again = await hook(completed);
  check('the same event delivered twice is a no-op', again.status === 200 && again.body.duplicate === true);
  const subEv = (id, type, created, extra = {}) => ({ id, type, created, data: { object: Object.assign({ id: 'sub_pat', object: 'subscription', customer: 'cus_pat', status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: PERIOD_END, price: { id: 'price_year' } }] }, metadata: { household_id: String(patState.household.id) } }, extra) } });
  const early = await hook(subEv('evt_2', 'customer.subscription.created', t0 - 1));
  check('the subscription.created event, stamped a second earlier, is stale and harmless', early.status === 200 && (await ent()).status === 'active');
  const staleHook = await hook(subEv('evt_0', 'customer.subscription.updated', t0 - 100, { status: 'canceled' }));
  check('an older event arriving late cannot undo a newer one', staleHook.status === 200 && (await ent()).status === 'active');

  await pb.goto(BASE+'/app/?paid=1'); await pb.waitForLoadState('load');
  /* they were inviting the other parent when the paywall stopped them, so paying
     puts them back on that, not on a receipt */
  const resumedInvite = await until(pb, () => /Invite the other parent/.test(document.querySelector('#view').textContent));
  check('back from Stripe, the parent lands on the invite they were making', resumedInvite && !pb.url().includes('paid='));
  await pb.click('[data-act="pane-done"]'); await pb.waitForTimeout(250);
  await openPane(pb, 'plan');
  const backOk = await until(pb, () => /Renews\s*Jan 15, 2027/.test(document.querySelector('#view').textContent));
  if (!backOk) console.log('  (diag) url=' + pb.url() + ' view=' + (await pb.textContent('#view')).replace(/\s+/g, ' ').slice(0, 400) + ' errors=' + JSON.stringify(errors.slice(-3)));
  check('and Subscription carries the renewal date, what it costs, Manage billing, and no second buy button', backOk &&
    /\$19\.99 a year/.test(await pb.textContent('#view')) && /Cancel it any time in Manage billing/.test(await pb.textContent('#view')) &&
    (await pb.$$eval('[data-act="portal"]', a => a.length)) === 1 &&
    (await pb.$$eval('[data-act="upgrade"]:not([data-why="forever"])', a => a.length)) === 0, (await pb.textContent('#view')).match(/Renews[^\n]{0,60}/));
  /* a household on the monthly price must be told the monthly price, which only
     works if the entitlement's price id reaches the app at all */
  await db.query(`UPDATE entitlements SET stripe_price_id='price_month' WHERE household_id=${patState.household.id}`);
  await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
  const monthlyShown = await until(pb, () => /\$2\.99 a month/.test(document.querySelector('#view').textContent));
  check('a monthly household is told the monthly price, not the yearly one', monthlyShown &&
    !/\$19\.99 a year/.test(await pb.textContent('#view')), (await pb.textContent('#view')).replace(/\s+/g, ' ').slice(0, 200));
  const smallPlan = await pb.$$eval('.btn.sm, .tg, .kidbtn, .seg button, .x, nav.tabs button, .item[data-act]', a =>
    a.filter(e => e.checkVisibility()).map(e => ({h: Math.round(e.getBoundingClientRect().height), t: e.textContent.trim().slice(0,20)})).filter(x => x.h < 44));
  check('every tappable control on the Subscription page is at least 44px tall', smallPlan.length === 0, smallPlan);
  await db.query(`UPDATE entitlements SET stripe_price_id='price_year' WHERE household_id=${patState.household.id}`);
  await pb.reload(); await pb.waitForLoadState('load');
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('a paid household can add a second lunchbox', (await pb.$$eval('#nkName', a => a.length)) === 1);
  await sheetDone(pb); await pb.waitForTimeout(300);
  const invitePaid = await pb.evaluate(() => fetch('/api/household/invite', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}).then(r => r.status));
  check('and invite the other parent', invitePaid === 200, invitePaid);
  const dupYear = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status));
  check('a household that already has the yearly plan is not sold it again', dupYear === 409);
  await openPane(pb, 'plan');
  check('forever is not sold: Subscription offers no switch to it', (await pb.$$eval('[data-why="forever"], [data-plan="lifetime"]', a => a.length)) === 0);
  await pb.click('[data-act="portal"]'); await pb.waitForURL(/billing\.stripe\.com/);
  check('Manage billing opens Stripe\'s portal for this customer', stripeCalls.some(c => c.path === '/v1/billing_portal/sessions' && c.params.customer === 'cus_pat' && /\/app\/\?portal=1$/.test(c.params.return_url)));

  await hook(subEv('evt_3', 'customer.subscription.updated', t0 + 2, { cancel_at_period_end: true }));
  await pb.goto(BASE+'/app/?portal=1'); await pb.waitForLoadState('load');
  await until(pb, () => /Ends\s*Jan 15, 2027/.test(document.querySelector('#view').textContent));
  check('a cancellation shows as the plan ending on its date, still paid until then', /Ends\s*Jan 15, 2027/.test(await pb.textContent('#view')) && (await ent()).cape === true && (await ent()).status === 'active');
  await hook(subEv('evt_3b', 'customer.subscription.updated', t0 + 2, { status: 'past_due' }));
  await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
  await until(pb, () => /payment failed/i.test(document.querySelector('#view').textContent));
  check('a failed payment says so with the date, keeps the plan for now, and makes Manage billing the main button', /update the card in Manage billing, or the Household plan ends on Jan 15, 2027/i.test(await pb.textContent('#view')) && await pb.$eval('[data-act="portal"]', b => b.classList.contains('primary')) && (await pb.$$eval('[data-act="upgrade"]:not([data-why="forever"])', a => a.length)) === 0);
  await pb.click('[data-act="pane-done"]'); await pb.waitForTimeout(150); await pb.click('[data-act="tab"][data-tab="pack"]'); await pb.waitForTimeout(250);
  check('a failed renewal gets its own banner on Pack, with Manage billing as the one button that fixes it',
    /did not go through/.test(await pb.textContent('#view')) && (await pb.$$eval('.banner [data-act="portal"]', a => a.length)) === 1 && !/three weeks/.test(await pb.textContent('#view')), (await pb.textContent('#view')).slice(0, 200));
  await pb.click('.banner [data-act="trial-dismiss"]'); await pb.waitForTimeout(200);
  check('and OK puts it away', (await pb.$$eval('.banner', a => a.filter(b => /did not go through/.test(b.textContent)).length)) === 0);
  const pastDueYear = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status));
  check('and a second yearly checkout is refused while the first is unpaid', pastDueYear === 409);
  await hook(subEv('evt_4', 'customer.subscription.deleted', t0 + 3, { status: 'canceled' }));
  check('when the subscription ends the household is free again', (await ent()).plan === 'free' && (await ent()).status === 'canceled' && (await ent()).cust === 'cus_pat');
  await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
  await until(pb, () => /Your plan\s*Free/.test(document.querySelector('#view').textContent));
  check('an ended plan has its own words on the Subscription page, never "your three weeks are up"',
    /Ended/.test(await pb.textContent('#view')) && /The plan has ended/.test(await pb.textContent('#view')) && !/three weeks are up/.test(await pb.textContent('#view')), (await pb.textContent('#view')).slice(0, 300));
  const portalStill = (await pb.$$eval('[data-act="portal"]', a => a.length)) === 1;
  await pb.click('[data-act="pane-done"]'); await pb.waitForTimeout(200);
  check('and the Subscription row reads Ended', /Subscription\s*Ended/.test(await pb.textContent('#view')), (await pb.textContent('#view')).match(/Subscription\s*[^\n]{0,30}/));
  await pb.click('[data-act="tab"][data-tab="pack"]'); await pb.waitForTimeout(250);
  check('Pack says the plan ended, once, in its own words', /Household plan ended/.test(await pb.textContent('#view')) && !/three weeks are up/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="trial-dismiss"][data-stage^="plan-ended"]', a => a.length)) === 1);
  await pb.click('[data-act="trial-dismiss"][data-stage^="plan-ended"]'); await pb.waitForTimeout(200);
  check('and OK puts it away for good, with no "three weeks" banner behind it', (await pb.$$eval('.banner', a => a.filter(b => /plan has ended|three weeks/.test(b.textContent)).length)) === 0);
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="upgrade"][data-why="lunchbox"]'); await pb.waitForTimeout(350);
  check('and the second lunchbox is gated again, with Manage billing still there for the invoices', (await pb.$$eval('#nkName', a => a.length)) === 0 && (await pb.$$eval('[data-act="add-kid"]', a => a.length)) === 0 && portalStill);
  await sheetDone(pb); await pb.waitForTimeout(200);

  /* forever, bought before it was withdrawn from sale: still honoured */
  await hook({ id: 'evt_5', type: 'checkout.session.completed', created: t0 + 4, data: { object: { id: 'cs_test_2', mode: 'payment', payment_status: 'paid', customer: 'cus_pat', client_reference_id: String(patState.household.id), metadata: { household_id: String(patState.household.id), plan: 'lifetime' } } } });
  check('a lifetime purchase is forever', (await ent()).plan === 'lifetime' && (await ent()).status === 'active' && (await ent()).pe === null);
  await hook(subEv('evt_6', 'customer.subscription.deleted', t0 + 5, { status: 'canceled' }));
  check('and an old subscription ending later does not touch it', (await ent()).plan === 'lifetime');
  const lifeAgain = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"lifetime"}'}).then(r => r.status));
  check('and forever, no longer sold, cannot be bought again by asking the server for it', lifeAgain === 410, lifeAgain);
  await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
  const forever = await until(pb, () => /Household, forever/.test(document.querySelector('#view').textContent));
  check('Subscription says forever and offers no upgrade', forever && (await pb.$$eval('[data-act="upgrade"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="portal"]', a => a.length)) === 1);
  const boughtRows = await planRows(['Your plan: Household, forever', 'Cost: $79, once', 'Bought: Paid once, never renews']);
  await pb.click('[data-act="tab"][data-tab="setup"]');
  const boughtCaption = await pb.textContent('[data-act="pane"][data-pane="plan"] .meta');
  check('and forever bought through Stripe keeps its words: what it cost, and that it was paid once',
    boughtCaption === 'Forever' && JSON.stringify(boughtRows) === JSON.stringify(['Your plan: Household, forever', 'Cost: $79, once', 'Bought: Paid once, never renews']), { boughtCaption, boughtRows });
  await openPane(pb, 'account');
  check('and the delete warning still calls it the forever purchase', (await pb.$$eval('#view li', a => a.map(l => l.textContent))).includes('The forever purchase, which does not come back'),
    await pb.$$eval('#view li', a => a.map(l => l.textContent)));
  /* the beta link opened by a household that bought forever: the claim says it already has it, and the
     beta's banner, "yours, free forever", is not for a plan that was paid for. Pat's claims (five an hour)
     and billing requests (twenty) are throttled, and backing out of Stripe needs its share of the twenty
     further down, so both counters start again here rather than lean on how many the blocks above spent.
     The banner used to arrive with the pull that follows the toast, so the view is watched for two
     seconds after it */
  await db.query(`DELETE FROM rate_events WHERE key IN ('beta:${patState.me.userId}', 'billing:${patState.me.userId}')`);
  await pb.goto(BASE + '/app/?beta=BETA-TEST-1234'); await pb.waitForLoadState('load');
  const boughtClaim = await until(pb, () => /already yours/.test(document.querySelector('#toast').textContent));
  let boughtView = '';
  for (const end = Date.now() + 2000; Date.now() < end && !/The beta is on/.test(boughtView); await pb.waitForTimeout(200))
    boughtView = (await pb.textContent('#view')).replace(/\s+/g, ' ');
  check('the beta link opened by a household that bought forever says it already has it, and never calls it free',
    boughtClaim && !/The beta is on/.test(boughtView) && (await ent()).source === 'stripe' && (await ent()).plan === 'lifetime',
    { toast: await pb.textContent('#toast'), view: boughtView.slice(0, 200) });
  /* a yearly household that buys forever stops its subscription so nobody pays twice */
  await db.query(`UPDATE entitlements SET plan='household', status='active', stripe_subscription_id='sub_old', event_at=NULL WHERE household_id=${patState.household.id}`);
  stripeCalls.length = 0;
  await hook({ id: 'evt_7', type: 'checkout.session.completed', created: t0 + 6, data: { object: { id: 'cs_test_3', mode: 'payment', payment_status: 'paid', customer: 'cus_pat', client_reference_id: String(patState.household.id), metadata: { plan: 'lifetime' } } } });
  check('buying forever on top of a yearly plan stops the yearly plan at its period end', (await ent()).plan === 'lifetime' && stripeCalls.some(c => c.path === '/v1/subscriptions/sub_old' && c.params.cancel_at_period_end === 'true'));
  await hook({ id: 'evt_refund_part', type: 'charge.refunded', created: t0 + 8, data: { object: { id: 'ch_1', object: 'charge', customer: 'cus_pat', refunded: false } } });
  check('a partial refund changes nothing', (await ent()).plan === 'lifetime');
  await hook({ id: 'evt_refund', type: 'charge.refunded', created: t0 + 9, data: { object: { id: 'ch_1', object: 'charge', customer: 'cus_pat', refunded: true } } });
  check('a forever purchase refunded in full is undone', (await ent()).plan === 'free' && (await ent()).status === 'canceled');
  /* the beta's forever charged nothing but keeps the Stripe customer of anything bought before, so a charge of that
     customer refunded in full later is an earlier one (support giving back what a forgotten subscription took) */
  await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_price_id = NULL WHERE household_id = ${patState.household.id}`);
  const betaRefund = await hook({ id: 'evt_refund_beta', type: 'charge.refunded', created: t0 + 9.1, data: { object: { id: 'ch_2', object: 'charge', customer: 'cus_pat', refunded: true } } });
  check('but a full refund of an earlier charge cannot end a forever nobody paid for', betaRefund.status === 200 && (await ent()).plan === 'lifetime' && (await ent()).source === 'code' && (await ent()).status === 'active' && (await ent()).cust === 'cus_pat', await ent());
  {
    /* a yearly checkout left open in a tab while the beta was claimed, and paid after: it would charge a free forever every year */
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL, stripe_price_id = NULL WHERE household_id = ${patState.household.id}`);
    const before = stripeCalls.length;
    const late = await hook({ id: 'evt_forever_clash', type: 'checkout.session.completed', created: t0 + 9.15, data: { object: { id: 'cs_forever_clash', mode: 'subscription', payment_status: 'paid', amount_total: 1999, customer: 'cus_pat', subscription: 'sub_late', invoice: 'in_clash', client_reference_id: String(patState.household.id), metadata: { plan: 'year' } } } });
    const calls = stripeCalls.slice(before);
    check('a yearly checkout paid after the beta was claimed is cancelled and refunded, and the forever stays as it was',
      late.status === 200 && calls.some(c => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_late') && calls.some(c => c.path === '/v1/refunds' && c.params.payment_intent === 'pi_clash')
      && (await ent()).plan === 'lifetime' && (await ent()).source === 'code' && (await ent()).sub === null, [calls.map(c => c.method + ' ' + c.path), await ent()]);
    /* one bought inside the three weeks took nothing at checkout; undone three days on (webhooks failing that long), its first
       charge may have been taken since, which nothing here gives back: the log asks for it to be looked at */
    const said = [], ce = console.error; console.error = (...a) => { said.push(a.map(String).join(' ')); ce.apply(console, a); };
    let lateTrial;
    try { lateTrial = await hook({ id: 'evt_late_trial', type: 'checkout.session.completed', created: t0 + 9.155, data: { object: { id: 'cs_late_trial', created: Math.floor(Date.now() / 1000) - 3 * 86400, mode: 'subscription', payment_status: 'no_payment_required', amount_total: 0, customer: 'cus_pat', subscription: 'sub_late_trial', client_reference_id: String(patState.household.id), metadata: { plan: 'year', charge_later: '1' } } } }); }
    finally { console.error = ce; }
    check('one bought inside the three weeks and undone days later is cancelled, and the log asks for its first charge to be checked by hand',
      lateTrial.status === 200 && said.some(l => /^billing: CHECK BY HAND for a first charge on sub_late_trial/.test(l)) && (await ent()).plan === 'lifetime' && (await ent()).source === 'code', { said, row: await ent() });
  }
  {
    /* an undo Stripe will not let finish is not marked seen: the event goes back to Stripe, which delivers it again, and the
       second go finishes it. A refund an earlier go made, a day on (past its idempotency key), answers already refunded,
       which counts as done. And a subscription's own event beside a plan held another way (a forever, or a plan the App
       Store holds) is read at Stripe and, if it can still charge, cancelled, or goes back to Stripe if Stripe will not:
       one left by a claim before claims cancelled them, an old yearly winding down, a checkout's own new one, an event
       older than what Stripe now says, and a first charge still being retried when the household bought on the iPhone */
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL WHERE household_id = ${patState.household.id}`);
    const stub = globalThis.__LS_STRIPE_FETCH, refusing = new Set(['sub_undo', 'sub_orphan_stuck']), nowSecs = Math.floor(Date.now() / 1000);
    const answer = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    const atStripe = { sub_orphan: { status: 'active', created: nowSecs - 30 * 86400 }, sub_orphan_ending: { status: 'active', cancel_at_period_end: true, created: nowSecs - 300 * 86400 },
      sub_orphan_new: { status: 'active', created: nowSecs - 60 }, sub_orphan_stale: { status: 'canceled', created: nowSecs - 30 * 86400 }, sub_beside_apple: { status: 'active', created: nowSecs - 40 * 86400 },
      sub_beside_ended_apple: { status: 'active', created: nowSecs - 40 * 86400 } };
    globalThis.__LS_STRIPE_FETCH = async (url, init) => {
      const path = new URL(url).pathname, id = path.split('/').pop();
      if (init.method === 'DELETE' && refusing.has(id)) { stripeCalls.push({ method: init.method, path }); return answer({ error: { type: 'api_error', message: 'stub: not now' } }, 500); }
      if (init.method === 'GET' && atStripe[id]) { stripeCalls.push({ method: init.method, path }); return answer(Object.assign({ id, object: 'subscription', cancel_at_period_end: false }, atStripe[id])); }
      if (path === '/v1/refunds' && init.headers['idempotency-key'] === 'refund-cs_undo_done') { stripeCalls.push({ method: init.method, path }); return answer({ error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Charge ch_undo has already been refunded.' } }, 400); }
      return stub(url, init);
    };
    const paidOnto = (id, sub, created) => ({ id, type: 'checkout.session.completed', created, data: { object: { id: 'cs_' + id.slice(4), mode: 'subscription', payment_status: 'paid', amount_total: 1999, customer: 'cus_pat', subscription: sub, invoice: 'in_clash', client_reference_id: String(patState.household.id), metadata: { plan: 'year' } } } });
    const seen = async (id) => (await db.query(`SELECT count(*)::int AS n FROM stripe_events WHERE id = '${id}'`)).rows[0].n;
    const said = [], ce = console.error; console.error = (...a) => { said.push(a.map(String).join(' ')); ce.apply(console, a); };
    const r = {}, callsOf = async (work) => { const from = stripeCalls.length; const status = (await work()).status; return { status, calls: stripeCalls.slice(from).map(c => c.method + ' ' + c.path.replace('/v1/subscriptions/', '')) }; };
    try {
      r.first = await callsOf(() => hook(paidOnto('evt_undo', 'sub_undo', t0 + 9.152))); r.seenFirst = await seen('evt_undo');
      refusing.delete('sub_undo');
      r.second = await callsOf(() => hook(paidOnto('evt_undo', 'sub_undo', t0 + 9.152))); r.seenSecond = await seen('evt_undo');
      r.done = await callsOf(() => hook(paidOnto('evt_undo_done', 'sub_undo_done', t0 + 9.153))); r.seenDone = await seen('evt_undo_done');
      r.live = await callsOf(() => hook(subEv('evt_orphan', 'customer.subscription.updated', t0 + 9.154, { id: 'sub_orphan' })));
      r.ending = await callsOf(() => hook(subEv('evt_orphan_ending', 'customer.subscription.updated', t0 + 9.155, { id: 'sub_orphan_ending' })));
      r.fresh = await callsOf(() => hook(subEv('evt_orphan_new', 'customer.subscription.created', t0 + 9.1555, { id: 'sub_orphan_new' })));
      r.stale = await callsOf(() => hook(subEv('evt_orphan_stale', 'customer.subscription.updated', t0 + 9.1557, { id: 'sub_orphan_stale' })));
      r.stuck = await callsOf(() => hook(subEv('evt_orphan_stuck', 'customer.subscription.updated', t0 + 9.156, { id: 'sub_orphan_stuck' }))); r.seenStuck = await seen('evt_orphan_stuck');
      r.row = await ent();
      await db.query(`UPDATE entitlements SET plan = 'household', source = 'apple', status = 'active', current_period_end = now() + interval '300 days' WHERE household_id = ${patState.household.id}`);
      r.apple = await callsOf(() => hook(subEv('evt_beside_apple', 'customer.subscription.updated', t0 + 9.1565, { id: 'sub_beside_apple' })));
      r.appleRow = await ent();
      /* an App Store plan past its end, inside the three days it is held while Apple's word is awaited: not cancelled beside */
      await db.query(`UPDATE entitlements SET current_period_end = now() - interval '1 day' WHERE household_id = ${patState.household.id}`);
      r.ended = await callsOf(() => hook(subEv('evt_beside_ended_apple', 'customer.subscription.updated', t0 + 9.1566, { id: 'sub_beside_ended_apple' }))); r.seenEnded = await seen('evt_beside_ended_apple');
      r.endedDeleted = await callsOf(() => hook(subEv('evt_beside_ended_apple_gone', 'customer.subscription.deleted', t0 + 9.1567, { id: 'sub_beside_ended_apple', status: 'canceled' }))); r.seenEndedDeleted = await seen('evt_beside_ended_apple_gone');
    } finally { console.error = ce; globalThis.__LS_STRIPE_FETCH = stub; }
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', current_period_end = NULL WHERE household_id = ${patState.household.id}`);
    const logged = (re) => said.some(l => re.test(l));
    check('an undo Stripe will not let finish goes back to Stripe unmarked, and the next delivery finishes it',
      r.first.status === 500 && r.seenFirst === 0 && r.first.calls.includes('DELETE sub_undo') && logged(/^billing: CANCEL BY HAND sub_undo paid while/)
      && r.second.status === 200 && r.seenSecond === 1 && r.second.calls.includes('DELETE sub_undo') && r.second.calls.includes('POST /v1/refunds'), r);
    check('and a refund an earlier go made answers already refunded, which counts as done, with no REFUND BY HAND',
      r.done.status === 200 && r.seenDone === 1 && r.done.calls.includes('DELETE sub_undo_done') && r.done.calls.includes('POST /v1/refunds') && !logged(/REFUND BY HAND, checkout cs_undo_done/), { done: r.done, seenDone: r.seenDone, said });
    check('a subscription still able to charge a held forever is read at Stripe and cancelled on its own event, the log asking for its last charge',
      r.live.status === 200 && JSON.stringify(r.live.calls) === JSON.stringify(['GET sub_orphan', 'DELETE sub_orphan']) && logged(/^billing: CHECK BY HAND the last charge of sub_orphan /) && r.row.plan === 'lifetime' && r.row.source === 'code', r);
    check('one winding down, or an event older than what Stripe now says, is left alone; a checkout\'s own new one is cancelled, its charge asked about too',
      r.ending.status === 200 && JSON.stringify(r.ending.calls) === JSON.stringify(['GET sub_orphan_ending']) && r.stale.status === 200 && JSON.stringify(r.stale.calls) === JSON.stringify(['GET sub_orphan_stale'])
      && r.fresh.status === 200 && r.fresh.calls.includes('DELETE sub_orphan_new') && logged(/^billing: CHECK BY HAND the last charge of sub_orphan_new /) && !logged(/CHECK BY HAND the last charge of sub_orphan_(stale|ending)/), r);
    check('and if Stripe will not cancel it, the event goes back to Stripe, unmarked', r.stuck.status === 500 && r.seenStuck === 0 && r.stuck.calls.includes('DELETE sub_orphan_stuck') && logged(/CANCEL BY HAND sub_orphan_stuck/), r);
    check('a Stripe subscription still charging beside a plan the App Store holds is cancelled, and the App Store\'s plan stands',
      r.apple.status === 200 && JSON.stringify(r.apple.calls) === JSON.stringify(['GET sub_beside_apple', 'DELETE sub_beside_apple']) && logged(/^billing: CHECK BY HAND the last charge of sub_beside_apple /)
      && r.appleRow.source === 'apple' && r.appleRow.plan === 'household' && r.appleRow.status === 'active', r);
    check('but beside an App Store plan past its end, still held while Apple\'s word is awaited, the event goes back to Stripe with nothing cancelled, its deleted event too, each saying BY HAND',
      r.ended.status === 500 && r.seenEnded === 0 && !r.ended.calls.some(c => c.startsWith('DELETE')) && r.endedDeleted.status === 500 && r.seenEndedDeleted === 0
      && logged(/CHECK BY HAND if Stripe stops retrying: sub_beside_ended_apple waits beside an App Store plan past its end/), r);
  }
  {
    /* a webhook whose Stripe calls hang: one eight-second budget for them all, so the event goes back to Stripe, unmarked,
       before Netlify's ten seconds would end the function with nothing said. The real timer */
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL WHERE household_id = ${patState.household.id}`);
    const stub = globalThis.__LS_STRIPE_FETCH, started = Date.now();
    globalThis.__LS_STRIPE_FETCH = (url, init) => new URL(url).pathname !== '/v1/subscriptions/sub_hung_undo' ? stub(url, init) : new Promise((_, reject) => init.signal
      ? init.signal.addEventListener('abort', () => reject(new DOMException('gave up', 'TimeoutError')), { once: true })
      : reject(new Error('no time limit')));
    let hungStatus;
    try { hungStatus = (await hook({ id: 'evt_hung_undo', type: 'checkout.session.completed', created: t0 + 9.157, data: { object: { id: 'cs_hung_undo', mode: 'subscription', payment_status: 'paid', amount_total: 1999, customer: 'cus_pat', subscription: 'sub_hung_undo', invoice: 'in_clash', client_reference_id: String(patState.household.id), metadata: { plan: 'year' } } } })).status; }
    finally { globalThis.__LS_STRIPE_FETCH = stub; }
    const took = Date.now() - started, hungSeen = (await db.query(`SELECT count(*)::int AS n FROM stripe_events WHERE id = 'evt_hung_undo'`)).rows[0].n;
    check('a webhook whose Stripe calls hang hands its event back within eight seconds, unmarked, inside Netlify\'s ten',
      hungStatus === 500 && hungSeen === 0 && took >= 7900 && took < 9500, { hungStatus, hungSeen, took });
  }
  {
    /* a checkout replacing a subscription whose card failed: its read of the new subscription is only for the dates, and gets
       three seconds at most, so the old subscription's cancel after it keeps its time even when the read hangs. The real timer */
    await db.query(`UPDATE entitlements SET plan = 'household', source = 'stripe', status = 'canceled', stripe_subscription_id = 'sub_replaced_old', current_period_end = NULL WHERE household_id = ${patState.household.id}`);
    const stub = globalThis.__LS_STRIPE_FETCH, started = Date.now();
    globalThis.__LS_STRIPE_FETCH = (url, init) => !(init.method === 'GET' && new URL(url).pathname === '/v1/subscriptions/sub_slow_read') ? stub(url, init) : new Promise((_, reject) => init.signal
      ? init.signal.addEventListener('abort', () => reject(new DOMException('gave up', 'TimeoutError')), { once: true })
      : reject(new Error('no time limit')));
    const from = stripeCalls.length;
    let replaced;
    try { replaced = (await hook({ id: 'evt_slow_read', type: 'checkout.session.completed', created: t0 + 9.158, data: { object: { id: 'cs_slow_read', mode: 'subscription', payment_status: 'paid', amount_total: 1999, customer: 'cus_pat', subscription: 'sub_slow_read', client_reference_id: String(patState.household.id), metadata: { plan: 'year' } } } })).status; }
    finally { globalThis.__LS_STRIPE_FETCH = stub; }
    const took = Date.now() - started, calls = stripeCalls.slice(from).map(c => c.method + ' ' + c.path), row = await ent();
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL, current_period_end = NULL WHERE household_id = ${patState.household.id}`);
    check('a checkout whose read of its new subscription hangs gives the read three seconds, and still cancels the subscription it replaced',
      replaced === 200 && calls.includes('DELETE /v1/subscriptions/sub_replaced_old') && took >= 2900 && took < 7000 && row.sub === 'sub_slow_read', { replaced, calls, took, row });
  }
  {
    /* the claim writing forever while a checkout's webhook waits on Stripe for the new subscription, after the webhook read the
       row and before it writes. With Stripe's stamp behind our clock the webhook's write is the older one and misses; with it
       ahead, the write would land on the forever. Either way the checkout is undone, and the forever stands */
    const stub = globalThis.__LS_STRIPE_FETCH;
    const overtaken = async (sub, claimedAt, created) => {
      await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'canceled', stripe_subscription_id = NULL WHERE household_id = ${patState.household.id}`);
      globalThis.__LS_STRIPE_FETCH = async (url, init) => {
        if (init.method === 'GET' && new URL(url).pathname === '/v1/subscriptions/' + sub)
          await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL, event_at = to_timestamp(${claimedAt}) WHERE household_id = ${patState.household.id}`);
        return stub(url, init);
      };
      const before = stripeCalls.length;
      let status;
      try { status = (await hook({ id: 'evt_' + sub, type: 'checkout.session.completed', created, data: { object: { id: 'cs_' + sub, mode: 'subscription', payment_status: 'paid', amount_total: 1999, customer: 'cus_pat', subscription: sub, invoice: 'in_clash', client_reference_id: String(patState.household.id), metadata: { plan: 'year' } } } })).status; }
      finally { globalThis.__LS_STRIPE_FETCH = stub; }
      const calls = stripeCalls.slice(before);
      return { status, undone: calls.some(c => c.method === 'DELETE' && c.path === '/v1/subscriptions/' + sub) && calls.some(c => c.path === '/v1/refunds'), row: await ent() };
    };
    const behind = await overtaken('sub_behind', t0 + 9.17, t0 + 9.16), ahead = await overtaken('sub_ahead', t0 + 9.18, t0 + 9.19);
    check('a checkout whose webhook the claim overtakes is cancelled and refunded, whichever clock is ahead, and the forever stands',
      [behind, ahead].every(r => r.status === 200 && r.undone && r.row.plan === 'lifetime' && r.row.source === 'code' && r.row.sub === null), { behind, ahead });
    /* and a subscription's own event, the claim writing forever between its read of the row and its write, Stripe's stamp ahead */
    await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'canceled', stripe_subscription_id = NULL WHERE household_id = ${patState.household.id}`);
    const realSql = globalThis.__LS_SQL; let claimed = false;
    globalThis.__LS_SQL = async (strings, ...vals) => {
      const rows = await realSql(strings, ...vals);
      if (!claimed && typeof strings !== 'string' && strings.join('?').startsWith('SELECT plan, status, source, current_period_end, stripe_subscription_id FROM entitlements WHERE household_id =')) {
        claimed = true;
        await realSql(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL, event_at = to_timestamp(${t0 + 9.185}) WHERE household_id = ${patState.household.id}`);
      }
      return rows;
    };
    let subOvertaken;
    try { subOvertaken = await hook(subEv('evt_sub_overtaken', 'customer.subscription.updated', t0 + 9.19, { id: 'sub_overtaken' })); }
    finally { globalThis.__LS_SQL = realSql; }
    check('and a subscription event the claim overtakes does not land on the forever either',
      claimed && subOvertaken.status === 200 && (await ent()).plan === 'lifetime' && (await ent()).source === 'code' && (await ent()).sub === null, { claimed, row: await ent() });
    /* an App Store forever past its end, Apple's word missed (a sandbox one lasts a day), holds nothing: the website sells the
       plan again, and a yearly checkout paid for it is a sale like any other, not undone */
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'apple', status = 'active', current_period_end = now() - interval '5 days', stripe_subscription_id = NULL, event_at = to_timestamp(${t0 + 9.19}) WHERE household_id = ${patState.household.id}`);
    const soldFrom = stripeCalls.length;
    const sold = await hook({ id: 'evt_after_sandbox', type: 'checkout.session.completed', created: t0 + 9.195, data: { object: { id: 'cs_after_sandbox', mode: 'subscription', payment_status: 'paid', amount_total: 1999, customer: 'cus_pat', subscription: 'sub_after_sandbox', invoice: 'in_clash', client_reference_id: String(patState.household.id), metadata: { plan: 'year' } } } });
    const soldCalls = stripeCalls.slice(soldFrom).map(c => c.method + ' ' + c.path);
    check('a lapsed App Store forever holds nothing: a yearly checkout paid over it is a sale, not undone',
      sold.status === 200 && !soldCalls.some(c => c.startsWith('DELETE') || c.endsWith('/refunds')) && (await ent()).plan === 'household' && (await ent()).source === 'stripe' && (await ent()).sub === 'sub_after_sandbox',
      { soldCalls, row: await ent() });
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'apple', status = 'active', current_period_end = now() - interval '5 days', stripe_subscription_id = NULL, event_at = to_timestamp(${t0 + 9.196}) WHERE household_id = ${patState.household.id}`);
    const lapsedEvent = await hook(subEv('evt_after_sandbox_sub', 'customer.subscription.updated', t0 + 9.197, { id: 'sub_after_sandbox' }));
    check('and so does a subscription\'s own event over one: it is applied, not skipped as forever',
      lapsedEvent.status === 200 && (await ent()).plan === 'household' && (await ent()).source === 'stripe' && (await ent()).sub === 'sub_after_sandbox', await ent());
  }
  /* one household, two ways to pay: Stripe's clock and Apple's cannot be compared, so a Stripe
     delivery late enough to pass the ordering check must still not undo a plan paid to Apple. The
     subscription events stop beside a plan the App Store holds before they write; write()'s own
     Apple clause, behind them, is what the App Store clash check further down reaches */
  await db.query(`UPDATE entitlements SET plan='household', source='apple', status='active', current_period_end=NULL, stripe_subscription_id=NULL, event_at=to_timestamp(${t0 + 9}), apple_original_transaction_id='2000000000000001', apple_product_id='app.lunchsorted.household.annual' WHERE household_id=${patState.household.id}`);
  const lateStripe = await hook(subEv('evt_apple_1', 'customer.subscription.deleted', t0 + 9.2, { status: 'canceled' }));
  check('a late Stripe delivery cannot undo a plan the household pays Apple for', lateStripe.status === 200 && (await ent()).plan === 'household' && (await ent()).source === 'apple' && (await ent()).status === 'active', await ent());
  {
    /* a plan bought on the web inside the three weeks completes with nothing charged yet: a sale, not a beta code */
    const [u] = (await db.query(`INSERT INTO users (email) VALUES ('later@example.com') RETURNING id`)).rows;
    const [h2] = (await db.query(`INSERT INTO households (owner_user_id, doc) VALUES (${u.id}, '{}'::jsonb) RETURNING id`)).rows;
    await db.query(`INSERT INTO entitlements (household_id, plan, status) VALUES (${h2.id}, 'free', 'none')`);
    await hook({ id: 'evt_later', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: { id: 'cs_later', mode: 'subscription', payment_status: 'no_payment_required', amount_total: 0, customer: 'cus_later', subscription: 'sub_later', client_reference_id: String(h2.id), metadata: { plan: 'year', charge_later: '1' } } } });
    const [e2] = (await db.query(`SELECT plan, source, status FROM entitlements WHERE household_id = ${h2.id}`)).rows;
    check('and a plan bought inside the three weeks, nothing charged yet, is on and counted as a sale, not a beta code', e2.plan === 'household' && e2.source === 'stripe' && e2.status === 'active', e2);
    const laterSub = (id, created, status) => ({ id, type: 'customer.subscription.updated', created, data: { object: { id: 'sub_later', object: 'subscription', customer: 'cus_later', status, cancel_at_period_end: false, items: { data: [{ current_period_end: PERIOD_END, price: { id: 'price_year' } }] }, metadata: { household_id: String(h2.id) } } } });
    const paidH2 = async () => (await db.query(`SELECT count(*)::int AS n FROM milestones WHERE household_id = ${h2.id} AND kind = 'paid'`)).rows[0].n;
    const stillFree = await paidH2();
    await hook(laterSub('evt_later_trial', Math.floor(Date.now() / 1000) + 0.5, 'trialing'));
    const trialFree = await paidH2();
    await hook(laterSub('evt_later_charged', Math.floor(Date.now() / 1000) + 0.7, 'active'));
    check('but it is not paid until the three weeks end and the first charge goes through', stillFree === 0 && trialFree === 0 && (await paidH2()) === 1, [stillFree, trialFree]);
    await db.query(`UPDATE entitlements SET plan='free', source='none', status='none', stripe_subscription_id=NULL, event_at=NULL WHERE household_id = ${h2.id}`);
    await hook({ id: 'evt_later_beta', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000) + 1, data: { object: { id: 'cs_later_b', mode: 'subscription', payment_status: 'no_payment_required', amount_total: 0, customer: 'cus_later', subscription: 'sub_later_b', discounts: [{ coupon: 'beta100' }], client_reference_id: String(h2.id), metadata: { plan: 'year', charge_later: '1' } } } });
    const [e3] = (await db.query(`SELECT source FROM entitlements WHERE household_id = ${h2.id}`)).rows;
    await db.query(`UPDATE entitlements SET plan='free', source='none', status='none', stripe_subscription_id=NULL, event_at=NULL WHERE household_id = ${h2.id}`);
    await hook({ id: 'evt_later_ten', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000) + 2, data: { object: { id: 'cs_later_t', mode: 'subscription', payment_status: 'no_payment_required', amount_total: 0, customer: 'cus_later', subscription: 'sub_later_t', discounts: [{ coupon: 'tenoff' }], client_reference_id: String(h2.id), metadata: { plan: 'year', charge_later: '1' } } } });
    const [e4] = (await db.query(`SELECT source FROM entitlements WHERE household_id = ${h2.id}`)).rows;
    check('but the beta testers\' 100%-off code, used inside the three weeks, still marks them as testers; any smaller code is a sale', e3.source === 'code' && e4.source === 'stripe', [e3, e4]);
    {
      const { subscriptionStatus } = await import('../netlify/lib/stripe.js');
      const firstFailed = subscriptionStatus({ status: 'past_due', trial_end: 1800000000, items: { data: [{ current_period_start: 1800000000 }] } });
      const renewalFailed = subscriptionStatus({ status: 'past_due', trial_end: 1700000000, items: { data: [{ current_period_start: 1800000000 }] } });
      check('a first charge that fails when the three weeks end ends the plan; a failed renewal keeps it while Stripe retries', firstFailed === 'canceled' && renewalFailed === 'past_due', [firstFailed, renewalFailed]);
    }
    await db.query(`DELETE FROM entitlements WHERE household_id = ${h2.id}`); await db.query(`DELETE FROM households WHERE id = ${h2.id}`); await db.query(`DELETE FROM users WHERE id = ${u.id}`);   /* the numbers page counts every row */
  }
  {
    /* a web checkout left open in a tab and paid after the iPhone bought the plan: ended and given back, not left charging */
    const before = stripeCalls.length;
    const clash = await hook({ id: 'evt_apple_clash', type: 'checkout.session.completed', created: t0 + 9.25, data: { object: { id: 'cs_clash', mode: 'subscription', payment_status: 'paid', amount_total: 1999, customer: 'cus_clash', subscription: 'sub_clash', invoice: 'in_clash', client_reference_id: String(patState.household.id), metadata: { plan: 'year' } } } });
    const calls = stripeCalls.slice(before);
    check('a web payment made after the household bought the plan through the App Store is cancelled and refunded, and the plan stays Apple\'s',
      clash.status === 200 && calls.some(c => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_clash') && calls.some(c => c.path === '/v1/refunds' && c.params.payment_intent === 'pi_clash') && (await ent()).source === 'apple' && (await ent()).status === 'active',
      [calls.map(c => c.method + ' ' + c.path), await ent()]);
  }
  {
    /* an App Store plan days past its end, Apple's notification missed: the website sells the plan again */
    await db.query(`UPDATE entitlements SET current_period_end = now() - interval '5 days' WHERE household_id=${patState.household.id}`);
    const again = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status));
    check('a lapsed App Store plan whose notification never came does not stop the website selling the plan', again === 200, again);
    const exp = stripeCalls.filter(c => c.path === '/v1/checkout/sessions').pop();
    check('and a checkout expires in half an hour, so one left open in a tab cannot be paid long after', !!exp && Math.abs(Number(exp.params.expires_at) - (Date.now() / 1000 + 1800)) < 120, exp && exp.params.expires_at);
    await db.query(`UPDATE entitlements SET current_period_end = NULL WHERE household_id=${patState.household.id}`);
  }
  await db.query(`UPDATE entitlements SET status='canceled' WHERE household_id=${patState.household.id}`);
  await hook({ id: 'evt_apple_2', type: 'checkout.session.completed', created: t0 + 9.3, data: { object: { id: 'cs_test_a', mode: 'payment', payment_status: 'paid', customer: 'cus_pat', client_reference_id: String(patState.household.id), metadata: { plan: 'lifetime' } } } });
  check('and once the Apple plan has ended, a Stripe purchase applies again', (await ent()).plan === 'lifetime' && (await ent()).source === 'stripe', await ent());
  await db.query(`UPDATE entitlements SET plan='free', source='none', status='canceled', apple_original_transaction_id=NULL, apple_product_id=NULL, event_at='${new Date((t0 + 9) * 1000).toISOString()}' WHERE household_id=${patState.household.id}`);
  {
    /* one App Store subscription unlocks one household: a second claim on it is refused */
    const [other] = (await db.query(`SELECT household_id FROM entitlements WHERE household_id <> ${patState.household.id} LIMIT 1`)).rows;
    let refused = false;
    await db.query(`UPDATE entitlements SET apple_original_transaction_id='2000000000000009' WHERE household_id=${patState.household.id}`);
    if (other) { try { await db.query(`UPDATE entitlements SET apple_original_transaction_id='2000000000000009' WHERE household_id=${other.household_id}`); } catch (e) { refused = /unique|duplicate/i.test(e.message); } }
    check('one App Store subscription can belong to one household only', !!other && refused, { other, refused });
    await db.query(`UPDATE entitlements SET apple_original_transaction_id=NULL WHERE household_id=${patState.household.id}`);
  }
  /* a beta tester: forever, on a 100%-off code, nothing charged; the admin page lists them by email */
  await hook({ id: 'evt_tester', type: 'checkout.session.completed', created: t0 + 9.5, data: { object: { id: 'cs_test_t', mode: 'payment', payment_status: 'no_payment_required', amount_total: 0, customer: 'cus_pat', client_reference_id: String(patState.household.id), metadata: { plan: 'lifetime' } } } });
  check('a forever plan on a 100%-off code is marked as a code, not a sale', (await ent()).plan === 'lifetime' && (await ent()).source === 'code', await ent());
  {
    /* that row carries forever's price id, as a sale's does, so the id alone cannot tell a code from a purchase.
       Its checkout left a Stripe customer, and Manage billing stays for it. It was kept for a subscription Stripe
       was still retrying when the beta was claimed; the claim cancels that one now, and whether the button goes
       for a forever nobody paid for is the app's own change, with a build of its own */
    const [{ stripe_price_id: codePrice }] = (await db.query(`SELECT stripe_price_id FROM entitlements WHERE household_id = ${patState.household.id}`)).rows;
    await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
    const codeRows = await planRows(['Your plan: Household, free forever']);
    const codeApp = await pb.evaluate(() => fetch('/api/household').then(r => r.json()).then(j => {
      let lifeId = null; try { lifeId = JSON.parse(localStorage.getItem('lunchsorted-billing')).prices.lifetime.id; } catch (e) {}
      return { portal: j.entitlement.portal, lifeId, manage: document.querySelectorAll('#view [data-act="portal"]').length };
    }));
    check('and Subscription quotes it no price and says nothing of buying it, though its row carries forever\'s price id; Manage billing stays, for the Stripe customer its checkout left',
      codePrice === 'price_life' && codeApp.lifeId === 'price_life' && codeApp.portal === true && codeApp.manage === 1 && JSON.stringify(codeRows) === JSON.stringify(['Your plan: Household, free forever']),
      { codePrice, codeApp, codeRows });
  }
  {
    /* a yearly or monthly plan on a 100%-off code keeps its price and its renewal date, on the page and in
       the Account tab's caption, Liz's call on 2026-09-30: only forever from a code reads free. The forever
       row above is put back as it was, for the roster below */
    const [was] = (await db.query(`SELECT plan, status, stripe_price_id, stripe_subscription_id, current_period_end, cancel_at_period_end FROM entitlements WHERE household_id = ${patState.household.id}`)).rows;
    await db.query(`UPDATE entitlements SET plan = 'household', status = 'active', stripe_price_id = 'price_year', stripe_subscription_id = 'sub_code', current_period_end = to_timestamp(${PERIOD_END}) WHERE household_id = ${patState.household.id}`);
    await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
    const codeYear = ['Your plan: Household', 'Cost: $19.99 a year', 'Renews: Jan 15, 2027'];
    const yearRows = await planRows(codeYear);
    await pb.click('[data-act="tab"][data-tab="setup"]');
    const yearCaption = await pb.textContent('[data-act="pane"][data-pane="plan"] .meta');
    await db.query(`UPDATE entitlements SET stripe_price_id = 'price_month' WHERE household_id = ${patState.household.id}`);
    await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
    const codeMonth = ['Your plan: Household', 'Cost: $2.99 a month', 'Renews: Jan 15, 2027'];
    const monthRows = await planRows(codeMonth);
    const codeSource = (await ent()).source;
    await db.query(`UPDATE entitlements SET plan = 'lifetime', status = 'active', stripe_price_id = 'price_life', stripe_subscription_id = NULL, current_period_end = NULL WHERE household_id = ${patState.household.id}`);
    check('a yearly or monthly plan on a 100%-off code keeps its price and its renewal date; only forever from a code reads free',
      was.plan === 'lifetime' && was.status === 'active' && was.stripe_price_id === 'price_life' && was.stripe_subscription_id === null && was.current_period_end === null && !was.cancel_at_period_end
        && codeSource === 'code' && JSON.stringify(yearRows) === JSON.stringify(codeYear) && yearCaption === 'Renews Jan 15, 2027' && JSON.stringify(monthRows) === JSON.stringify(codeMonth),
      { was, codeSource, yearRows, yearCaption, monthRows });
  }
  {
    const { testers, standard } = (await adminStats()).roster;
    /* the backfill in migration 0005 runs once, against a database that is empty in this
       suite, so run it here over seeded history: it is the only part of the change that
       touches production rows on deploy */
    {
      const sqlText = fs.readFileSync(path.join(ROOT, '..', 'netlify', 'database', 'migrations', '0005_days.sql'), 'utf8');
      const backfill = sqlText.replace(/--[^\n]*/g, '').split(';').map(x => x.trim()).filter(x => x.startsWith('UPDATE'));
      check('the migration carries one backfill statement', backfill.length === 1, backfill.length);
      const [old] = (await db.query(`INSERT INTO users (email, last_seen_at) VALUES ('history@example.com', now() - interval '9 days') RETURNING id`)).rows;
      await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_used_at) VALUES
        ('h1', ${old.id}, now() + interval '1 day', now() - interval '5 days', now() - interval '3 days'),
        ('h2', ${old.id}, now() + interval '1 day', now() - interval '5 days', now() - interval '2 days')`);
      await db.query(backfill[0]);
      const back = (await db.query(`SELECT days_seen, last_day FROM users WHERE id = ${old.id}`)).rows[0];
      check('and it reads a floor for the days before the counter existed, counting each day once', back.days_seen === 4 && !!back.last_day, back);
      await db.query(`DELETE FROM users WHERE email = 'history@example.com'`);
    }
    check('the numbers page lists the beta testers by email, with when they came in and were last seen', testers.length === 1 && testers[0].email === 'pat@example.com' && testers[0].plan === 'Forever' && !!testers[0].since && !!testers[0].lastSeen, testers);
    check('and everyone who did not come in on a code is on the other roster instead', standard.length > 1 && !standard.some(x => x.email === 'pat@example.com'), standard.map(x => x.email));
  }
  {
    /* the bug: last seen only moved when someone signed in, so a parent who stays signed in
       on their phone was stuck on the day they were invited forever */
    await db.query(`UPDATE users SET last_seen_at = now() - interval '30 days' WHERE email = 'pat@example.com'`);
    await db.query(`UPDATE sessions SET last_used_at = now() - interval '30 days' WHERE user_id = (SELECT id FROM users WHERE email = 'pat@example.com')`);
    await pb.evaluate(() => fetch('/api/household').then(r => r.status));
    const moved = (await db.query(`SELECT last_seen_at FROM users WHERE email = 'pat@example.com'`)).rows[0].last_seen_at;
    check('using the app moves last seen without signing in again', new Date(moved).getTime() > Date.now() - 60000, moved);
    check('and the numbers page shows that day, not the day they came in', new Date((await adminStats()).roster.testers[0].lastSeen).getTime() > Date.now() - 60000);
    await db.query(`UPDATE users SET last_seen_at = now() - interval '30 days' WHERE email = 'pat@example.com'`);
    await pb.evaluate(() => fetch('/api/household').then(r => r.status));
    const again = (await db.query(`SELECT last_seen_at FROM users WHERE email = 'pat@example.com'`)).rows[0].last_seen_at;
    check('a second request within the hour writes nothing', new Date(again).getTime() < Date.now() - 60000, again);
  }
  {
    /* days seen: one to a New York day, moved by the same hourly touch */
    const uid = (await db.query(`SELECT id FROM users WHERE email = 'pat@example.com'`)).rows[0].id;
    await db.query(`UPDATE users SET days_seen = 1, last_day = (now() AT TIME ZONE 'America/New_York')::date - 30 WHERE id = ${uid}`);
    await db.query(`UPDATE sessions SET last_used_at = now() - interval '2 hours' WHERE user_id = ${uid}`);
    await pb.evaluate(() => fetch('/api/household').then(r => r.status));
    const after = (await adminStats()).roster.testers[0].days;
    check('a new day in the app is counted, on top of the days already there', after === 2, after);
    /* put the session back over the hour so the write is really attempted a second time */
    await db.query(`UPDATE sessions SET last_used_at = now() - interval '2 hours' WHERE user_id = ${uid}`);
    await pb.evaluate(() => fetch('/api/household').then(r => r.status));
    check('and a second visit the same day is not counted twice', (await adminStats()).roster.testers[0].days === 2);
  }
  {
    /* the rosters in a real browser: thirty rows a page, and the search, the filters and
       the sort headers all working on rows that are already in the markup */
    const admins = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'pat@example.com';
    const filler = Array.from({ length: 34 }, (_, i) => `('filler${i}@example.com')`).join(',');
    await db.query(`INSERT INTO users (email) VALUES ${filler}`);
    const pa = await pb.context().newPage(); pa.on('pageerror', e => errors.push(String(e.message)));
    await pa.goto(BASE + '/api/admin'); await pa.waitForLoadState('load');
    check('a person in ADMIN_EMAILS gets the numbers page itself, not a sign-in', /by the numbers/i.test(await pa.title() + await pa.textContent('h1')), await pa.title());
    const t = await pa.evaluate(() => {
      const box = document.querySelectorAll('[data-table]')[0];
      const rows = () => box.querySelectorAll('tbody tr').length;
      const head = box.querySelectorAll('thead th');
      const out = {
        tables: document.querySelectorAll('[data-table]').length,
        columns: Array.prototype.map.call(head, th => th.querySelector('button').textContent.trim().replace(/[ \u2191\u2193]+$/, '')),
        filters: Array.prototype.map.call(box.querySelectorAll('[data-filter]'), s => s.options[0].textContent),
        toolsShown: !box.querySelector('.tools').hidden && !box.querySelector('.pager').hidden,
        first: rows(), firstCount: box.querySelector('[data-count]').textContent
      };
      box.querySelector('[data-next]').click();
      out.second = rows(); out.secondCount = box.querySelector('[data-count]').textContent;
      const search = box.querySelector('[data-search]');
      search.value = 'filler7@'; search.dispatchEvent(new Event('input'));
      out.searched = rows(); out.searchedEmail = box.querySelector('tbody td').textContent;
      box.querySelector('[data-clear]').click();
      out.cleared = rows();
      const pick = box.querySelector('[data-filter]');
      pick.value = 'No household'; pick.dispatchEvent(new Event('change'));
      out.filtered = box.querySelector('[data-count]').textContent;
      box.querySelector('[data-clear]').click();
      head[7].querySelector('button').click();
      out.sorted = head[7].getAttribute('aria-sort');
      out.topDays = box.querySelector('tbody tr').cells[7].textContent;
      out.sheetBeforeOpen = box.querySelector('[data-sheet]').textContent;
      var fold = box.querySelector('details'); fold.open = true; fold.dispatchEvent(new Event('toggle'));
      out.sheetLines = box.querySelector('[data-sheet]').textContent.split('\n').length;
      return out;
    });
    check('the numbers page carries both rosters, every column with a sort button and the four filters',
      t.tables === 2 && t.toolsShown && t.filters.join('|') === 'Role: all|Plan: all|Status: all|Household has: all' &&
      t.columns.join('|') === 'Email|Household|Role|Plan|Status|Joined|Last seen|Days seen|Household has|Who else is on it', t);
    check('it shows the first thirty people and pages through the rest', t.first === 30 && /^1–30 of \d\d/.test(t.firstCount) && t.second > 0 && t.second <= 30 && /^31–/.test(t.secondCount), t);
    check('searching narrows it to the one person, and Clear brings everyone back', t.searched === 1 && /filler7@example\.com/.test(t.searchedEmail) && t.cleared === 30, t);
    check('a filter counts only the rows it keeps, and a sort puts the largest first',
      /^1–\d+ of \d+ matching · 40 in all$/.test(t.filtered) && t.filtered !== t.firstCount && t.sorted === 'descending' && Number(t.topDays) >= 1, t);
    check('the sheet block is empty until it is opened, and then carries every filtered row', t.sheetBeforeOpen === '' && t.sheetLines === 40, [t.sheetBeforeOpen.length, t.sheetLines]);
    await pa.close();
    await db.query(`DELETE FROM users WHERE email LIKE 'filler%@example.com'`);
    process.env.ADMIN_EMAILS = admins;
  }
  /* the tester's code charged nothing either, so a charge of the same customer refunded in full is an earlier one */
  await hook({ id: 'evt_refund_t', type: 'charge.refunded', created: t0 + 9.6, data: { object: { id: 'ch_t', object: 'charge', customer: 'cus_pat', refunded: true } } });
  check('and a refund cannot end the tester\'s forever, nor take the mark off', (await ent()).plan === 'lifetime' && (await ent()).source === 'code' && (await ent()).status === 'active', await ent());
  /* back by hand, then, to the household with no plan that a refund used to leave, for the App Store's checks */
  await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'canceled', current_period_end = NULL, cancel_at_period_end = false, stripe_subscription_id = NULL, stripe_price_id = NULL WHERE household_id = ${patState.household.id}`);
  /* ------------------------------------------------ the App Store */
  {
    const fx = (n) => fs.readFileSync(path.join(ROOT, '..', 'tests', 'fixtures', 'apple', n));
    const real = JSON.parse(fx('real-chain.json'));
    const at = Date.parse('2026-06-01T00:00:00Z');
    const threw = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
    check('the purchase check accepts the chain Apple really signs with, and finds its marks', !threw(() => appleLib.verifyChain([real.leaf, real.intermediate, real.root], at)), threw(() => appleLib.verifyChain([real.leaf, real.intermediate, real.root], at)));
    check('and refuses it once the signing certificate has expired', /out of date/.test(threw(() => appleLib.verifyChain([real.leaf, real.intermediate, real.root], Date.parse('2028-01-01')))));
    const pem = (n) => new crypto.X509Certificate(fx(n + '.pem'));
    check('and refuses any chain that does not end at Apple\'s own root', /root/.test(threw(() => appleLib.verifyChain([pem('leaf'), pem('intermediate'), pem('root')], Date.now()))));
    /* everything after is signed with a test chain made the same way as Apple's, its root pinned in place of Apple's */
    globalThis.__LS_APPLE_ROOT = pem('root').fingerprint256;
    const jws = (payload, signer = 'leaf') => {
      const x5c = [pem(signer), pem('intermediate'), pem('root')].map(c => c.raw.toString('base64'));
      const h = Buffer.from(JSON.stringify({ alg: 'ES256', x5c })).toString('base64url'), b = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return h + '.' + b + '.' + crypto.sign('sha256', Buffer.from(h + '.' + b), { key: fx(signer + '.key'), dsaEncoding: 'ieee-p1363' }).toString('base64url');
    };
    const hid = patState.household.id;
    const token = (await db.query(`SELECT apple_account_token::text AS t FROM entitlements WHERE household_id = ${hid}`)).rows[0].t;
    let clock = Date.now();
    const next = () => (clock += 1000);
    const DAY = 86400000;
    const txn = (o = {}) => Object.assign({ bundleId: 'app.lunchsorted', environment: 'Sandbox', productId: 'app.lunchsorted.household.annual', originalTransactionId: '2000000000000100', transactionId: '2000000000000100', purchaseDate: clock, expiresDate: Date.now() + 365 * DAY, appAccountToken: token, type: 'Auto-Renewable Subscription', signedDate: next() }, o);
    const link = (t, signer) => pb.evaluate(b => fetch('/api/apple/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: b }).then(async r => ({ status: r.status, body: await r.json() })), JSON.stringify({ signedTransaction: jws(t, signer) }));
    const notify = async (type, t, renewal, o = {}) => {
      const n = Object.assign({ notificationType: type, notificationUUID: crypto.randomUUID(), signedDate: next(), data: { bundleId: 'app.lunchsorted', environment: 'Sandbox', signedTransactionInfo: t && jws(t), signedRenewalInfo: renewal && jws(Object.assign({ signedDate: clock, environment: 'Sandbox' }, renewal)) } }, o);
      const r = await fetch(NODE_BASE + '/api/apple/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedPayload: o.raw || jws(n) }) });
      return { status: r.status, body: await r.json().catch(() => ({})), uuid: n.notificationUUID, n };
    };
    const row = async () => (await db.query(`SELECT plan, source, status, cancel_at_period_end AS cape, current_period_end AS pe, apple_original_transaction_id AS otx, apple_product_id AS product FROM entitlements WHERE household_id = ${hid}`)).rows[0];

    check('every household is given its own App Store token, and the parent\'s phone is sent it', /^[0-9a-f-]{36}$/.test(token) && (await pb.evaluate(() => fetch('/api/household').then(r => r.json()).then(j => j.entitlement.appleToken))) === token);
    const rogue = await link(txn(), 'rogue');
    check('a purchase signed by any Apple developer\'s certificate, not the App Store\'s, is refused', rogue.status === 400 && (await row()).plan === 'free', rogue);
    await db.query(`DELETE FROM milestones WHERE household_id = ${hid} AND kind = 'paid'`);   /* its Stripe plan above was paid */
    const first = await link(txn());
    check('a yearly purchase from the phone makes the household paid, through Apple', first.status === 200 && (await row()).plan === 'household' && (await row()).source === 'apple' && (await row()).status === 'active' && (await row()).otx === '2000000000000100' && (await row()).product === 'app.lunchsorted.household.annual', [first, await row()]);
    check('and the phone is told the new plan in the same answer', first.body.entitlement && first.body.entitlement.source === 'apple' && first.body.entitlement.plan === 'household', first.body);
    check('and telling us twice changes nothing', (await link(txn())).status === 200 && (await row()).status === 'active');
    const sandboxPaid = (await db.query(`SELECT count(*)::int AS n FROM milestones WHERE household_id = ${hid} AND kind = 'paid'`)).rows[0].n;
    const live = await link(txn({ environment: 'Production' }));
    const livePaid = (await db.query(`SELECT count(*)::int AS n FROM milestones WHERE household_id = ${hid} AND kind = 'paid'`)).rows[0].n;
    check('a purchase in Apple\'s sandbox (App Review, TestFlight) is not a paid household; the same purchase for real is', sandboxPaid === 0 && live.status === 200 && livePaid === 1, [sandboxPaid, live.status, livePaid]);
    const webBuy = await pb.evaluate(() => fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"plan":"year"}' }).then(async r => ({ status: r.status, body: await r.json() })));
    check('the website will not sell the plan again to a household paying Apple, and says where it is managed', webBuy.status === 409 && webBuy.body.apple === true && /App Store/.test(webBuy.body.error), webBuy);
    /* nor will the beta link take it: the server answers apple, and the app says that, not that the beta is full */
    await db.query(`DELETE FROM rate_events WHERE key = 'beta:${patState.me.userId}'`);
    await pb.goto(BASE + '/app/?beta=BETA-TEST-1234'); await pb.waitForLoadState('load');
    const appleBeta = await until(pb, () => /paid through the App Store, so there is nothing for the beta link to switch on/.test(document.querySelector('#view').textContent));
    check('a household paying through the App Store that opens the beta link is told so, not that the beta is full',
      appleBeta && !/beta is full/.test(await pb.textContent('#view')) && (await pb.evaluate(() => localStorage.getItem('lunchsorted-beta'))) === null && (await row()).source === 'apple',
      appleBeta ? undefined : (await pb.textContent('#view')).slice(0, 200));
    if (appleBeta) { await pb.click('.banner [data-act="notice-dismiss"]'); await pb.waitForTimeout(250); }
    const [otherHh] = (await db.query(`SELECT apple_account_token::text AS t FROM entitlements WHERE household_id <> ${hid} LIMIT 1`)).rows;
    const someoneElse = await link(txn({ appAccountToken: otherHh.t }));
    check('a purchase made for another household is not taken by this one', someoneElse.status === 409 && someoneElse.body.elsewhere === true, someoneElse);
    const orphan = await link(txn({ appAccountToken: crypto.randomUUID() }));
    check('but one made for a household since deleted can be restored into this one', orphan.status === 200 && (await row()).source === 'apple', orphan);
    check('and a purchase through Apple never makes anyone the payer of the household\'s Stripe billing', (await db.query(`SELECT paid_by FROM entitlements WHERE household_id = ${hid}`)).rows[0].paid_by === null);
    const shared = await link(txn({ inAppOwnershipType: 'FAMILY_SHARED', appAccountToken: undefined, originalTransactionId: '2000000000000800', transactionId: '2000000000000800' }));
    check('a purchase shared through Family Sharing is not taken, since the plan is shared through the household', shared.status === 409 && shared.body.notHere === true, shared);
    const tokenless = await link(txn({ appAccountToken: undefined, originalTransactionId: '2000000000000810', transactionId: '2000000000000810' }));
    check('nor is one that carries no household at all', tokenless.status === 409 && tokenless.body.notHere === true, tokenless);
    const lost = txn({ productId: 'app.lunchsorted.household.forever', originalTransactionId: '2000000000000820', transactionId: '2000000000000820', type: 'Non-Consumable', expiresDate: undefined, appAccountToken: crypto.randomUUID() });
    await notify('REFUND', Object.assign({}, lost, { revocationDate: Date.now(), signedDate: next() }), null);
    const relinked = await link(Object.assign({}, lost, { appAccountToken: token }));
    check('a purchase Apple has refunded cannot be linked afterwards, even from before the refund and with no household to hold the refund', relinked.status === 409 && relinked.body.notHere === true && (await row()).otx !== '2000000000000820', relinked);
    const t1 = Date.now();
    const bomb = await fetch(NODE_BASE + '/api/apple/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedPayload: Buffer.from(JSON.stringify({ alg: 'ES256', x5c: [{ length: 5e8 }, {}, {}] })).toString('base64url') + '.' + Buffer.from('{"signedDate":1}').toString('base64url') + '.x' }) });
    check('a notification whose certificates are not text is refused at once, before anything is built from them', bomb.status === 400 && Date.now() - t1 < 2000, [bomb.status, Date.now() - t1]);
    const summary = await notify('RENEWAL_EXTENSION', null, null, { data: undefined, summary: { bundleId: 'app.lunchsorted' } });
    check('a summary notification, which carries no purchase, is acknowledged rather than refused', summary.status === 200 && summary.body.ignored === true, summary);

    const off = await notify('DID_CHANGE_RENEWAL_STATUS', txn(), { originalTransactionId: '2000000000000100', autoRenewStatus: 0 }, { subtype: 'AUTO_RENEW_DISABLED' });
    check('switching off renewal in iOS Settings reaches the row as ending at the period end', off.status === 200 && (await row()).cape === true && (await row()).status === 'active', [off, await row()]);
    await link(txn());
    check('and a later word from the phone, which carries no renewal news, does not switch it back on', (await row()).cape === true);
    const dup = await fetch(NODE_BASE + '/api/apple/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedPayload: jws(Object.assign({}, off.n)) }) }).then(r => r.json());
    check('the same notification delivered twice is a no-op', dup.duplicate === true, dup);
    const staleN = await notify('EXPIRED', txn({ expiresDate: Date.now() - DAY }), null, { signedDate: clock - 5000 });
    check('a notification older than the last one applied cannot undo it', staleN.status === 200 && (await row()).plan === 'household', await row());

    const grace = await notify('DID_FAIL_TO_RENEW', txn({ expiresDate: Date.now() - DAY }), { originalTransactionId: '2000000000000100', autoRenewStatus: 1, gracePeriodExpiresDate: Date.now() + 6 * DAY }, { subtype: 'GRACE_PERIOD' });
    check('a card Apple cannot charge keeps the plan through its grace period, as waiting on a payment', grace.status === 200 && (await row()).plan === 'household' && (await row()).status === 'past_due', await row());
    await notify('EXPIRED', txn({ expiresDate: Date.now() - DAY }), { originalTransactionId: '2000000000000100', autoRenewStatus: 0 }, { subtype: 'VOLUNTARY' });
    check('when the Apple subscription ends the household is free again, and still bound to it', (await row()).plan === 'free' && (await row()).source === 'none' && (await row()).otx === '2000000000000100', await row());
    await notify('SUBSCRIBED', txn({ expiresDate: Date.now() + 30 * DAY }), { originalTransactionId: '2000000000000100', autoRenewStatus: 1 }, { subtype: 'RESUBSCRIBE' });
    check('and coming back to it later picks the same household up again', (await row()).plan === 'household' && (await row()).status === 'active' && (await row()).cape === false, await row());

    const forever = await link(txn({ productId: 'app.lunchsorted.household.forever', originalTransactionId: '2000000000000200', transactionId: '2000000000000200', type: 'Non-Consumable', expiresDate: undefined }));
    check('buying forever through Apple makes it forever', forever.status === 200 && (await row()).plan === 'lifetime' && (await row()).otx === '2000000000000200', await row());
    const sandboxEnd = new Date((await row()).pe).getTime() - Date.now();
    check('though forever bought in the sandbox, as a reviewer or a tester does for free, lasts a day and then lapses', sandboxEnd > 20 * 3600000 && sandboxEnd < 26 * 3600000, (await row()).pe);
    await notify('DID_RENEW', txn({ expiresDate: Date.now() + 365 * DAY }), { originalTransactionId: '2000000000000100', autoRenewStatus: 1 });
    await notify('EXPIRED', txn({ expiresDate: Date.now() - DAY }), null);
    check('and the yearly one it replaced, which Apple lets run until it is cancelled in Settings, cannot lower it', (await row()).plan === 'lifetime' && (await row()).status === 'active', await row());
    await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'plan');
    const appleRows = await planRows(['Your plan: Household, forever', 'Cost: Through the App Store', 'Bought: Paid once, never renews']);
    check('and on the website its Subscription keeps a purchase\'s words: bought once, through the App Store',
      JSON.stringify(appleRows) === JSON.stringify(['Your plan: Household, forever', 'Cost: Through the App Store', 'Bought: Paid once, never renews']), appleRows);
    await notify('REFUND', txn({ productId: 'app.lunchsorted.household.forever', originalTransactionId: '2000000000000200', transactionId: '2000000000000200', type: 'Non-Consumable', expiresDate: undefined, revocationDate: Date.now() }), null);
    check('a forever purchase Apple refunds is undone', (await row()).plan === 'free' && (await row()).status === 'canceled', await row());

    await link(txn({ originalTransactionId: '2000000000000300', transactionId: '2000000000000300' }));
    await notify('REFUND', txn({ originalTransactionId: '2000000000000100', expiresDate: Date.now() - 100 * DAY, revocationDate: Date.now() }), null);
    check('a refund of an older Apple subscription does not end the one being paid for now', (await row()).plan === 'household' && (await row()).status === 'active' && (await row()).otx === '2000000000000300', await row());

    const [other] = (await db.query(`SELECT household_id FROM entitlements WHERE household_id <> ${hid} LIMIT 1`)).rows;
    await db.query(`UPDATE entitlements SET apple_original_transaction_id = '2000000000000400' WHERE household_id = ${other.household_id}`);
    const taken = await link(txn({ originalTransactionId: '2000000000000400', transactionId: '2000000000000400' }));   /* this household's own token: only the binding can refuse it */
    check('a purchase already bound to another household cannot be restored into this one', taken.status === 409 && taken.body.elsewhere === true && (await row()).otx === '2000000000000300', [taken, await row()]);
    await db.query(`UPDATE entitlements SET apple_original_transaction_id = NULL WHERE household_id = ${other.household_id}`);
    const nobody = await notify('SUBSCRIBED', txn({ originalTransactionId: '2000000000000500', transactionId: '2000000000000500', appAccountToken: crypto.randomUUID() }), null);
    check('a notification for a purchase no household made is acknowledged and changes nothing', nobody.status === 200 && (await row()).otx === '2000000000000300', nobody);
    const wrongApp = await notify('SUBSCRIBED', txn({ bundleId: 'com.someone.else' }), null, { data: { bundleId: 'com.someone.else', environment: 'Sandbox', signedTransactionInfo: jws(txn({ bundleId: 'com.someone.else' })) } });
    check('a notification for another app is refused', wrongApp.status === 400, wrongApp);
    const test = await notify('TEST', null, null);
    check('Apple\'s test notification is acknowledged', test.status === 200 && test.body.ignored === true, test);
    const forged = await fetch(NODE_BASE + '/api/apple/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedPayload: jws({ notificationType: 'SUBSCRIBED', notificationUUID: crypto.randomUUID(), signedDate: next(), data: { bundleId: 'app.lunchsorted', environment: 'Sandbox', signedTransactionInfo: jws(txn(), 'rogue') } }) }) });
    check('a notification carrying a purchase signed by the wrong certificate is refused', forged.status === 400);

    /* an App Store plan whose end has long passed, with no word from Apple, no longer holds the row */
    await db.query(`UPDATE entitlements SET plan = 'household', source = 'apple', status = 'active', current_period_end = now() - interval '5 days', stripe_subscription_id = NULL WHERE household_id = ${hid}`);
    await hook(subEv('evt_after_apple_lapse', 'customer.subscription.updated', Math.floor(Date.now() / 1000) + 50, { status: 'active' }));
    check('an App Store plan days past its end with no word from Apple is over: the website can sell the plan again', (await row()).source === 'stripe' && (await row()).status === 'active', await row());
    /* a household paying on the website is not sold the plan again by the phone */
    await db.query(`UPDATE entitlements SET plan = 'household', source = 'stripe', status = 'active', apple_original_transaction_id = NULL, apple_product_id = NULL WHERE household_id = ${hid}`);
    const twice = await link(txn({ originalTransactionId: '2000000000000600', transactionId: '2000000000000600' }));
    check('an App Store purchase cannot take over a plan being paid on the website', twice.status === 409 && twice.body.paying === true && (await row()).source === 'stripe', [twice, await row()]);

    /* ---- the iPhone app's plan sheet, on a phone with StoreKit (stubbed) and the real server behind it */
    const fresh = () => db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'canceled', current_period_end = NULL, cancel_at_period_end = false, apple_original_transaction_id = NULL, apple_product_id = NULL, apple_event_at = NULL WHERE household_id = ${hid}`);
    await fresh();
    const stub = (hasStoreKit) => {
      window.__sk = { purchases: [], finished: [], managed: 0, launched: [], listeners: {}, next: null };
      const P = { AppLauncher: { openUrl: async o => { window.__sk.launched.push(o.url); return { completed: true }; } },
        Browser: { open: async () => {}, close: async () => {}, addListener: () => ({ remove() {} }) }, App: { addListener: () => ({ remove() {} }) } };
      if (hasStoreKit) P.StoreKit = {
        products: async () => ({ products: [
          { id: 'app.lunchsorted.household.annual', displayName: 'Household, yearly', displayPrice: '$34.99', kind: 'subscription', period: 'year' },
          { id: 'app.lunchsorted.household.month', displayName: 'Household, monthly', displayPrice: '$3.99', kind: 'subscription', period: 'month' },
          { id: 'app.lunchsorted.household.forever', displayName: 'Household, forever', displayPrice: '$89.99', kind: 'forever' }] }),
        purchase: async o => { window.__sk.purchases.push(o); if (window.__sk.fail) { const e = new Error('The purchase did not go through'); e.code = window.__sk.fail; throw e; } return window.__sk.next || { status: 'cancelled' }; },
        restore: async () => ({ transactions: [] }),
        finish: async o => { window.__sk.finished.push(o.transactionId); return { finished: true }; },
        manage: async () => { window.__sk.managed++; },
        addListener: (ev, fn) => { window.__sk.listeners[ev] = fn; return { remove() {} }; } };
      window.Capacitor = { isNativePlatform: () => true, Plugins: P };
    };
    const saved = await pb.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
    const iphone = async (hasStoreKit) => {
      const c = await browser.newContext({ viewport: { width: 375, height: 812 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LunchSortedApp/1' });
      await pinClock(c); await c.route(/^https:\/\/fonts\.g(oogleapis|static)\.com\//, r => r.abort());
      await c.addCookies(await pb.context().cookies());
      await c.addInitScript(o => { if (!sessionStorage.getItem('seeded')) { for (const k in o) localStorage.setItem(k, o[k]); sessionStorage.setItem('seeded', '1'); } }, saved);
      await c.addInitScript(stub, hasStoreKit);
      const pg = await c.newPage(); pg.on('pageerror', e => errors.push(String(e.message)));
      await pg.goto(BASE + '/app/'); await pg.waitForLoadState('load');
      return { c, pg };
    };
    const openPlanSheet = async pg => {
      await openPane(pg, 'plan');
      await until(pg, () => !!document.querySelector('#view [data-act="upgrade"]'));
      await pg.click('#view [data-act="upgrade"]');
      await until(pg, () => /Household plan/.test(document.querySelector('#sheetTitle').textContent));
    };
    const { c: ctxN, pg: pn } = await iphone(true);
    await openPlanSheet(pn);
    await until(pn, () => document.querySelectorAll('#sheetBody [data-act="iap-buy"]').length === 2);
    const sheet = await pn.textContent('#sheetBody');
    check('on the iPhone the plan sheet sells through the App Store, at Apple\'s own prices, with no Stripe button and no forever even if the App Store still lists one', /\$34\.99 a year/.test(sheet) && /\$3\.99 a month/.test(sheet) && !/forever|\$89\.99/i.test(sheet) && !/\$19\.99/.test(sheet) && (await pn.$$eval('#sheetBody [data-act="buy"]', a => a.length)) === 0, sheet.replace(/\s+/g, ' ').slice(0, 300));
    check('and it offers Restore purchases, Terms of use and Privacy, says the plans renew, and promises no refund Apple would have to give', (await pn.$$eval('#sheetBody [data-act="iap-restore"]', a => a.length)) === 1 && (await pn.$$eval('#sheetBody [data-url="/terms.html"], #sheetBody a[href="/terms.html"]', a => a.length)) === 1 && (await pn.$$eval('#sheetBody [data-url="/privacy.html"], #sheetBody a[href="/privacy.html"]', a => a.length)) === 1 && !/14 days/.test(sheet) && /Renews each year or month until you cancel/.test(sheet) && /Apple Account/.test(sheet));
    {
      /* the App Store refuses the purchase (App Review's iPad, 1.0 (6)): the parent is told plainly, and
         Apple's own reason waits in the bug report rather than on screen */
      /* the reason is long, and a character outside plain ASCII straddles the cut: kept whole it would split, the mail link would throw, and Help would not open */
      await pn.evaluate(() => { window.__sk.fail = 'unknown(StoreKitError) ' + 'x'.repeat(136) + '😀 and more'; });
      await pn.click('#sheetBody [data-act="iap-buy"][data-product="app.lunchsorted.household.annual"]');
      const failed = await until(pn, () => /did not go through/.test(document.getElementById('toast').textContent));
      const buttonsBack = await pn.$$eval('#sheetBody [data-act="iap-buy"]', a => a.length === 2 && a.every(b => !b.disabled && /a (year|month)$/.test(b.textContent)));
      await pn.evaluate(() => { window.__sk.fail = null; window.__sk.purchases = []; });
      await pn.click('#sheetClose'); await pn.waitForTimeout(250);
      await pn.click('[data-act="help"]'); await pn.waitForTimeout(300);
      const mail = decodeURIComponent(await pn.$eval('#sheetBody a[data-feedback]', a => a.getAttribute('href')));
      check('a purchase the App Store refuses says so in plain words, puts the buttons back, and keeps Apple\'s reason for a bug report',
        failed && buttonsBack && /Last App Store error: unknown\(StoreKitError\)/.test(mail) && !/StoreKitError/.test(await pn.textContent('#toast')), [failed, buttonsBack, mail.slice(-200)]);
      await pn.click('#sheetClose'); await pn.waitForTimeout(250);
      await openPlanSheet(pn);
      await until(pn, () => document.querySelectorAll('#sheetBody [data-act="iap-buy"]').length === 2);
    }
    const bought = txn({ originalTransactionId: '2000000000000700', transactionId: '2000000000000700' });
    await pn.evaluate(n => { window.__sk.next = n; }, { status: 'purchased', jws: jws(bought), transactionId: '2000000000000700', productId: bought.productId });
    const stripeBefore = stripeCalls.length;
    await pn.click('#sheetBody [data-act="iap-buy"][data-product="app.lunchsorted.household.annual"]');
    await until(pn, () => window.__sk.finished.length > 0);
    const skSeen = await pn.evaluate(() => window.__sk);
    check('buying the yearly plan hands Apple the household\'s token, and the purchase is finished only once the server has it', skSeen.purchases.length === 1 && skSeen.purchases[0].id === 'app.lunchsorted.household.annual' && skSeen.purchases[0].token === token && skSeen.finished[0] === '2000000000000700' && (await row()).source === 'apple' && (await row()).plan === 'household', [skSeen, await row()]);
    check('and nothing was opened in a browser, and no Stripe checkout was made', skSeen.launched.length === 0 && stripeCalls.slice(stripeBefore).filter(c => c.path === '/v1/checkout/sessions').length === 0, stripeCalls.slice(stripeBefore).map(c => c.path));
    await until(pn, () => /Welcome to the Household plan/.test(document.querySelector('#toast').textContent));
    {
      await pn.click('[data-act="help"]'); await pn.waitForTimeout(300);
      const mailAfter = decodeURIComponent(await pn.$eval('#sheetBody a[data-feedback]', a => a.getAttribute('href')));
      check('and a purchase that goes through takes the App Store\'s earlier reason back out of the bug report', !/Last App Store error/.test(mailAfter), mailAfter.slice(-160));
      await pn.click('#sheetClose'); await pn.waitForTimeout(250);
    }
    await openPane(pn, 'plan');
    await until(pn, () => !!document.querySelector('#view [data-act="iap-manage"]'));
    const paneN = await pn.textContent('#view');
    check('Subscription on the iPhone then offers Manage in the App Store, not Manage billing, and names no website price', (await pn.$$eval('#view [data-act="portal"]', a => a.length)) === 0 && !/\$19\.99/.test(paneN) && /Manage in the App Store/.test(paneN), paneN.replace(/\s+/g, ' ').slice(0, 300));
    await pn.click('#view [data-act="iap-manage"]'); await until(pn, () => window.__sk.managed === 1);
    check('and Manage in the App Store opens Apple\'s own subscription sheet', (await pn.evaluate(() => window.__sk.managed)) === 1);
    const renewed = txn({ originalTransactionId: '2000000000000700', transactionId: '2000000000000701', expiresDate: Date.now() + 700 * DAY });
    await pn.evaluate(t => window.__sk.listeners.transaction(t), { jws: jws(renewed), transactionId: '2000000000000701', productId: renewed.productId });
    await until(pn, () => window.__sk.finished.includes('2000000000000701'));
    check('a purchase StoreKit hands over by itself, a renewal or an Ask to Buy approved later, goes to the server and is finished', new Date((await row()).pe).getTime() > Date.now() + 600 * DAY, await row());
    await ctxN.close();

    /* a household the website bills is not sold the plan again on the iPhone */
    await db.query(`UPDATE entitlements SET plan = 'household', source = 'stripe', status = 'active', apple_original_transaction_id = NULL, apple_product_id = NULL WHERE household_id = ${hid}`);
    const { c: ctxW, pg: pw } = await iphone(true);
    await openPane(pw, 'plan'); await until(pw, () => /Household/.test(document.querySelector('#view').textContent));
    check('a household paying on the website is sold nothing on the iPhone, and the app does not open Stripe even to manage it', (await pw.$$eval('[data-act="iap-buy"], [data-act="upgrade"][data-why="forever"], [data-act="portal"]', a => a.length)) === 0 && /at lunchsorted\.app/.test(await pw.textContent('#view')), (await pw.textContent('#view')).replace(/\s+/g, ' ').slice(0, 300));
    await ctxW.close();

    /* the iPhone app built before StoreKit still loads this page: it must sell nothing at all */
    await fresh();
    const { c: ctxO, pg: po } = await iphone(false);
    await openPlanSheet(po);
    const oldSheet = await po.textContent('#sheetBody');
    check('an iPhone app from before the App Store plugin is told to update, and offers no way to pay', /Update Lunch Sorted/.test(oldSheet) && (await po.$$eval('#sheetBody [data-act="buy"], #sheetBody [data-act="iap-buy"]', a => a.length)) === 0, oldSheet.replace(/\s+/g, ' ').slice(0, 200));
    await ctxO.close();
    delete globalThis.__LS_APPLE_ROOT;
    await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'canceled', current_period_end = NULL, cancel_at_period_end = false, apple_original_transaction_id = NULL, apple_product_id = NULL, apple_event_at = NULL WHERE household_id = ${hid}`);
  }
  /* who may manage billing: the owner, and whoever paid; a helper may buy nothing */
  await db.query(`UPDATE entitlements SET plan='household', status='active', stripe_subscription_id='sub_pat', paid_by=NULL WHERE household_id=${patState.household.id}`);
  await pb.reload(); await pb.waitForLoadState('load'); await openPane(pb, 'household');
  await pb.click('[data-act="invite-helper"]'); await until(pb, () => !!document.querySelector('#inviteUrl'));
  const sitterUrl = await pb.inputValue('#inviteUrl');
  const ctxH = await phone(); const ph = await ctxH.newPage(); ph.on('pageerror', e => errors.push(String(e.message)));
  await ph.goto(sitterUrl); await ph.waitForLoadState('load'); await until(ph, () => !!document.querySelector('#signinEmail'));
  await ph.fill('#signinEmail', 'sitter@example.com'); await ph.press('#signinEmail', 'Enter'); await until(ph, () => !!document.querySelector('[data-dev-link]'));
  await ph.goto(await ph.getAttribute('[data-dev-link]', 'href')); await ph.click('button[type="submit"]'); await ph.waitForURL(/\/app\//); await ph.waitForLoadState('load');
  await until(ph, () => !!document.querySelector('[data-act="join-accept"]')); await ph.click('[data-act="join-accept"]');
  await until(ph, () => /Read-only on this phone/.test(document.querySelector('#view').textContent));
  const helperBuy = await ph.evaluate(() => Promise.all([fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status), fetch('/api/billing/portal', {method:'POST'}).then(r => r.status), fetch('/api/apple/link', {method:'POST', headers:{'content-type':'application/json'}, body:'{"signedTransaction":"x"}'}).then(r => r.status)]));
  check('a caretaker can neither buy nor manage billing, on the website or through the App Store, and sees no plan line', helperBuy[0] === 403 && helperBuy[1] === 403 && helperBuy[2] === 403 && !/Household plan/.test(await ph.textContent('#view')), helperBuy);
  /* and is not sent what the household pays in the first place */
  const sitterEnt = await ph.evaluate(() => fetch('/api/household').then(r => r.json()).then(j => j.entitlement));
  check('and the server never hands a caretaker the household\'s plan, price or renewal date',
    sitterEnt.plan === 'free' && sitterEnt.currentPeriodEnd === null && !sitterEnt.price && sitterEnt.portal === false && !sitterEnt.appleToken, sitterEnt);
  /* the Account tab a caretaker gets: no plan, no lunchbox settings, and still a way out */
  await ph.click('[data-act="tab"][data-tab="setup"]'); await ph.waitForTimeout(300);
  const sitterRows = await ph.evaluate(() => [...document.querySelectorAll('#view .item')].map(e => e.querySelector('.nm').textContent));
  check('a caretaker sees Account, Household and support, and no Subscription or Lunchboxes row',
    sitterRows.join('|') === 'Account|Household|Contact support', sitterRows);
  await ph.click('[data-act="tab"][data-tab="week"]'); await ph.waitForTimeout(300);
  check('and no gear in the corner on the tabs that carry one for a parent', (await ph.$$eval('#who [data-act="box-settings"]', a => a.length)) === 0);
  await ph.click('[data-act="tab"][data-tab="setup"]'); await ph.waitForTimeout(300);
  const sitterForced = await ph.evaluate(() => {
    const mk = (p) => { const b = document.createElement('button'); b.setAttribute('data-act','pane'); b.setAttribute('data-pane',p); document.body.appendChild(b); b.click(); b.remove(); return document.querySelector('#view').textContent; };
    return { box: mk('box'), plan: mk('plan') };
  });
  check('and a forced tap on either refuses rather than opening it',
    !/School rules/.test(sitterForced.box) && !/Your plan/.test(sitterForced.plan), sitterForced);
  await ph.click('[data-act="pane"][data-pane="account"]'); await ph.waitForTimeout(300);
  check('a caretaker can still reach Sign out and Leave this household',
    (await ph.$$eval('[data-act="signout"]', a => a.length)) === 1 && (await ph.$$eval('[data-act="leave"]', a => a.length)) === 1);
  await ph.click('[data-act="pane-done"]'); await ph.waitForTimeout(250);
  await ph.click('[data-act="pane"][data-pane="household"]'); await ph.waitForTimeout(300);
  check('and sees who else is in it, named a caretaker, with no invite of their own',
    /Caretaker \u2014 sees the week and checks the box off/.test(await ph.textContent('#view')) && (await ph.$$eval('[data-act="invite"], [data-act="invite-helper"]', a => a.length)) === 0,
    (await ph.textContent('#view')).replace(/\s+/g, ' ').slice(0, 200));
  await ph.click('[data-act="pane-done"]'); await ph.waitForTimeout(250);
  await db.query(`UPDATE entitlements SET plan='free', status='none' WHERE household_id=${patState.household.id}`);
  await ph.reload(); await ph.waitForLoadState('load'); await ph.click('[data-act="tab"][data-tab="setup"]');
  await until(ph, () => /Read-only on this phone/.test(document.querySelector('#view').textContent));
  await ph.click('[data-act="tab"][data-tab="pack"]'); await ph.waitForTimeout(250);
  check('and on a lapsed household a helper sees no locks, stars, tags or banners either', (await ph.$$eval('.chip.lock, .chip.good, .star, .starmark, [data-act="upgrade"], [data-act="trial-dismiss"]', a => a.filter(x => /Household|three weeks|\u2605/.test(x.textContent)).length)) === 0);
  await db.query(`UPDATE entitlements SET plan='household', status='active' WHERE household_id=${patState.household.id}`);
  await ctxH.close();
  await pb.click('[data-act="invite"]'); await until(pb, () => /works once, for a week\./.test(document.querySelector('#view').textContent));
  const adultUrl = await pb.inputValue('#inviteUrl');
  const ctxA = await phone(); const pa = await ctxA.newPage(); pa.on('pageerror', e => errors.push(String(e.message)));
  await pa.goto(adultUrl); await pa.waitForLoadState('load'); await until(pa, () => !!document.querySelector('#signinEmail'));
  await pa.fill('#signinEmail', 'other@example.com'); await pa.press('#signinEmail', 'Enter'); await until(pa, () => !!document.querySelector('[data-dev-link]'));
  await pa.goto(await pa.getAttribute('[data-dev-link]', 'href')); await pa.click('button[type="submit"]'); await pa.waitForURL(/\/app\//); await pa.waitForLoadState('load');
  await until(pa, () => !!document.querySelector('[data-act="join-accept"]')); await pa.click('[data-act="join-accept"]');
  await until(pa, () => !!document.querySelector('[data-act="pane"][data-pane="plan"]'));
  await openPane(pa, 'plan');
  const otherPortal = await pa.evaluate(() => fetch('/api/billing/portal', {method:'POST'}).then(r => r.status));
  check('the other parent sees the plan but cannot open the payer\'s billing', otherPortal === 403 && (await pa.$$eval('[data-act="portal"]', a => a.length)) === 0, otherPortal);
  {
    /* one checkout at a time for a household: the other parent's, still open, is refused; a parent's own is closed at Stripe and replaced */
    const entRow = (await db.query(`SELECT plan, source, status, stripe_subscription_id FROM entitlements WHERE household_id = ${patState.household.id}`)).rows[0];
    await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'none', stripe_subscription_id = NULL WHERE household_id = ${patState.household.id}`);
    const patId = (await db.query(`SELECT id FROM users WHERE email = 'pat@example.com'`)).rows[0].id;
    await db.query(`INSERT INTO rate_events (key) VALUES ('checkout:${patState.household.id}:${patId}:cs_test_1')`);
    const otherCheckout = await pa.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.json().then(j => ({status: r.status, body: j}))));
    check('while one parent\'s checkout is open, the other parent\'s is refused, and told why', otherCheckout.status === 409 && otherCheckout.body.open === true && /The other parent is paying right now/.test(otherCheckout.body.error), otherCheckout);
    stripeCalls.length = 0;
    const patAgain = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status));
    const marks = (await db.query(`SELECT key FROM rate_events WHERE key LIKE 'checkout:${patState.household.id}:%'`)).rows.map(r => r.key);
    check('the same parent trying again closes the earlier checkout at Stripe, gets a fresh one, and one open checkout is on record', patAgain === 200 && stripeCalls.some(c => c.path === '/v1/checkout/sessions/cs_test_1/expire') && stripeCalls.some(c => c.path === '/v1/checkout/sessions') && marks.length === 1, [patAgain, stripeCalls.map(c => c.path), marks]);
    stripeCalls.length = 0;
    const closed = await pb.evaluate(() => fetch('/api/billing/close', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}).then(r => r.json().then(j => ({status: r.status, body: j}))));
    const marksAfter = (await db.query(`SELECT key FROM rate_events WHERE key LIKE 'checkout:${patState.household.id}:%'`)).rows.length;
    check('backing out of Stripe closes the parent\'s own checkout at once, so nobody is told someone is paying', closed.status === 200 && closed.body.closed === 1 && marksAfter === 0 && stripeCalls.some(c => c.path === '/v1/checkout/sessions/cs_test_1/expire'), [closed, marksAfter]);
    await db.query(`DELETE FROM rate_events WHERE key LIKE 'checkout:${patState.household.id}:%'`);
    await db.query(`UPDATE entitlements SET plan = '${entRow.plan}', source = '${entRow.source}', status = '${entRow.status}', stripe_subscription_id = ${entRow.stripe_subscription_id ? "'" + entRow.stripe_subscription_id + "'" : 'NULL'} WHERE household_id = ${patState.household.id}`);
  }
  await ctxA.close();
  {
    /* an owner folding a household with nobody else in it into another: its subscription is cancelled whatever its row says,
       since a first charge Stripe is still retrying reads as ended, and once the household goes nothing would find it */
    const { createSession, findOrCreateUser, createInvite } = await import('../netlify/lib/auth.js');
    const folder = await findOrCreateUser('folder@example.com'), folderToken = await createSession(folder.id, 'native');
    const [own] = (await db.query(`INSERT INTO households (owner_user_id, doc) VALUES (${folder.id}, '{}'::jsonb) RETURNING id`)).rows;
    await db.query(`INSERT INTO household_members (household_id, user_id, role, member_id) VALUES (${own.id}, ${folder.id}, 'owner', 'mem_folder1')`);
    await db.query(`INSERT INTO entitlements (household_id, plan, source, status, stripe_subscription_id) VALUES (${own.id}, 'free', 'none', 'canceled', 'sub_folded')`);
    const code = await createInvite(patState.household.id, patState.me.userId, 'adult');
    const before = stripeCalls.length;
    const joined = await fetch(NODE_BASE + '/api/household/join', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + folderToken }, body: JSON.stringify({ code }) });
    const gone = (await db.query(`SELECT count(*)::int AS n FROM households WHERE id = ${own.id}`)).rows[0].n === 0;
    const calls = stripeCalls.slice(before).map(c => c.method + ' ' + c.path);
    await db.query(`DELETE FROM users WHERE id = ${folder.id}`);   /* out of Pat's household again, and off the numbers page */
    check('an owner folding their household into another cancels its subscription, a first charge Stripe is still retrying included',
      joined.status === 200 && gone && calls.includes('DELETE /v1/subscriptions/sub_folded'), { status: joined.status, gone, calls });
  }
  {
    /* and if Stripe cannot say that subscription is cancelled, the join waits, with nothing spent or let go: the invite still
       good, the household and its subscription where they were */
    const { createSession, findOrCreateUser, createInvite } = await import('../netlify/lib/auth.js');
    const { peekInvite } = await import('../netlify/lib/auth.js');
    const folder = await findOrCreateUser('folder2@example.com'), folderToken = await createSession(folder.id, 'native');
    const [own] = (await db.query(`INSERT INTO households (owner_user_id, doc) VALUES (${folder.id}, '{}'::jsonb) RETURNING id`)).rows;
    await db.query(`INSERT INTO household_members (household_id, user_id, role, member_id) VALUES (${own.id}, ${folder.id}, 'owner', 'mem_folder2')`);
    await db.query(`INSERT INTO entitlements (household_id, plan, source, status, stripe_subscription_id) VALUES (${own.id}, 'free', 'none', 'canceled', 'sub_fold_stuck')`);
    const code = await createInvite(patState.household.id, patState.me.userId, 'adult');
    const stub = globalThis.__LS_STRIPE_FETCH;
    globalThis.__LS_STRIPE_FETCH = (url, init) => new URL(url).pathname === '/v1/subscriptions/sub_fold_stuck' && init.method === 'DELETE'
      ? Promise.resolve(new Response(JSON.stringify({ error: { type: 'api_error', message: 'stub: not now' } }), { status: 500 })) : stub(url, init);
    let waited;
    try { waited = await fetch(NODE_BASE + '/api/household/join', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + folderToken }, body: JSON.stringify({ code }) }); }
    finally { globalThis.__LS_STRIPE_FETCH = stub; }
    const still = (await db.query(`SELECT (SELECT count(*)::int FROM households WHERE id = ${own.id}) AS household, (SELECT count(*)::int FROM household_members WHERE user_id = ${folder.id} AND household_id = ${own.id}) AS member`)).rows[0];
    const inviteGood = !!(await peekInvite(code)), said = (await waited.json().catch(() => ({}))).error;
    await db.query(`DELETE FROM users WHERE id = ${folder.id}`);
    check('and if Stripe cannot say it is cancelled, the join waits, the invite still good and the household where it was',
      waited.status === 503 && inviteGood && still.household === 1 && still.member === 1 && /Try again in a moment/.test(said || ''), { status: waited.status, inviteGood, still, said });
  }
  /* deleting the account stops the money; and a household this parent paid for, though another owns it, whose first charge
     Stripe is still retrying, has that subscription cancelled too, whatever its row says */
  const [elsewhereOwner] = (await db.query(`INSERT INTO users (email) VALUES ('elsewhere@example.com') RETURNING id`)).rows;
  const [elsewhere] = (await db.query(`INSERT INTO households (owner_user_id, doc) VALUES (${elsewhereOwner.id}, '{}'::jsonb) RETURNING id`)).rows;
  await db.query(`INSERT INTO entitlements (household_id, plan, source, status, stripe_subscription_id, paid_by) VALUES (${elsewhere.id}, 'free', 'none', 'canceled', 'sub_paid_elsewhere', ${patState.me.userId})`);
  stripeCalls.length = 0;
  await openPane(pb, 'account');
  check('the delete warning says the plan stops', /The plan, which stops at once/.test(await pb.textContent('#view')),
    (await pb.textContent('#view')).replace(/\s+/g, ' ').slice(0, 240));
  await pb.fill('#deleteConfirm', 'DELETE'); await pb.waitForSelector('[data-act="delete-account"]:not([disabled])');
  await pb.click('[data-act="delete-account"]');
  await until(pb, () => !!document.querySelector('.ob') && !!localStorage.getItem('lunchsorted'));
  check('deleting the account cancels the subscription at Stripe', stripeCalls.some(c => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_pat'));
  check('and one it paid for elsewhere, its first charge still being retried, whatever its row says', stripeCalls.some(c => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_paid_elsewhere'), stripeCalls.map(c => c.method + ' ' + c.path));
  await db.query(`DELETE FROM users WHERE id = ${elsewhereOwner.id}`);   /* the household goes with its owner, and the numbers page counts every person */
  const unpaidSession = await hook({ id: 'evt_8', type: 'checkout.session.completed', created: t0 + 7, data: { object: { id: 'cs_test_4', mode: 'subscription', payment_status: 'unpaid', client_reference_id: '999999', metadata: {} } } });
  check('a session that is not paid yet, or for no household, grants nothing and is still acknowledged', unpaidSession.status === 200);
  await ctxB.close();
  /* ---- the daily reminder job */
  {
    const { run } = await import('../netlify/functions/cron-trial.js');
    const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
    const mk = async (email, daysAgo, opts = {}) => {
      const [u] = (await db.query(`INSERT INTO users (email, mail_ok) VALUES ('${email}', ${opts.mailOk === false ? 'false' : 'true'}) RETURNING id`)).rows;
      const [h] = (await db.query(`INSERT INTO households (owner_user_id, created_at, doc) VALUES (${u.id}, '${ago(daysAgo)}', '{"createdAt":"${ago(daysAgo)}"${opts.tz ? `,"tz":"${opts.tz}"` : ''}}'::jsonb) RETURNING id`)).rows;
      await db.query(`INSERT INTO household_members (household_id, user_id, role, member_id) VALUES (${h.id}, ${u.id}, 'owner', 'mem_x')`);
      await db.query(`INSERT INTO entitlements (household_id, plan, status) VALUES (${h.id}, '${opts.plan || 'free'}', '${opts.status || 'none'}')`);
      return { u: u.id, h: h.id };
    };
    const ending = await mk('ending@example.com', 18), ended = await mk('ended@example.com', 21.5), young = await mk('young@example.com', 5);
    const paidOne = await mk('paid@example.com', 18, { plan: 'household', status: 'active' }), quiet = await mk('quiet@example.com', 18, { mailOk: false });
    const west = await mk('west@example.com', 18, { tz: 'Pacific/Honolulu' }), odd = await mk('odd@example.com', 18, { tz: 'Not/AZone' });
    const before = mails.length;
    const first = await run(Date.now(), 'https://test.example');
    const got = (to) => mails.slice(before).filter(m => m.to === to);
    check('the trial emails quote the price Stripe has now, founding line and all, and never forever',
      [got('ending@example.com')[0], got('ended@example.com')[0]].every(m => m && /\$19\.99 a year, or \$2\.99 a month \(the founding price, yours for as long as you stay\)/.test(m.text) && /\$19\.99 a year/.test(m.html) && !/forever|\$79|\$29\b/i.test(m.text + m.html)),
      [got('ending@example.com')[0], got('ended@example.com')[0]].map(m => m && m.text));
    {
      const { dateWords } = await import('../netlify/lib/mail.js');
      const end = new Date(Date.now() + 3 * 86400000);
      const east = end.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
      const hawaii = end.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Pacific/Honolulu' });
      check("the end date in the email is the household's own day, and a zone the server does not know falls back to the East Coast",
        got('west@example.com').length === 1 && got('west@example.com')[0].subject.endsWith(hawaii) && got('odd@example.com').length === 1 && got('odd@example.com')[0].subject.endsWith(east) && dateWords(end, 'Pacific/Honolulu') === hawaii && dateWords(end, 'Not/AZone') === east
        && dateWords(end, null) === east && dateWords(end, '') === east
        && dateWords(new Date('2026-09-10T06:00:00Z'), 'Pacific/Honolulu') === 'Wednesday, September 9' && dateWords(new Date('2026-09-10T06:00:00Z'), 'America/New_York') === 'Thursday, September 10',
        [got('west@example.com').map(m => m.subject), got('odd@example.com').map(m => m.subject), hawaii, east]);
    }
    check('three days before the end, one email says when; the day after, one says what changed', first.ending === 3 && first.ended === 1 &&
      got('ending@example.com').length === 1 && /end [A-Z][a-z]+day, [A-Z][a-z]+ \d+$/.test(got('ending@example.com')[0].subject) && /\/app\/\?upgrade=1/.test(got('ending@example.com')[0].text) &&
      got('ended@example.com').length === 1 && /three weeks are up/i.test(got('ended@example.com')[0].subject), [first, got('ending@example.com').map(m => m.subject)]);
    check('a young household, a paid one, and someone who stopped reminders get nothing', got('young@example.com').length === 0 && got('paid@example.com').length === 0 && got('quiet@example.com').length === 0 && first.skipped === 1);
    const second = await run(Date.now(), 'https://test.example');
    check('running the job again sends nothing twice', second.ending === 0 && second.ended === 0 && mails.length === before + 4);
    const stopUrl = got('ending@example.com')[0].text.match(/https:\/\/test\.example(\/api\/auth\/mail-stop\?t=[a-f0-9]{32})/)[1];
    const peek = await fetch(NODE_BASE + stopUrl);
    const stillOk = (await db.query(`SELECT mail_ok FROM users WHERE id = ${ending.u}`)).rows[0].mail_ok;
    const token = stopUrl.split('t=')[1];
    const stopped = await fetch(NODE_BASE + '/api/auth/mail-stop', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 't=' + token });
    const mailOk = (await db.query(`SELECT mail_ok FROM users WHERE id = ${ending.u}`)).rows[0].mail_ok;
    const bad = await fetch(NODE_BASE + '/api/auth/mail-stop', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 't=deadbeef' });
    check('the stop link shows a button rather than acting on sight, the button stops the reminders, and a wrong token is refused',
      peek.status === 200 && /Stop these reminders/.test(await peek.text()) && stillOk === true && stopped.status === 200 && mailOk === false && bad.status === 410, [peek.status, stillOk, stopped.status, mailOk, bad.status]);
    {
      const { default: cronHandler } = await import('../netlify/functions/cron-trial.js');
      const stray = await cronHandler(new Request('http://x/cron', { method: 'POST', body: '{}' }));
      check('the job refuses to run for anything but the schedule on the published deploy', stray.status === 404);
      /* on the published deploy the job then sweeps: a month-old error report and a two-day-old throttle mark go, younger ones
         stay. The suite's test key leaves production without billing, so the emails before it send nothing */
      /* a flood leaves a day of rate rows due at once: the request that pays for housekeeping deletes one batch, and the daily
         run below keeps going until they are gone. Math.random is held off the one-in-twenty-five from here until the daily
         run has been counted, so no other request's housekeeping can take the rows either check is counting */
      const { sweep: sweepNow, SWEEP_BATCH } = await import('../netlify/lib/db.js');
      await db.query("INSERT INTO rate_events (key, at) SELECT 'flood:old', now() - interval '2 days' FROM generate_series(1, $1::int)", [2 * SWEEP_BATCH + 5]);
      const floodLeft = async () => (await db.query("SELECT count(*)::int AS n FROM rate_events WHERE key = 'flood:old'")).rows[0].n;
      const realRandom = Math.random; Math.random = () => 0.5 + realRandom() / 2;
      await sweepNow(); const oneBatch = await floodLeft();
      check('a request that pays for housekeeping deletes one batch of old rate rows, not the whole day', oneBatch === SWEEP_BATCH + 5, [oneBatch, SWEEP_BATCH]);
      await db.query(`INSERT INTO app_errors (at, build, kind, message) VALUES (now() - interval '31 days', 'lunchsorted-v3', 'error', 'smoke: a month old'), (now() - interval '29 days', 'lunchsorted-v3', 'error', 'smoke: not yet a month')`);
      await db.query(`INSERT INTO rate_events (key, at) VALUES ('smoke:two days old', now() - interval '2 days'), ('smoke:two hours old', now() - interval '2 hours')`);
      const leftover = async () => (await db.query("SELECT message AS k FROM app_errors WHERE build = 'lunchsorted-v3' UNION ALL SELECT key FROM rate_events WHERE key LIKE 'smoke:%'")).rows.map(r => r.k).sort().join();
      const seeded = await leftover(), mailsBefore = mails.length, wasEnv = process.env.SITE_ENV;
      process.env.SITE_ENV = 'production';
      let swept; try { swept = await cronHandler(new Request('http://x/cron', { method: 'POST', body: '{"next_run":"x"}' })); } finally { process.env.SITE_ENV = wasEnv; }
      const stayed = await leftover();
      check('on the published deploy the daily job also sweeps: a month-old error report and a two-day-old throttle mark go, younger ones stay',
        swept.status === 200 && seeded === 'smoke: a month old,smoke: not yet a month,smoke:two days old,smoke:two hours old' && stayed === 'smoke: not yet a month,smoke:two hours old' && mails.length === mailsBefore,
        [swept.status, seeded, stayed, mails.length - mailsBefore]);
      check('and the daily run keeps going until a day of old rate rows is gone', (await floodLeft()) === 0, await floodLeft());
      Math.random = realRandom;
      await db.query("DELETE FROM app_errors WHERE build = 'lunchsorted-v3'"); await db.query("DELETE FROM rate_events WHERE key LIKE 'smoke:%'");
      const { default: testerHandler } = await import('../netlify/functions/cron-tester.js');
      const strayT = await testerHandler(new Request('http://x/cron', { method: 'POST', body: '{"next_run":"x"}' }));
      check('and so does the beta-week job, even with a schedule-shaped body, off the published deploy', strayT.status === 404);
    }
    void young; void paidOne; void quiet; void ended; void west; void odd;
    /* the beta testers' first week: days 1, 3 and 6, once each, never after "no more of these" */
    {
      const { run: runTester } = await import('../netlify/functions/cron-tester.js');
      const seed = async (email, daysAgo, opts = {}) => { const r = await mk(email, daysAgo + 1, opts); await db.query(`UPDATE entitlements SET plan = 'lifetime', status = 'active', source = 'code', event_at = '${ago(daysAgo)}' WHERE household_id = ${r.h}`); return r; };
      await seed('t1@example.com', 1.2); await seed('t3@example.com', 3.5); await seed('t6@example.com', 6.1); await seed('t0@example.com', 0.4); await seed('t9@example.com', 9.5); await seed('tq@example.com', 1.2, { mailOk: false });
      const b0 = mails.length;
      const r1 = await runTester(Date.now(), 'https://test.example');
      const to = (e) => mails.slice(b0).filter(m => m.to === e);
      check('day one, three and six each get their note, a household too new or too old gets none, and no more of these is honoured',
        r1.sent === 3 && /Thank you for beta testing/.test(to('t1@example.com')[0].subject) && /let your kid pick/.test(to('t3@example.com')[0].subject) && /What came home/.test(to('t6@example.com')[0].subject) && to('t0@example.com').length === 0 && to('t9@example.com').length === 0 && to('tq@example.com').length === 0, r1);
      check('every note carries numbered steps, a screenshot, the feedback form, the reply line and a stop link', to('t1@example.com')[0].text.includes('/feedback.html') && /\n1\. /.test(to('t1@example.com')[0].text) && /img\/mail-day1\.png/.test(to('t1@example.com')[0].html) && /img\/mail-day6\.png/.test(to('t6@example.com')[0].html) && /Instacart/.test(to('t6@example.com')[0].text) && /a person reads it/.test(to('t1@example.com')[0].text) && /mail-stop\?t=[a-f0-9]{32}/.test(to('t1@example.com')[0].text));
      const r2 = await runTester(Date.now(), 'https://test.example');
      check('a second run the same day sends nothing again', r2.sent === 0, r2);
    }
  }
  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_YEAR', 'STRIPE_PRICE_LIFETIME', 'STRIPE_PRICE_MONTH']) delete process.env[k];
  stripeLib.forgetPrices();

  let recipeSession = '', recipeCookieName = 'ls_session';
  /* ----------------------------------------------------------- recipes
     Three layers over one record: the idea bank's cooked dishes carry a recipe,
     any recipe can be cooked a step at a time in either set of measures, and a
     recipe can be read off a page or pasted in from under a video. Nothing here
     needs the network except the page reader, and that is held up against a page
     in memory rather than fetched. */
  {
    const { parseRecipeHtml, publicUrl, privateAddress } = await import('../netlify/functions/api-recipe.js');
    const { COOKIE: authCookieName, createSession, findOrCreateUser } = await import('../netlify/lib/auth.js');
    const recipeUser = await findOrCreateUser('recipes@example.com');
    recipeSession = await createSession(recipeUser.id); recipeCookieName = authCookieName;
    const ld = (body) => `<html><head><title>Quinoa Salad | A Blog</title><script type="application/ld+json">${JSON.stringify(body)}</script></head><body></body></html>`;
    const read = parseRecipeHtml(ld({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite' },
      { '@type': ['Recipe'], name: 'Lemony Quinoa Salad', recipeYield: ['4 servings'],
        prepTime: 'PT10M', cookTime: 'PT20M',
        recipeIngredient: ['1 cup quinoa', '&frac12; tsp salt', '2 tbsp olive oil'],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Rinse the quinoa.' },
          { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Simmer <b>20 minutes</b>.' }] }] }
    ] }), 'https://www.a-blog.example/quinoa');
    check('a recipe page is read out of the markup it already publishes: name, time, yield, ingredients and every step',
      read && read.title === 'Lemony Quinoa Salad' && read.m === 30 && read.y === 4
      && read.ing.length === 3 && read.ing[1] === '½ tsp salt'
      && read.steps.length === 2 && read.steps[1] === 'Simmer 20 minutes.' && read.src === 'a-blog.example', read);
    const micro = parseRecipeHtml('<h1 itemprop="name">Oat bites</h1><li itemprop="recipeIngredient">1 cup oats</li>'
      + '<li itemprop="recipeIngredient">2 tbsp honey</li><p itemprop="recipeInstructions">Roll them.</p>', 'https://b.example/x');
    check('a page that never adopted JSON-LD is read from the tags in its markup instead',
      micro && micro.ing.length === 2 && /Roll them/.test(micro.steps[0]), micro);
    check('a page with no recipe on it reads as no recipe, rather than as an empty one',
      parseRecipeHtml('<html><body><p>1 cup of nothing</p></body></html>', 'https://c.example/x') === null);
    /* A great many recipes are published with no machine-readable markup at all — a shop's
       blog post on a template that only knows about articles. The recipe is still under an
       Ingredients heading, so that is read too, entities and all. */
    const article = parseRecipeHtml('<html><head><title>Pumpkin Blondies &ndash; A Shop</title>'
      + '<script type="application/ld+json">{"@type":"BlogPosting","headline":"Pumpkin Blondies"}</script></head><body>'
      + '<h1>Pumpkin Blondies</h1><p>A fall favourite.</p>'
      + '<h2>Ingredients</h2><ul><li>1 cup all-purpose flour</li><li>&frac12; cup pumpkin pur&eacute;e</li>'
      + '<li>&frac34; cup brown sugar</li><li>1 tsp pumpkin pie spice</li></ul>'
      + '<h2>Instructions</h2><ol><li>Heat the oven to 350F.</li><li>Bake 28 minutes.</li></ol>'
      + '<h2>Notes</h2><p>Keeps five days.</p></body></html>', 'https://a-shop.example/blogs/recipes/pumpkin-blondies?utm_source=Pinterest');
    check('a recipe published as nothing but a heading and a list is read out of the page itself',
      article && article.title === 'Pumpkin Blondies'
      && article.ing.length === 4 && article.ing[1] === '½ cup pumpkin purée'
      && article.steps.length === 2 && /Keeps five days/.test(article.steps.join(' ')) === false, article);
    check('and one Ingredients heading with nothing under it is not a recipe',
      parseRecipeHtml('<h2>Ingredients</h2><p>Coming soon.</p>', 'https://c.example/x') === null
      && parseRecipeHtml('<h2>Ingredients</h2><ul><li>love</li></ul>', 'https://c.example/x') === null);
    {
      /* the article reader runs on pages someone else wrote, so it is bounded too */
      const t0 = Date.now();
      parseRecipeHtml('<h2>'.repeat(200000).slice(0, 1500000), 'https://c.example/x');
      parseRecipeHtml('<h2>Ingredients</h2><ul>' + '<li>'.repeat(300000).slice(0, 1400000), 'https://c.example/x');
      const ms = Date.now() - t0;
      check('and a page of unclosed tags does not make reading it expensive', ms < 2000, ms + 'ms');
    }

    /* the one thing on this site that fetches an address someone else chose */
    const refused = {};
    for (const u of ['http://example.com/r', 'https://127.0.0.1/r', 'https://10.0.0.5/r', 'https://[::1]/r',
                     'https://localhost/r', 'https://box.internal/r', 'https://example.com:8080/r',
                     'https://0x7f000001/r', 'https://2130706433/r', 'file:///etc/passwd', 'not-a-url'])
      refused[u] = !!(await publicUrl(u)).error;
    check('the page reader refuses anything but a named host on the public web over https',
      Object.values(refused).every(Boolean), refused);
    /* the filter reads addresses as bytes, so a private one in a costume is still private */
    const inCostume = {};
    for (const [label, addr] of [['loopback', '127.0.0.1'], ['private', '10.1.2.3'], ['link-local', '169.254.169.254'],
      ['v4-mapped', '::ffff:127.0.0.1'], ['v4-compatible', '::127.0.0.1'], ['loopback v6', '::1'], ['unspecified', '::'],
      ['NAT64', '64:ff9b::7f00:1'], ['6to4 of loopback', '2002:7f00:1::'], ['v6 multicast', 'ff02::1'],
      ['unique local', 'fd00::1'], ['v6 link-local', 'fe80::1'], ['carrier NAT', '100.100.1.1'], ['nonsense', 'not-an-address']])
      inCostume[label] = privateAddress(addr);
    check('and reads an address as its bytes, so loopback wears no costume it does not see through',
      Object.values(inCostume).every(Boolean)
      && !privateAddress('93.184.216.34') && !privateAddress('2606:2800:220:1:248:1893:25c8:1946'), inCostume);

    /* a page built to be expensive to read: the tag strippers used to scan to the end
       of the buffer from every unclosed "<", which cost a minute of CPU per request */
    {
      const nasty = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Recipe',
        name: '<script '.repeat(90000), recipeIngredient: ['1 cup oats'], recipeInstructions: '<'.repeat(400000) }) + '</script>';
      const t0 = Date.now(); parseRecipeHtml(nasty, 'https://a.example/x'); const ms = Date.now() - t0;
      check('a page written to be expensive to read is read in a moment anyway', ms < 2000, ms + 'ms');
    }

    const post = (body, method = 'POST', headers = {}) => recipeHandler(new Request('http://localhost/api/recipe',
      { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body) }));
    check('the reader answers nothing but a POST', (await post({}, 'GET')).status === 404);
    /* the one thing here that fetches an address someone else chose is not left open to
       the internet, and that is also what keeps the promise that signed out, nothing typed
       into the app leaves the phone */
    check('and refuses a stranger outright, whatever they ask for',
      (await post({ url: 'https://example.com/r' })).status === 401 && (await post({})).status === 401);
    {
      const cookie = `${authCookieName}=${recipeSession}`;
      check('signed in, it asks for an address when none came', (await post({}, 'POST', { cookie })).status === 400);
      const plain = await post({ url: 'http://example.com/recipe' }, 'POST', { cookie });
      check('and says so, in words a parent can act on, when the address is not one it will open',
        plain.status === 422 && /https/.test((await plain.json()).error));
      const huge = await recipeHandler(new Request('http://localhost/api/recipe',
        { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: 'x'.repeat(4000) }));
      check('and a body too big to be an address is refused before it is parsed', huge.status === 400);
      const shapes = await Promise.all(['https://127.0.0.1/r', 'https://10.0.0.5/r'].map(u => post({ url: u }, 'POST', { cookie }).then(r => r.status)));
      const worded = await Promise.all(['https://127.0.0.1/r', 'https://10.0.0.5/r'].map(u => post({ url: u }, 'POST', { cookie }).then(r => r.json()).then(j => j.error)));
      check('and every way a page can fail to give up a recipe answers in the same words, so the reader is not a map of someone else\u2019s network',
        shapes.every(x => x === 422) && worded[0] === worded[1], worded);
    }
  }
  {
    const ctxR2 = await phone();
    const pr2 = await ctxR2.newPage(); pr2.on('pageerror', e => errors.push(String(e.message)));
    /* the address of a recipe page, answered from here, so the suite never leaves the machine */
    await ctxR2.route('**/api/recipe', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recipe: {
      title: 'Lemony Quinoa Salad', m: 30, y: 4,
      ing: ['1 cup quinoa', '2 cups water', '4 oz feta cheese, crumbled', '1/2 tsp salt'],
      steps: ['Rinse the quinoa.', 'Simmer it for 20 minutes.', 'Toss it with the feta.'],
      src: 'a-blog.example', url: 'https://a-blog.example/quinoa' } }) }));
    await pr2.goto(BASE + '/app/'); await pr2.waitForTimeout(400);
    await pr2.fill('#obName', 'Wren'); await pr2.click('[data-act="ob-go"]'); await pr2.waitForTimeout(500);
    const later2 = await pr2.$('[data-act="ob-later"]'); if (later2) { await later2.click(); await pr2.waitForTimeout(350); }
    await pr2.click('[data-act="tab"][data-tab="foods"]'); await pr2.waitForTimeout(300);
    const cooking = () => pr2.textContent('#sheetBody');
    const openRow = async (name) => {
      const h = await pr2.evaluateHandle(n => [...document.querySelectorAll('[data-act="food-open"]')].find(b => b.textContent.includes(n)), name);
      const el = h.asElement(); if (!el) return false;
      await el.click(); await pr2.waitForTimeout(300); return true;
    };
    const addIdea = async (name) => {
      await pr2.click('[data-act="ideas"]'); await pr2.waitForTimeout(300);
      await pr2.click(`[data-act="add-idea"][data-name="${name}"]`); await pr2.waitForTimeout(300);
      await sheetDone(pr2); await pr2.waitForTimeout(250);
    };

    /* ---- the idea bank's own recipes, free like the rest of the bank */
    await addIdea('Mediterranean quinoa salad');
    check('a food from the idea bank that has to be cooked says so on the list',
      await pr2.$$eval('[data-act="food-open"]', a => a.some(b => /Mediterranean quinoa salad/.test(b.textContent) && /Recipe/.test(b.textContent))));
    check('and opening it offers the recipe rather than sending a parent out of the app to find one',
      (await openRow('Mediterranean quinoa salad')) && (await pr2.$$eval('[data-act="cook"]', a => a.length)) === 1);
    await pr2.click('[data-act="cook"]'); await pr2.waitForTimeout(300);
    check('the recipe opens with what to buy, what to do, and how long it takes',
      /35 minutes, plus 2 hours chilling/.test(await cooking()) && /makes 6 lunches/.test(await cooking())
      && /1 cup quinoa/.test(await cooking()) && /Rinse the quinoa/.test(await cooking()), (await cooking()).slice(0, 140));
    check('and the way in is at the top, not under a screen and a half of ingredients',
      await pr2.evaluate(() => {
        const b = document.querySelector('#sheetBody [data-act="cook-step"][data-i="0"]');
        const list = document.querySelector('#sheetBody .list'), body = document.querySelector('#sheetBody');
        if (!b || !list) return false;
        const top = b.getBoundingClientRect().top - body.getBoundingClientRect().top;
        return top < list.getBoundingClientRect().top - body.getBoundingClientRect().top && top < body.clientHeight;
      }));
    check('and the waiting is in the head and in the first step, not sprung at the end',
      /Start this the evening before/.test(await cooking())
      && (await cooking()).indexOf('Start this the evening before') < (await cooking()).indexOf('Rinse the quinoa'));
    check('and it says whose recipe it is, with the original a tap away on a control big enough to hit',
      /From USDA Recipes for Healthy Kids/.test(await cooking())
      && await pr2.$$eval('#sheetBody a.btn, #sheetBody button.btn[data-act="recipe-site"]', a =>
           a.length === 1 && /fna\.usda\.gov/.test(a[0].getAttribute('href') || a[0].getAttribute('data-url') || '')
           && a[0].getBoundingClientRect().height >= 44),
      (await cooking()).slice(-160));
    await pr2.click('[data-act="cook-tick"][data-i="0"]'); await pr2.waitForTimeout(250);
    check('an ingredient ticks off as it goes in, so a parent interrupted mid-recipe knows where they were',
      (await pr2.$$eval('[data-act="cook-tick"][data-i="0"]', a => a[0].className)).includes('done'));

    /* ---- the measures */
    await pr2.click('[data-act="cook-units"][data-v="metric"]'); await pr2.waitForTimeout(250);
    const metric = await cooking();
    check('in grams, a cup of quinoa is weighed, broth is poured, a spoon of salt stays a spoon, and a cup of tomatoes stays a cup',
      /170 g quinoa/.test(metric) && /470 ml low-sodium vegetable broth/.test(metric) && /½ tsp salt/.test(metric)
      && /½ cup cherry tomatoes/.test(metric), metric.slice(0, 200));
    await pr2.click('[data-act="cook-makes"][data-v="1"]'); await pr2.waitForTimeout(250);
    check('asking for one more lunch scales every amount and says how many it is making now',
      /7 lunches/.test(await cooking()) && /195 g quinoa/.test(await cooking()));
    await pr2.click('[data-act="cook-makes"][data-v="-1"]'); await pr2.waitForTimeout(200);
    await sheetDone(pr2); await pr2.waitForTimeout(200);

    /* ---- the walk through */
    await openRow('Mediterranean quinoa salad'); await pr2.click('[data-act="cook"]'); await pr2.waitForTimeout(300);
    await pr2.click('[data-act="cook-units"][data-v="us"]'); await pr2.waitForTimeout(250);
    for (const n of [0, 1]) { await pr2.click(`[data-act="cook-step"][data-i="${n}"]`); await pr2.waitForTimeout(250); }
    check('cooking it step by step shows one step, says where it has got to, and keeps the ingredients within reach',
      /Step 2 of 7/.test(await cooking()) && /Rinse the quinoa/.test(await cooking())
      && (await pr2.$$eval('[data-act="cook-step"][data-i="2"]', a => a.length)) === 1
      && (await pr2.$$eval('.prog', a => a.length)) === 1);
    await pr2.click('[data-act="cook-step"][data-i="2"]'); await pr2.waitForTimeout(250);
    check('and it goes on and back a step at a time', /Step 3 of 7/.test(await cooking())
      && (await pr2.$$eval('[data-act="cook-step"][data-i="1"]', a => a.length)) === 1);
    /* the amounts belong beside the step that calls for them, not three taps back */
    check('a step carries the amount of everything it names, and nothing it does not',
      (await pr2.$$eval('ul.steping li', a => a.map(b => b.textContent))).join('|') === '1 cup quinoa|2 cups low-sodium vegetable broth',
      await pr2.$$eval('ul.steping li', a => a.map(b => b.textContent)));
    /* an ingredient is claimed by the step that names it and not read into the others:
       the dressing step takes the white pepper, the vegetable step the red bell pepper */
    for (const n of [3, 4]) { await pr2.click(`[data-act="cook-step"][data-i="${n}"]`); await pr2.waitForTimeout(250); }
    const dressing = await pr2.$$eval('ul.steping li', a => a.map(b => b.textContent));
    check('a word two ingredients share goes to the one the step actually means',
      dressing.some(t => /ground white pepper/.test(t)) && !dressing.some(t => /red bell pepper/.test(t))
      && !dressing.some(t => /olives/.test(t)), dressing);
    await pr2.click('[data-act="cook-step"][data-i="5"]'); await pr2.waitForTimeout(250);
    const veg = await pr2.$$eval('ul.steping li', a => a.map(b => b.textContent));
    check('and the step that means the other one gets it, with no leftovers from the first',
      veg.some(t => /red bell pepper/.test(t)) && veg.some(t => /black olives/.test(t))
      && !veg.some(t => /white pepper/.test(t)), veg);
    /* the step view moves a step at a time, so walk back to the one that calls for nothing */
    for (const n of [4, 3]) { await pr2.click(`[data-act="cook-step"][data-i="${n}"]`); await pr2.waitForTimeout(250); }
    check('and a step that calls for nothing carries no amounts at all',
      /Step 4 of 7/.test(await cooking()) && (await pr2.$$eval('ul.steping li', a => a.length)) === 0,
      await pr2.textContent('.cookstep'));
    /* the button at the top is the obvious one to tap coming back, so it must not be the
       one that starts the pan again */
    await pr2.click('[data-act="cook-step"][data-i="-1"]'); await pr2.waitForTimeout(250);
    check('stepping out to re-read something offers the step it was left on, with starting over underneath',
      /Back to step 4/.test(await cooking())
      && (await pr2.$$eval('#sheetBody [data-act="cook-step"][data-i="3"]', a => a.length)) === 1
      && (await pr2.$$eval('#sheetBody [data-act="cook-step"][data-i="0"]', a => a.length)) === 1,
      (await cooking()).slice(0, 120));
    await pr2.click('[data-act="cook-step"][data-i="3"]'); await pr2.waitForTimeout(250);
    check('and taking it puts the parent back where the pan was', /Step 4 of 7/.test(await cooking()));
    for (const n of [2, 1, 0, -1]) { await pr2.click(`[data-act="cook-step"][data-i="${n}"]`); await pr2.waitForTimeout(250); }
    await pr2.click('[data-act="cook-units"][data-v="metric"]'); await pr2.waitForTimeout(250);
    for (const n of [0, 1, 2]) { await pr2.click(`[data-act="cook-step"][data-i="${n}"]`); await pr2.waitForTimeout(250); }
    check('and they are in the measures and the quantity the parent chose, like every other amount',
      (await pr2.$$eval('ul.steping li', a => a.map(b => b.textContent))).join('|') === '170 g quinoa|470 ml low-sodium vegetable broth',
      await pr2.$$eval('ul.steping li', a => a.map(b => b.textContent)));
    await pr2.click('[data-act="cook-step"][data-i="-1"]'); await pr2.waitForTimeout(250);
    await pr2.click('[data-act="cook-units"][data-v="us"]'); await pr2.waitForTimeout(250);

    /* the box is where a parent is standing: on the step, not three taps back on the
       overview — and the step and the folded whole list are two views of one tick */
    await pr2.click('[data-act="cook-step"][data-i="2"]'); await pr2.waitForTimeout(250);
    check('the amounts under a step each carry a box to check off, at a size a floury thumb can hit',
      await pr2.$$eval('ul.steping .item', a => a.length > 0
        && a.every(b => b.getAttribute('data-act') === 'cook-tick'
          && b.querySelector('.box') && b.getBoundingClientRect().height >= 44)),
      await pr2.$$eval('ul.steping .item', a => a.map(b => b.getBoundingClientRect().height)));
    check('and the step lists only what that step needs, not the whole recipe over again',
      (await pr2.$$eval('ul.steping .item', a => a.length)) === 2
      && (await pr2.$$eval('#sheetBody .list .item, #sheetBody details', a => a.length)) === 0,
      await pr2.$$eval('ul.steping .item', a => a.map(b => b.textContent.trim())));
    const stepTi = await pr2.$$eval('ul.steping .item', a => a[0].getAttribute('data-ti'));
    await pr2.click('ul.steping .item'); await pr2.waitForTimeout(250);
    /* struck where it stands: the row repaints itself rather than the step being rebuilt,
       which is what keeps the scroll and stops the step being read out again mid-tick */
    check('the row strikes through where it was tapped, without the step being rebuilt',
      await pr2.$$eval('ul.steping .item', a => a[0].className.includes('done')
        && a[0].getAttribute('aria-pressed') === 'true'),
      await pr2.$$eval('ul.steping .item', a => a[0].getAttribute('aria-pressed')));
    await pr2.click('[data-act="cook-step"][data-i="-1"]'); await pr2.waitForTimeout(250);
    check('ticking it in the step is the same tick the whole recipe shows',
      await pr2.$eval(`.list .item[data-ti~="${stepTi.split(' ')[0]}"]`, e => e.className.includes('done')), stepTi);
    /* a step that names nothing offers nothing: no heading, no empty list */
    for (const n of [0, 1, 2, 3]) { await pr2.click(`[data-act="cook-step"][data-i="${n}"]`); await pr2.waitForTimeout(250); }
    check('a step that calls for none of the ingredients shows no list and no heading for one',
      (await pr2.$$eval('ul.steping .item', a => a.length)) === 0
      && !/What you need/.test(await cooking()));
    await pr2.click('[data-act="cook-step"][data-i="-1"]'); await pr2.waitForTimeout(250);
    await sheetDone(pr2); await pr2.waitForTimeout(250);

    /* the other one the app ships, which nothing else in the suite exercises: its own
       shopping line, its own allergen, and the warning that decides which evening */
    await addIdea('Bean & avocado wrap');
    check('the second recipe the app ships is on the list with what to buy for it',
      await pr2.$$eval('[data-act="food-open"]', a => a.some(b => /Bean &amp; avocado wrap/.test(b.innerHTML)
        && /White beans/.test(b.textContent) && /Recipe/.test(b.textContent))),
      await pr2.$$eval('[data-act="food-open"]', a => a.map(b => b.textContent).filter(t => /avocado wrap/.test(t))));
    await openRow('Bean & avocado wrap'); await pr2.click('[data-act="cook"]'); await pr2.waitForTimeout(300);
    check('and it says up front that it is a morning job, before a parent rolls six of them',
      /20 minutes/.test(await cooking()) && /makes 6 lunches/.test(await cooking())
      && /Make these the morning they are eaten/.test(await cooking())
      && /From USDA Recipes for Healthy Kids/.test(await cooking()), (await cooking()).slice(0, 160));
    /* scaled to one lunch, an eighth of a teaspoon must not round away to none */
    for (let i = 0; i < 5; i++) { await pr2.click('[data-act="cook-makes"][data-v="-1"]'); await pr2.waitForTimeout(200); }
    const one = await pr2.$$eval('#sheetBody .item .nm', a => a.map(b => b.textContent.trim()));
    check('and cut to one lunch it still asks for a measurable amount of everything, never none',
      /1 lunch\+/.test(await cooking()) && one.length === 11 && !one.some(t => /(^|\s)0(\.\d+)?(\s|$)/.test(t)),
      (await cooking()).slice(0, 60) + ' || ' + one.join(' / '));
    await sheetDone(pr2); await pr2.waitForTimeout(250);

    check('none of the cooking is written into the household: a half-made recipe is not something the other phone needs',
      await pr2.evaluate(() => !/"ticked"|"step":/.test(localStorage.getItem('lunchsorted') || '')));
    check('the phone remembers which measures this kitchen works in',
      await pr2.evaluate(() => localStorage.getItem('lunchsorted-units')) === 'us');

    /* ---- the recipe where a parent is actually standing: the box being packed */
    const today0 = await pr2.evaluate(() => { const n = new Date(), p = x => String(x).padStart(2, '0');
      return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()); });
    await pr2.click('[data-act="tab"][data-tab="week"]'); await pr2.waitForTimeout(350);
    await pr2.click(`[data-act="slot"][data-day="${today0}"][data-cat="main"]`); await pr2.waitForTimeout(350);
    check('the compartment sheet offers at most the one recipe for what is in the compartment',
      (await pr2.$$eval('[data-act="cook"]', a => a.length)) <= 1);
    const quinoaId = await pr2.$$eval('[data-act="pick"]', a => {
      const hit = a.find(b => /Mediterranean quinoa salad/.test(b.textContent)); return hit && hit.getAttribute('data-id'); });
    await pr2.click(`[data-act="pick"][data-id="${quinoaId}"]`); await pr2.waitForTimeout(400);
    await pr2.click(`[data-act="slot"][data-day="${today0}"][data-cat="main"]`); await pr2.waitForTimeout(350);
    check('and once a dish that has to be cooked is in it, the recipe is one tap from the week',
      (await pr2.$$eval('[data-act="cook"]', a => a.map(b => b.getAttribute('data-id')))).includes(quinoaId));
    await sheetDone(pr2); await pr2.waitForTimeout(200);
    await pr2.click('[data-act="tab"][data-tab="pack"]'); await pr2.waitForTimeout(350);
    check('and the pack list names what in this box gets made, so the recipe waits in the kitchen',
      /Making it\?/.test(await pr2.textContent('#view'))
      && (await pr2.$$eval('#view [data-act="cook"]', a => a.map(b => b.textContent))).some(t => /Mediterranean quinoa salad/.test(t)));
    /* ---- reading one off a page needs a sign-in, because that is the only part that leaves the phone */
    await pr2.click('[data-act="tab"][data-tab="recipes"]'); await pr2.waitForTimeout(350);
    await pr2.click('[data-act="recipe-import"]'); await pr2.waitForTimeout(300);
    check('signed out, the app does not offer to send an address anywhere, and says why',
      (await pr2.$$eval('#riUrl', a => a.length)) === 0
      && (await pr2.$$eval('#riText', a => a.length)) === 1
      && /nothing you type here leaves the phone/.test(await pr2.textContent('#sheetBody')));

    /* ---- and pasted in, which is the only thing that works for a video.
       A recipe is kept for its own sake: it goes into the household's library, and
       putting it on a lunchbox's food list is a separate thing, offered afterwards. */
    await pr2.fill('#riText', 'EASY TURKEY PINWHEELS — my kids ask for these every week!!\n'
      + 'Serves 4\nPrep 10 minutes\n4 large tortillas\n3 tbsp cream cheese\n8 slices deli turkey\n'
      + '1. Spread the cream cheese right to the edge of each tortilla.\n'
      + '2. Warm them at 375F for 5 minutes if that is how they like them, then chill 20 minutes before slicing.');
    await pr2.click('[data-act="recipe-paste"]'); await pr2.waitForTimeout(400);
    check('a caption copied from under a video is read the same way, with the shouting and the aside taken off the name',
      (await pr2.inputValue('#rsName')) === 'Easy turkey pinwheels'
      && /3 ingredients · 2 steps/.test(await pr2.textContent('#sheetBody')), await pr2.inputValue('#rsName'));
    check('and a numbered step that mentions a time is a step, not the time the recipe takes',
      /10 minutes · makes 4 servings/.test(await pr2.textContent('#sheetBody')), await pr2.textContent('#sheetBody'));
    await pr2.click('[data-act="recipe-save"]'); await pr2.waitForTimeout(500);
    const kept = await pr2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted'));
      return { lib: (d.recipes || []).map(r => ({ n: r.n, ing: r.ing.length, steps: r.steps.length, y: r.y, m: r.m, id: /^rec_/.test(r.id) })),
        foods: d.kids.flatMap(k => k.foods).filter(f => f.recipeId).length };
    });
    check('it is kept on the household, with an id of its own, and nothing is put on a food list uninvited',
      kept.lib.length === 1 && kept.lib[0].n === 'Easy turkey pinwheels' && kept.lib[0].ing === 3
      && kept.lib[0].steps === 2 && kept.lib[0].y === 4 && kept.lib[0].m === 10 && kept.lib[0].id
      && kept.foods === 0, kept);
    check('and the food list is offered next rather than assumed',
      /Put it on a food list too/.test(await pr2.textContent('#sheetBody'))
      && (await pr2.$$eval('[data-act="recipe-to-food"]', a => a.length)) === 1);
    await pr2.click('[data-act="recipe-to-food"]'); await pr2.waitForTimeout(400);
    check('and taking that offer prefills the food, guesses and all, pointing at the recipe rather than copying it',
      (await pr2.inputValue('#nfName')) === 'Easy turkey pinwheels'
      && /Deli turkey/.test(await pr2.inputValue('#nfBuy'))
      && (await pr2.$$eval('#nfAl .tg[aria-pressed="true"]', a => a.map(b => b.getAttribute('data-v')))).includes('dairy'),
      await pr2.inputValue('#nfBuy'));
    await pr2.click('[data-act="save-own"]'); await pr2.waitForTimeout(500);
    const linked = await pr2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const r = (d.recipes || [])[0], f = d.kids.flatMap(k => k.foods).filter(x => x.n === 'Easy turkey pinwheels');
      return { n: f.length, pointing: f.every(x => x.recipeId === r.id), copies: f.filter(x => x.recipe).length };
    });
    check('a food points at the recipe rather than carrying a copy of it, in every lunchbox it went into',
      linked.n >= 1 && linked.pointing && linked.copies === 0, linked);

    /* ---- the tab it all lives on, which is not per-lunchbox */
    await pr2.click('[data-act="tab"][data-tab="recipes"]'); await pr2.waitForTimeout(400);
    check('the Recipes tab is on the bottom bar, with the household’s own above the two the app ships',
      (await pr2.$$eval('nav.tabs [data-tab="recipes"]', a => a.length)) === 1
      && /Yours/.test(await pr2.textContent('#view'))
      && /Comes with the app/.test(await pr2.textContent('#view'))
      && (await pr2.textContent('#view')).indexOf('Yours') < (await pr2.textContent('#view')).indexOf('Comes with the app'));
    const barOK = () => pr2.evaluate(() => {
      const bar = document.querySelector('nav.tabs');
      const fits = [...bar.children].every(b => {
        const r = b.getBoundingClientRect(), s = b.querySelector('span');
        return r.width >= 44 && r.height >= 44 && s.scrollWidth <= s.clientWidth + 0.5;
      });
      return fits && bar.scrollWidth <= bar.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth;
    });
    check('and every tab on the bar is big enough to hit, with no label clipped and nothing off the edge', await barOK());
    await pr2.setViewportSize({ width: 320, height: 568 }); await pr2.waitForTimeout(300);
    check('and it holds on the narrowest phone anyone carries, which is what a sixth tab put at risk', await barOK());
    await pr2.setViewportSize({ width: 375, height: 812 }); await pr2.waitForTimeout(300);
    check('a recipe of the household\u2019s own says where it is used; the bank\u2019s say they are the bank\u2019s',
      /Easy turkey pinwheels/.test(await pr2.textContent('#view'))
      && /on the food list/.test(await pr2.textContent('#view'))
      && (await pr2.$$eval('[data-act="cook-recipe"]', a => a.length)) >= 3);
    check('a short list carries no search box to ignore, and no dashed panel saying nothing is there',
      (await pr2.$$eval('#rqFind', a => a.length)) === 0
      && (await pr2.$$eval('#view .empty', a => a.length)) === 0);
    await pr2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted')), t = new Date().toISOString();
      for (let i = 1; i <= 6; i++) d.recipes.push({ id: 'rec_fill' + i, n: 'Filler ' + i, m: 10, y: 4,
        ing: ['1 cup rolled oats'], steps: ['Stir it.'], src: '', url: null, createdAt: t, updatedAt: t, deletedAt: null });
      localStorage.setItem('lunchsorted', JSON.stringify(d));
    });
    await pr2.reload(); await pr2.waitForTimeout(600);
    await pr2.click('[data-act="tab"][data-tab="recipes"]'); await pr2.waitForTimeout(400);
    check('and it arrives once the list is longer than a screen',
      (await pr2.$$eval('#rqFind', a => a.length)) === 1
      && (await pr2.$$eval('[data-act="cook-recipe"]', a => a.length)) === 9);
    /* once it is on screen it stays for the visit: removing a recipe must not pull the
       list 64px up from under the thumb that is reaching for Undo */
    for (let i = 0; i < 2; i++) {
      const row = await pr2.evaluateHandle(() => [...document.querySelectorAll('[data-act="cook-recipe"]')].find(b => /Filler/.test(b.textContent)));
      await row.asElement().click(); await pr2.waitForTimeout(350);
      await pr2.click('[data-act="recipe-delete"]'); await pr2.waitForTimeout(450);
    }
    check('and once shown it stays, so removing one does not move the list out from under a thumb',
      (await pr2.$$eval('#rqFind', a => a.length)) === 1
      && (await pr2.$$eval('[data-act="cook-recipe"]', a => a.length)) === 7);
    await pr2.fill('#rqFind', 'quinoa'); await pr2.waitForTimeout(350);
    check('the search finds a recipe by name and keeps the keyboard where it was',
      (await pr2.$$eval('[data-act="cook-recipe"] .nm', a => a.map(b => b.textContent))).join('|').includes('Mediterranean quinoa salad')
      && (await pr2.$$eval('[data-act="cook-recipe"]', a => a.length)) === 1
      && await pr2.evaluate(() => document.activeElement && document.activeElement.id === 'rqFind'));
    await pr2.fill('#rqFind', 'lemon'); await pr2.waitForTimeout(350);
    check('and by an ingredient, which is how a parent shops the cupboard',
      (await pr2.$$eval('[data-act="cook-recipe"] .nm', a => a.map(b => b.textContent.trim())))
        .sort().join('|') === 'Bean & avocado wrap|Mediterranean quinoa salad',
      await pr2.$$eval('[data-act="cook-recipe"] .nm', a => a.map(b => b.textContent.trim())));
    await pr2.click('[data-act="tab"][data-tab="pack"]'); await pr2.waitForTimeout(300);
    await pr2.click('[data-act="tab"][data-tab="recipes"]'); await pr2.waitForTimeout(400);
    check('leaving the tab clears the search, so nobody comes back to a list that looks half empty',
      (await pr2.$$eval('[data-act="cook-recipe"]', a => a.length)) === 7
      && (await pr2.$$eval('#rqFind[value=""], #rqFind:not([value])', a => a.length))
         === (await pr2.$$eval('#rqFind', a => a.length)));
    check('and the field goes back to arriving with the list that needs it, rather than staying for good',
      (await pr2.$$eval('#rqFind', a => a.length)) === 0);
    await pr2.click('[data-act="cook-recipe"]'); await pr2.waitForTimeout(400);
    check('and a recipe opens to be cooked straight from the tab, with no food list involved',
      /What you need/.test(await pr2.textContent('#sheetBody'))
      && (await pr2.textContent('#sheetTitle')).length > 0);
    /* a step is read where it is followed, so the oven is given in the scale this
       kitchen works in — on a recipe brought in, which is where an oven lives now */
    await pr2.click('[data-act="cook-units"][data-v="metric"]'); await pr2.waitForTimeout(250);
    check('and an oven set in Fahrenheit carries its Celsius once the kitchen works in grams',
      /375F \(190°C\)/.test(await pr2.textContent('#sheetBody')), (await pr2.textContent('#sheetBody')).slice(0, 240));
    await pr2.click('[data-act="cook-units"][data-v="us"]'); await pr2.waitForTimeout(250);
    check('while in cups it is left exactly as the recipe wrote it',
      !/190°C/.test(await pr2.textContent('#sheetBody')));
    await sheetDone(pr2); await pr2.waitForTimeout(250);

    /* ---- a recipe is data from outside, like everything else. The shape v17 wrote —
       a recipe on the food — is carried forward into the library rather than dropped,
       and everything about it is rebuilt from the whitelist on the way. */
    await pr2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const ks = d.kids.filter(x => !x.deletedAt), k = ks[0];
      const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
        kidId: k.id, c: 'main', a: 'other', t: [], al: [], buy: null };
      const legacy = { m: 40, y: 12, ing: ['1 cup oats', '2 tbsp honey'], steps: ['Stir it.', 'Bake it.'], src: 'old.example', url: null };
      /* a second lunchbox, so "once, however many boxes held it" is actually exercised */
      const two = JSON.parse(JSON.stringify(k));
      two.id = 'kid_second'; two.name = 'Sam'; two.week = null; two.next = null;
      two.foods = two.foods.map(f => ({ ...f, id: f.id.replace(/^food_/, 'food_s'), kidId: two.id }));
      d.kids.push(two);
      k.foods.push({ id: 'food_leg1', n: 'Legacy bars', ...stamp, recipe: legacy });
      two.foods.push({ id: 'food_leg2', n: 'Legacy bars', ...stamp, kidId: two.id, recipe: legacy });
      /* and a food normFood will refuse, sitting ahead of a good one: pairing by position
         would marry this recipe to the wrong food, and its ingredient list with it */
      k.foods.unshift({ id: 'food_bogus', n: 'Peanut bars', ...stamp, c: 'NOT_A_COMPARTMENT',
        recipe: { m: 5, y: 4, ing: ['2 cups peanut butter'], steps: ['Stir.'], src: '', url: null } });
      k.foods.push({ id: 'food_hostile', n: 'Sneaky salad', ...stamp, recipe: {
        ing: ['1 cup oats'], steps: ['Stir it <img src=x onerror="window.__ls_bad=1"> well.'],
        url: 'javascript:window.__ls_bad=1', src: 'x'.repeat(300), m: 1e9, y: -4, l: 1 } });
      k.foods.push({ id: 'food_empty', n: 'Nothing salad', ...stamp, recipe: { ing: [], steps: [] } });
      k.foods.push({ id: 'food_silly', n: 'Silly salad', ...stamp, recipe: 'not a recipe' });
      localStorage.setItem('lunchsorted', JSON.stringify(d));
    });
    await pr2.goto(BASE + '/app/'); await pr2.waitForTimeout(600);
    const lifted = await pr2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const bars = (d.recipes || []).filter(r => r.n === 'Legacy bars');
      const pointing = d.kids.flatMap(k => k.foods).filter(f => f.n === 'Legacy bars');
      const bad = (d.recipes || []).find(r => r.n === 'Sneaky salad');
      const wrong = (d.recipes || []).filter(r => (r.ing || []).some(l => /peanut/i.test(l)));
      return { bars: bars.length, ing: bars[0] && bars[0].ing.length, id: bars[0] && /^rec_/.test(bars[0].id), wrong: wrong.map(r => r.n),
        pointing: pointing.length, allPoint: pointing.length > 0 && pointing.every(f => f.recipeId === (bars[0] || {}).id),
        copies: d.kids.flatMap(k => k.foods).filter(f => f.recipe).length,
        badUrl: bad && bad.url, badSrc: bad && bad.src.length, badM: bad && bad.m, badY: bad && bad.y, badL: bad && bad.l,
        empties: (d.recipes || []).filter(r => r.n === 'Nothing salad' || r.n === 'Silly salad').length };
    });
    check('a recipe written the old way, on the food, is carried into the library — once, however many lunchboxes held it',
      lifted.bars === 1 && lifted.ing === 2 && lifted.id && lifted.pointing === 2 && lifted.allPoint && lifted.copies === 0, lifted);
    check('and a food the app cannot read takes its recipe with it, rather than handing the ingredients to the food after it',
      lifted.wrong.length === 0, lifted.wrong);
    /* The lift runs on every document this phone normalises — its own, and the server's
       on every pull. A random id would mean two phones lifting the same v17 document
       minted two ids for one recipe, and a union keyed on id would keep both forever. */
    const firstId = await pr2.evaluate(() => (JSON.parse(localStorage.getItem('lunchsorted')).recipes || []).find(r => r.n === 'Legacy bars').id);
    await pr2.goto(BASE + '/app/'); await pr2.waitForTimeout(600);
    const afterAgain = await pr2.evaluate(() => (JSON.parse(localStorage.getItem('lunchsorted')).recipes || []).filter(r => r.n === 'Legacy bars').map(r => r.id));
    check('and lifting the same document again works out the same id, so two phones do not end up with two copies',
      afterAgain.length === 1 && afterAgain[0] === firstId, { first: firstId, now: afterAgain });
    check('and is rebuilt from the whitelist on the way in: no address it cannot open, no nonsense numbers, and it cannot claim to be one of ours',
      lifted.badUrl === null && lifted.badSrc <= 60 && lifted.badM === 0 && lifted.badY === 0 && !lifted.badL, lifted);
    check('a recipe with nothing in it, or one that is not a recipe at all, is not carried anywhere', lifted.empties === 0, lifted);

    await pr2.click('[data-act="tab"][data-tab="recipes"]'); await pr2.waitForTimeout(400);
    check('the lifted recipe is on the tab, under the household\u2019s own',
      /Legacy bars/.test(await pr2.textContent('#view')));
    const hostileRow = await pr2.evaluateHandle(() => [...document.querySelectorAll('[data-act="cook-recipe"]')].find(b => /Sneaky salad/.test(b.textContent)));
    await hostileRow.asElement().click(); await pr2.waitForTimeout(400);
    const hostile = await pr2.textContent('#sheetBody');
    check('and a recipe that arrives from outside is put on screen as the words it is, never as markup or as a link the app would follow',
      /Stir it <img src=x onerror/.test(hostile)
      && (await pr2.$$eval('#sheetBody img, #sheetBody a[href^="javascript"]', a => a.length)) === 0
      && await pr2.evaluate(() => !window.__ls_bad) && !/-4|16666/.test(hostile), hostile.slice(0, 160));
    await sheetDone(pr2); await pr2.waitForTimeout(200);

    /* ---- removing one from the library, and what that leaves behind */
    /* the bank's recipes are nobody's to remove, so the button is not on them */
    const bankRow = await pr2.evaluateHandle(() => [...document.querySelectorAll('[data-act="cook-recipe"]')].find(b => !b.getAttribute('data-id')));
    await bankRow.asElement().click(); await pr2.waitForTimeout(350);
    check('and the idea bank\u2019s recipes carry no Remove, because they were never the household\u2019s to lose',
      (await pr2.$$eval('[data-act="recipe-delete"]', a => a.length)) === 0);
    await sheetDone(pr2); await pr2.waitForTimeout(200);
    const barsAgain = await pr2.evaluateHandle(() => [...document.querySelectorAll('[data-act="cook-recipe"]')].find(b => /Legacy bars/.test(b.textContent)));
    await barsAgain.asElement().click(); await pr2.waitForTimeout(400);
    check('a recipe of the household\u2019s own can be removed from where it is read, and the idea bank\u2019s cannot',
      (await pr2.$$eval('[data-act="recipe-delete"]', a => a.length)) === 1
      && (await pr2.evaluate(() => {
           const b = document.querySelector('[data-act="recipe-delete"]');
           return b.getBoundingClientRect().height >= 44;
         })));
    await pr2.click('[data-act="recipe-delete"]'); await pr2.waitForTimeout(400);
    const afterDelete = await pr2.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const r = (d.recipes || []).find(x => x.n === 'Legacy bars');
      return { tomb: !!(r && r.deletedAt), stillPointing: d.kids.flatMap(k => k.foods).filter(f => f.recipeId === (r || {}).id).length,
        foodStays: d.kids.flatMap(k => k.foods).filter(f => f.n === 'Legacy bars' && !f.deletedAt).length };
    });
    check('removing a recipe tombstones it, unhooks the foods that used it, and takes none of them off the list',
      afterDelete.tomb && afterDelete.stillPointing === 0 && afterDelete.foodStays >= 1, afterDelete);
    check('and the tombstone carries no text with it, so a removed recipe stops riding every sync',
      await pr2.evaluate(() => {
        const r = (JSON.parse(localStorage.getItem('lunchsorted')).recipes || []).find(x => x.n === 'Legacy bars');
        return r && r.deletedAt && r.ing.length === 0 && r.steps.length === 0;
      }));
    await pr2.click('[data-act="undo"]'); await pr2.waitForTimeout(400);
    check('and Undo puts the recipe back with its steps, and hooks the foods up again',
      await pr2.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('lunchsorted'));
        const r = (d.recipes || []).find(x => x.n === 'Legacy bars');
        return !!r && !r.deletedAt && r.steps.length === 2
          && d.kids.flatMap(k => k.foods).some(f => f.recipeId === r.id);
      }));
    await ctxR2.close();
  }
  {
    /* signed in, the address of a page can be read. The session is made directly rather
       than driven through the sign-in screens, which have their own tests above; the
       reader itself is answered from here, so the suite never leaves the machine. */
    const ctxR3 = await phone();
    await ctxR3.addCookies([{ name: recipeCookieName, value: recipeSession, url: BASE }]);
    await ctxR3.route('**/api/recipe', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recipe: {
      title: 'Lemony Quinoa Salad', m: 30, y: 4,
      ing: ['1 cup quinoa', '2 cups water', '4 oz feta cheese, crumbled', '1/2 tsp salt'],
      steps: ['Rinse the quinoa.', 'Simmer it for 20 minutes.', 'Toss it with the feta.'],
      src: 'a-blog.example', url: 'https://a-blog.example/quinoa' } }) }));
    const pr3 = await ctxR3.newPage(); pr3.on('pageerror', e => errors.push(String(e.message)));
    await pr3.goto(BASE + '/app/'); await pr3.waitForTimeout(600);
    await pr3.fill('#obName', 'Rowan'); await pr3.click('[data-act="ob-go"]'); await pr3.waitForTimeout(600);
    for (const a of ['ob-later', 'ob-skip']) { const b = await pr3.$(`[data-act="${a}"]`); if (b) { await b.click(); await pr3.waitForTimeout(350); } }
    await pr3.click('[data-act="tab"][data-tab="recipes"]'); await pr3.waitForTimeout(400);
    await pr3.click('[data-act="recipe-import"]'); await pr3.waitForTimeout(350);
    check('signed in, the app offers to read a page', (await pr3.$$eval('#riUrl', a => a.length)) === 1);
    await pr3.fill('#riUrl', 'https://a-blog.example/quinoa');
    await pr3.click('[data-act="recipe-fetch"]'); await pr3.waitForTimeout(600);
    check('a recipe read off a page comes back to be named and kept, not pushed onto a food list',
      (await pr3.inputValue('#rsName')) === 'Lemony Quinoa Salad'
      && /from a-blog.example/.test(await pr3.textContent('#sheetBody')),
      await pr3.inputValue('#rsName'));
    await pr3.click('[data-act="recipe-save"]'); await pr3.waitForTimeout(500);
    const saved = await pr3.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted'));
      const r = (d.recipes || [])[0];
      return r && { n: r.n, ing: r.ing.length, steps: r.steps.length, src: r.src, url: r.url, l: r.l,
        foods: d.kids.flatMap(k => k.foods).filter(f => f.recipeId).length };
    });
    check('and it is kept with its steps and where it came from, and no food made for it yet',
      saved && saved.ing === 4 && saved.steps === 3 && saved.src === 'a-blog.example' && saved.foods === 0, saved);
    await pr3.click('[data-act="recipe-to-food"]'); await pr3.waitForTimeout(400);
    await pr3.click('[data-act="save-own"]'); await pr3.waitForTimeout(500);
    check('and once it is on a food list, the food points at it and the shopping line came with it',
      await pr3.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('lunchsorted'));
        const r = (d.recipes || [])[0], f = d.kids.flatMap(k => k.foods).find(x => x.n === 'Lemony Quinoa Salad');
        return !!f && f.recipeId === r.id && !f.recipe && f.buy.length > 1;
      }));
    await pr3.click('[data-act="tab"][data-tab="recipes"]'); await pr3.waitForTimeout(400);
    const own = await pr3.evaluateHandle(() => [...document.querySelectorAll('[data-act="cook-recipe"]')].find(b => /Lemony/.test(b.textContent)));
    await own.asElement().click(); await pr3.waitForTimeout(400);
    check('and it is counted in servings, not in lunches, because that is what its own page said',
      /makes 4 servings/.test(await pr3.textContent('#sheetBody')), await pr3.textContent('#sheetBody'));
    await sheetDone(pr3); await pr3.waitForTimeout(200);
    await ctxR3.close();
  }

  /* ------------------------------------------------------- pwa + offline */
  check('the service worker takes control',
    await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)));
  const mf = await page.evaluate(async () => (await (await fetch('/app/manifest.webmanifest')).json()));
  check('the manifest is installable', mf.display === 'standalone' && Array.isArray(mf.icons) && mf.icons.length >= 2);
  await page.waitForTimeout(600);
  await ctx.setOffline(true);
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(700);
  check('the app opens with no network', (await page.$$eval('.tin', a => a.length)) > 0);
  await ctx.setOffline(false);
  {
    /* a new build's worker taking control: the page reloads itself, but not while a sheet is open */
    await page.click('[data-act="help"]'); await page.waitForTimeout(300);
    await page.evaluate(() => { window.__stillHere = 1; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
    await page.waitForTimeout(2200);
    check('a new build taking control waits while a sheet is open', await page.evaluate(() => window.__stillHere === 1 && !!document.querySelector('.sheet.open')));
    await sheetDone(page);
    await page.waitForTimeout(2200);
    check('and while the parent is still moving about', await page.evaluate(() => window.__stillHere === 1));
    /* fifteen quiet seconds are more than the suite can spare: the quiet window is the page's own setting */
    await page.evaluate(() => { document.getElementById('toast').classList.remove('show'); window.__LS_QUIET_MS = 100; });
    const reloaded = await until(page, () => window.__stillHere !== 1, undefined, 20000);
    check('and reloads the page once nothing has been touched for a while, back on the same tab with the lunches still there and a word about it', reloaded && (await page.$$eval('.tin', a => a.length)) > 0 && await until(page, () => /Updated/.test(document.querySelector('#toast').textContent), undefined, 4000));
  }

  /* --------------------------------------------------------- the website */
  const site = await ctx.newPage();
  const siteErrors = [];
  site.on('pageerror', e => siteErrors.push(String(e.message)));
  /* a block the page's own policy refuses is a console error, never a pageerror */
  site.on('console', m => { if(m.type() === 'error' && /Content Security Policy/i.test(m.text())) siteErrors.push(m.text()); });
  await site.goto(BASE+'/');
  await site.waitForTimeout(400);
  check('the landing page never scrolls sideways on a phone',
    !(await site.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  /* wake the lazy images the way a reader does: a screen at a time, top to bottom */
  await site.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } window.scrollTo(0, document.body.scrollHeight);
    /* below the breakpoint the shots are a swipeable row with mandatory snapping, so
       setting scrollLeft fights the snap: bring each figure into view the way a swipe
       would, or the ones off to the right never wake and never load */
    for (const fig of document.querySelectorAll('.shots figure')) {
      fig.scrollIntoView({block:'center', inline:'center'});
      await new Promise(r => setTimeout(r, 80));
    }
    /* lazy images start loading when they come into view, so give the ones just woken
       a chance to finish before anything asks whether they did */
    await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => {
      i.addEventListener('load', r, {once:true}); i.addEventListener('error', r, {once:true});
      setTimeout(r, 4000);
    }))); });
  await site.waitForTimeout(600);
  check('the three email screenshots are on the site', ['1','3','6'].every(d => fs.existsSync('public/img/mail-day'+d+'.png')));
  check('every screenshot on the landing page loads',
    await site.$$eval('img', a => a.length > 0 && a.every(i => i.complete && i.naturalWidth > 0)),
    await site.$$eval('img', a => a.filter(i => !(i.complete && i.naturalWidth > 0)).map(i => i.currentSrc || i.src)));
  check('screenshots ship as WebP with a PNG fallback and load lazily',
    await site.$$eval('picture source[type="image/webp"]', a => a.length) === 6 &&
    await site.$$eval('.shots img[loading="lazy"]', a => a.length) === 5);
  check('the honeypot is hidden from assistive tech and the tab order',
    await site.$eval('input[name="bot-field"]', i => i.closest('[aria-hidden="true"]') !== null && i.getAttribute('tabindex') === '-1'));
  warn('og:image is an absolute URL (set once the domain exists)',
    /^https?:\/\//.test(await site.$eval('meta[property="og:image"]', m => m.content)));
  check('the landing page says what is free, what the plan costs, and where the terms are',
    await site.evaluate(() => { const p = document.querySelector('#pricing'); return !!p && /\$19\.99/.test(p.textContent) && /\$2\.99/.test(p.textContent) && /Founding price/.test(p.textContent) && !/forever|\$79|\$29\b/i.test(p.textContent) && /three weeks/.test(p.textContent) && !!p.querySelector('a[href="/terms.html"]') && !!p.querySelector('a[href="/app/"]'); }));
  {
    const ld = await site.evaluate(() => { const b = document.querySelector('script[type="application/ld+json"]'); return b ? JSON.parse(b.textContent) : null; });
    const app = ld && ld['@graph'].find(x => x['@type'] === 'WebApplication');
    const typed = await site.evaluate(() => [...document.querySelectorAll('#pricing [data-price="year"], #pricing [data-price="month"]')].map(e => e.getAttribute('data-price')));
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const printed = k => (html.match(new RegExp('data-price="' + k + '">\\$([0-9.]+)<')) || [])[1];
    const offer = n => (app.offers.find(o => new RegExp(n).test(o.name)) || {}).price;
    check('the home page tells search engines what it is, at the prices the page itself prints',
      !!app && offer('yearly') === printed('year') && offer('monthly') === printed('month') && !app.offers.some(o => /forever/i.test(o.name)) && typed.length === 2,
      [app && app.offers, printed('year'), printed('month')]);
  }
  check('the waitlist form is wired to Netlify',
    await site.$eval('form.signup', f => f.getAttribute('data-netlify') === 'true' &&
      !!f.querySelector('input[name="form-name"]')));
  {
    /* the front page's prices follow Stripe: a later, higher price with no founding mark replaces
       what the HTML says, and the founding line goes with it */
    const later = await ctx.newPage();
    await later.route('**/api/billing', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, prices: { year: { amount: 2999, currency: 'usd', founding: false }, month: { amount: 399, currency: 'usd', founding: false } } }) }));
    await later.goto(BASE+'/'); await later.waitForTimeout(500);
    const shown = await later.evaluate(() => { const p = document.querySelector('#pricing'); const f = p.querySelector('[data-founding]'); return { text: p.innerText, founding: !!f && f.hidden }; });
    const told = await later.evaluate(() => JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'].find(x => x['@type'] === 'WebApplication').offers.map(o => o.name + ' ' + o.price));
    check('and tells search engines the same prices the page now shows', told.includes('Household plan, yearly 29.99') && told.includes('Household plan, monthly 3.99') && told.includes('Free 0'), told);
    check('the front page shows the price Stripe has now, and drops the founding line when that price is not marked founding',
      /\$29\.99/.test(shown.text) && /\$3\.99 a month/.test(shown.text) && !/\$19\.99|\$2\.99/.test(shown.text) && !/Founding price/.test(shown.text) && shown.founding, shown);
    await later.close();
    /* Stripe with no monthly price takes the monthly offer away; Stripe unreachable leaves the typed ones */
    const offersWith = async (fulfill) => {
      const pg = await ctx.newPage(); await pg.route('**/api/billing', fulfill);
      await pg.goto(BASE+'/'); await pg.waitForTimeout(500);
      const o = await pg.evaluate(() => JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'].find(x => x['@type'] === 'WebApplication').offers.map(o => o.name + ' ' + o.price));
      await pg.close(); return o;
    };
    const noMonth = await offersWith(r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, prices: { year: { amount: 2999, currency: 'usd', founding: false }, month: null } }) }));
    const down = await offersWith(r => r.fulfill({ status: 500, body: '' }));
    check('with no monthly price the monthly offer goes, and with Stripe out of reach the typed prices stand',
      noMonth.includes('Household plan, yearly 29.99') && !noMonth.some(x => /monthly/.test(x)) && noMonth.includes('Free 0')
      && down.includes('Household plan, yearly 19.99') && down.includes('Household plan, monthly 2.99'), [noMonth, down]);
  }
  await site.goto(BASE+'/feedback.html'); await site.waitForTimeout(250);
  check('the feedback page is a Netlify form with an email, the story, and a keep-using-it answer, sent to a thank-you page', await site.$eval('form[name="feedback"]', f => f.getAttribute('data-netlify') === 'true' && !!f.querySelector('input[name="form-name"][value="feedback"]') && !!f.querySelector('input[name="email"][required]') && !!f.querySelector('textarea[name="what"][required]') && f.querySelectorAll('input[name="keep"]').length === 3 && !!f.querySelector('textarea[name="ideas"]') && f.querySelectorAll('input[name="want"]').length === 5 && f.getAttribute('action') === '/thanks.html' && !!f.querySelector('input[name="bot-field"]')));
  await site.goto(BASE+'/help.html'); await site.waitForTimeout(250);
  {
    /* the answers told to search engines are the answers on the page, word for word, and name no price */
    const faq = await site.evaluate(() => {
      const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
      const onPage = {};
      document.querySelectorAll('h2').forEach(h => { const p = h.nextElementSibling; if(p && p.tagName === 'P') onPage[h.textContent.trim()] = p.textContent.replace(/\s+/g, ' ').trim(); });
      return { type: ld['@type'], qa: ld.mainEntity.map(q => ({ q: q.name, same: onPage[q.name] === q.acceptedAnswer.text })), text: JSON.stringify(ld) };
    });
    check('the help page\'s FAQPage answers are its own answers, word for word, with no price in them',
      faq.type === 'FAQPage' && faq.qa.length >= 5 && faq.qa.every(x => x.same) && !/\$\d/.test(faq.text), faq.qa.filter(x => !x.same));
    check('and it carries a description and a canonical address', !!(await site.$('meta[name="description"]')) && (await site.$eval('link[rel="canonical"]', l => l.href)) === 'https://lunchsorted.app/help.html');
  }
  check('the help page answers the questions and points at the planner and the address', /plan the week/.test(await site.textContent('body')) && !!(await site.$('a[href="/app/"]')) && !!(await site.$('a[href^="mailto:hello@lunchsorted.app"]')));
  check('the help page carries the two anchors the ideas pages link to', !!(await site.$('h2#pick')) && !!(await site.$('h2#rules')) && !!(await site.$('a[href="/ideas/"]')));
  {
    /* the ideas pages load /ga.js like the front page, so they are served under the front page's
       policy; the tag itself is stubbed, which still proves the policy lets it run */
    const ideas = await ctx.newPage();
    const ideaErrors = [];
    ideas.on('pageerror', e => ideaErrors.push(String(e.message)));
    ideas.on('console', m => { if (m.type() === 'error') ideaErrors.push(m.text()); });
    await ideas.route('https://www.googletagmanager.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ideas.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    check('the ideas pages share the front page\'s policy, analytics and all', POLICIES['/ideas/*'] === POLICIES['/index.html']);
    for (const u of ['/ideas/', '/ideas/picky-eater-lunch-week.html', '/ideas/nut-free-school-lunch-week.html']) {
      const resp = await ideas.goto(BASE+u); await ideas.waitForTimeout(250);
      const got = await ideas.evaluate(() => ({
        h1: document.querySelectorAll('h1').length,
        canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
        og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
        tw: !!document.querySelector('meta[name="twitter:card"]') && !!document.querySelector('meta[name="description"]'),
        home: !!document.querySelector('a[href="/"]'), help: !!document.querySelector('a[href^="/help.html"]'),
        foot: ['/feedback.html','/privacy.html','/terms.html','/app/'].every(h => document.querySelector('footer a[href="'+h+'"]')),
        styled: getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)',
        ga: typeof window.gtag === 'function',
        wide: document.documentElement.scrollWidth > window.innerWidth + 1 }));
      check('the ideas page '+u+' opens under its policy with one h1, its canonical, the share tags, the way back and the footer, and analytics',
        resp.status() === 200 && resp.headers()['content-security-policy'] === POLICIES['/ideas/*'] && got.h1 === 1
        && got.canonical === 'https://lunchsorted.app'+u && got.og === 'https://lunchsorted.app/img/og.png' && got.tw
        && got.home && got.help && got.foot && got.styled && got.ga && !got.wide, got);
    }
    check('and nothing on them is refused or thrown', ideaErrors.length === 0, ideaErrors);
    await ideas.close();
    const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>https:\/\/lunchsorted\.app(\/[^<]*)<\/loc>\s*<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)].map(m => m[1]);
    check('the sitemap lists the public pages with a date each, and none of the private ones, and every one exists',
      locs.length === (sitemap.match(/<url>/g) || []).length && ['/', '/help.html', '/ideas/', '/ideas/picky-eater-lunch-week.html', '/ideas/nut-free-school-lunch-week.html'].every(l => locs.includes(l))
      && !locs.some(l => /^\/(app|api|admin|beta|back|thanks|on-the-list)/.test(l))
      && locs.every(l => fs.existsSync(path.join(ROOT, l.endsWith('/') ? l + 'index.html' : l))), locs);
    check('robots.txt points at the sitemap', /\nSitemap: https:\/\/lunchsorted\.app\/sitemap\.xml\n/.test(fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8')));
  }
  {
    const r = await site.goto(BASE+'/no-such-page'); await site.waitForTimeout(150);
    check('a path that is not there gets the site\'s own page, with a 404, the way home, and no place in search',
      r.status() === 404 && /isn.t here/.test(await site.textContent('h1')) && !!(await site.$('a[href="/app/"]')) && !!(await site.$('a[href="/help.html"]'))
      && (await site.$eval('meta[name="robots"]', m => m.content)) === 'noindex');
    check('and a direct request for /404.html carries the site\'s policy, like every other page', POLICIES['/404.html'] === POLICIES['/help.html']);
    const noindex = ['thanks', 'on-the-list'].map(n => /<meta name="robots" content="noindex">/.test(fs.readFileSync(path.join(ROOT, n + '.html'), 'utf8')));
    check('the pages after a form is sent stay out of search', noindex.every(Boolean), noindex);
    const llms = fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8');
    check('llms.txt says what the app is and names no price', /^# Lunch Sorted\n\n> /.test(llms) && !/\$\d/.test(llms));
  }
  await site.goto(BASE+'/privacy.html');
  await site.waitForTimeout(250);
  check('the privacy page names the pages that run analytics: the front page, the ideas pages and the beta page', /front page of this site, the lunch ideas pages under \/ideas\/ and the beta page at \/beta/.test(await site.textContent('body')));
  warn('the privacy page has a real contact address, not the placeholder',
    !(await site.content()).includes('hello@example.com'));
  /* the sign-in link only opens the app if this file parses, carries the team, and claims
     nothing but the verify route; all three fail silently in the wild */
  {
    const aasa = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'public', '.well-known', 'apple-app-site-association'), 'utf8'));
    const det = aasa.applinks.details[0], comps = JSON.stringify(det.components);
    const toml = fs.readFileSync(path.join(ROOT, '..', 'netlify.toml'), 'utf8');
    check('the apple-app-site-association claims the sign-in route and nothing else',
      /^[A-Z0-9]{10}\.app\.lunchsorted$/.test(det.appIDs[0]) && det.components.length === 1
      && det.components[0]['/'] === '/api/auth/verify'
      && !/\/app|back\.html/.test(comps),
      comps);
    check('and Netlify serves it as JSON, which iOS requires of an extensionless file',
      /for = "\/\.well-known\/apple-app-site-association"[\s\S]{0,400}?Content-Type = "application\/json"/.test(toml));
  }
  check('nothing renders as stray code text at the foot of the app', !/\}\);\s*\}\)\(\);/.test(await page.evaluate(() => document.body.innerText)));
  check('no javascript errors anywhere', errors.length === 0 && siteErrors.length === 0,
    errors.concat(siteErrors));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${checks - failures}/${checks} checks passed` +
  (warnings ? `, ${warnings} launch gate${warnings > 1 ? 's' : ''} still open` : ''));
process.exit(failures ? 1 : 0);
