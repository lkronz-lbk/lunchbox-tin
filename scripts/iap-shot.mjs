/* The review screenshot App Store Connect asks for on each in-app purchase: the plan sheet as the
   iPhone app shows it, at the 6.9" size, with the App Store's prices. Serves public/ statically,
   stands in for the shell's StoreKit plugin with the prices set in App Store Connect, and marks
   the price founding as Stripe does. Output: store/iap-review.png, one image for both products.

     CHROMIUM_PATH=/path/to/chrome node scripts/iap-shot.mjs [yearly-price] [monthly-price]

   The prices default to the founding ones, $19.99 and $2.99; pass the new ones after a change. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [year = '$19.99', month = '$2.99'] = process.argv.slice(2);
const cents = (s) => Math.round(parseFloat(s.replace(/[^0-9.]/g, '')) * 100);
const ROOT = path.resolve('public');
const OUT = path.resolve('store/iap-review.png');
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
const ctx = await browser.newContext({ viewport:{width:440,height:956}, deviceScaleFactor:3, isMobile:true, hasTouch:true, colorScheme:'light',
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LunchSortedApp/1' });
await ctx.addInitScript(([year, month]) => {
  const products = [
    { id: 'app.lunchsorted.household.annual', displayName: 'Household plan, yearly', displayPrice: year, kind: 'subscription', period: 'year' },
    { id: 'app.lunchsorted.household.month', displayName: 'Household plan, monthly', displayPrice: month, kind: 'subscription', period: 'month' }];
  window.Capacitor = { isNativePlatform: () => true, Plugins: { StoreKit: {
    products: async () => ({ products }), addListener: async () => ({ remove(){} }),
    purchase: async () => ({ status: 'cancelled' }), restore: async () => ({ transactions: [] }), finish: async () => ({}), manage: async () => ({}) } } };
}, [year, month]);
const page = await ctx.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
const wait = ms => page.waitForTimeout(ms);

/* the server, as a signed-in household on its free trial sees it: only what the sheet reads */
const state = { me: { userId: 1, email: 'parent@example.com', memberId: null, role: 'owner' }, members: [], version: 1, household: { id: 1 }, billing: true,
  entitlement: { plan: 'free', source: 'none', status: 'none', appleToken: '6f1c2a7e-0b4d-4e8a-9c3f-2d5e8b7a1c90' } };
const billing = { enabled: true, prices: { year: { amount: cents(year), currency: 'usd', interval: 'year', founding: true }, month: { amount: cents(month), currency: 'usd', interval: 'month', founding: false } } };
await page.route('**/api/**', r => {
  const u = new URL(r.request().url());
  if (u.pathname === '/api/billing') return r.fulfill({ json: billing });
  if (u.pathname === '/api/household' && r.request().method() === 'GET') return r.fulfill({ json: state });
  return r.fulfill({ json: { ok: true, version: 1 } });
});

await page.goto(BASE + '/app/'); await wait(500);
await page.addStyleTag({ content: '#toast{display:none!important}' });
await page.fill('#obName', 'Emma');
await page.click('[data-act="ob-go"]'); await wait(900);
if(await page.$('[data-act="ob-later"]')) { await page.click('[data-act="ob-later"]'); await wait(400); }
/* the flag a signed-in phone keeps, then the boot a parent sees: the pull, the plan pane, the button */
await page.evaluate(() => localStorage.setItem('lunchsorted-account', '1'));
await page.reload(); await wait(1200);
await page.addStyleTag({ content: '#toast{display:none!important}' });
await page.click('[data-act="tab"][data-tab="setup"]'); await wait(300);
await page.click('[data-act="pane"][data-pane="plan"]'); await wait(400);
await page.click('#view [data-act="upgrade"]'); 
await wait(1200);
const text = await page.textContent('#sheetBody');
if (!text.includes(year) || !text.includes(month)) { console.error('the sheet did not show both prices:', text); process.exit(1); }
await page.screenshot({ path: OUT });
console.log('wrote', path.relative(process.cwd(), OUT));
await browser.close(); server.close();
