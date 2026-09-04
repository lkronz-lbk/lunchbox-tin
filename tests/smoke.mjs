/* End-to-end smoke tests for Five Boxes.
   No test framework and no build: a tiny static server plus Playwright.
     npm test                    (installs nothing if playwright is present)
     CHROMIUM_PATH=/path/to/chrome npm test
   Every check below guards something that has actually broken at least once. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPolicies } from '../scripts/csp.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
/* The test server enforces the same Content-Security-Policy Netlify will, so a
   policy that would break the app breaks the suite instead of the site. */
const POLICIES = readPolicies(fs.readFileSync(path.join(ROOT, '..', 'netlify.toml'), 'utf8'));
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
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({server, port: server.address().port})));
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
const BASE = `http://127.0.0.1:${port}`;

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
    await page.evaluate(() => JSON.parse(localStorage.getItem('fiveboxes')).kids[0].name === 'Nia'));
  check('the week header leads with the date', /^Week of /.test((await page.textContent('.view-title')).trim()));
  check('the week eyebrow counts the days actually planned', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0], words = ['No','One','Two','Three','Four','Five','Six','Seven'];
    return document.querySelector('.view-sub').textContent.trim().startsWith(words[k.week.days.length]); }));

  check('three taps land on a planned week',
    await page.getAttribute('nav.tabs [aria-current="true"]', 'data-tab') === 'week');
  const empties = await page.$$eval('.cmp.empty', a => a.length);
  check('every compartment is filled', empties === 0, empties);
  const notes = await page.$$eval('.note', a => a.filter(n => n.textContent.trim().length > 10).length);
  const planned = await page.evaluate(() => JSON.parse(localStorage.getItem('fiveboxes')).kids[0].week.days.length);
  check('each day gets a pairing note', planned >= 2 && notes >= planned, {notes, planned});
  check('excluded allergens never enter the list', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes'));
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
    const d = JSON.parse(localStorage.getItem('fiveboxes'));
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
    const d = JSON.parse(localStorage.getItem('fiveboxes'));
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
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
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
  const rules = await page.evaluate(() => JSON.parse(localStorage.getItem('fiveboxes'))
    .kids.filter(k => !k.deletedAt).map(k => k.settings.avoidAllergens.join('+')));
  check('each lunchbox keeps its own rules', rules[0] !== rules[1], rules);

  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(250);
  const lines = await page.$$eval('.kidline', a => a.length);
  check('filling a new lunchbox\'s list also plans it, so the pack list covers every lunchbox', lines === 2, lines);

  /* ------------------------------------------------- transfer round trip */
  const dump = await page.evaluate(() => localStorage.getItem('fiveboxes'));
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="import-open"]');
  await page.waitForTimeout(350);
  await page.fill('#impText', '{"hello":"world"}');
  await page.click('[data-act="import-do"]');
  await page.waitForTimeout(250);
  check('arbitrary JSON is refused', (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fiveboxes')).kids.filter(k => !k.deletedAt).length)) === 2);
  await page.fill('#impText', '{"foods":[],"settings":{},"week":{"days":[{}]}}');
  await page.click('[data-act="import-do"]');
  await page.waitForTimeout(250);
  check('a broken legacy save is refused with a message, not a crash', /not Five Boxes data/i.test(await page.textContent('#toast')) && errors.length === 0, errors);
  await page.fill('#impText', JSON.stringify({app:'fiveboxes', schema:2, account:JSON.parse(dump)}));
  await page.click('[data-act="import-do"]');           /* first tap arms */
  await page.waitForTimeout(200);
  await page.click('[data-act="import-do"]');           /* second applies */
  await page.waitForTimeout(400);
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('fiveboxes'))
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
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
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
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0,0,0,0);
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    k.week.days[0].d = iso(y);                     /* pretend the first box was yesterday */
    const c = new Date(); c.setDate(c.getDate() - 3); k.week.createdAt = c.toISOString();   /* and that the plan existed then */
    localStorage.setItem('fiveboxes', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(500);
  check("the morning after, it asks how the box went", (await page.$$eval('.review', a => a.length)) === 1);
  const reviewedFood = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0]; return k.week.days[0].slots.main; });
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
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0], f = k.foods.find(x => x.id === k.week.days[0].slots.main);
    return f && document.querySelector('#view').textContent.includes(f.n + ' came home'); }), summaryText.slice(0, 200));
  await page.click('[data-act="eat-change"]'); await page.waitForTimeout(200);
  await page.click('[data-act="eat-all"]'); await page.waitForTimeout(250);
  check('outcomes are stored against the food, with who and when', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    const rows = Object.values(k.eaten || {});
    return rows.length === 1 && Object.values(rows[0]).every(e => e.foodId && e.r === 'ate' && e.at && e.by);
  }));
  /* two "came home" in a row rests a food and says so */
  await page.evaluate(id => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
    const iso = n => { const x = new Date(); x.setDate(x.getDate() - n); x.setHours(0,0,0,0);
      return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
    k.eaten = {}; k.eaten[iso(2)] = {main:{foodId:id, r:'left'}}; k.eaten[iso(4)] = {main:{foodId:id, r:'left'}};
    d.activeKidId = k.id;                                    /* shuffle THIS lunchbox below */
    for (let i = 0; i < 6; i++) k.foods.push({id:'test_main_'+i, kidId:k.id, n:'Test main '+i, c:'main',
      t:['protein','soft'], a:'deli', al:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null});
    localStorage.setItem('fiveboxes', JSON.stringify(d));    /* enough mains that resting one costs nothing */
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
    restedDrawn += await page.evaluate(id => JSON.parse(localStorage.getItem('fiveboxes')).kids[0]
      .week.days.filter(x => x.slots.main === id).length, reviewedFood);
  }
  check('the draw leaves a resting food out', restedDrawn === 0, restedDrawn);
  let restedRedrawn = 0;
  for (let i = 0; i < 5; i++) {
    await page.click('.daycard:not(.past) [data-act="shuffle-day"] >> nth=0'); await page.waitForTimeout(200);
    restedRedrawn += await page.evaluate(id => JSON.parse(localStorage.getItem('fiveboxes')).kids[0]
      .week.days.filter(x => x.slots.main === id).length, reviewedFood);
  }
  check('and so does a single re-draw', restedRedrawn === 0, restedRedrawn);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fiveboxes')); d.kids[0].eaten = {}; localStorage.setItem('fiveboxes', JSON.stringify(d)); });
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
  const savedTags = await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    const f = k.foods.filter(x => x.n === 'Test seaweed snack').pop(); return f ? f.t : null; });
  check('a tag chosen under More is saved with the food', Array.isArray(savedTags) && savedTags.includes('salty') && savedTags.includes('crunchy'), savedTags);

  /* --------------------------------------------- optional slots and richer rules */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0], ts = new Date().toISOString();
    const mk = (id, n, c, tags) => ({id, kidId:k.id, n, c, t:tags, a:'other', al:[], createdAt:ts, updatedAt:ts, deletedAt:null});
    k.foods.push(mk('t_choc', 'Chocolate buttons', 'sweet', ['sweet']));
    k.foods.push(mk('t_ice',  'Test cold main', 'main', ['protein','soft','ice']));
    k.foods.push(mk('t_messy','Test messy side', 'side', ['messy']));
    localStorage.setItem('fiveboxes', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
  check('seeds & sesame is a keep-out option', (await page.$$eval('[data-act="allergen"][data-k="seeds"]', a => a.length)) === 1);
  await page.click('[data-act="compartment"][data-k="snack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="compartment"][data-k="drink"]'); await page.waitForTimeout(250);
  const slotState = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
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
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    return ['t_choc','t_ice','t_messy'].some(id => k.week.days.some(dy => Object.values(dy.slots).includes(id)));
  });
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
  const excludedAfter = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    return ['t_choc','t_ice','t_messy'].some(id => k.week.days.some(dy => Object.values(dy.slots).includes(id)));
  });
  check('a re-draw keeps every rule-breaking food out of the box', !excludedAfter, excludedAfter);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
    k.settings.noChoc = k.settings.noIce = k.settings.shortWindow = false;
    k.foods = k.foods.filter(f => !/^t_/.test(f.id));
    localStorage.setItem('fiveboxes', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* ------------------------------------------- correctness: rules, compartments, picks */
  const isoOff = n => { const x = new Date(); x.setDate(x.getDate()+n); x.setHours(0,0,0,0);
    return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };

  /* a rule tightened after the draw clears even a locked compartment */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0], ts = new Date().toISOString();
    k.foods.push({id:'t_dairy', kidId:k.id, n:'Test cheese stick', c:'side', t:['protein','soft'], a:'dairy', al:['dairy'], createdAt:ts, updatedAt:ts, deletedAt:null});
    k.settings.avoidAllergens = ['nuts'];
    k.week.days[0].slots.side = 't_dairy'; k.week.days[0].lock.side = true;
    d.activeKidId = k.id;
    localStorage.setItem('fiveboxes', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
  await page.click('[data-act="allergen"][data-k="dairy"]'); await page.waitForTimeout(300);
  const afterRule = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    return {side: k.week.days[0].slots.side, locked: k.week.days[0].lock.side};
  });
  check('a rule change clears a locked compartment that now breaks it and draws again',
    afterRule.side !== 't_dairy' && afterRule.side !== null && !afterRule.locked, afterRule);
  check('and says so', (await page.textContent('#toast')).includes('rules'));
  await page.click('[data-act="allergen"][data-k="dairy"]'); await page.waitForTimeout(200);

  /* a word typed into the avoid list sweeps the plan, and the sweep is saved */
  const avoidTarget = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return k.foods.find(f => f.id === day.slots.side).n; });
  await page.fill('#avoidText', avoidTarget);
  await page.locator('#avoidText').blur(); await page.waitForTimeout(300);   /* change fires on blur, as it does for a person */
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  check('a food typed into the avoid list is out of the week after a reload', await page.evaluate(name => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    return k.settings.avoidText === name && !k.week.days.some(d => { const f = k.foods.find(x => x.id === d.slots.side); return f && f.n === name; }); }, avoidTarget), avoidTarget);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fiveboxes')); d.kids[0].settings.avoidText = ''; localStorage.setItem('fiveboxes', JSON.stringify(d)); });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);

  /* switching a compartment off takes it out of the week and off the list */
  if ((await page.getAttribute('[data-act="compartment"][data-k="drink"]', 'aria-pressed')) !== 'true') {
    await page.click('[data-act="compartment"][data-k="drink"]'); await page.waitForTimeout(250); }   /* on */
  await page.click('[data-act="compartment"][data-k="drink"]'); await page.waitForTimeout(250);       /* off */
  const ghost = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    return k.week.days.some(dy => dy.slots.drink);
  });
  check('switching a compartment off clears it from this week', !ghost);
  await page.click('[data-act="tab"][data-tab="shop"]'); await page.waitForTimeout(250);
  const drinkNames = await page.evaluate(() => JSON.parse(localStorage.getItem('fiveboxes')).kids[0].foods.filter(f => f.c === 'drink').map(f => f.n));
  const shopText = await page.textContent('#view');
  check('and no drink is left on the shopping list', drinkNames.length > 0 && !drinkNames.some(n => shopText.includes(n)), drinkNames);

  /* stopping the kid's pick midway keeps what was already chosen */
  await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(250);
  await page.click('[data-act="kid-start"]'); await page.waitForTimeout(250);
  const partial = await page.getAttribute('.kidmode .pick >> nth=1', 'data-id');
  await page.click('.kidmode .pick >> nth=1'); await page.waitForTimeout(150);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  const kidKept = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0], t = new Date(); t.setHours(0,0,0,0);
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
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return !day.kidPick || !day.kidPick.main;
  });
  check('a manual swap clears the kid-picked mark', starGone);

  /* "Re-draw this one" on a kept compartment un-keeps it */
  await page.click('.daycard:not(.past) .tin .cmp[data-cat="side"] >> nth=0'); await page.waitForTimeout(350);
  if ((await page.getAttribute('[data-act="sheet-lock"]', 'aria-pressed')) !== 'true') { await page.click('[data-act="sheet-lock"]'); await page.waitForTimeout(200); }
  await page.click('[data-act="sheet-shuffle"]'); await page.waitForTimeout(350);
  check('re-drawing a kept compartment on purpose clears the keep', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return day.lock.side === false && !!day.slots.side; }));
  check('and says so', /no longer kept/i.test(await page.textContent('#toast')));
  await page.click('#backdrop', {position:{x:10, y:10}}); await page.waitForTimeout(300);

  /* an in-place re-draw leaves the days already gone exactly as they were */
  const pastKept = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const t = new Date(); t.setHours(0,0,0,0);
    const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    k.settings.days = [1,2,3,4,5];
    const pick = c => k.foods.filter(f => f.c === c && !f.deletedAt).map(f => f.id);
    k.week = {id:'week_test', kidId:k.id, start:iso(mon), createdAt:new Date(mon).toISOString(), updatedAt:new Date().toISOString(), days:[]};
    for (let i = 0; i < 5; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i);
      const slots = {}, lock = {}; ['main','side','fruit','sweet'].forEach(c => { slots[c] = pick(c)[i % pick(c).length] || null; lock[c] = false; });
      k.week.days.push({d:iso(x), dow:(i+1)%7, slots, lock, kidPick:{}}); }
    localStorage.setItem('fiveboxes', JSON.stringify(d));
    const filled = o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v)));
    return k.week.days.filter(x => x.d < iso(t)).map(x => filled(x.slots));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
  const pastAfter = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0], t = new Date(); t.setHours(0,0,0,0);
    const iso = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
    const filled = o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v)));
    return {slots: k.week.days.filter(x => x.d < iso(t)).map(x => filled(x.slots)), n: k.week.days.length};
  });
  check('a re-draw in place keeps the days already gone exactly as they were (vacuous on a Monday)',
    pastAfter.n === 5 && JSON.stringify(pastAfter.slots) === JSON.stringify(pastKept), {before: pastKept, after: pastAfter});
  check('and offers no Re-draw on a day that has gone', (await page.$$eval('.daycard.past [data-act="shuffle-day"]', a => a.length)) === 0);

  /* the pack view names the last day of a plan that has gone by */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
    k.week.days.forEach((dy, i) => { const x = new Date(); x.setDate(x.getDate() - 14 + i); x.setHours(0,0,0,0);
      dy.d = x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); });
    localStorage.setItem('fiveboxes', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  const gone = await page.evaluate(() => ({ sub: document.querySelector('.view-title').previousElementSibling.textContent,   /* the header, not the review card */
    last: JSON.parse(localStorage.getItem('fiveboxes')).kids[0].week.days.map(x => x.d).sort().pop(),
    all: JSON.parse(localStorage.getItem('fiveboxes')).kids.map(k => (k.deletedAt ? 'x' : '') + (k.week ? k.week.days.map(x => x.d).join(' ') : '-')) }));
  check('"Already packed" shows the last day of the old plan', gone.sub.includes('Already packed') &&
    gone.sub.includes(String(parseInt(gone.last.slice(8), 10))), gone);
  /* and the review does not ask about a box planned after the fact */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
    k.eaten = {}; k.packed = {}; k.week.createdAt = new Date().toISOString();
    const y = new Date(); y.setDate(y.getDate()-1); y.setHours(0,0,0,0);
    k.week.days[k.week.days.length-1].d = y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0');
    localStorage.setItem('fiveboxes', JSON.stringify(d));
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
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0], t = new Date(); t.setHours(0,0,0,0);
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
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fiveboxes'));
    d.kids = d.kids.filter(k => k.name !== 'Nobody'); d.activeKidId = d.kids[0].id; localStorage.setItem('fiveboxes', JSON.stringify(d)); });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* -------------------------------------------------- safety: bad data can't brick it */
  const goodDoc = await page.evaluate(() => localStorage.getItem('fiveboxes'));
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
      localStorage.setItem('fiveboxes', JSON.stringify(d));
    }, [goodDoc, mutate.toString().replace(/^[^{]*\{|\}$/g, '')]);
    await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
    const alive = await page.evaluate(() => !!document.querySelector('nav.tabs') && document.querySelectorAll('#view *').length > 5);
    check('storage with '+name+' still opens', alive);
  }
  await page.evaluate(raw => localStorage.setItem('fiveboxes', raw), goodDoc);

  /* an unreadable save is kept, not overwritten */
  await page.evaluate(() => localStorage.setItem('fiveboxes', '{"schema":2,"kids":[{"name":"Precious"'));
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  const kept = await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('fiveboxes-backup-') && localStorage.getItem(k).includes('Precious')));
  check('an unreadable save is backed up before anything is written', kept);
  check('and the app says so', (await page.textContent('#view')).includes('could not be read'));
  await page.evaluate(() => { Object.keys(localStorage).filter(k => k.startsWith('fiveboxes-backup-')).forEach(k => localStorage.removeItem(k)); });
  await page.evaluate(raw => localStorage.setItem('fiveboxes', raw), goodDoc);

  /* hostile ids are neutralised at the boundary */
  await page.evaluate(raw => {
    const d = JSON.parse(raw);
    d.kids[0].id = 'kid_"><img src=x onerror="window.__pwned=1">';
    d.kids[0].foods.forEach(f => f.kidId = d.kids[0].id);
    localStorage.setItem('fiveboxes', JSON.stringify(d));
  }, goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);
  check('a hostile id in stored data cannot inject markup', await page.evaluate(() => !window.__pwned && !document.querySelector('img[src="x"]')));
  await page.evaluate(raw => localStorage.setItem('fiveboxes', raw), goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* a food called Constructor is just a food */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0], ts = new Date().toISOString();
    k.foods.push({id:'t_ctor', kidId:k.id, n:'Constructor', c:'side', t:['crunchy'], a:'snacks', al:[], createdAt:ts, updatedAt:ts, deletedAt:null});
    k.week.days[0].slots.side = 't_ctor';
    localStorage.setItem('fiveboxes', JSON.stringify(d));
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
  const afterClear = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fiveboxes')); return {week: d.kids[0].week, pantry: Object.keys(d.pantry).length}; });
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
  await page.evaluate(() => { localStorage.setItem('lunchbox-tin', localStorage.getItem('fiveboxes')); localStorage.setItem('lunchbox-tin-v1', '{"foods":[],"settings":{}}'); localStorage.setItem('fiveboxes-backup-1', '{"old":1}'); });
  await page.click('[data-act="tab"][data-tab="setup"]'); await page.waitForTimeout(200);
  await page.click('[data-act="clear-all"]'); await page.waitForTimeout(150);
  await page.click('[data-act="clear-all"]'); await page.waitForTimeout(300);
  check('"Erase everything" also removes the copies saved under the old name, and the backups',
    await page.evaluate(() => !localStorage.getItem('lunchbox-tin') && !localStorage.getItem('lunchbox-tin-v1') && !Object.keys(localStorage).some(k => k.startsWith('fiveboxes-backup-'))));
  await page.evaluate(raw => localStorage.setItem('fiveboxes', raw), goodDoc);
  await page.goto(BASE+'/app/'); await page.waitForTimeout(400);

  /* pruning keeps the document bounded */
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes')), k = d.kids[0];
    k.packed['2020-01-06'] = {main:{at:'2020-01-06T08:00:00Z', by:null}};
    k.eaten['2020-01-06'] = {main:{foodId:k.foods[0].id, r:'ate', at:'2020-01-06T15:00:00Z', by:null}};
    k.foods.push({id:'t_old', kidId:k.id, n:'Old thing', c:'side', t:[], a:'other', al:[], createdAt:'2020-01-01T00:00:00Z', updatedAt:'2020-01-01T00:00:00Z', deletedAt:'2020-01-02T00:00:00Z'});
    localStorage.setItem('fiveboxes', JSON.stringify(d));
  });
  await page.goto(BASE+'/app/'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(150);
  await page.click('[data-act="plan-kid"]'); await page.waitForTimeout(300);
  check('a re-plan prunes ancient ticks, outcomes and tombstones', await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('fiveboxes')).kids[0];
    return !k.packed['2020-01-06'] && !k.eaten['2020-01-06'] && !k.foods.some(f => f.id === 't_old');
  }));

  /* the site is served under its real CSP (the server above enforces netlify.toml) */
  check('the app runs under the generated Content-Security-Policy', !!POLICIES['/app/*'] && POLICIES['/app/*'].includes('sha256-'));
  check('the marketing pages carry a CSP too', !!POLICIES['/index.html'] && !!POLICIES['/privacy.html']);

  /* --------------------------------------------- the old name's data survives */
  await page.evaluate(() => {
    const doc = localStorage.getItem('fiveboxes');
    localStorage.clear();
    localStorage.setItem('lunchbox-tin', doc);          /* saved under the app's earlier name */
  });
  await page.goto(BASE+'/app/');
  await page.waitForTimeout(500);
  check('data saved under the old name is read and carried forward', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fiveboxes') || 'null'); return !!(d && d.kids && d.kids.length); }));

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
