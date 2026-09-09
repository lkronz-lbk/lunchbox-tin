/* Screenshots for the beta testers' first-week emails: one per email, from the
   app as it is, at phone size, cropped to the part that matters. Output in
   public/img/mail-day{1,3,6}.png, served by the site and referenced by mail.js.
     CHROMIUM_PATH=/path/to/chrome node scripts/mail-shots.mjs */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const ROOT = path.resolve('public');
const TYPES = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.json':'application/json','.webmanifest':'application/manifest+json'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
let chromium; try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport:{width:375,height:812}, deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:'light' });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
const wait = ms => page.waitForTimeout(ms);
const shot = async (name, height) => {
  const f = path.join(ROOT, 'img', 'mail-' + name + '.png');
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(200);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 375, height } }); console.log('captured', name);
};
await page.goto(BASE + '/app/'); await wait(500);
await page.addStyleTag({ content: '#toast{display:none!important}' });
await page.fill('#obName', 'Emma');
await page.click('[data-act="ob-go"]'); await wait(900);
if (await page.$('[data-act="ob-later"]')) { await page.click('[data-act="ob-later"]'); await wait(400); }

/* day 1: the week, planned */
await page.click('[data-act="tab"][data-tab="week"]'); await wait(400);
await shot('day1', 560);

/* day 3: the kid's pick */
await page.click('[data-act="box-settings"]'); await wait(400);
await page.click('[data-act="kidpick-on"]'); await wait(300);
await page.click('[data-act="box-done"]'); await wait(300);
await page.click('[data-act="tab"][data-tab="pack"]'); await wait(400);
if (await page.$('[data-act="kid-start"]')) { await page.click('[data-act="kid-start"]'); await wait(500); await shot('day3', 620); await page.click('[data-act="kid-exit"]', { force: true }); await wait(400); }

/* day 6: the morning after a packed box */
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lunchsorted')), k = d.kids[0]; const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0,0,0,0);
  const iso = y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0');
  const slots = {}; for (const c of ['main','side','fruit','sweet']) { const f = k.foods.find(x => x.c === c && !x.deletedAt); if (f) slots[c] = f.id; }
  k.past = [{d: iso, dow: y.getDay(), slots, lock: {}, kidPick: {}}]; k.packed = k.packed || {}; k.packed[iso] = {main:{at:new Date().toISOString(), by:null}};
  localStorage.setItem('lunchsorted', JSON.stringify(d)); });
await page.reload(); await wait(600);
await page.addStyleTag({ content: '#toast{display:none!important}' });
await page.click('[data-act="tab"][data-tab="pack"]'); await wait(400);
await shot('day6', 560);
await browser.close(); server.close();
