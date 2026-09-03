/* End-to-end smoke tests for Lunchbox Tin.
   No test framework and no build: a tiny static server plus Playwright.
     npm test                    (installs nothing if playwright is present)
     CHROMIUM_PATH=/path/to/chrome npm test
   Every check below guards something that has actually broken at least once. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json',
  '.webmanifest':'application/manifest+json','.txt':'text/plain','.svg':'image/svg+xml'};

function serve(){
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'});
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

  await page.click('[data-act="ob-avoid"][data-v="dairy"]');
  await page.click('[data-act="ob-breadth"][data-v="picky"]');
  await page.click('[data-act="ob-go"]');
  await page.waitForTimeout(400);

  check('three taps land on a planned week',
    await page.getAttribute('nav.tabs [aria-current="true"]', 'data-tab') === 'week');
  const empties = await page.$$eval('.cmp.empty', a => a.length);
  check('every compartment is filled', empties === 0, empties);
  const notes = await page.$$eval('.note', a => a.filter(n => n.textContent.trim().length > 10).length);
  check('each day gets a pairing note', notes >= 5, notes);
  check('excluded allergens never enter the list', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchbox-tin'));
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
    const d = JSON.parse(localStorage.getItem('lunchbox-tin'));
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
  check("the main is asked first, by name", /pick your main/i.test(firstMainLabel), firstMainLabel);
  const chosenMain = await page.getAttribute('.kidmode .pick >> nth=1', 'data-id');   /* option B, not the draw */
  await page.click('.kidmode .pick >> nth=1'); await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) { await page.click('.kidmode .pick >> nth=0'); await page.waitForTimeout(150); }
  check('four taps end on the finished box', (await page.$$eval('.kiddone .tin .cmp', a => a.length)) === 4);
  await page.click('[data-act="kid-exit"]'); await page.waitForTimeout(250);
  const afterPick = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lunchbox-tin'));
    const k = d.kids[0], t = new Date(); t.setHours(0,0,0,0);
    const day = k.week.days.find(x => new Date(x.d + 'T00:00:00') >= t) || k.week.days[0];
    return {main: day.slots.main, locked: Object.values(day.lock).every(Boolean),
      picked: Object.keys(day.kidPick || {}).length, by: day.kidPick && day.kidPick.main && day.kidPick.main.by === k.id};
  });
  check("the kid's choice replaced the draw", afterPick.main === chosenMain, afterPick);
  check('kid-picked compartments are locked and attributed', afterPick.locked && afterPick.picked === 4 && afterPick.by, afterPick);
  check('the pack list says who picked', (await page.textContent('#view')).includes(' picked'));
  await page.click('[data-act="tab"][data-tab="week"]'); await page.waitForTimeout(200);
  await page.click('[data-act="shuffle-day"] >> nth=0'); await page.waitForTimeout(300);
  const stillMain = await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem('lunchbox-tin')).kids[0];
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
  const rules = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchbox-tin'))
    .kids.filter(k => !k.deletedAt).map(k => k.settings.avoidAllergens.join('+')));
  check('each lunchbox keeps its own rules', rules[0] !== rules[1], rules);

  await page.click('[data-act="tab"][data-tab="pack"]');
  await page.waitForTimeout(250);
  check('an unplanned lunchbox is announced, not silently dropped',
    await page.$$eval('[data-act="plan-all"]', a => a.length) > 0);
  await page.click('[data-act="plan-all"]');
  await page.waitForTimeout(500);
  const lines = await page.$$eval('.kidline', a => a.length);
  check('the pack list covers every lunchbox', lines === 2, lines);

  /* ------------------------------------------------- transfer round trip */
  const dump = await page.evaluate(() => localStorage.getItem('lunchbox-tin'));
  await page.click('[data-act="tab"][data-tab="setup"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="import-open"]');
  await page.waitForTimeout(350);
  await page.fill('#impText', '{"hello":"world"}');
  await page.click('[data-act="import-do"]');
  await page.waitForTimeout(250);
  check('arbitrary JSON is refused', (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lunchbox-tin')).kids.filter(k => !k.deletedAt).length)) === 2);
  await page.fill('#impText', JSON.stringify({app:'lunchbox-tin', schema:2, account:JSON.parse(dump)}));
  await page.click('[data-act="import-do"]');           /* first tap arms */
  await page.waitForTimeout(200);
  await page.click('[data-act="import-do"]');           /* second applies */
  await page.waitForTimeout(400);
  const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('lunchbox-tin'))
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
    const d = JSON.parse(localStorage.getItem('lunchbox-tin')), k = d.kids[0];
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
  check('every screenshot on the landing page loads',
    await site.$$eval('img', a => a.length > 0 && a.every(i => i.complete && i.naturalWidth > 0)));
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
