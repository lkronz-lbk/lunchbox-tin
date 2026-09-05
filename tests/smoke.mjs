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
globalThis.__LS_SQL = async (strings, ...vals) => typeof strings === 'string' ? (await db.query(strings)).rows : (await db.sql(strings, ...vals)).rows;
await migrate(globalThis.__LS_SQL);
const { default: authHandler } = await import('../netlify/functions/api-auth.js');
const { default: householdHandler } = await import('../netlify/functions/api-household.js');
const { default: billingHandler } = await import('../netlify/functions/api-billing.js');
const stripeLib = await import('../netlify/lib/stripe.js');
/* Stripe itself is a stub: it answers the four calls the code makes and records what it was asked */
const stripeCalls = [];
globalThis.__LS_STRIPE_FETCH = async (url, init) => {
  const u = new URL(url); const params = Object.fromEntries(new URLSearchParams(init.body || ''));
  stripeCalls.push({ method: init.method, path: u.pathname, params, auth: init.headers.authorization });
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/v1/prices/price_year') return reply({ id: 'price_year', unit_amount: 2900, currency: 'usd', recurring: { interval: 'year' } });
  if (u.pathname === '/v1/prices/price_life') return reply({ id: 'price_life', unit_amount: 7900, currency: 'usd' });
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
  const handler = req.url.startsWith('/api/auth/') ? authHandler : req.url.startsWith('/api/billing') ? billingHandler : householdHandler;
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
  if(p === '/' || p === '/index.html') return POLICIES['/index.html'];
  return POLICIES[p] || null;
}
const TYPES = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.json':'application/json',
  '.webmanifest':'application/manifest+json','.txt':'text/plain','.svg':'image/svg+xml'};

function serve(){
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(p.startsWith('/api/')) return apiProxy(req, res);
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
const ctx = await browser.newContext({ viewport:{width:375,height:812} });
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
  const notes = await page.$$eval('.note', a => a.filter(n => n.textContent.trim().length > 10).length);
  const planned = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids[0].week.days.length);
  check('each day gets a pairing note', planned >= 2 && notes >= planned, {notes, planned});
  check('excluded allergens never enter the list', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    return !d.kids[0].foods.some(f => (f.al||[]).includes('nuts') || (f.al||[]).includes('dairy'));
  }));

  /* ------------------------------------------------------------ packing */
  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(200);
  const before = await page.textContent('.count');
  await page.click('.cmp[data-act="toggle"]');
  await page.waitForTimeout(200);
  check('ticking a compartment moves the progress count',
    before !== await page.textContent('.count'));
  check('packing records who and when', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    for(const k of d.kids) for(const dt in k.packed) for(const c in k.packed[dt])
      return !!k.packed[dt][c].by && !!k.packed[dt][c].at;
    return false;
  }));

  /* ---------------------------------------------------------- kid's pick */
  await page.click('[data-act="kid-start"]');
  await page.waitForTimeout(250);
  check("kid's pick takes over the screen with two pictures",
    (await page.$$eval('.kidmode .pick', a => a.length)) === 2);
  const firstMainLabel = await page.textContent('.kidmode h1');
  check("the main is asked first, by name, in a child's words", /^Nia, pick your lunch/i.test(firstMainLabel.trim()), firstMainLabel);
  check('the exit is worded for the parent', /give the phone back/i.test(await page.textContent('[data-act="kid-exit"]')));
  check('the eyebrow above it uses the same word', /^lunch/i.test((await page.textContent('.kidmode .catlab')).trim()));
  const chosenMain = await page.getAttribute('.kidmode .pick >> nth=1', 'data-id');   /* option B, not the draw */
  await page.click('.kidmode .pick >> nth=1'); await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) { await page.click('.kidmode .pick >> nth=0'); await page.waitForTimeout(150); }
  check('four taps end on the finished box', (await page.$$eval('.kiddone .tin .cmp', a => a.length)) === 4);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  const afterPick = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted'));
    const k = d.kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return {main: day.slots.main, locked: Object.values(day.lock).every(Boolean),
      picked: Object.keys(day.kidPick || {}).length,
      by: !!(day.kidPick && day.kidPick.main && d.members.some(m => m.id === day.kidPick.main.by) && day.kidPick.main.picker === 'kid')};
  });
  check("the kid's choice replaced the draw", afterPick.main === chosenMain, afterPick);
  check('kid-picked compartments are locked and attributed', afterPick.locked && afterPick.picked === 4 && afterPick.by, afterPick);
  check('the pack list says who picked', (await page.textContent('#view')).includes(' picked'));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
  await page.click('[data-act="shuffle-day"] >> nth=0'); await page.waitForTimeout(300);
  const stillMain = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchsorted')).kids[0];
    const t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return day.slots.main;
  });
  check("a re-draw does not overwrite what the kid chose", stillMain === chosenMain);
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(200);

  /* ----------------------------------------------------------- shopping */
  await page.click('[data-act="tab"][data-tab="shop"]');
  await page.waitForTimeout(200);
  const rows = await page.$$eval('.list .item', a => a.length);
  check('the week produces a shopping list', rows > 0, rows);
  const head = await page.textContent('.count');
  await page.click('.list .item');
  await page.waitForTimeout(200);
  check('a pantry tick moves an item out of the buy count', head !== await page.textContent('.count'));

  /* -------------------------------------------------- second lunchbox */
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="add-kid"]');
  await page.waitForTimeout(350);
  await page.fill('#nkName', 'Sam');
  await page.click('[data-act="save-kid"]');
  await page.waitForTimeout(350);
  await page.click('[data-act="seed"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="allergen"][data-k="gluten"]');
  await page.waitForTimeout(250);
  const rules = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted'))
    .kids.filter(k => !k.deletedAt).map(k => k.settings.avoidAllergens.join('+')));
  check('each lunchbox keeps its own rules', rules[0] !== rules[1], rules);

  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(250);
  const lines = await page.$$eval('.kidline', a => a.length);
  check('filling a new lunchbox\'s list also plans it, so the pack list covers every lunchbox', lines === 2, lines);

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
  check('the day-of-week chips are named in full for a screen reader', (await page.$$eval('.dow .tg[aria-label]', a => a.length)) === 7);
  check('every tappable control on Setup is at least 44px tall', smallSetup.length === 0, smallSetup);
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
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
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
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="kid-start"]'); await page.waitForTimeout(250);
  check("kid's pick walks all six compartments", (await page.$$eval('.kidmode .dots i', a => a.length)) === 6);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
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
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
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
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);

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

  /* stopping the kid's pick midway keeps what was already chosen */
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="kid-start"]'); await page.waitForTimeout(250);
  const partial = await page.getAttribute('.kidmode .pick >> nth=1', 'data-id');
  await page.click('.kidmode .pick >> nth=1'); await page.waitForTimeout(150);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  const kidKept = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return {main: day.slots.main, locked: day.lock.main, picker: day.kidPick && day.kidPick.main && day.kidPick.main.picker,
      by: d.members.some(m => m.id === (day.kidPick && day.kidPick.main && day.kidPick.main.by))};
  });
  check('a choice the kid already made survives Stop', kidKept.main === partial && kidKept.locked && kidKept.picker === 'kid' && kidKept.by, kidKept);

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
  check('and offers no Re-draw on a day that has gone', (await page.$$eval('.daycard.past [data-act="shuffle-day"]', a => a.length)) === 0);

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
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
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
  check('the marketing pages carry a CSP too', !!POLICIES['/index.html'] && !!POLICIES['/privacy.html'] && !!POLICIES['/terms.html']);

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
  const ctx2 = await browser.newContext({ viewport:{width:375,height:812} });
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errors.push(String(e.message)));
  await p2.goto(BASE+'/app/'); await p2.waitForTimeout(400);
  await p2.fill('#obName', 'Ollie'); await p2.click('[data-act="ob-go"]'); await p2.waitForTimeout(400);   /* Sam has his own lunches already */
  await p2.goto(inviteUrl); await p2.waitForLoadState('load');
  await until(p2, () => /invited you to share/i.test(document.querySelector('#view').textContent));
  check('the invite opens at the top of Setup, naming who sent it', await p2.evaluate(() => { const v = document.querySelector('#view'); return /liz@example\.com|Liz/.test(v.textContent) && /invited you to share/i.test(v.textContent) && !!v.querySelector('#signinEmail'); }), (await p2.textContent('#view')).slice(0, 160));
  await p2.fill('#signinEmail', 'sam@example.com'); await p2.click('[data-act="signin-request"]');
  await until(p2, () => !!document.querySelector('#signinCode'));
  const devCode = await p2.evaluate(() => fetch('/api/auth/request', {method:'POST', headers:{'content-type':'application/json'}, body:'{"email":"sam@example.com"}'}).then(r => r.json()).then(j => j.devCode));
  await p2.fill('#signinCode', devCode.toLowerCase()); await p2.press('#signinCode', 'Enter');
  await until(p2, () => /Join their household/.test(document.querySelector('#view').textContent));
  check('the code from the email signs in without leaving the app, and offers the household', /Join their household/.test(await p2.textContent('#view')) && await p2.evaluate(() => fetch('/api/household').then(r => r.status)) === 200);
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
  const ctx3 = await browser.newContext({ viewport:{width:375,height:812} });
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
  await p3.click('[data-act="plan-kid"]'); await p3.waitForTimeout(200);
  check('and the app says so instead of pretending', /Only a parent can change the plan/.test(await p3.textContent('#toast')));
  await ctx3.close();

  /* sign out keeps the phone's copy; delete removes the household everywhere */
  await p2.click('[data-act="tab"][data-tab="setup"]'); await p2.waitForTimeout(250);
  await p2.click('[data-act="signout"]'); await until(p2, () => !!document.querySelector('#signinEmail'));
  check('signing out keeps the lunches on that phone', await p2.evaluate(() => JSON.parse(localStorage.getItem('lunchsorted')).kids.some(k => k.foods.length)));
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
  check('a test key in production, or a live key anywhere else, refuses to start', guard('production', 'sk_test_x') && guard('staging', 'sk_live_x') && !guard('production', 'sk_live_x') && !guard('staging', 'sk_test_x'));
  const WH = 'whsec_test_secret';
  const sign = (body, t = Math.floor(Date.now() / 1000), secret = WH) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  check('a webhook signature is checked against the raw body and the clock',
    stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}'), WH) && !stripeLib.verifyWebhook('{"a":2}', sign('{"a":1}'), WH) &&
    !stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}', Math.floor(Date.now() / 1000) - 600), WH) && !stripeLib.verifyWebhook('{"a":1}', sign('{"a":1}', undefined, 'whsec_other'), WH) && !stripeLib.verifyWebhook('{"a":1}', '', WH));
  check('the period end is read from either shape of subscription',
    stripeLib.periodEnd({ current_period_end: 1800000000 }) === '2027-01-15T08:00:00.000Z' && stripeLib.periodEnd({ items: { data: [{ current_period_end: 1800000000 }] } }) === '2027-01-15T08:00:00.000Z' && stripeLib.periodEnd({}) === null);

  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_stub', STRIPE_WEBHOOK_SECRET: WH, STRIPE_PRICE_YEAR: 'price_year', STRIPE_PRICE_LIFETIME: 'price_life' });
  const ctxB = await browser.newContext({ viewport:{width:375,height:812} });
  const pb = await ctxB.newPage(); pb.on('pageerror', e => errors.push(String(e.message)));
  await pb.route('https://checkout.stripe.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe checkout</title>' }));
  await pb.route('https://billing.stripe.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe portal</title>' }));
  await pb.goto(BASE+'/app/'); await pb.waitForTimeout(400);
  await pb.fill('#obName', 'Remy'); await pb.click('[data-act="ob-go"]'); await pb.waitForTimeout(400);
  const bcfg = await pb.evaluate(() => fetch('/api/billing').then(r => r.json()));
  check('the plans and their prices come from Stripe, not the app', bcfg.enabled === true && bcfg.prices.year.amount === 2900 && bcfg.prices.lifetime.amount === 7900 && bcfg.prices.year.interval === 'year', bcfg);
  await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(250);
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('signed out, a second lunchbox opens the Household plan sheet with a sign-in button', (await pb.$$eval('#nkName', a => a.length)) === 0 && (await pb.$$eval('[data-act="go-signin"]', a => a.length)) === 1 && /second lunchbox/i.test(await pb.textContent('#sheetBody')));
  await pb.click('[data-act="go-signin"]'); await pb.waitForTimeout(300);
  check('and that button lands on the sign-in field', await pb.evaluate(() => document.activeElement && document.activeElement.id === 'signinEmail'));
  await pb.fill('#signinEmail', 'pat@example.com'); await pb.press('#signinEmail', 'Enter');
  await until(pb, () => !!document.querySelector('[data-dev-link]'));
  await pb.goto(await pb.getAttribute('[data-dev-link]', 'href')); await pb.click('button[type="submit"]'); await pb.waitForURL(/\/app\//); await pb.waitForLoadState('load');
  await until(pb, () => /Signed in as\s*pat@example\.com/.test(document.querySelector('#view').textContent) && !!document.querySelector('[data-act="upgrade"]'));
  const resumed = await until(pb, () => document.querySelector('#sheet').classList.contains('open') && /second lunchbox/i.test(document.querySelector('#sheetBody').textContent));
  check('after signing in, the plan sheet comes back on its own for the lunchbox they were adding', resumed);
  await pb.click('#sheetClose'); await pb.waitForTimeout(300);
  check('signed in and free, Setup says Free and offers the plan', /Household plan\s*Free/.test(await pb.textContent('#view')) && (await pb.$$eval('[data-act="portal"]', a => a.length)) === 0);
  const noCustomer = await pb.evaluate(() => fetch('/api/billing/portal', {method:'POST'}).then(r => r.status));
  check('there is no billing to manage before anything is bought', noCustomer === 404, noCustomer);
  await until(pb, () => fetch('/api/household').then(r => r.json()).then(j => j.version >= 1));
  const patState = await pb.evaluate(() => fetch('/api/household').then(r => r.json()));
  const inviteFree = await pb.evaluate(() => fetch('/api/household/invite', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}).then(r => r.status));
  check('the server refuses an invite from a free household', inviteFree === 402, inviteFree);
  await pb.click('[data-act="invite"]'); await pb.waitForTimeout(300);
  check('and the app opens the plan sheet instead, with both prices', /other parent/i.test(await pb.textContent('#sheetBody')) && /\$29 a year/.test(await pb.textContent('#sheetBody')) && /\$79, once, forever/.test(await pb.textContent('#sheetBody')));
  check('links in the sheet use the accent, not browser blue', await pb.$eval('#sheetBody a[href="/terms.html"]', a => getComputedStyle(a).color !== 'rgb(0, 0, 238)' && getComputedStyle(a).color !== 'rgb(0, 0, 255)'));
  const ownerCheckout = await pb.evaluate(() => fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.json()));
  check('checkout is opened on the server, for this household, on Stripe\'s page', ownerCheckout.url === 'https://checkout.stripe.com/c/pay/cs_test_1' &&
    stripeCalls.some(c => c.path === '/v1/checkout/sessions' && c.params.client_reference_id === String(patState.household.id) && c.params.mode === 'subscription' && c.params['line_items[0][price]'] === 'price_year' && c.params.customer_email === 'pat@example.com' && /\/app\/\?paid=1$/.test(c.params.success_url) && c.params['automatic_tax[enabled]'] === 'true' && c.auth === 'Bearer sk_test_stub'), stripeCalls.slice(-1));
  stripeCalls.length = 0; globalThis.__LS_STRIPE_NO_TAX = true;
  await pb.click('[data-act="buy"][data-plan="year"]'); await pb.waitForURL(/checkout\.stripe\.com/); 
  check('when Stripe Tax is not set up yet, the checkout is retried without it and still opens', pb.url().startsWith('https://checkout.stripe.com/') && stripeCalls.filter(c => c.path === '/v1/checkout/sessions').length === 2 && stripeCalls[1].params['automatic_tax[enabled]'] === 'false');
  globalThis.__LS_STRIPE_NO_TAX = false;
  const anon = await fetch(BASE+'/api/billing/checkout', { method: 'POST', body: '{}' });
  check('a stranger cannot open a checkout', anon.status === 401);

  /* Stripe calls back */
  const hook = async (ev, opts = {}) => { if (ev.livemode === undefined) ev.livemode = false; const body = JSON.stringify(ev); const r = await fetch(BASE+'/api/billing/webhook', { method:'POST', headers: { 'content-type':'application/json', 'stripe-signature': opts.sig === undefined ? sign(body, opts.t) : opts.sig }, body }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
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
  await until(pb, () => /Household plan\s*Free/.test(document.querySelector('#view').textContent));
  await pb.click('[data-act="add-kid"]'); await pb.waitForTimeout(350);
  check('and the second lunchbox is gated again, with Manage billing still there for the invoices', (await pb.$$eval('#nkName', a => a.length)) === 0 && (await pb.$$eval('[data-act="portal"]', a => a.length)) === 1);
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
  /* who may manage billing: the owner, and whoever paid; a helper may buy nothing */
  await db.query(`UPDATE entitlements SET plan='household', status='active', stripe_subscription_id='sub_pat', paid_by=NULL WHERE household_id=${patState.household.id}`);
  await pb.reload(); await pb.waitForLoadState('load'); await pb.click('[data-act="tab"][data-tab="setup"]'); await pb.waitForTimeout(300);
  await pb.click('[data-act="invite-helper"]'); await until(pb, () => !!document.querySelector('#inviteUrl'));
  const sitterUrl = await pb.inputValue('#inviteUrl');
  const ctxH = await browser.newContext({ viewport:{width:375,height:812} }); const ph = await ctxH.newPage(); ph.on('pageerror', e => errors.push(String(e.message)));
  await ph.goto(sitterUrl); await ph.waitForLoadState('load'); await until(ph, () => !!document.querySelector('#signinEmail'));
  await ph.fill('#signinEmail', 'sitter@example.com'); await ph.press('#signinEmail', 'Enter'); await until(ph, () => !!document.querySelector('[data-dev-link]'));
  await ph.goto(await ph.getAttribute('[data-dev-link]', 'href')); await ph.click('button[type="submit"]'); await ph.waitForURL(/\/app\//); await ph.waitForLoadState('load');
  await until(ph, () => !!document.querySelector('[data-act="join-accept"]')); await ph.click('[data-act="join-accept"]');
  await until(ph, () => /Read-only on this phone/.test(document.querySelector('#view').textContent));
  const helperBuy = await ph.evaluate(() => Promise.all([fetch('/api/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body:'{"plan":"year"}'}).then(r => r.status), fetch('/api/billing/portal', {method:'POST'}).then(r => r.status)]));
  check('a helper can neither buy nor manage billing, and sees no plan line', helperBuy[0] === 403 && helperBuy[1] === 403 && !/Household plan/.test(await ph.textContent('#view')), helperBuy);
  await ctxH.close();
  await pb.click('[data-act="invite"]'); await until(pb, () => /works once, for a week\./.test(document.querySelector('#view').textContent));
  const adultUrl = await pb.inputValue('#inviteUrl');
  const ctxA = await browser.newContext({ viewport:{width:375,height:812} }); const pa = await ctxA.newPage(); pa.on('pageerror', e => errors.push(String(e.message)));
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
  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_YEAR', 'STRIPE_PRICE_LIFETIME']) delete process.env[k];
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
  await site.evaluate(() => window.scrollTo(0, document.body.scrollHeight));   /* wake the lazy ones */
  await site.waitForTimeout(600);
  check('every screenshot on the landing page loads',
    await site.$$eval('img', a => a.length > 0 && a.every(i => i.complete && i.naturalWidth > 0)));
  check('screenshots ship as WebP with a PNG fallback and load lazily',
    await site.$$eval('picture source[type="image/webp"]', a => a.length) === 5 &&
    await site.$$eval('.shots img[loading="lazy"]', a => a.length) === 4);
  check('the honeypot is hidden from assistive tech and the tab order',
    await site.$eval('input[name="bot-field"]', i => i.closest('[aria-hidden="true"]') !== null && i.getAttribute('tabindex') === '-1'));
  warn('og:image is an absolute URL (set once the domain exists)',
    /^https?:\/\//.test(await site.$eval('meta[property="og:image"]', m => m.content)));
  check('the waitlist form is wired to Netlify',
    await site.$eval('form.signup', f => f.getAttribute('data-netlify') === 'true' &&
      !!f.querySelector('input[name="form-name"]')));
  await site.goto(BASE+'/privacy.html');
  await site.waitForTimeout(250);
  warn('the privacy page has a real contact address, not the placeholder',
    !(await site.content()).includes('hello@example.com'));
  check('no javascript errors anywhere', errors.length === 0 && siteErrors.length === 0,
    errors.concat(siteErrors));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${checks - failures}/${checks} checks passed` +
  (warnings ? `, ${warnings} launch gate${warnings > 1 ? 's' : ''} still open` : ''));
process.exit(failures ? 1 : 0);
