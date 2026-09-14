/* Screen recordings of the app, for reels and video pins. Sibling to
   store-shots.mjs: same static server, same onboarding walk, same selectors —
   but it captures a frame at a time and hands the sequence to ffmpeg, so the
   output is pixel-sharp at 3× rather than a soft screencast, and the pacing is
   exact rather than whatever the machine managed that run.

     CHROMIUM_PATH=/path/to/chrome node scripts/store-clips.mjs [clip ...]

   Onboarding is walked off-camera and every clip starts from a planned week:
   on a first run the app offers to sign you in between the last question and
   the week arriving, which is exactly where the reveal should be. The reveal is
   filmed from Shuffle instead.

   With no arguments it records all of them. Output in store/clips/ as
   1080×1920 MP4 (9:16, the reel and video-pin shape): the phone scaled to the
   full height on the app's own ground colour, with a tap dot wherever a finger
   would be. No captions burned in — the words belong in the edit, where they
   can be changed.

   Needs an ffmpeg that can encode H.264 — the one Playwright ships cannot (it
   is built for WebM only), and Instagram and Pinterest both want MP4. The
   script hunts for a capable one and says what to install if there is none;
   FFMPEG_PATH overrides the hunt. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('public');
const OUT = path.resolve('store/clips');
const WORK = path.join(OUT, '.frames');
const FPS = 24;
const GROUND = { light: '#E9EEE6', dark: '#0E1815' };

/* ---- ffmpeg ---- */
const canH264 = (bin) => {
  try { return execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('libx264'); }
  catch { return false; }
};
let _ffmpeg;
function ffmpeg() {
  if (_ffmpeg) return _ffmpeg;
  if (process.env.FFMPEG_PATH) return (_ffmpeg = process.env.FFMPEG_PATH);
  const tries = ['ffmpeg'];
  /* pip install imageio-ffmpeg puts a full build with libx264 here */
  for (const root of ['/usr/local/lib', '/usr/lib', path.join(process.env.HOME || '', '.local/lib')]) {
    for (const py of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      const d = path.join(root, py, 'dist-packages/imageio_ffmpeg/binaries');
      const d2 = path.join(root, py, 'site-packages/imageio_ffmpeg/binaries');
      for (const dir of [d, d2]) if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) tries.push(path.join(dir, f));
    }
  }
  for (const t of tries) if (canH264(t)) return (_ffmpeg = t);
  throw new Error('no ffmpeg with H.264 here. Install one: `pip install imageio-ffmpeg`, or apt/brew install ffmpeg, or set FFMPEG_PATH.');
}

/* ---- the static server, as in store-shots.mjs ---- */
const TYPES = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.json':'application/json','.webmanifest':'application/manifest+json'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let chromium; try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/* A finger is not a cursor: every scripted tap paints a dot where a thumb would
   be, so the clip reads as somebody using a phone rather than a robot. */
const TAP = `
.__tap{position:fixed;z-index:99999;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;
  background:rgba(22,36,30,.22);border:2px solid rgba(22,36,30,.45);pointer-events:none;transform:scale(.5);opacity:0}
.__tap.on{transform:scale(1);opacity:1}
@media (prefers-color-scheme:dark){.__tap{background:rgba(230,238,231,.22);border-color:rgba(230,238,231,.5)}}`;

let clip = null, frameNo = 0;

async function newRun(name, { dark = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    colorScheme: dark ? 'dark' : 'light',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LunchSortedApp/1'
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.addStyleTag({ content: TAP }).catch(() => {});
  clip = { name, page, ctx, dark, dir: path.join(WORK, name) };
  fs.rmSync(clip.dir, { recursive: true, force: true });
  fs.mkdirSync(clip.dir, { recursive: true });
  frameNo = 0;
  return page;
}

const pad = (n) => String(n).padStart(5, '0');
async function frame(n = 1) {
  const file = path.join(clip.dir, pad(frameNo++) + '.png');
  await clip.page.screenshot({ path: file });
  for (let i = 1; i < n; i++) fs.copyFileSync(file, path.join(clip.dir, pad(frameNo++) + '.png'));
}
/* hold the picture still for a beat — the viewer needs time to read what changed */
const hold = (seconds) => frame(Math.max(1, Math.round(seconds * FPS)));

async function tap(selector, { settle = 0.35 } = {}) {
  const el = clip.page.locator(selector).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (box) {
    await clip.page.evaluate(([x, y]) => {
      const d = document.createElement('div');
      d.className = '__tap'; d.style.left = x + 'px'; d.style.top = y + 'px';
      document.body.appendChild(d); requestAnimationFrame(() => d.classList.add('on'));
      setTimeout(() => d.remove(), 700);
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    await frame(3);
  }
  await el.click({ force: true });
  await clip.page.waitForTimeout(settle * 1000);
  await frame(2);
}

/* a scroll a thumb could have done: eased, and one frame per step */
async function scroll(distance, seconds = 1.2) {
  const steps = Math.max(2, Math.round(seconds * FPS));
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const target = Math.round(distance * eased);
    await clip.page.mouse.wheel(0, target - done);
    done = target;
    await frame();
  }
}

async function finish() {
  const { name, ctx, dir, dark } = clip;
  await ctx.close();
  const out = path.join(OUT, name + '.mp4');
  const bg = (dark ? GROUND.dark : GROUND.light).replace('#', '0x');
  /* the phone is 390×844, which is taller than 9:16 — so it is scaled to the
     full frame height and the app's own ground colour fills the sides, the way
     the pins hold a phone on a coloured field */
  execFileSync(ffmpeg(), [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', path.join(dir, '%05d.png'),
    '-vf', `scale=-2:1920:flags=lanczos,pad=1080:1920:(ow-iw)/2:0:${bg}`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', out
  ], { stdio: 'inherit' });
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`  ${name}.mp4 — ${frameNo} frames, ${(frameNo / FPS).toFixed(1)}s, ${kb}KB`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* Onboarding happens BEFORE the camera rolls. On a first run the app offers to
   sign you in between the last question and the week appearing, and that screen
   has no business in a clip about lunches — it used to flash across the exact
   moment the week arrives. So every clip starts from a planned week, and the
   reveal is filmed from Shuffle, which draws the same week with one tap and can
   be repeated as often as you like. */
async function ready(page, name = 'Emma') {
  await page.goto(BASE + '/app/');
  await page.waitForTimeout(700);
  await page.fill('#obName', name);
  await page.click('[data-act="ob-go"]');
  await page.waitForTimeout(1400);
  if (await page.$('[data-act="ob-later"]')) { await page.click('[data-act="ob-later"]'); await page.waitForTimeout(800); }
  await page.click('[data-act="tab"][data-tab="week"]').catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3800);   /* let the "Your week is ready" toast clear */
}

/* ---- the clips ---- */
const CLIPS = {
  /* 1 · one tap, and the week draws itself. The one that sells it. */
  async week() {
    const page = await newRun('week');
    await ready(page);
    await hold(1.4);
    await tap('[data-act="plan-kid"]', { settle: 1.3 });
    await hold(2.2);
    await scroll(700, 1.6);
    await hold(1.2);
    await scroll(520, 1.3);
    await hold(1.4);
    await finish();
  },

  /* 2 · the rules go on, and the plan is re-checked around them */
  async rules() {
    const page = await newRun('rules');
    await ready(page);
    await hold(1.0);
    await tap('[data-act="box-settings"]', { settle: 0.7 });
    await scroll(520, 1.0);
    await hold(0.7);
    /* cold-only and nut-free came on in onboarding and are visibly already set —
       these two start off, so the clip shows them going on */
    await tap('[data-act="rule"][data-k="shortWindow"]');
    await hold(0.6);
    await tap('[data-act="rule"][data-k="noIce"]');
    await hold(0.6);
    await scroll(240, 0.7);
    await tap('[data-act="allergen"][data-k="dairy"]');
    await hold(1.8);   /* long enough to read "… broke the rules — drawn again" */
    await tap('[data-act="box-done"]', { settle: 0.8 });
    await hold(0.8);
    await scroll(620, 1.4);
    await hold(1.4);
    await finish();
  },

  /* 3 · the list writes itself, and the pantry gets ticked off */
  async shop() {
    const page = await newRun('shop');
    await ready(page);
    await hold(1.0);
    await tap('[data-act="tab"][data-tab="shop"]', { settle: 0.8 });
    await hold(1.6);
    await scroll(560, 1.3);
    await hold(0.8);
    /* by index, not "the first one": a tick re-renders the list, and tapping
       the first row three times just ticks the same row three times */
    for (let i = 0; i < 3; i++) {
      await tap(`.list .item[data-act="have"] >> nth=${i}`, { settle: 0.3 });
      await hold(0.35);
    }
    await hold(1.6);
    await finish();
  },

  /* 4 · the phone goes across the table */
  async kidpick() {
    const page = await newRun('kidpick');
    await ready(page);
    /* turning their say on is setup, not story — do it before the camera rolls */
    await page.click('[data-act="box-settings"]'); await page.waitForTimeout(500);
    await page.click('[data-act="kidpick-on"]').catch(() => {}); await page.waitForTimeout(400);
    await page.click('[data-act="box-done"]'); await page.waitForTimeout(500);
    await page.click('[data-act="tab"][data-tab="pack"]'); await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await hold(1.6);
    if (await page.$('[data-act="kid-start"]')) {
      await tap('[data-act="kid-start"]', { settle: 1.0 });
      await hold(1.6);
      /* all four compartments, so the run finishes rather than stalling halfway
         through with the dots part-filled */
      for (let i = 0; i < 4 && await page.$('[data-act="kid-pick"]'); i++) {
        await tap('[data-act="kid-pick"] >> nth=' + (i % 2), { settle: 0.9 });
        await hold(0.8);
      }
      await hold(1.8);
    }
    await finish();
  }
};

fs.mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2).filter(a => !a.startsWith('-'));
const names = want.length ? want : Object.keys(CLIPS);
for (const n of names) {
  if (!CLIPS[n]) { console.error('no such clip: ' + n + ' (have: ' + Object.keys(CLIPS).join(', ') + ')'); continue; }
  console.log('recording ' + n + '…');
  await CLIPS[n]();
}
fs.rmSync(WORK, { recursive: true, force: true });
await browser.close(); server.close();
