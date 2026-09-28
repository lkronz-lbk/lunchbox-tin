/* The share image, public/img/og.png (1200×630): the tin and the name, in the brand's own
   fonts (checked in under store/) and the light theme's colors. It was drawn by hand until
   2026-09-27; make it here so a color change reaches it.

     node scripts/og.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = f => 'data:font/ttf;base64,' + fs.readFileSync(path.join(ROOT, 'store', f)).toString('base64');
/* the light :root block of public/index.html, read rather than copied, so the image follows it */
const css = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const tok = k => (css.match(new RegExp('--' + k + ':\\s*(#[0-9A-Fa-f]{6})')) || [])[1];
const C = { ground: tok('ground'), ink: tok('ink'), ink2: tok('ink-2'), frame: tok('line-strong'),
  main: tok('c-main'), side: tok('c-side'), fruit: tok('c-fruit'), sweet: tok('c-sweet') };
if (Object.values(C).some(v => !v)) throw new Error('a token is missing from public/index.html: ' + JSON.stringify(C));

const html = `<!doctype html><html><head><style>
@font-face{font-family:Familjen;src:url(${font('FamiljenGrotesk-Bold.ttf')});font-weight:700}
@font-face{font-family:Karla;src:url(${font('Karla-Medium.ttf')});font-weight:500}
html,body{margin:0;width:1200px;height:630px;background:${C.ground}}
.wrap{display:flex;align-items:center;gap:64px;height:630px;padding:0 100px;box-sizing:border-box}
.tin{flex:none;width:336px;height:336px;box-sizing:border-box;border:9px solid ${C.frame};border-radius:56px;overflow:hidden;
  display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8px;background:${C.frame}}
.tin i{display:block}
h1{font-family:Familjen;font-weight:700;font-size:88px;letter-spacing:-0.035em;line-height:1;margin:0 0 30px;color:${C.ink}}
h1 span{color:${C.side}}
p{font-family:Karla;font-weight:500;font-size:30px;line-height:1.36;margin:0;color:${C.ink2};max-width:470px}
</style></head><body><div class="wrap">
<div class="tin"><i style="background:${C.main}"></i><i style="background:${C.side}"></i><i style="background:${C.fruit}"></i><i style="background:${C.sweet}"></i></div>
<div><h1>Lunch <span>Sorted</span></h1><p>A week of school lunches, planned in about a minute. Matched boxes, school rules respected, shopping list done.</p></div>
</div></body></html>`;

let chromium; try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html); await page.evaluate(() => document.fonts.ready);
const out = path.join(ROOT, 'public', 'img', 'og.png');
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', path.relative(ROOT, out), JSON.stringify(C));
