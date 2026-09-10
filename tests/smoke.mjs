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
await migrate(globalThis.__LS_SQL);
const { default: authHandler } = await import('../netlify/functions/api-auth.js');
const { default: householdHandler } = await import('../netlify/functions/api-household.js');
const { default: billingHandler } = await import('../netlify/functions/api-billing.js');
const { default: adminHandler, stats: adminStats } = await import('../netlify/functions/api-admin.js');
const { default: betaHandler } = await import('../netlify/functions/beta.js');
process.env.ADMIN_EMAILS = 'liz@example.com';
process.env.REVIEW_EMAIL = 'review@example.com'; process.env.REVIEW_CODE = 'REVU-2468';
process.env.BETA_CODE = 'BETA-TEST-1234'; process.env.BETA_CAP = '2';
const stripeLib = await import('../netlify/lib/stripe.js');
/* Stripe itself is a stub: it answers the four calls the code makes and records what it was asked */
const stripeCalls = [];
globalThis.__LS_STRIPE_FETCH = async (url, init) => {
  const u = new URL(url); const params = Object.fromEntries(new URLSearchParams(init.body || ''));
  stripeCalls.push({ method: init.method, path: u.pathname, params, auth: init.headers.authorization });
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/v1/prices/price_year') return reply({ id: 'price_year', unit_amount: 2900, currency: 'usd', recurring: { interval: 'year' } });
  if (u.pathname === '/v1/prices/price_life') return reply({ id: 'price_life', unit_amount: 7900, currency: 'usd' });
  if (u.pathname === '/v1/prices/price_month') return reply({ id: 'price_month', unit_amount: 399, currency: 'usd', recurring: { interval: 'month' } });
  if (u.pathname === '/v1/checkout/sessions') {
    if (params['automatic_tax[enabled]'] === 'true' && globalThis.__LS_STRIPE_NO_TAX) return reply({ error: { message: 'You must configure Stripe Tax before enabling automatic_tax', code: 'invalid_request_error' } }, 400);
    return reply({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  }
  if (u.pathname === '/v1/billing_portal/sessions') return reply({ url: 'https://billing.stripe.com/p/session/test_1' });
  if (u.pathname.startsWith('/v1/subscriptions/')) {
    const id = u.pathname.split('/').pop();
    if (init.method === 'GET') return reply({ id, object: 'subscription', status: 'active', cancel_at_period_end: false, customer: 'cus_pat', items: { data: [{ current_period_end: 1800000000, price: { id: 'price_year' } }] } });
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
  const handler = req.url.startsWith('/api/auth/') ? authHandler : req.url.startsWith('/api/billing') ? billingHandler : req.url.startsWith('/api/admin') ? adminHandler : req.url.startsWith('/beta') ? betaHandler : householdHandler;
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
  if(p === '/' || p === '/index.html') return POLICIES['/index.html'];
  return POLICIES[p] || null;
}
const TYPES = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.json':'application/json',
  '.webmanifest':'application/manifest+json','.txt':'text/plain','.svg':'image/svg+xml'};

function serve(){
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(p.startsWith('/api/') || p === '/beta') return apiProxy(req, res);
    if(p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end('not found');
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
const pinClock = async c => c.addInitScript(day => {
  const Real = Date;
  const [y, m, dd] = day.split('-').map(Number);
  const offset = new Real(y, m - 1, dd, 9, 0, 0).getTime() - Real.now();
  function Fake(...a){ return a.length ? new Real(...a) : new Real(Real.now() + offset); }
  Fake.prototype = Real.prototype;
  Fake.now = () => Real.now() + offset;
  Fake.parse = Real.parse; Fake.UTC = Real.UTC;
  window.Date = Fake;
}, pinnedDay);
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
  check('onboarding takes the whole screen on first run',
    await page.$eval('nav.tabs', e => getComputedStyle(e).display === 'none'));

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
  const traitTins = await page.$$eval('.tin', a => a.filter(t => t.querySelectorAll('.tr i:not(.care)').length >= 2).length);
  const planned = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.length);
  check('each box shows what its foods bring, as words in the compartments', planned >= 2 && traitTins >= planned && (await page.$$eval('.note', a => a.length)) === 0, {traitTins, planned});
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

  /* ---------------------------------------------------------- kid's pick */
  check('nobody is offered the kid\'s pick until the lunchbox says the kid has a say', (await page.$$eval('[data-act="kid-start"]', a => a.length)) === 0);
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(250);
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
  await page.click('[data-act="shuffle-day"][data-day="'+targetDate+'"]'); await page.waitForTimeout(300);
  const stillMain = await page.evaluate((td) => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.find(x => x.d === td).slots.main, targetDate);
  check("a shuffle does not overwrite what the kid chose", stillMain === chosenMain);
  check('every compartment that can change shows the swap cue, a locked one the lock', await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.daycard:not(.past) .cmp')];
    return cells.length > 0 && cells.every(c => (c.querySelector('.swap') ? 1 : 0) + (c.querySelector('.lock') ? 1 : 0) === 1) && document.querySelectorAll('.daycard.past .cmp .swap').length === 0;
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
    const shared = await page.$$eval('.list .item', a => a.filter(x => /\u00d7\d/.test(x.querySelector('.qty').textContent)).length);
    check('a part two dishes share is one line with a count', dishes.length < 2 || shared > 0 || new Set(withParts.flatMap(f => f.buy)).size === withParts.flatMap(f => f.buy).length, shared);
    const fromBank = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('lunchsorted')); const f = d.kids[0].foods.find(x => x.buy && x.buy.length); delete f.buy;   /* a food seeded before lists existed */
      localStorage.setItem('lunchsorted', JSON.stringify(d)); return f.n;
    });
    await page.reload(); await page.waitForTimeout(600); await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
    check('a food seeded before parts existed takes the bank\'s parts', fromBank && await page.evaluate((n) => { const f = JSON.parse(localStorage.getItem('lunchsorted')).kids[0].foods.find(x => x.n === n); return !!(f.buy && f.buy.length); }, fromBank), fromBank);
    /* an update says what changed, once, and only to a phone that already had the app */
    check('a phone that had the app is told what changed on the first open after an update', await page.evaluate(() => { localStorage.setItem('lunchsorted-seen', 'lunchsorted-v0'); return true; })
      && (await page.reload(), await page.waitForTimeout(600), /New: /.test(await page.textContent('#view'))) && (await page.$$eval('[data-act="notice-dismiss"]', a => a.length)) === 1);
    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
    check('the note follows to the next tab, once, and is green not amber', (await page.$$eval('[data-act="notice-dismiss"]', a => a.length)) === 1 && !!(await page.$('.banner.good')));
    await page.click('[data-act="notice-dismiss"]'); await page.waitForTimeout(200); await page.reload(); await page.waitForTimeout(600);
    check('and once dismissed it stays gone', !/New: /.test(await page.textContent('#view')) && await page.evaluate(() => /^lunchsorted-v\d+$/.test(localStorage.getItem('lunchsorted-seen') || '')));
    await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
    check('the list groups every line under a real aisle', (await page.$$eval('.sect-head h3', a => a.map(x => x.textContent))).every(t => ['Produce','Deli','Bakery','Dairy','Drinks','Pantry','Snacks','Frozen','Your own'].includes(t)));
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.click('[data-act="copy-list"]'); await page.waitForTimeout(250);
    const txt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('Copy puts the list on the clipboard grouped by aisle, one line a thing', /^Lunch shopping list\n\n[A-Z][a-z]+\n- /.test(txt) && txt.split('\n').filter(l => l.startsWith('- ')).length === (await page.$$eval('.list .item:not(.done)', a => a.length)), txt.slice(0, 80));
    await page.click('[data-act="help"]'); await page.waitForTimeout(300);
    check('the ? at the top opens help: questions, a way to write in, and the page on the site', (await page.$$eval('#sheetBody details', a => a.length)) >= 4 && !!(await page.$('#sheetBody a[data-feedback][href^="mailto:"]')) && !!(await page.$('#sheetBody a[href="/help.html"]')));
    await page.evaluate(() => document.querySelector('#sheetBody details summary').click()); await page.waitForTimeout(150);
    check('and an answer opens on a tap', await page.$eval('#sheetBody details', d => d.open));
    check('the ? still fits beside a long name and two lunchboxes', await page.evaluate(() => { const b = document.querySelector('[data-act="help"]').getBoundingClientRect(); return b.right <= window.innerWidth - 8 && document.documentElement.scrollWidth <= window.innerWidth; }));
    await page.click('#sheetClose'); await page.waitForTimeout(250);
    check('the share button shows only where the phone has a share sheet', (await page.$$eval('[data-act="send-list"]', a => a.length)) === (await page.evaluate(() => navigator.share ? 1 : 0)));
  }
  const head = await page.textContent('.count');
  await page.click('.list .item');
  await page.waitForTimeout(200);
  check('a pantry tick moves an item out of the buy count', head !== await page.textContent('.count'));

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
  await page.click('[data-act="box-settings"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="add-kid"]');
  await page.waitForTimeout(350);
  await page.fill('#nkName', 'Sam');
  await page.click('[data-act="save-kid"]');
  await page.waitForTimeout(350);
  await page.click('[data-act="seed"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="box-settings"]');
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

  const idea = await page.$$eval('[data-act="add-idea"]:not(.done)',
    a => (a.find(b => !/gluten|nuts|dairy|egg|soy|fish|sesame/i.test(b.textContent)) || {getAttribute: () => null}).getAttribute('data-name'));
  await page.click('[data-act="add-idea"][data-name="' + idea + '"]');
  await page.waitForTimeout(350);
  const landed = await page.evaluate(n => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.foods.some(f => !f.deletedAt && f.n === n)), idea);
  check('one tap adds the food to every lunchbox', landed.length === 2 && landed.every(Boolean), [idea, landed]);

  await page.click('[data-act="add-to"]');                     /* take the first box back out */
  await page.waitForTimeout(350);
  const only = await page.$$eval('[data-act="add-to"]', a => a.map(b => b.getAttribute('aria-pressed')));
  check('a box can be taken out of the next add', only[0] === 'false' && only[1] === 'true', only);
  const idea2 = await page.$$eval('[data-act="add-idea"]:not(.done)',
    a => (a.find(b => !/gluten|nuts|dairy|egg|soy|fish|sesame/i.test(b.textContent)) || {getAttribute: () => null}).getAttribute('data-name'));
  const hadIt = await page.evaluate(n => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.foods.some(f => !f.deletedAt && f.n === n)), idea2);
  await page.click('[data-act="add-idea"][data-name="' + idea2 + '"]');
  await page.waitForTimeout(350);
  const landed2 = await page.evaluate(n => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.foods.some(f => !f.deletedAt && f.n === n)), idea2);
  check('and then the one weird food lands in that one box only',
    landed2[1] === true && landed2[0] === hadIt[0], [idea2, hadIt, landed2]);
  await page.click('[data-act="add-to"]');                     /* put it back for the tests below */
  await page.waitForTimeout(350);
  await page.click('#sheetClose');
  await page.waitForTimeout(300);


  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(250);
  check('filling a new lunchbox\'s list also plans it, so every lunchbox has a box to pack',
    await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted'))
      .kids.filter(k => !k.deletedAt).every(k => k.week && k.week.days.length)));

  /* ------------------------------------------- one week across two boxes */
  await page.click('[data-act="tab"][data-tab="week"]');
  await page.waitForTimeout(250);
  const pills = await page.$$eval('.kidpager button', a => a.map(b => b.textContent.trim()));
  check('two lunchboxes get a pager to move between their plans', pills.length === 2, pills);

  await page.click('.kidpager button:first-child');
  await page.waitForTimeout(300);
  const kidBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).activeKidId);
  await page.evaluate(() => {
    const view = document.getElementById('view');
    const start = new Event('touchstart', {bubbles:true});
    start.touches = [{clientX:300, clientY:400}];
    view.dispatchEvent(start);
    const end = new Event('touchend', {bubbles:true});
    end.changedTouches = [{clientX:120, clientY:408}];
    view.dispatchEvent(end);
  });
  await page.waitForTimeout(250);
  const kidAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).activeKidId);
  check('a sideways flick moves to the next lunchbox', kidBefore !== kidAfter, [kidBefore, kidAfter]);

  await page.evaluate(() => {
    const view = document.getElementById('view');
    const start = new Event('touchstart', {bubbles:true});
    start.touches = [{clientX:200, clientY:200}];
    view.dispatchEvent(start);
    const end = new Event('touchend', {bubbles:true});
    end.changedTouches = [{clientX:186, clientY:640}];
    view.dispatchEvent(end);
  });
  await page.waitForTimeout(250);
  check('a scroll down the page is not a swipe',
    kidAfter === await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).activeKidId));


  /* ------------------------------------- shop is the household's, always */
  await page.click('[data-act="tab"][data-tab="shop"]');
  await page.waitForTimeout(300);
  check('the shopping list offers no lunchbox to switch to, because it covers them all',
    await page.evaluate(() => !document.querySelector('#who .kidbtn') && !document.querySelector('.kidpager')));
  check('and every lunchbox is in it', await page.evaluate(() => {
    const names = JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => k.name);
    const metas = [...document.querySelectorAll('.list .item .meta')].map(m => m.textContent).join(' ');
    return names.every(n => metas.includes(n));
  }));


  /* ----------------------------------------- pack swipes like the plan */
  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(300);
  check('pack carries the same pager as the plan', (await page.$$eval('.kidpager button', a => a.length)) === 2);
  const pins = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const ks = d.kids.filter(k => !k.deletedAt);
    const day = ks[0].week.days.find(x => x.d >= new Date().toISOString().slice(0,10));
    return {day: day && day.d, kid: ks[0].id, cats: Object.keys(day ? day.slots : {}).filter(c => day.slots[c])};
  });
  if (pins.day) {
    /* one Packed tick for the box on screen, and its pill should say so. The
       other box may already be packed by an earlier check, so count relative. */
    const readyLine = t => { const m = /(\d+) of (\d+) boxes ready/.exec(t); return m ? {ready: +m[1], boxes: +m[2]} : null; };
    const before = readyLine(await page.textContent('#view'));
    check('Pack says how much of the household is ready, not just the box on screen', !!before && before.boxes === 2, before);
    const okBefore = await page.$$eval('.kidpager .pin.ok', a => a.length);
    await page.click('[data-act="pack-all"]');
    await page.waitForTimeout(300);
    const okAfter = await page.$$eval('.kidpager .pin.ok', a => a.length);
    check('a pill says when that box is packed, so four kids is not four guesses', okAfter === okBefore + 1, {okBefore, okAfter});
    const after = readyLine(await page.textContent('#view')), line = await page.textContent('#view');
    check('and the household line counts it, naming who is still to pack',
      !!after && after.ready === before.ready + 1 && (after.ready === after.boxes ? /everyone is packed/.test(line) : /\w+ still to pack\./.test(line)), {before, after});
    await page.click('[data-act="pack-all"]');                   /* un-tick: leave the fixture as it was */
    await page.waitForTimeout(300);
  }
  await page.click('.kidpager button:first-child');
  await page.waitForTimeout(300);
  const packBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).activeKidId);
  await page.evaluate(() => {
    const view = document.getElementById('view');
    const start = new Event('touchstart', {bubbles:true});
    start.touches = [{clientX:300, clientY:400}];
    view.dispatchEvent(start);
    const end = new Event('touchend', {bubbles:true});
    end.changedTouches = [{clientX:120, clientY:404}];
    view.dispatchEvent(end);
  });
  await page.waitForTimeout(300);
  const packAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).activeKidId);
  check('and swipes to the next box the same way', packBefore !== packAfter);
  await page.evaluate(() => {                                  /* past the last box is a wall, not a loop */
    const view = document.getElementById('view');
    const start = new Event('touchstart', {bubbles:true});
    start.touches = [{clientX:300, clientY:400}];
    view.dispatchEvent(start);
    const end = new Event('touchend', {bubbles:true});
    end.changedTouches = [{clientX:120, clientY:404}];
    view.dispatchEvent(end);
  });
  await page.waitForTimeout(300);
  check('and stops at the last one rather than looping round',
    packAfter === await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).activeKidId));


  /* ------------------------------------ one plan across the two boxes */
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(250);
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
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(250);
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
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(250);
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
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(200);
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
    k.week.days[0].d = iso(y);                     /* pretend the first box was yesterday */
    const c = new Date(); c.setDate(c.getDate() - 3); k.week.createdAt = c.toISOString();   /* and that the plan existed then */
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(500);
  check("the morning after, it asks how the box went", (await page.$$eval('.review', a => a.length)) === 1);
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
    /came home twice — taking a break until [A-Z][a-z]{2} \d{1,2}/.test(await page.textContent('#view')), (await page.textContent('#view')).match(/came home[^<]{0,60}/));
  let restedDrawn = 0;
  for (let i = 0; i < 5; i++) {
    await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
    await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(250);
    restedDrawn += await page.evaluate(id => JSON.parse(localStorage.getItem('lunchsorted')).kids[0]
      .week.days.filter(x => x.slots.main === id).length, reviewedFood);
  }
  check('the draw leaves a resting food out', restedDrawn === 0, restedDrawn);
  let restedRedrawn = 0;
  for (let i = 0; i < 5; i++) {
    await page.click('.daycard:not(.past) [data-act="shuffle-day"] >> nth=0'); await page.waitForTimeout(200);
    restedRedrawn += await page.evaluate(id => JSON.parse(localStorage.getItem('lunchsorted')).kids[0]
      .week.days.filter(x => x.slots.main === id).length, reviewedFood);
  }
  check('and so does a single re-draw', restedRedrawn === 0, restedRedrawn);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids[0].eaten = {}; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(400);

  /* ------------------------------------------------ friction: targets, sheet, words */
  const small = async () => page.$$eval('.btn.sm, .tg, .kidbtn, .seg button, .x, .cmp[data-act], nav.tabs button', a =>
    a.filter(e => e.checkVisibility()).map(e => ({h: Math.round(e.getBoundingClientRect().height), t: e.textContent.trim().slice(0,20)})).filter(x => x.h < 44));
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(250);
  const smallSetup = await small();
  check('every tappable control on Account is at least 44px tall', smallSetup.length === 0, smallSetup);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(250);
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
    lock: document.body.style.overflow, keep: /don.t change this one/i.test(document.getElementById('sheet').textContent)}));
  check('opening a compartment sheet locks the page behind it and offers "Don\u2019t change this one"',
    sheetOpen.vis === 'visible' && sheetOpen.lock === 'hidden' && sheetOpen.keep, sheetOpen);
  await page.click('#backdrop', {position:{x:10, y:10}}); await page.waitForTimeout(350);
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
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(200);
  check('seeds & sesame is a keep-out option', (await page.$$eval('[data-act="allergen"][data-k="seeds"]', a => a.length)) === 1);
  await page.click('[data-act="compartment"][data-k="snack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="compartment"][data-k="drink"]'); await page.waitForTimeout(250);
  const slotState = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return {on: !!(k.settings.slots && k.settings.slots.snack && k.settings.slots.drink),
      snacks: k.foods.filter(f => f.c==='snack' && !f.deletedAt).length,
      drinks: k.foods.filter(f => f.c==='drink' && !f.deletedAt).length,
      filled: k.week.days.every(dy => dy.slots.snack && dy.slots.drink)};
  });
  check('switching a compartment on seeds it and fills this week', slotState.on && slotState.snacks > 0 && slotState.drinks > 0 && slotState.filled, slotState);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(250);
  const perTin = await page.$$eval('.tin', tins => tins.map(t => t.querySelectorAll('.cmp').length));
  check('the tin grows to six compartments', perTin.length > 0 && perTin.every(n => n === 6), perTin);
  await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
  check('drinks land on the shopping list under their own aisle', (await page.textContent('#view')).toLowerCase().includes('drinks'));
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(200);
  await page.click('[data-act="kidpick-on"]'); await page.waitForTimeout(200);          /* this lunchbox's kid gets a say too, the whole box at a time */
  await page.click('[data-act="kidpick-mode"][data-v="boxes"]'); await page.waitForTimeout(200);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="kid-start"] >> nth=-1'); await page.waitForTimeout(250);
  check("whole-box picking offers two boxes, each with all six compartments", (await page.$$eval('.kidmode .pickbox', a => a.length)) === 2 && (await page.$$eval('.kidmode .pickbox >> nth=0 >> .mini .cmp', a => a.length)) === 6);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(200);
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
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
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
    k.week.days[0].slots.side = 't_dairy'; k.week.days[0].lock.side = true;
    d.activeKidId = k.id;
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(200);
  await page.click('[data-act="allergen"][data-k="dairy"]'); await page.waitForTimeout(300);
  const afterRule = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return {side: k.week.days[0].slots.side, locked: k.week.days[0].lock.side};
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
    return k.settings.avoidText === name && !k.week.days.some(d => { const f = k.foods.find(x => x.id === d.slots.side); return f && f.n === name; }); }, avoidTarget), avoidTarget);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); d.kids[0].settings.avoidText = ''; localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(200);

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
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(200);
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
  await page.click('#sheetBody .item:not(.done) >> nth=0'); await page.waitForTimeout(300);
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
  check('and says so', /no longer kept/i.test(await page.textContent('#toast')));
  await page.click('#backdrop', {position:{x:10, y:10}}); await page.waitForTimeout(300);

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
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
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
  const gone = await page.evaluate(() => ({ sub: document.querySelector('.view-title').previousElementSibling.textContent,   /* the header, not the review card */
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
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(250);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(350);
  check('a brand-new plan never includes days that have already happened', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const today = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
    return k.week.days.length > 0 && k.week.days.every(dy => dy.d >= today);
  }));

  /* a lunchbox with no foods is announced, and the title counts what is on screen */
  await page.click('[data-act="box-settings"]'); await page.waitForTimeout(200);
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
  await page.click('.list .item'); await page.waitForTimeout(150);            /* tick one pantry row */
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(200);
  check('"Clear the plans" needs a second tap', (await page.textContent('[data-act="clear-week"]')).includes('again'));
  await page.click('[data-act="clear-week"]'); await page.waitForTimeout(250);
  const afterClear = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return {week: d.kids[0].week, pantry: Object.keys(d.pantry).length}; });
  check('clearing the plans leaves the shopping ticks alone', afterClear.week === null && afterClear.pantry >= 1, afterClear);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(200);
  const firstFood = await page.textContent('.list .item .nm');
  await page.click('[data-act="del-food"]'); await page.waitForTimeout(200);
  check('deleting a food offers Undo', (await page.$$eval('#toast [data-act="undo"]', a => a.length)) === 1);
  await page.click('#toast [data-act="undo"]'); await page.waitForTimeout(250);
  check('Undo puts the food back', (await page.textContent('#view')).includes(firstFood.trim()));

  /* erase really erases, old names included */
  await page.evaluate(() => { localStorage.setItem('lunchbox-tin', localStorage.getItem('lunchsorted')); localStorage.setItem('lunchbox-tin-v1', '{"foods":[],"settings":{}}'); localStorage.setItem('fiveboxes-backup-1', '{"old":1}'); localStorage.setItem('lunchsorted-backup-2', '{"old":2}'); });
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
  {
    const href = await page.getAttribute('[data-feedback]', 'href');
    const body = decodeURIComponent((href.split('body=')[1] || ''));
    check('the Account tab has a "tell us" link that opens an email with the build, the phone and the household shape filled in, and never a food name',
      /^mailto:hello@lunchsorted\.app\?subject=/.test(href) && /Build: lunchsorted-v\d+ \(web\)/.test(body) && /Phone: Mozilla/.test(body) && /Lunchboxes: \d+ · foods: \d+/.test(body) && /What happened:/.test(body) && !/grape|banana|cracker|yogurt/i.test(body.replace(/^Phone:.*$/m, '')), body.slice(0, 300));
  }
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
    k.foods.push({id:'t_old', kidId:k.id, n:'Old thing', c:'side', t:[], a:'other', al:[], createdAt:'2020-01-01T00:00:00Z', updatedAt:'2020-01-01T00:00:00Z', deletedAt:'2020-01-02T00:00:00Z'});
    localStorage.setItem('lunchsorted', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
  check('a re-plan prunes ancient ticks, outcomes and tombstones', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    return !k.packed['2020-01-06'] && !k.eaten['2020-01-06'] && !k.foods.some(f => f.id === 't_old');
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
  await until(page, () => /Signed in as\s*liz@example\.com/.test(document.querySelector('#view').textContent));
  check('one tap signs in, lands back in the app, and the account card is at the top', page.url().endsWith('/app/') &&
    await page.evaluate(() => { const v = document.querySelector('#view'); return /Signed in as/.test(v.textContent) && v.querySelector('.sect-head h3').textContent === 'Account'; }), page.url());
  const welcomes = (to) => mails.filter(m => m.to === to && /Everything is on for three weeks/.test(m.subject));
  check('a first sign-in gets one welcome email, with a way to stop reminders', welcomes('liz@example.com').length === 1 && /\/api\/auth\/mail-stop\?t=[a-f0-9]{32}/.test(welcomes('liz@example.com')[0].text) && /\/app\//.test(welcomes('liz@example.com')[0].text));
  {
    const anonAdmin = await fetch(NODE_BASE + '/api/admin');
    const adminPage = await page.evaluate(() => fetch('/api/admin').then(r => r.text().then(t => ({ status: r.status, text: t, csp: r.headers.get('content-security-policy') }))));
    check('the numbers page asks a stranger to sign in, and shows the person in ADMIN_EMAILS real counts with no script allowed',
      anonAdmin.status === 401 && adminPage.status === 200 && /by the numbers/i.test(adminPage.text) && /households/.test(adminPage.text) && /default-src 'none'/.test(adminPage.csp) && !/<script/.test(adminPage.text), [anonAdmin.status, adminPage.status]);
  }
  const spent = await page.evaluate(u => fetch(u).then(r => r.status), devLink);
  check('a used link is gone', spent === 410, spent);
  await until(page, () => fetch('/api/household').then(r => r.json()).then(j => j.version >= 1 && !!j.doc));
  const srv = await page.evaluate(() => fetch('/api/household').then(r => r.json()));
  check("this phone's lunches became the household on the server", !!(srv.doc && srv.doc.kids.length >= 1 && srv.version >= 1 && srv.me.role === 'owner'), {version: srv.version, role: srv.me && srv.me.role});
  check('the person on this phone is a member the document already knew', await page.evaluate(m => JSON.parse(localStorage.getItem('lunchsorted')).members.some(x => x.id === m) && localStorage.getItem('lunchsorted-device') === m, srv.me.memberId));
  const stale = await page.evaluate(v => fetch('/api/household', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({doc: JSON.parse(localStorage.getItem('lunchsorted')), version: v - 1})}).then(r => r.status), srv.version);
  check('a push with a stale version is refused with 409', stale === 409, stale);

  /* the other parent already uses the app on their own phone */
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
  await p2.fill('#signinCode', devCode.toLowerCase()); await p2.press('#signinCode', 'Enter');
  await until(p2, () => /Join their household/.test(document.querySelector('#view').textContent));
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
  await p2.click('[data-act="join-accept"]');
  await until(p2, () => /you share their lunches/i.test(document.querySelector('#toast').textContent) || /Parent/.test(document.querySelector('#view').textContent));
  await until(page, () => fetch('/api/household').then(r => r.json()).then(j => j.members.length === 2));
  await page.goto(BASE+'/app/'); await page.waitForLoadState('load'); await page.waitForTimeout(800);
  const ownerKids = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => k.name).sort());
  const samKids = await p2.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.filter(k => !k.deletedAt).map(k => k.name).sort());
  check("joining with lunches of his own brings Ollie into the household on both phones", JSON.stringify(samKids) === JSON.stringify(ownerKids) && samKids.includes('Ollie') && samKids.length >= 2, {ownerKids, samKids});
  await p2.click('[data-act="tab"][data-tab="setup"]'); await p2.waitForTimeout(300);
  const memberText = await p2.textContent('#view');
  check('both parents are listed, by name, with the address as the small print', /Parent/.test(memberText) && /sam@example\.com/.test(memberText) && /liz@example\.com/.test(memberText) && !/sam\.example/.test(memberText));
  check('Sam kept the member he already was', await p2.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return d.members.filter(m => !m.deletedAt).length === 2 && d.members.some(m => m.id === localStorage.getItem('lunchsorted-device')); }));
  const notOwner = await p2.evaluate(id => fetch('/api/household/remove', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({userId:id})}).then(r => r.status), srv.me.userId);
  check('only the owner can remove someone', notOwner === 403, notOwner);

  /* an edit on each phone reaches the other; an un-tick holds */
  await page.click('[data-act="tab"][data-tab="foods"]'); await page.waitForTimeout(250);
  await page.click('[data-act="add-own"]'); await page.waitForTimeout(350);
  await page.fill('#nfName', 'Shared test food'); await page.click('[data-act="save-own"]');
  await until(page, () => fetch('/api/household').then(r => r.json()).then(j => JSON.stringify(j.doc).includes('Shared test food')));
  await p2.click('[data-act="tab"][data-tab="shop"]'); await p2.waitForTimeout(300);
  const pantryKey = await p2.getAttribute('.list .item[data-act="have"] >> nth=0', 'data-key');
  await p2.click('.list .item[data-act="have"] >> nth=0');
  await until(p2, k => !!JSON.parse(localStorage.getItem('lunchsorted')).pantry[k], pantryKey);   /* the save is debounced */
  const first = await p2.evaluate(k => JSON.parse(localStorage.getItem('lunchsorted')).pantry[k].have, pantryKey);
  check('a pantry tick reaches the server', await until(p2, a => fetch('/api/household').then(r => r.json()).then(j => !!j.doc.pantry[a.k] && j.doc.pantry[a.k].have === a.v), {k: pantryKey, v: first}), {pantryKey, first});
  await p2.click('.list .item[data-act="have"] >> nth=0');                                   /* and straight back */
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

  /* a helper sees the pack list and cannot change the plan */
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(250);
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
  const helperState = await p3.evaluate(() => fetch('/api/household').then(r => r.json()));
  check('a helper gets the plan and the foods in it, and nothing else', helperState.me.role === 'helper' && helperState.doc.kids.every(k => k.settings.avoidAllergens.length === 0 && k.foods.every(f => f.al.length === 0)) && helperState.members.every(m => !m.email || m.userId === helperState.me.userId));
  const helperPut = await p3.evaluate(v => fetch('/api/household', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({doc: JSON.parse(localStorage.getItem('lunchsorted')), version:v})}).then(r => r.status), helperState.version);
  check("a helper's push is refused", helperPut === 403, helperPut);
  await p3.click('[data-act="tab"][data-tab="week"]'); await p3.waitForTimeout(250);
  check('and a helper sees no Shuffle button and no swap cue, only the week', (await p3.$$eval('[data-act="plan-kid"],[data-act="shuffle-day"],.cmp .swap', a => a.length)) === 0 && (await p3.$$eval('.cmp', a => a.length)) > 0);
  await p3.click('.daycard:not(.past) .cmp >> nth=0'); await p3.waitForTimeout(200);
  check('and the app says so instead of pretending', /Only a parent can change the plan/.test(await p3.textContent('#toast')));
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
  await p2.reload(); await p2.waitForLoadState('load'); await p2.click('[data-act="tab"][data-tab="setup"]'); await until(p2, () => !!document.querySelector('[data-act="signout"]'));
  await p2.click('[data-act="signout"]'); await until(p2, () => !!document.querySelector('.ob') && !!localStorage.getItem('lunchsorted'));
  const cleared = await p2.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')); return !d.onboardedAt && !d.kids.some(k => k.foods.length) && !d.kids.some(k => k.name === 'Ollie'); });
  const onServer = (await db.query(`SELECT h.doc FROM households h JOIN household_members m ON m.household_id = h.id JOIN users u ON u.id = m.user_id WHERE u.email = 'sam@example.com'`)).rows[0];
  check('signing out sends the last change, then leaves the phone blank at onboarding', cleared && !!onServer && onServer.doc.kids.some(k => k.name === 'Ollie Unsent'), [cleared, onServer && onServer.doc.kids.map(k => k.name)]);
  await ctx2.close();
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(250);
  await page.click('[data-act="delete-account"]'); await page.waitForTimeout(150);
  await page.click('[data-act="delete-account"]'); await until(page, () => !!document.querySelector('.ob') && !!localStorage.getItem('lunchsorted'));   /* the fresh document lands after the save debounce */
  const afterDelete = await page.evaluate(() => fetch('/api/household').then(r => r.status));
  check('deleting the account signs out, removes the household from the server, and starts this phone over',
    afterDelete === 401 && (await page.$$eval('.ob', a => a.length)) === 1 &&
    await page.evaluate(() => !JSON.parse(localStorage.getItem('lunchsorted')).kids.some(k => k.foods.length)));
  const rowsLeft = await db.query(`SELECT (SELECT count(*)::int FROM households) AS h, (SELECT count(*)::int FROM users WHERE email='liz@example.com') AS u`);
  check('and the rows are really gone', rowsLeft.rows[0].u === 0, rowsLeft.rows[0]);
  await page.evaluate(raw => localStorage.setItem('lunchsorted', raw), goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(500);

  /* ------------------------------------------------------------ billing */
  const bcfgOff = await page.evaluate(() => fetch('/api/billing').then(r => r.json()));
  check('with no Stripe in the deploy nothing is gated', bcfgOff.enabled === false);
  /* the key guard: a live key can never serve a branch, a test key can never serve production */
  const guard = (env, key) => { const was = { e: process.env.SITE_ENV, k: process.env.STRIPE_SECRET_KEY }; process.env.SITE_ENV = env; process.env.STRIPE_SECRET_KEY = key;
    let threw = false; try { stripeLib.stripeKey(); } catch { threw = true; } process.env.SITE_ENV = was.e; process.env.STRIPE_SECRET_KEY = was.k; return threw; };
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
  const WH = 'whsec_test_secret';
  const sign = (body, t = Math.floor(Date.now() / 1000), secret = WH) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  check('a webhook signature is checked against the raw body and the clock',
    stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}'), WH) && !stripeLib.verifyWebhook('{"a":2}', sign('{"a":1}'), WH) &&
    !stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}', Math.floor(Date.now() / 1000) - 600), WH) && !stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}', undefined, 'whsec_other'), WH) && !stripeLib.verifyWebhook('{"a":1}', '', WH));
  check('the period end is read from either shape of subscription',
    stripeLib.periodEnd({ current_period_end: 1800000000 }) === '2027-01-15T08:00:00.000Z' && stripeLib.periodEnd({ items: { data: [{ current_period_end: 1800000000 }] } }) === '2027-01-15T08:00:00.000Z' && stripeLib.periodEnd({}) === null);

  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_WEBHOOK_SECRET: WH, STRIPE_PRICE_YEAR: 'price_year', STRIPE_PRICE_LIFETIME: 'price_life', STRIPE_PRICE_MONTH: 'price_month' });
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
    await pi.fill('#signinCode', code); await pi.click('[data-act="signin-code"]');
    const codeIn = await until(pi, () => !document.querySelector('#signinCode') && !!document.querySelector('.tin'));
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
  check('a new household has everything on for 21 days and Setup says so', /Household plan\s*On for 21 more days/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="upgrade"][data-why="keep"]', a => a.length)) === 1);
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  check('the premium pieces wear a tag while they are on', await pb.$$eval('.chip.good', a => a.filter(c => /Household plan/.test(c.textContent)).length) >= 1 && (await pb.$$eval('.chip.lock', a => a.length)) === 0);
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('and a second lunchbox just works', (await pb.$$eval('#nkName', a => a.length)) === 1);
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  await pb.click('[data-act="kidpick-on"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="tab"][data-tab="pack"]'); await pb.waitForTimeout(250);
  check('kid\'s pick is on, with the tag beside it', (await pb.$$eval('[data-act="kid-start"]', a => a.length)) === 1 && (await pb.$$eval('.chip.good', a => a.filter(c => /Household plan/.test(c.textContent)).length)) >= 1);
  check('no banner nags in week one', (await pb.$$eval('.banner', a => a.filter(b => /three weeks/.test(b.textContent)).length)) === 0);
  await setBorn(19); await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('with three days left the app says when everything ends, once', /three weeks of everything end on [A-Z][a-z]{2} \d{1,2}/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="upgrade"][data-why="keep"]', a => a.length)) >= 1);
  await pb.click('[data-act="trial-dismiss"]'); await pb.waitForTimeout(200); await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('and Later means later', !/three weeks of everything end/.test(await pb.textContent('#view')));
  await setBorn(30); await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('when the three weeks are up it says so, once, and the plan sheet is one tap away', /three weeks are up/.test(await pb.textContent('#view')));
  await pb.click('[data-act="trial-dismiss"]'); await pb.waitForTimeout(200);
  check('kid\'s pick is now locked in place', (await pb.$$eval('[data-act="kid-start"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="upgrade"][data-why="kidpick"]', a => a.length)) === 1);
  await pb.click('[data-act="upgrade"][data-why="kidpick"]'); await pb.waitForTimeout(300);
  check('and tapping it explains, in the sheet', /Letting them pick/.test(await pb.textContent('#sheetBody')));
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  /* yesterday's box was packed, so this morning asks how it went: locked, with the question still visible */
  await pb.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0]; const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0,0,0,0);
    const iso = y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0');
    const slots = {}; for (const c of ['main','side','fruit','sweet']) { const f = k.foods.find(x => x.c === c && !x.deletedAt); if (f) slots[c] = f.id; }
    k.past = [{d: iso, dow: y.getDay(), slots, lock: {}, kidPick: {}}]; k.packed = k.packed || {}; k.packed[iso] = {main:{at:new Date().toISOString(), by:null}};
    localStorage.setItem('lunchsorted', JSON.stringify(d)); });
  await pb.reload(); await pb.waitForLoadState('load'); await pb.waitForTimeout(300);
  check('the morning review is locked in place: the question shows, the answers wait for the plan', /How did .*box go\?/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="eat-set"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="upgrade"][data-why="review"]', a => a.length)) === 1 && (await pb.$$eval('.chip.lock', a => a.length)) >= 1);
  await pb.click('[data-act="tab"][data-tab="shop"]'); await pb.waitForTimeout(250);
  check('the shopping list is still free, the pantry tick is not', (await pb.$$eval('[data-act="have"]', a => a.length)) > 0 && /part of the Household plan/.test(await pb.textContent('#view')));
  await pb.click('[data-act="have"]'); await pb.waitForTimeout(300);
  check('a pantry tick opens the sheet instead', /pantry that remembers/.test(await pb.textContent('#sheetBody')) && await pb.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lunchsorted')).pantry).length === 0));
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  const bcfg = await pb.evaluate(() => fetch('/api/billing').then(r => r.json()));
  check('the plans and their prices come from Stripe, not the app', bcfg.enabled === true && bcfg.prices.year.amount === 2900 && bcfg.prices.lifetime.amount === 7900 && bcfg.prices.year.interval === 'year', bcfg);
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('signed out, a second lunchbox opens the Household plan sheet with a sign-in button', (await pb.$$eval('#nkName', a => a.length)) === 0 && (await pb.$$eval('[data-act="go-signin"]', a => a.length)) === 1 && /second lunchbox/i.test(await pb.textContent('#sheetBody')));
  await pb.click('[data-act="go-signin"]'); await pb.waitForTimeout(300);
  check('and that button lands on the sign-in field', await pb.evaluate(() => document.activeElement && document.activeElement.id === 'signinEmail'));
  await pb.fill('#signinEmail', 'pat@example.com'); await pb.press('#signinEmail', 'Enter');
  await until(pb, () => !!document.querySelector('[data-dev-link]'));
  await pb.goto(await pb.getAttribute('[data-dev-link]', 'href')); await pb.click('button[type="submit"]'); await pb.waitForURL(/\/app\//); await pb.waitForLoadState('load');
  await until(pb, () => /Signed in as\s*pat@example\.com/.test(document.querySelector('#view').textContent) && !!document.querySelector('[data-act="upgrade"]'));
  check('signed in from a phone\'s Safari, the app says how to put it on the home screen, step by step, once', /bottom right/.test(await pb.textContent('#view')) && /Add to Home Screen/.test(await pb.textContent('#view')) && !!(await pb.$('.banner.hot [data-act="home-ok"]')));
  await pb.$eval('[data-act="home-ok"]', b => b.click()); await pb.waitForTimeout(200);   /* the resumed sheet sits over it in this flow; the tap itself is what is under test */
  check('and OK puts it away for good', !/Add to Home Screen/.test(await pb.textContent('#view')) && (await pb.evaluate(() => localStorage.getItem('lunchsorted-home-seen'))) === '1');
  const resumed = await until(pb, () => document.querySelector('#sheet').classList.contains('open') && /second lunchbox/i.test(document.querySelector('#sheetBody').textContent));
  check('after signing in, the plan sheet comes back on its own for the lunchbox they were adding', resumed);
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  check('signed in and free, Setup says Free and offers the plan', /Household plan\s*Not on/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="portal"]', a => a.length)) === 0 && (await pb.$$eval('.chip.lock', a => a.length)) >= 1);
  await pb.goto(BASE+'/app/?upgrade=1'); await pb.waitForLoadState('load');
  const viaMail = await until(pb, () => document.querySelector('#sheet').classList.contains('open') && /Household plan/.test(document.querySelector('#sheetBody').textContent));
  check('the link in a reminder email opens the plan sheet on arrival', viaMail && !pb.url().includes('upgrade='));
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  check('a signed-in parent who is not in ADMIN_EMAILS gets not-found from the numbers page', (await pb.evaluate(() => fetch('/api/admin').then(r => r.status))) === 404);
  const noCustomer = await pb.evaluate(() => fetch('/api/billing/portal', {method:'POST'}).then(r => r.status));
  check('there is no billing to manage before anything is bought', noCustomer === 404, noCustomer);
  await until(pb, () => fetch('/api/household').then(r => r.json()).then(j => j.version >= 1));
  const patState = await pb.evaluate(() => fetch('/api/household').then(r => r.json()));
  /* ---- the beta link: free forever for the first BETA_CAP households, switched on from the app once signed in */
  {
    const entPat = async () => (await db.query(`SELECT plan, source, status FROM entitlements WHERE household_id = ${patState.household.id}`)).rows[0];
    const betaPage = await (await fetch(NODE_BASE + '/beta')).text();
    check('the beta page says how many spots are left and links into the app with the code', /2 spots left/.test(betaPage) && betaPage.includes('/app/?beta=BETA-TEST-1234') && (betaPage.match(/<script/g) || []).length === 1 && /<script src="\/ga\.js" defer>/.test(betaPage) && /15 years/.test(betaPage) && /class="qr"><svg/.test(betaPage) && !/<script|on\w+=/.test(betaPage.slice(betaPage.indexOf('class="qr"'))), betaPage.slice(0, 200));
    const wrong = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-NOPE-0000' }) }).then(r => r.status));
    check('a wrong beta code grants nothing', wrong === 404 && ((await entPat()) || {}).plan !== 'lifetime', wrong);
    check('a stranger cannot claim the beta', (await fetch(NODE_BASE + '/api/billing/beta', { method: 'POST', body: JSON.stringify({ code: 'BETA-TEST-1234' }) })).status === 401);
    await pb.goto(BASE + '/app/?beta=BETA-TEST-1234'); await pb.waitForLoadState('load');
    let got = null; for (let i = 0; i < 40 && !(got && got.plan === 'lifetime'); i++) { await pb.waitForTimeout(250); got = await entPat(); }
    check('opening the beta link while signed in switches the household to forever, marked as the beta', !!got && got.plan === 'lifetime' && got.source === 'code' && got.status === 'active', got);
    check('the code leaves the address bar and the phone once used', !/beta=/.test(pb.url()) && (await pb.evaluate(() => localStorage.getItem('lunchsorted-beta'))) === null);
    await until(pb, () => /The beta is on/.test(document.querySelector('#view').textContent));
    check('and the app says so where it stays, in green', !!(await pb.$('.banner.good [data-act="notice-dismiss"]')));
    await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(250);
    check('a beta household has the feedback strip on every tab', !!(await pb.$('.betabar a[href="/feedback.html"], .betabar [data-act="help-site"]')) && /Beta tester/.test(await pb.textContent('.betabar')));
    await pb.click('[data-act="tab"][data-tab="foods"]'); await pb.waitForTimeout(250);
    check('on Foods too', !!(await pb.$('.betabar')));
    check('the beta page counts it', /1 spot left/.test(await (await fetch(NODE_BASE + '/beta')).text()));
    const again = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-TEST-1234' }) }).then(r => r.json().then(j => ({ status: r.status, already: j.already }))));
    check('claiming twice is fine and says so', again.status === 200 && again.already === true, again);
    await db.query(`UPDATE entitlements SET plan = 'household', source = 'stripe', status = 'active', stripe_subscription_id = 'sub_beta_x' WHERE household_id = ${patState.household.id}`);
    const paying = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-TEST-1234' }) }).then(r => r.json().then(j => ({ status: r.status, paying: j.paying }))));
    check('a household paying for the plan is refused the beta, so its card is not charged for nothing', paying.status === 409 && paying.paying === true && (await entPat()).plan === 'household', paying);
    await db.query(`UPDATE entitlements SET plan = 'lifetime', source = 'code', status = 'active', stripe_subscription_id = NULL WHERE household_id = ${patState.household.id}`);
    process.env.BETA_CAP = '1';
    const fullPage = await (await fetch(NODE_BASE + '/beta')).text();
    check('at the cap the page says the beta is full and takes an email for the list', /beta is full/.test(fullPage) && /name="waitlist"/.test(fullPage) && /value="beta-full"/.test(fullPage) && /action="\/on-the-list\.html"/.test(fullPage) && !/Join the beta/.test(fullPage));
    await db.query(`UPDATE entitlements SET plan = 'free', source = 'none', status = 'none' WHERE household_id = ${patState.household.id}`);
    process.env.BETA_CAP = '0';                                   /* closed: nobody else gets in, whatever the count */
    const full = await pb.evaluate(() => fetch('/api/billing/beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'BETA-TEST-1234' }) }).then(r => r.json().then(j => ({ status: r.status, full: j.full }))));
    check('and a claim past the cap is refused', full.status === 409 && full.full === true, full);
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
  await pb.click('[data-act="invite"]'); await pb.waitForTimeout(300);
  check('and the app opens the plan sheet instead, with all three prices', /other parent/i.test(await pb.textContent('#sheetBody')) && /\$29 a year/.test(await pb.textContent('#sheetBody')) && /\$3\.99 a month/.test(await pb.textContent('#sheetBody')) && /\$79, once, forever/.test(await pb.textContent('#sheetBody')));
  const monthly = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"month"}'}).then(r => r.json()));
  check('the monthly price opens a subscription checkout of its own', !!monthly.url && stripeCalls.some(c => c.path === '/v1/checkout/sessions' && c.params['line_items[0][price]'] === 'price_month' && c.params.mode === 'subscription' && c.params['subscription_data[metadata][plan]'] === 'month'));
  check('links in the sheet use the accent, not browser blue', await pb.$eval('#sheetBody a[href="/terms.html"]', a => getComputedStyle(a).color !== 'rgb(0, 0, 238)' && getComputedStyle(a).color !== 'rgb(0, 0, 255)'));
  const ownerCheckout = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.json()));
  check('checkout is opened on the server, for this household, on Stripe\'s page', ownerCheckout.url === 'https://checkout.stripe.com/c/pay/cs_test_1' &&
    stripeCalls.some(c => c.path === '/v1/checkout/sessions' && c.params.client_reference_id === String(patState.household.id) && c.params.mode === 'subscription' && c.params['line_items[0][price]'] === 'price_year' && c.params.customer_email === 'pat@example.com' && /\/app\/\?paid=1$/.test(c.params.success_url) && c.params['automatic_tax[enabled]'] === 'true' && c.auth === 'Bearer sk_test_stub'), stripeCalls.slice(-1));
  /* the iPhone app: Stripe opens in Safari and comes back through a page that hands off to the app */
  const iosCheckout = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year","client":"ios"}'}).then(r => r.json()));
  const iosCall = stripeCalls.filter(c => c.path === '/v1/checkout/sessions').pop();
  check('from the iPhone app, Stripe sends the parent back through the hand-off page', !!iosCheckout.url && iosCall && /\/back\.html\?paid=1$/.test(iosCall.params.success_url) && /\/back\.html\?paid=0$/.test(iosCall.params.cancel_url), iosCall && iosCall.params);
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
    await pa.click('[data-act="tab"][data-tab="setup"]'); await pa.waitForTimeout(250);
    check('and Setup does not tell an app to add itself to the Home Screen', !/Add to Home Screen/.test(await pa.textContent('#view')) && /on this phone/.test(await pa.textContent('#view')));
    await ctxApp.close();
  }
  stripeCalls.length = 0; globalThis.__LS_STRIPE_NO_TAX = true;
  await pb.click('[data-act="buy"][data-plan="year"]'); await pb.waitForURL(/checkout\.stripe\.com/); 
  check('when Stripe Tax is not set up yet, the checkout is retried without it and still opens', pb.url().startsWith('https://checkout.stripe.com/') && stripeCalls.filter(c => c.path === '/v1/checkout/sessions').length === 2 && stripeCalls[1].params['automatic_tax[enabled]'] === 'false');
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
  globalThis.__LS_SQL = async (strings, ...vals) => { if (blow && typeof strings !== 'string' && strings.join('').includes('INSERT INTO entitlements')) { blow = false; throw new Error('neon blinked'); } return realSql(strings, ...vals); };
  const blinked = await hook(completed);
  globalThis.__LS_SQL = realSql;
  const ok = await hook(completed);
  check('a delivery that failed mid-apply is retried by Stripe and applied the second time', blinked.status === 500 && ok.status === 200 && !ok.body.duplicate && (await ent()).plan === 'household', [blinked.status, ok.body]);
  check('a signed checkout.session.completed makes the household paid, with the renewal date from the subscription itself', (await ent()).status === 'active' && (await ent()).cust === 'cus_pat' && (await ent()).sub === 'sub_pat' && new Date((await ent()).pe).toISOString() === '2027-01-15T08:00:00.000Z' && stripeCalls.some(c => c.method === 'GET' && c.path === '/v1/subscriptions/sub_pat'), await ent());
  const again = await hook(completed);
  check('the same event delivered twice is a no-op', again.status === 200 && again.body.duplicate === true);
  const subEv = (id, type, created, extra = {}) => ({ id, type, created, data: { object: Object.assign({ id: 'sub_pat', object: 'subscription', customer: 'cus_pat', status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: 1800000000, price: { id: 'price_year' } }] }, metadata: { household_id: String(patState.household.id) } }, extra) } });
  const early = await hook(subEv('evt_2', 'customer.subscription.created', t0 - 1));
  check('the subscription.created event, stamped a second earlier, is stale and harmless', early.status === 200 && (await ent()).status === 'active');
  const staleHook = await hook(subEv('evt_0', 'customer.subscription.updated', t0 - 100, { status: 'canceled' }));
  check('an older event arriving late cannot undo a newer one', staleHook.status === 200 && (await ent()).status === 'active');

  await pb.goto(BASE+'/app/?paid=1'); await pb.waitForLoadState('load');
  const backOk = await until(pb, () => /Renews Jan 15, 2027/.test(document.querySelector('#view').textContent));
  if (!backOk) console.log('  (diag) url=' + pb.url() + ' view=' + (await pb.textContent('#view')).replace(/\s+/g, ' ').slice(0, 400) + ' errors=' + JSON.stringify(errors.slice(-3)));
  check('back from Stripe, the account card is at the top with the renewal date, Manage billing, and no second buy button', backOk && (await pb.$$eval('[data-act="portal"]', a => a.length)) === 1 && !pb.url().includes('paid=') &&
    await pb.evaluate(() => document.querySelector('#view .sect-head h3').textContent === 'Account') && (await pb.$$eval('[data-act="upgrade"]:not([data-why="forever"])', a => a.length)) === 0, (await pb.textContent('#view')).match(/Household plan[^\n]{0,60}/));
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('a paid household can add a second lunchbox', (await pb.$$eval('#nkName', a => a.length)) === 1);
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  const invitePaid = await pb.evaluate(() => fetch('/api/household/invite', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}).then(r => r.status));
  check('and invite the other parent', invitePaid === 200, invitePaid);
  const dupYear = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status));
  check('a household that already has the yearly plan is not sold it again', dupYear === 409);
  await pb.click('[data-act="upgrade"][data-why="forever"]'); await pb.waitForTimeout(300);
  check('Switch to forever offers only the forever price', (await pb.$$eval('[data-act="buy"][data-plan="year"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="buy"][data-plan="lifetime"]', a => a.length)) === 1 && /never renews/.test(await pb.textContent('#sheetBody')));
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  await pb.click('[data-act="portal"]'); await pb.waitForURL(/billing\.stripe\.com/);
  check('Manage billing opens Stripe\'s portal for this customer', stripeCalls.some(c => c.path === '/v1/billing_portal/sessions' && c.params.customer === 'cus_pat' && /\/app\/\?portal=1$/.test(c.params.return_url)));

  await hook(subEv('evt_3', 'customer.subscription.updated', t0 + 2, { cancel_at_period_end: true }));
  await pb.goto(BASE+'/app/?portal=1'); await pb.waitForLoadState('load');
  await until(pb, () => /Ends Jan 15, 2027/.test(document.querySelector('#view').textContent));
  check('a cancellation shows as the plan ending on its date, still paid until then', /Ends Jan 15, 2027/.test(await pb.textContent('#view')) && (await ent()).cape === true && (await ent()).status === 'active');
  await hook(subEv('evt_3b', 'customer.subscription.updated', t0 + 2, { status: 'past_due' }));
  await pb.reload(); await pb.waitForLoadState('load'); await pb.click('[data-act="tab"][data-tab="setup"]');
  await until(pb, () => /Payment failed/.test(document.querySelector('#view').textContent));
  check('a failed payment says so with the date, keeps the plan for now, and makes Manage billing the main button', /update the card in Manage billing, or the Household plan ends on Jan 15, 2027/i.test(await pb.textContent('#view')) && await pb.$eval('[data-act="portal"]', b => b.classList.contains('primary')) && (await pb.$$eval('[data-act="upgrade"]:not([data-why="forever"])', a => a.length)) === 0);
  const pastDueYear = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status));
  check('and a second yearly checkout is refused while the first is unpaid', pastDueYear === 409);
  await hook(subEv('evt_4', 'customer.subscription.deleted', t0 + 3, { status: 'canceled' }));
  check('when the subscription ends the household is free again', (await ent()).plan === 'free' && (await ent()).status === 'canceled' && (await ent()).cust === 'cus_pat');
  await pb.reload(); await pb.waitForLoadState('load'); await pb.click('[data-act="tab"][data-tab="setup"]');
  await until(pb, () => /Household plan\s*Not on/.test(document.querySelector('#view').textContent));
  const portalStill = (await pb.$$eval('[data-act="portal"]', a => a.length)) === 1;
  await pb.click('[data-act="tab"][data-tab="week"]'); await pb.waitForTimeout(200); await pb.click('[data-act="box-settings"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('and the second lunchbox is gated again, with Manage billing still there for the invoices', (await pb.$$eval('#nkName', a => a.length)) === 0 && portalStill);
  await pb.click('#sheetClose'); await pb.waitForTimeout(200);

  /* forever */
  await hook({ id: 'evt_5', type: 'checkout.session.completed', created: t0 + 4, data: { object: { id: 'cs_test_2', mode: 'payment', payment_status: 'paid', customer: 'cus_pat', client_reference_id: String(patState.household.id), metadata: { household_id: String(patState.household.id), plan: 'lifetime' } } } });
  check('a lifetime purchase is forever', (await ent()).plan === 'lifetime' && (await ent()).status === 'active' && (await ent()).pe === null);
  await hook(subEv('evt_6', 'customer.subscription.deleted', t0 + 5, { status: 'canceled' }));
  check('and an old subscription ending later does not touch it', (await ent()).plan === 'lifetime');
  const lifeAgain = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"lifetime"}'}).then(r => r.status));
  check('nor is forever sold twice', lifeAgain === 409);
  await pb.reload(); await pb.waitForLoadState('load'); await pb.click('[data-act="tab"][data-tab="setup"]');
  const forever = await until(pb, () => /Household plan\s*Forever/.test(document.querySelector('#view').textContent));
  check('Setup says forever and offers no upgrade', forever && (await pb.$$eval('[data-act="upgrade"]', a => a.length)) === 0 && (await pb.$$eval('[data-act="portal"]', a => a.length)) === 1);
  /* a yearly household that buys forever stops its subscription so nobody pays twice */
  await db.query(`UPDATE entitlements SET plan='household', status='active', stripe_subscription_id='sub_old', event_at=NULL WHERE household_id=${patState.household.id}`);
  stripeCalls.length = 0;
  await hook({ id: 'evt_7', type: 'checkout.session.completed', created: t0 + 6, data: { object: { id: 'cs_test_3', mode: 'payment', payment_status: 'paid', customer: 'cus_pat', client_reference_id: String(patState.household.id), metadata: { plan: 'lifetime' } } } });
  check('buying forever on top of a yearly plan stops the yearly plan at its period end', (await ent()).plan === 'lifetime' && stripeCalls.some(c => c.path === '/v1/subscriptions/sub_old' && c.params.cancel_at_period_end === 'true'));
  await hook({ id: 'evt_refund_part', type: 'charge.refunded', created: t0 + 8, data: { object: { id: 'ch_1', object: 'charge', customer: 'cus_pat', refunded: false } } });
  check('a partial refund changes nothing', (await ent()).plan === 'lifetime');
  await hook({ id: 'evt_refund', type: 'charge.refunded', created: t0 + 9, data: { object: { id: 'ch_1', object: 'charge', customer: 'cus_pat', refunded: true } } });
  check('a forever purchase refunded in full is undone', (await ent()).plan === 'free' && (await ent()).status === 'canceled');
  /* a beta tester: forever, on a 100%-off code, nothing charged; the admin page lists them by email */
  await hook({ id: 'evt_tester', type: 'checkout.session.completed', created: t0 + 9.5, data: { object: { id: 'cs_test_t', mode: 'payment', payment_status: 'no_payment_required', amount_total: 0, customer: 'cus_pat', client_reference_id: String(patState.household.id), metadata: { plan: 'lifetime' } } } });
  check('a forever plan on a 100%-off code is marked as a code, not a sale', (await ent()).plan === 'lifetime' && (await ent()).source === 'code', await ent());
  {
    const testers = (await adminStats()).testers;
    check('the numbers page lists the beta testers by email, with when they came in and were last seen', testers.length === 1 && /pat@example\.com/.test(testers[0].emails) && testers[0].plan === 'lifetime' && !!testers[0].since && !!testers[0].lastSeen, testers);
  }
  await hook({ id: 'evt_refund_t', type: 'charge.refunded', created: t0 + 9.6, data: { object: { id: 'ch_t', object: 'charge', customer: 'cus_pat', refunded: true } } });
  check('undoing it clears the tester mark too', (await ent()).plan === 'free' && (await ent()).source === 'none', await ent());
  /* who may manage billing: the owner, and whoever paid; a helper may buy nothing */
  await db.query(`UPDATE entitlements SET plan='household', status='active', stripe_subscription_id='sub_pat', paid_by=NULL WHERE household_id=${patState.household.id}`);
  await pb.reload(); await pb.waitForLoadState('load'); await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(300);
  await pb.click('[data-act="invite-helper"]'); await until(pb, () => !!document.querySelector('#inviteUrl'));
  const sitterUrl = await pb.inputValue('#inviteUrl');
  const ctxH = await phone(); const ph = await ctxH.newPage(); ph.on('pageerror', e => errors.push(String(e.message)));
  await ph.goto(sitterUrl); await ph.waitForLoadState('load'); await until(ph, () => !!document.querySelector('#signinEmail'));
  await ph.fill('#signinEmail', 'sitter@example.com'); await ph.press('#signinEmail', 'Enter'); await until(ph, () => !!document.querySelector('[data-dev-link]'));
  await ph.goto(await ph.getAttribute('[data-dev-link]', 'href')); await ph.click('button[type="submit"]'); await ph.waitForURL(/\/app\//); await ph.waitForLoadState('load');
  await until(ph, () => !!document.querySelector('[data-act="join-accept"]')); await ph.click('[data-act="join-accept"]');
  await until(ph, () => /Read-only on this phone/.test(document.querySelector('#view').textContent));
  const helperBuy = await ph.evaluate(() => Promise.all([fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status), fetch('/api/billing/portal', {method:'POST'}).then(r => r.status)]));
  check('a helper can neither buy nor manage billing, and sees no plan line', helperBuy[0] === 403 && helperBuy[1] === 403 && !/Household plan/.test(await ph.textContent('#view')), helperBuy);
  await db.query(`UPDATE entitlements SET plan='free', status='none' WHERE household_id=${patState.household.id}`);
  await ph.reload(); await ph.waitForLoadState('load'); await until(ph, () => /Read-only on this phone/.test(document.querySelector('#view').textContent));
  await ph.click('[data-act="tab"][data-tab="pack"]'); await ph.waitForTimeout(250);
  check('and on a lapsed household a helper sees no locks, tags or banners either', (await ph.$$eval('.chip.lock, .chip.good, [data-act="upgrade"], [data-act="trial-dismiss"]', a => a.filter(x => /Household|three weeks/.test(x.textContent)).length)) === 0);
  await db.query(`UPDATE entitlements SET plan='household', status='active' WHERE household_id=${patState.household.id}`);
  await ctxH.close();
  await pb.click('[data-act="invite"]'); await until(pb, () => /works once, for a week\./.test(document.querySelector('#view').textContent));
  const adultUrl = await pb.inputValue('#inviteUrl');
  const ctxA = await phone(); const pa = await ctxA.newPage(); pa.on('pageerror', e => errors.push(String(e.message)));
  await pa.goto(adultUrl); await pa.waitForLoadState('load'); await until(pa, () => !!document.querySelector('#signinEmail'));
  await pa.fill('#signinEmail', 'other@example.com'); await pa.press('#signinEmail', 'Enter'); await until(pa, () => !!document.querySelector('[data-dev-link]'));
  await pa.goto(await pa.getAttribute('[data-dev-link]', 'href')); await pa.click('button[type="submit"]'); await pa.waitForURL(/\/app\//); await pa.waitForLoadState('load');
  await until(pa, () => !!document.querySelector('[data-act="join-accept"]')); await pa.click('[data-act="join-accept"]');
  await until(pa, () => /Household plan/.test(document.querySelector('#view').textContent));
  const otherPortal = await pa.evaluate(() => fetch('/api/billing/portal', {method:'POST'}).then(r => r.status));
  check('the other parent sees the plan but cannot open the payer\'s billing', otherPortal === 403 && (await pa.$$eval('[data-act="portal"]', a => a.length)) === 0, otherPortal);
  await ctxA.close();
  /* deleting the account stops the money */
  stripeCalls.length = 0;
  await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(250);
  check('the delete warning says the yearly plan stops', /yearly plan stops at once/.test(await pb.textContent('#view')));
  await pb.click('[data-act="delete-account"]'); await pb.waitForTimeout(150); await pb.click('[data-act="delete-account"]');
  await until(pb, () => !!document.querySelector('.ob') && !!localStorage.getItem('lunchsorted'));
  check('deleting the account cancels the subscription at Stripe', stripeCalls.some(c => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_pat'));
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

  /* --------------------------------------------------------- the website */
  const site = await ctx.newPage();
  const siteErrors = [];
  site.on('pageerror', e => siteErrors.push(String(e.message)));
  await site.goto(BASE+'/');
  await site.waitForTimeout(400);
  check('the landing page never scrolls sideways on a phone',
    !(await site.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  /* wake the lazy images the way a reader does: a screen at a time, top to bottom */
  await site.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } window.scrollTo(0, document.body.scrollHeight); });
  await site.waitForTimeout(600);
  check('the three email screenshots are on the site', ['1','3','6'].every(d => fs.existsSync('public/img/mail-day'+d+'.png')));
  check('every screenshot on the landing page loads',
    await site.$$eval('img', a => a.length > 0 && a.every(i => i.complete && i.naturalWidth > 0)));
  check('screenshots ship as WebP with a PNG fallback and load lazily',
    await site.$$eval('picture source[type="image/webp"]', a => a.length) === 5 &&
    await site.$$eval('.shots img[loading="lazy"]', a => a.length) === 4);
  check('the honeypot is hidden from assistive tech and the tab order',
    await site.$eval('input[name="bot-field"]', i => i.closest('[aria-hidden="true"]') !== null && i.getAttribute('tabindex') === '-1'));
  warn('og:image is an absolute URL (set once the domain exists)',
    /^https?:\/\//.test(await site.$eval('meta[property="og:image"]', m => m.content)));
  check('the landing page says what is free, what the plan costs, and where the terms are',
    await site.evaluate(() => { const p = document.querySelector('#pricing'); return !!p && /\$29/.test(p.textContent) && /\$3\.99/.test(p.textContent) && /\$79/.test(p.textContent) && /three weeks/.test(p.textContent) && !!p.querySelector('a[href="/terms.html"]') && !!p.querySelector('a[href="/app/"]'); }));
  check('the waitlist form is wired to Netlify',
    await site.$eval('form.signup', f => f.getAttribute('data-netlify') === 'true' &&
      !!f.querySelector('input[name="form-name"]')));
  await site.goto(BASE+'/feedback.html'); await site.waitForTimeout(250);
  check('the feedback page is a Netlify form with an email, the story, and a keep-using-it answer, sent to a thank-you page', await site.$eval('form[name="feedback"]', f => f.getAttribute('data-netlify') === 'true' && !!f.querySelector('input[name="form-name"][value="feedback"]') && !!f.querySelector('input[name="email"][required]') && !!f.querySelector('textarea[name="what"][required]') && f.querySelectorAll('input[name="keep"]').length === 3 && !!f.querySelector('textarea[name="ideas"]') && f.querySelectorAll('input[name="want"]').length === 5 && f.getAttribute('action') === '/thanks.html' && !!f.querySelector('input[name="bot-field"]')));
  await site.goto(BASE+'/help.html'); await site.waitForTimeout(250);
  check('the help page answers the questions and points at the planner and the address', /pick the week/.test(await site.textContent('body')) && !!(await site.$('a[href="/app/"]')) && !!(await site.$('a[href^="mailto:hello@lunchsorted.app"]')));
  await site.goto(BASE+'/privacy.html');
  await site.waitForTimeout(250);
  warn('the privacy page has a real contact address, not the placeholder',
    !(await site.content()).includes('hello@example.com'));
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
