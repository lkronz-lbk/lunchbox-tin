import { chromium } from 'playwright';
const B='http://localhost:8099';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
export async function onboard(page){
  await page.goto(B+'/app/'); await page.waitForTimeout(500);
  await page.fill('#obName','Nia');
  await page.click('[data-act="ob-go"]'); await page.waitForTimeout(500);
  await page.click('[data-act="ob-later"]'); await page.waitForTimeout(400);
  const ok = await page.$('[data-act="whats-new-ok"]'); if(ok){ await ok.click(); await page.waitForTimeout(200);}
}
for(const w of [320,359,360,375,390,430]){
  const ctx = await browser.newContext({viewport:{width:w,height:812}, deviceScaleFactor:2});
  await ctx.route(/fonts\.g/, r=>r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e=>console.log('PAGEERROR', w, e.message));
  await onboard(page);
  const tabs = await page.$$eval('nav.tabs button', bs => bs.map(b=>{
    const r=b.getBoundingClientRect(); const s=b.querySelector('span');
    const sr=s?s.getBoundingClientRect():null; const cs=s?getComputedStyle(s):null;
    return {t:s?s.textContent:'', w:+r.width.toFixed(1), h:+r.height.toFixed(1),
      textW: sr?+sr.width.toFixed(1):0, fs:cs?cs.fontSize:'', sh: sr?+sr.height.toFixed(1):0};
  }));
  console.log('WIDTH', w, JSON.stringify(tabs));
  console.log('  fontFamily used:', await page.$eval('nav.tabs button span', e=>getComputedStyle(e).fontFamily));
  await ctx.close();
}
await browser.close();
