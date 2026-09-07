/* App Store screenshots. Serves public/ statically, walks the app through
   onboarding at an iPhone's size, captures the screens, and composes each on
   the ground colour with a headline. Output in store/screenshots/.

     CHROMIUM_PATH=/path/to/chrome node scripts/store-shots.mjs [--raw]

   --raw keeps the bare captures beside the composed ones. Composition needs
   Python 3 with Pillow (scripts/store-compose.py). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('public');
const OUT = path.resolve('store/screenshots');
const TYPES = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.json':'application/json','.webmanifest':'application/manifest+json'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if(!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let chromium; try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
/* iPhone 16 Pro Max points; Apple wants 1320×2868 for the 6.9" slot, which is 440×956 at 3× */
const ctx = await browser.newContext({ viewport:{width:440,height:956}, deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme:'light',
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LunchSortedApp/1' });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
const wait = ms => page.waitForTimeout(ms);
const shot = async (name) => { const f = path.join(OUT, 'raw-' + name + '.png'); await page.screenshot({ path: f }); console.log('captured', name); return f; };
fs.mkdirSync(OUT, { recursive: true });

await page.goto(BASE + '/app/'); await wait(500);
await page.addStyleTag({ content: '#toast{display:none!important}' });   /* no "Your week is ready" over the shots */
await page.fill('#obName', 'Emma');
await page.click('[data-act="ob-go"]'); await wait(900);
if(await page.$('[data-act="ob-later"]')) { await page.click('[data-act="ob-later"]'); await wait(400); }

/* 1 · the week */
await page.click('[data-act="tab"][data-tab="week"]'); await wait(400);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('week');

/* 2 · the lunchbox settings: the kid gets a say, and the school rules are in view */
await page.click('[data-act="box-settings"]'); await wait(400);
await page.click('[data-act="kidpick-on"]'); await wait(300);
await page.evaluate(() => { const h = [...document.querySelectorAll('#view *')].find(e => e.children.length === 0 && /^school rules$/i.test(e.textContent.trim())); if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 10); });
await wait(300);
await shot('setup');
await page.click('[data-act="box-done"]'); await wait(300);

/* 3 · the pack list, then the kid's pick from it */
await page.click('[data-act="tab"][data-tab="pack"]'); await wait(400);
if(await page.$('[data-act="kid-start"]')) { await page.click('[data-act="kid-start"]'); await wait(500); await shot('kidpick'); await page.click('[data-act="kid-exit"]', { force: true }); await wait(400); }
for (let i = 0; i < 2; i++) { await page.locator('.tin [data-act="toggle"]').nth(i).click(); await wait(250); }   /* two things already in the bag; each tick re-renders, so fresh locators */
await page.evaluate(() => window.scrollTo(0, 0));
await shot('pack');

/* 4 · the shopping list */
await page.click('[data-act="tab"][data-tab="shop"]'); await wait(400);
for (let i = 0; i < 2; i++) { await page.locator('.list .item[data-act="have"]').nth(i).click(); await wait(250); }   /* two things the pantry already has */
await page.evaluate(() => window.scrollTo(0, 0));
await shot('shop');

/* 5 · the foods */
await page.click('[data-act="tab"][data-tab="foods"]'); await wait(400);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('foods');

await browser.close(); server.close();
if (!process.argv.includes('--no-compose')) execFileSync('python3', ['scripts/store-compose.py'], { stdio: 'inherit' });
if (!process.argv.includes('--raw')) for (const f of fs.readdirSync(OUT)) if (f.startsWith('raw-')) fs.unlinkSync(path.join(OUT, f));
