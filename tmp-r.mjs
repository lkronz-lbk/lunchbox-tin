import { chromium } from 'playwright';
const B='http://localhost:8099';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
async function onboard(page){
  await page.goto(B+'/app/'); await page.waitForTimeout(500);
  await page.fill('#obName','Nia');
  await page.click('[data-act="ob-go"]'); await page.waitForTimeout(500);
  await page.click('[data-act="ob-later"]'); await page.waitForTimeout(400);
  const ok = await page.$('[data-act="whats-new-ok"]'); if(ok){ await ok.click(); await page.waitForTimeout(200);}
}
for(const scheme of ['light','dark']){
  const ctx = await browser.newContext({viewport:{width:375,height:812}, deviceScaleFactor:2, colorScheme:scheme});
  await ctx.route(/fonts\.g/, r=>r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e=>console.log('PAGEERROR', e.message));
  await onboard(page);
  await page.click('[data-act="tab"][data-tab="recipes"]'); await page.waitForTimeout(400);
  console.log('==== scheme', scheme);
  const inp = await page.$eval('#rqFind', e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);
    return {w:+r.width.toFixed(1),h:+r.height.toFixed(1), bg:c.backgroundColor, color:c.color, border:c.border, radius:c.borderRadius, fs:c.fontSize, appearance:c.webkitAppearance, minH:c.minHeight, pad:c.padding};});
  console.log('rqFind', JSON.stringify(inp));
  const rows = await page.$$eval('[data-act="cook-recipe"]', bs=>({n:bs.length, first:(()=>{const r=bs[0].getBoundingClientRect();return {h:+r.height.toFixed(1), w:+r.width.toFixed(1), txt:bs[0].innerText.replace(/\n/g,' | ')};})(), min: Math.min(...bs.map(b=>b.getBoundingClientRect().height))}));
  console.log('rows', JSON.stringify(rows));
  const chip = await page.$('.list .chip');
  if(chip) console.log('chip', JSON.stringify(await chip.evaluate(e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {h:+r.height.toFixed(1),color:c.color,bg:c.backgroundColor,fs:c.fontSize};})));
  console.log('page text head:', (await page.innerText('#view')).split('\n').slice(0,12).join(' / '));
  // typing test
  await page.click('#rqFind');
  const t0=Date.now();
  await page.type('#rqFind','oats',{delay:60});
  await page.waitForTimeout(150);
  const st = await page.evaluate(()=>({active:document.activeElement && document.activeElement.id, val:document.getElementById('rqFind')?.value, sel:document.getElementById('rqFind')?.selectionStart, rows:document.querySelectorAll('[data-act="cook-recipe"]').length, scrollY:window.scrollY}));
  console.log('after typing', JSON.stringify(st), 'ms', Date.now()-t0);
  // caret in the middle test: move caret to start and type
  await page.evaluate(()=>{const e=document.getElementById('rqFind'); e.setSelectionRange(0,0);});
  await page.keyboard.type('r');
  await page.waitForTimeout(100);
  console.log('caret-at-start typing ->', JSON.stringify(await page.evaluate(()=>({val:document.getElementById('rqFind').value, sel:document.getElementById('rqFind').selectionStart, active:document.activeElement.id}))));
  // keystroke cost
  const cost = await page.evaluate(()=>{const t=performance.now(); for(let i=0;i<10;i++){document.getElementById('view').innerHTML=viewRecipes();} return (performance.now()-t)/10;});
  console.log('viewRecipes render ms (avg of 10, filtered):', cost.toFixed(1));
  await page.evaluate(()=>{UI.recipeFind='';});
  const cost2 = await page.evaluate(()=>{const t=performance.now(); for(let i=0;i<10;i++){document.getElementById('view').innerHTML=viewRecipes();} return (performance.now()-t)/10;});
  console.log('viewRecipes render ms full list:', cost2.toFixed(1));
  await ctx.close();
}
await browser.close();
