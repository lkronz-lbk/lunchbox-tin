/* Regenerate the marketing screenshots in public/img.
   Needs the static server: `npm run dev` in another terminal, then `npm run shots`.

   Everything here is a deliberate choice about what the pictures have to show,
   not incidental setup: two lunchboxes, because one hides the whole point of
   the pager and the matched plan; a Monday, because a plan drawn on a Thursday
   is two days long; Emma's box finished and Noah's not, because that is what
   the household line is for. Change the app, look at the shots, and if they no
   longer tell the truth, run this. The kid's-pick shot is taken here too: the
   screen fills itself now, so there is nothing left to frame by hand. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = '/Users/lizkronzek/lunch-sorted/public/img';
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: {width:375, height:812}, deviceScaleFactor:2, colorScheme:'light', timezoneId:'America/New_York' });
/* Shoot on a Monday, so the week view shows a week rather than the two days
   left after a Thursday. The app reads the clock in a dozen places; pin it once. */
await ctx.addInitScript(() => {
  const Real = Date;
  const offset = new Real('2026-09-07T13:00:00Z').getTime() - Real.now();
  function Fake(...a){ return a.length ? new Real(...a) : new Real(Real.now() + offset); }
  Fake.prototype = Real.prototype;
  Fake.now = () => Real.now() + offset;
  Fake.parse = Real.parse; Fake.UTC = Real.UTC;
  window.Date = Fake;
});

const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
try {
  await p.goto('http://localhost:8099/app/index.html', {timeout:8000});
} catch (e) {
  console.error('No static server on :8099 — run `npm run dev` in another terminal first.');
  await b.close();
  process.exit(1);
}
await wait(700);

/* onboarding: Emma, the name the existing shots use */
await p.fill('#obName', 'Emma');
await p.click('[data-act="ob-go"]');
await wait(900);
/* online, onboarding ends on an offer to sign in; the shots are of the planner */
const later = await p.$('[data-act="ob-later"]');
if (later) { await later.click(); await wait(500); }

/* a second lunchbox, so the shots show what the app now does */
/* on main, Add a lunchbox lives in the lunchbox sheet behind the header button */
await p.click('[data-act="tab"][data-tab="week"]'); await wait(400);
await p.click('[data-act="kidsheet"]'); await wait(400);
await p.click('[data-act="add-kid"]'); await wait(500);
await p.fill('#nkName', 'Noah');
await p.click('[data-act="save-kid"]'); await wait(600);
await p.click('[data-act="seed"]'); await wait(800);

/* draw them together */
await p.click('[data-act="tab"][data-tab="setup"]'); await wait(400);
await p.click('[data-act="pane"][data-pane="account"]'); await wait(400);
await p.click('[data-act="clear-week"]'); await wait(250);
await p.click('[data-act="clear-week"]'); await wait(500);
await p.click('[data-act="tab"][data-tab="pack"]'); await wait(400);
await p.click('[data-act="plan-all"]'); await wait(900);

/* stand on Emma everywhere */
const emma = await p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lunchsorted'));
  return d.kids.find(k => k.name === 'Emma').id;
});
const toEmma = async () => {
  await p.evaluate(id => { const b = document.querySelector('.boxtabs button[data-id="'+id+'"]'); if(b) b.click(); }, emma);
  await wait(400);
};
const hideToast = () => p.evaluate(() => document.getElementById('toast').classList.remove('show'));

async function shot(tab, name, extra) {
  await p.click(`[data-act="tab"][data-tab="${tab}"]`); await wait(500);
  if (tab !== 'shop') await toEmma();
  if (extra) { await extra(); }
  await hideToast();
  await p.evaluate(() => window.scrollTo(0, 0));
  await wait(350);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

await shot('week', 'screen-week');
await shot('pack', 'screen-pack', async () => {
  /* Emma's box finished, so the household line has something to say */
  const packed = await p.$('[data-act="pack-all"]');
  if (packed) { await packed.click(); await wait(400); }
});
await shot('shop', 'screen-shop');

/* The kid's pick: not a tab, and the switch has to go on first. Two options that look
   alike sell the opposite of what this screen is for, so step past any part whose
   pictures match before taking it. */
await p.click('[data-act="tab"][data-tab="pack"]'); await wait(500);
await toEmma();
await p.click('[data-act="box-settings"]'); await wait(400);
await p.click('[data-act="kidpick-on"]'); await wait(300);
await p.click('[data-act="box-done"]'); await wait(400);
await p.click('[data-act="kid-start"]'); await wait(600);
const alike = () => p.evaluate(() => {
  const f = [...document.querySelectorAll('.pick')].map(x => { const i = x.querySelector('.pic'); return i ? i.src : (x.querySelector('.ic') || {}).textContent; });
  return f.length < 2 || f[0] === f[1];
});
for (let i = 0; i < 3 && await alike(); i++) { await p.locator('.pick').first().click(); await wait(500); }
await hideToast();
await p.screenshot({ path: `${OUT}/screen-kidpick.png` });
console.log('shot', 'screen-kidpick');
await p.click('[data-act="kid-exit"]', { force: true }); await wait(400);

/* WebP twins: Chromium is the encoder, since sips on this machine will not write one */
for (const name of ['screen-week','screen-pack','screen-shop','screen-kidpick']) {
  const png = fs.readFileSync(`${OUT}/${name}.png`).toString('base64');
  const out = await p.evaluate(async b64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.82);
  }, png);
  if (!out.startsWith('data:image/webp')) throw new Error('no webp encoder for ' + name);
  fs.writeFileSync(`${OUT}/${name}.webp`, Buffer.from(out.split(',')[1], 'base64'));
  console.log('webp', name);
}

await b.close();
