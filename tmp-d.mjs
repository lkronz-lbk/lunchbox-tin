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
for(const scheme of ['dark']){
  const ctx = await browser.newContext({viewport:{width:375,height:812}, deviceScaleFactor:2, colorScheme:scheme});
  await ctx.route(/fonts\.g/, r=>r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e=>console.log('PAGEERROR', e.message));
  await onboard(page);
  await page.click('[data-act="tab"][data-tab="recipes"]'); await page.waitForTimeout(400);
  const inp = await page.$eval('#rqFind', e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);
    return {h:+r.height.toFixed(1), bg:c.backgroundColor, color:c.color, border:c.borderColor+' '+c.borderStyle+' '+c.borderWidth, radius:c.borderRadius};});
  console.log('DARK rqFind', JSON.stringify(inp));
  // placeholder colour
  console.log('placeholder shown?', await page.$eval('#rqFind', e=>e.placeholder));
  // contrast helpers
  const contrast = await page.evaluate(()=>{
    function L(c){const m=c.match(/[\d.]+/g).map(Number);const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);}
    function R(a,b){const l1=L(a),l2=L(b);return ((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2);}
    const cs=getComputedStyle(document.documentElement);
    const g=n=>cs.getPropertyValue(n).trim();
    function toRGB(hex){hex=hex.replace('#','');return 'rgb('+parseInt(hex.slice(0,2),16)+','+parseInt(hex.slice(2,4),16)+','+parseInt(hex.slice(4,6),16)+')';}
    const t={};
    ['--ground','--surface','--surface-2','--ink','--ink-2','--ink-3','--line','--line-strong','--accent','--hot'].forEach(n=>t[n]=toRGB(g(n)));
    const row=document.querySelector('[data-act="cook-recipe"]');
    const meta=row.querySelector('.meta'), chip=row.querySelector('.chip'), go=row.querySelector('.go');
    const rowbg=getComputedStyle(document.querySelector('.list')).backgroundColor;
    return {
      'meta on list': R(getComputedStyle(meta).color, rowbg),
      'nm on list': R(getComputedStyle(row.querySelector('.nm')).color, rowbg),
      'chev(.go) on list': R(getComputedStyle(go).color, rowbg),
      'chip text on chip bg': chip? R(getComputedStyle(chip).color, getComputedStyle(chip).backgroundColor):'n/a',
      'chip border on list': chip? R(getComputedStyle(chip).borderTopColor, rowbg):'n/a',
      'divider line on list': R(t['--line'], rowbg),
      'tab inactive ink-3 on ground': R(t['--ink-3'], t['--ground']),
      'tab active accent on ground': R(t['--accent'], t['--ground']),
      'due dot hot on ground': R(t['--hot'], t['--ground']),
      'search native border on ground': R(getComputedStyle(document.getElementById('rqFind')).borderTopColor, t['--ground']),
      'search text on search bg': R(getComputedStyle(document.getElementById('rqFind')).color, getComputedStyle(document.getElementById('rqFind')).backgroundColor),
      'hint muted ink-2 on ground': R(t['--ink-2'], t['--ground']),
      'sect-head h3 ink? ': R(getComputedStyle(document.querySelector('.sect-head h3')).color, t['--ground']),
      'count ink-3 on ground': R(t['--ink-3'], t['--ground'])
    };
  });
  console.log(JSON.stringify(contrast,null,1));
  // keystroke cost with real input events
  await page.click('#rqFind');
  const per = await page.evaluate(async ()=>{
    const e=document.getElementById('rqFind'); const out=[];
    for(const v of ['o','oa','oat','oats','oat','oa','o','']){
      const t=performance.now(); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); out.push(+(performance.now()-t).toFixed(1));
    }
    return out;
  });
  console.log('ms per keystroke (input handler, desktop chromium):', JSON.stringify(per));
  await ctx.close();
}
await browser.close();
