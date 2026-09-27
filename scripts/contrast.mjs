/* Measures the colour contrast of every piece of text a parent can see, on the site and in the
   planner, in light and dark, against WCAG 2.2 AAA (1.4.6): 7:1 for text, 4.5:1 for large text
   (24px, or 18.66px bold), and 3:1 for the edge of a field or a switch (1.4.11). What it measures is what the browser drew — the text colour through
   every opacity above it, on the first solid background behind it — so a token, a raw colour or
   a faded label all count the same. Text on an image or a gradient is listed, not measured.

     node scripts/contrast.mjs            # prints each failure; exits 1 if there are any

   Serves public/ itself; the planner runs signed out, walked through onboarding with the clock
   pinned to a Monday, as scripts/store-shots.mjs does. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if(!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let chromium; try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/* runs in the page: every visible text run, its drawn colour, the solid colour behind it, the ratio */
function measure(){
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r:v[0], g:v[1], b:v[2], a: v.length > 3 ? v[3] : 1}; };
  const over = (top, under) => ({r: top.r*top.a + under.r*(1-top.a), g: top.g*top.a + under.g*(1-top.a), b: top.b*top.a + under.b*(1-top.a), a: 1});
  const lum = c => { const f = v => { v /= 255; return v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+0.05) / (Math.min(x,y)+0.05); };
  const hex = c => '#' + [c.r,c.g,c.b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase();
  /* the colour behind an element: each ancestor's background laid over the next, down to the page */
  function behind(el){
    const layers = []; let unknown = false;
    for(let e = el; e; e = e.parentElement){
      const cs = getComputedStyle(e);
      if(cs.backgroundImage && cs.backgroundImage !== 'none') unknown = true;
      const bg = parse(cs.backgroundColor);
      if(bg && bg.a > 0){ layers.push(bg); if(bg.a >= 1) break; }
    }
    let c = {r:255, g:255, b:255, a:1};
    for(let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return {c, unknown};
  }
  const out = [], seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for(let n = walker.nextNode(); n; n = walker.nextNode()){
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    if(!text || !/[A-Za-z0-9$]/.test(text)) continue;
    const el = n.parentElement; if(!el || seen.has(el)) continue; seen.add(el);
    if(el.closest('script,style,noscript,[hidden],[aria-hidden="true"],button:disabled,[disabled]')) continue;
    const r = el.getBoundingClientRect(); if(r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if(cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1; for(let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if(op < 0.05) continue;
    const {c: bg, unknown} = behind(el);
    const fg0 = parse(cs.color); const fg = over({...fg0, a: fg0.a * op}, bg);
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 4.5 : 7, got = ratio(fg, bg);
    if(got + 0.005 < need) out.push({text: text.slice(0, 48), fg: hex(fg), bg: hex(bg), ratio: Math.round(got*100)/100, need, size, unknown, where: (el.id ? '#'+el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).join('.') : ''))});
  }
  for(const i of document.querySelectorAll('input[placeholder],textarea[placeholder]')){
    const r = i.getBoundingClientRect(); if(r.width < 1) continue;
    const ph = parse(getComputedStyle(i, '::placeholder').color), {c: bg} = behind(i);
    if(!ph) continue;
    const got = ratio(over(ph, bg), bg);
    if(got + 0.005 < 7) out.push({text: 'placeholder: ' + i.placeholder.slice(0, 36), fg: hex(over(ph, bg)), bg: hex(bg), ratio: Math.round(got*100)/100, need: 7, size: parseFloat(getComputedStyle(i).fontSize), where: '#' + (i.id || i.name)});
  }
  /* 1.4.11, which has no AAA: what marks out a control a parent must find (a field's edge, a
     switch's outline) holds 3:1 against what is around it */
  for(const i of document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select,.sw,.tg:not([aria-pressed="true"]),.choices label')){
    const r = i.getBoundingClientRect(); if(r.width < 1 || i.closest('[hidden],[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(i); if(parseFloat(cs.borderTopWidth) < 1) continue;
    const {c: around} = behind(i.parentElement || i), edge = parse(cs.borderTopColor); if(!edge) continue;
    const got = ratio(over(edge, around), around);
    if(got + 0.005 < 3) out.push({text: 'edge of ' + (i.placeholder || i.getAttribute('aria-label') || i.name || i.id || i.className), fg: hex(over(edge, around)), bg: hex(around), ratio: Math.round(got*100)/100, need: 3, size: 0, where: i.tagName.toLowerCase() + (i.id ? '#' + i.id : '')});
  }
  return out;
}

const failures = [];
async function check(page, label){
  const got = await page.evaluate(measure);
  for(const f of got) failures.push({label, ...f});
}

for(const scheme of ['light', 'dark']){
  const ctx = await browser.newContext({ viewport:{width:390, height:844}, deviceScaleFactor:1, isMobile:true, hasTouch:true, colorScheme: scheme });
  await ctx.route(/googletagmanager|google-analytics/, r => r.fulfill({status:200, contentType:'text/javascript', body:''}));
  await ctx.addInitScript(() => {
    let later = 0; try { later = Number(localStorage.getItem('contrast-days')) || 0; } catch(e){}
    const Real = Date, offset = new Real('2026-09-07T13:00:00Z').getTime() + later * 86400000 - Real.now();
    function Fake(...a){ return a.length ? new Real(...a) : new Real(Real.now() + offset); }
    Fake.prototype = Real.prototype; Fake.now = () => Real.now() + offset; Fake.parse = Real.parse; Fake.UTC = Real.UTC;
    window.Date = Fake;
  });
  const page = await ctx.newPage();
  const wait = ms => page.waitForTimeout(ms);
  const tap = async (sel, label) => { const e = await page.$(sel); if(!e){ console.log('  (no '+sel+' for '+label+')'); return false; } await e.click({force:true}); await wait(450); return true; };

  const pages = ['/', '/help.html', '/privacy.html', '/terms.html', '/feedback.html', '/thanks.html', '/on-the-list.html', '/404.html', '/back.html'];
  for(const f of fs.readdirSync(path.join(ROOT, 'ideas')).filter(f => f.endsWith('.html'))) pages.push('/ideas/' + (f === 'index.html' ? '' : f));
  for(const u of pages){
    /* back.html hands the phone back to the app and never finishes loading in a plain browser */
    await page.goto(BASE + u, {waitUntil:'domcontentloaded', timeout:8000}).catch(() => {}); await wait(350);
    await check(page, scheme + ' ' + u).catch(e => console.log('  (could not read ' + u + ': ' + e.message.split('\n')[0] + ')'));
  }

  await page.goto(BASE + '/app/'); await wait(700);
  await page.addStyleTag({ content: '#splash{display:none!important}' });
  await check(page, scheme + ' app: onboarding');
  await page.fill('#obName', 'Emma'); await page.click('[data-act="ob-go"]'); await wait(900);
  await check(page, scheme + ' app: after onboarding');
  if(await page.$('[data-act="ob-later"]')) await tap('[data-act="ob-later"]', 'later');
  for(const t of ['pack', 'week', 'foods', 'shop', 'recipes', 'setup']){
    if(await tap('[data-act="tab"][data-tab="'+t+'"]', t)) await check(page, scheme + ' app: ' + t);
  }
  const sheet = async (open, label) => { await tap('[data-act="tab"][data-tab="'+open[0]+'"]', label); if(await tap(open[1], label)){ await check(page, scheme + ' app: ' + label); await page.keyboard.press('Escape'); await wait(300); await page.evaluate(() => { const b = document.querySelector('#sheetClose'); if(b && b.offsetParent) b.click(); }); await wait(300); } };
  await sheet(['week', '[data-act="box-settings"]'], 'lunchbox settings');
  await sheet(['foods', '[data-act="ideas"]'], 'ideas');
  await sheet(['week', '[data-act="help"]'], 'help sheet');
  await sheet(['week', '[data-act="slot"]'], 'a compartment');
  /* the one screen a child sees: switch the kid's pick on, then hand the phone over */
  await tap('[data-act="tab"][data-tab="week"]', 'week'); await tap('[data-act="box-settings"]', 'settings');
  await tap('[data-act="kidpick-on"]', 'kid pick on'); await tap('[data-act="box-done"]', 'done');
  await tap('[data-act="tab"][data-tab="pack"]', 'pack');
  if(await tap('[data-act="kid-start"]', 'kid pick')){ await check(page, scheme + ' app: the kid\'s pick'); await tap('[data-act="kid-exit"]', 'give it back'); }
  /* the states paleness used to carry: a box packed, and, two days on, the days that have gone */
  if(await tap('[data-act="tab"][data-tab="pack"]', 'pack') && await tap('[data-act="pack-all"]', 'packed')) await check(page, scheme + ' app: a packed box');
  await page.evaluate(() => localStorage.setItem('contrast-days', '2')); await page.reload(); await wait(900);
  await page.addStyleTag({ content: '#splash{display:none!important}' });
  for(const t of ['pack', 'week']) if(await tap('[data-act="tab"][data-tab="'+t+'"]', t)) await check(page, scheme + ' app: ' + t + ', Wednesday, two days gone');
  /* the plan sheet opens only where billing is on, which this static server is not; its text uses the same tokens */
  await ctx.close();
}
await browser.close(); server.close();

const key = f => f.label.replace(/^(light|dark) /, '') + '|' + f.where + '|' + f.fg + '|' + f.bg;
const grouped = new Map();
for(const f of failures){ const k = f.label.split(' ')[0] + '|' + f.where + '|' + f.fg + '|' + f.bg; if(!grouped.has(k)) grouped.set(k, {...f, count: 0}); grouped.get(k).count++; }
for(const f of grouped.values())
  console.log(`${f.label.padEnd(34)} ${String(f.ratio).padStart(5)} < ${f.need}  ${f.fg} on ${f.bg}${f.unknown ? ' (over an image)' : ''}  ${f.size}px  ${f.where}  "${f.text}"${f.count > 1 ? '  ×' + f.count : ''}`);
console.log(failures.length ? `\n${grouped.size} kinds of text below AAA (${failures.length} runs)` : 'Every piece of text meets AAA.');
process.exit(failures.length ? 1 : 0);
