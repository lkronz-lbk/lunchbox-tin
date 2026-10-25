/* Builds the two things that show the email program, from copy.json:
     1. the mock-up page (every email drawn in the real shell, editable in place), written to the
        path given as the first argument, or to docs/email-program/mockups.html;
     2. the content-spec blocks in report.md, rewritten in place from the same copy.
   Run from the repository root:  node docs/email-program/build.mjs [out.html]
   The page's edits are saved in the published artifact's own store (collection "copy", one document
   per email id, the changed fields only). Pulling them back is: read that collection with the
   ArtifactData tool, write the fields into copy.json, run this script, publish the page again. */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const copy = JSON.parse(fs.readFileSync(path.join(HERE, 'copy.json'), 'utf8'));
const OUT = process.argv[2] || path.join(HERE, 'mockups.html');
const partsSrc = fs.readFileSync('netlify/lib/mail-parts.js', 'utf8');
const parts = await import(path.resolve('netlify/lib/mail-parts.js'));

/* the browser gets the same renderer the server uses: the module with its export keywords removed */
const PARTS_INLINE = partsSrc.replace(/^export (const|function) /gm, '$1 ');
const IMG = Object.fromEntries(Object.entries(copy.images).map(([k, v]) => [k, `data:${v.mime};base64,` + fs.readFileSync(v.file).toString('base64')]));
IMG.icon = 'data:image/png;base64,' + fs.readFileSync('public/icons/icon-192.png').toString('base64');

const esc = parts.esc;
const groups = [...new Set(copy.emails.map(e => e.group))];
const slug = (g) => g.toLowerCase().replace(/\s+/g, '-');
const STATUS = { change: 'Change', add: 'New', hold: 'Spec, on hold', later: 'Later' };

const card = (e) => `
<article class="card" id="${esc(e.id)}" data-id="${esc(e.id)}">
  <header class="head">
    <div class="num">${esc(e.n)}</div>
    <div class="title"><h3>${esc(e.name)}</h3><div class="timing">${esc(e.timing)}</div></div>
    <span class="chip chip-${esc(e.status)}">${STATUS[e.status] || esc(e.status)}</span>
    <span class="chip chip-edited" data-edited hidden>Edited</span>
  </header>
  <div class="inbox" aria-label="How it reads in the inbox">
    <img class="av" src="${IMG.icon}" alt="" width="36" height="36">
    <div class="row"><div class="from">Lunch Sorted <span class="when">7:30 AM</span></div><div class="subj" data-subj></div><div class="pre" data-pre></div></div>
  </div>
  <div class="tools">
    <button type="button" class="ghost" data-edit aria-expanded="false" aria-controls="form-${esc(e.id)}">Edit copy</button>
    <button type="button" class="ghost" data-copytext title="Copy the spec as text">Copy spec</button>
  </div>
  <form class="edit" id="form-${esc(e.id)}" hidden>
    <label>Subject <span class="n" data-count></span><input type="text" name="subject" id="subject-${esc(e.id)}" autocomplete="off"></label>
    <label>Preheader<input type="text" name="preheader" id="preheader-${esc(e.id)}" autocomplete="off"></label>
    <label>Headline<input type="text" name="headline" id="headline-${esc(e.id)}" autocomplete="off"></label>
    <label>Lines, one per line (**bold**, [a link](https://…))<textarea name="lines" id="lines-${esc(e.id)}" rows="4"></textarea></label>
    <label>Small print, one per line<textarea name="fine" id="fine-${esc(e.id)}" rows="2"></textarea></label>
    ${e.button ? `<label>Button<input type="text" name="buttonLabel" id="button-${esc(e.id)}" autocomplete="off"></label>` : ''}
    <div class="actions">
      <button type="submit" class="primary" data-save>Save</button>
      <button type="button" class="ghost" data-discard>Discard changes</button>
      <button type="button" class="ghost" data-revert hidden>Back to the plan's copy</button>
      <span class="state" data-state aria-live="polite"></span>
    </div>
  </form>
  <div class="phone"><iframe title="${esc(e.name)}" loading="lazy"></iframe></div>
  <dl class="meta"><dt>Purpose</dt><dd>${esc(e.purpose)}</dd><dt>Outcome</dt><dd>${esc(e.outcome)}</dd>${e.button ? `<dt>Button</dt><dd><code>${esc(e.button.href)}</code></dd>` : ''}</dl>
</article>`;

const sections = groups.map(g => `<section class="group" id="${slug(g)}"><h2>${esc(g)}</h2><div class="cards">${copy.emails.filter(e => e.group === g).map(card).join('')}</div></section>`).join('')
  + `<section class="group" id="not-sent"><h2>Not sent</h2>${copy.notSent.map(x => `<div class="note"><h3>${esc(x.n)}. ${esc(x.name)}</h3><p>${esc(x.why)}</p></div>`).join('')}</section>`;

const page = `<title>Lunch Sorted email mock-ups</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&family=Karla:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
/* layout: one scrolling gallery, cards in a responsive grid; each card is an inbox row, an edit form that folds open, and a phone */
:root{--ground:#E9EEE6;--surface:#FBFCF9;--ink:#16241E;--ink2:#3E4D45;--line:#CFDACB;--line-field:#6F8479;--accent:#2A5141;--soft:#DCE8DF;--warn:#664204;--hot:#7F310B;--head:'Familjen Grotesk','Helvetica Neue',Arial,sans-serif;--body:Karla,'Helvetica Neue',Arial,sans-serif;--mono:'IBM Plex Mono',ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#0E1815;--surface:#17251F;--ink:#E6EEE7;--ink2:#AFC1B6;--line:#2B3E36;--line-field:#5A8272;--accent:#81CBA8;--soft:#1F332A;--warn:#E6B372;--hot:#F4AD7F;color-scheme:dark}}
:root[data-theme="dark"]{--ground:#0E1815;--surface:#17251F;--ink:#E6EEE7;--ink2:#AFC1B6;--line:#2B3E36;--line-field:#5A8272;--accent:#81CBA8;--soft:#1F332A;--warn:#E6B372;--hot:#F4AD7F;color-scheme:dark}
body{background:var(--ground);color:var(--ink);font:400 16px/1.5 var(--body);margin:0;padding-block:0 48px;padding-inline:16px}
.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:2;background:var(--ground);display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line);margin-bottom:16px}
.top h1{font:700 22px/1.1 var(--head);margin:0;letter-spacing:-.01em}
.top .lede{color:var(--ink2);font-size:14px;flex:1 1 320px;min-width:0}
.seg{display:inline-flex;border:1px solid var(--line-field);border-radius:12px;overflow:hidden}
.seg button{font:600 14px var(--body);color:var(--ink);background:var(--surface);border:0;padding:10px 14px;min-height:44px;cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--accent);color:var(--ground)}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.banner{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 16px;font-size:14px;color:var(--ink2);margin:0 0 16px}
.banner b{color:var(--ink)}
nav.toc{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}
nav.toc a{font:600 14px var(--body);color:var(--ink);text-decoration:none;border:1px solid var(--line-field);background:var(--surface);border-radius:999px;padding:9px 14px;min-height:44px;display:inline-flex;align-items:center}
.legend{font-size:13px;color:var(--ink2);margin:-6px 0 24px}
.group{margin:0 0 36px}
.group h2{font:700 20px/1.2 var(--head);margin:0 0 14px;letter-spacing:-.01em}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px}
@media (max-width:420px){.cards{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;overflow:hidden;min-width:0;display:flex;flex-direction:column}
.head{display:flex;gap:12px;align-items:flex-start;padding:16px 18px 12px;flex-wrap:wrap}
.num{font:600 13px var(--mono);color:var(--ink2);min-width:28px;padding-top:4px}
.title{flex:1;min-width:160px}
.title h3{font:700 18px/1.2 var(--head);margin:0 0 2px;text-wrap:balance}
.timing{font-size:13px;color:var(--ink2)}
.chip{font:600 12px/1 var(--body);letter-spacing:.02em;border-radius:999px;padding:6px 10px;white-space:nowrap;border:1px solid var(--line-field);color:var(--ink);align-self:flex-start}
.chip-add{background:var(--soft);border-color:var(--accent)}
.chip-hold,.chip-later{color:var(--warn);border-color:var(--warn)}
.chip-edited{background:var(--accent);color:var(--ground);border-color:var(--accent)}
.inbox{display:flex;gap:12px;align-items:flex-start;padding:12px 18px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--ground)}
.inbox .av{border-radius:9px;flex:none}
.row{min-width:0;flex:1}
.from{font-weight:700;font-size:15px;display:flex;justify-content:space-between}
.when{font-weight:400;color:var(--ink2);font-size:13px}
.subj{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.subj .count{font:600 11px var(--mono);color:var(--ink2);margin-left:6px}
.cut{color:var(--hot);font-weight:400;margin:0 1px}
.pre{font-size:14px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tools{display:flex;gap:8px;padding:10px 18px 0;flex-wrap:wrap}
.ghost,.primary{font:600 14px var(--body);border-radius:12px;padding:10px 14px;min-height:44px;cursor:pointer}
.ghost{background:var(--surface);color:var(--ink);border:1px solid var(--line-field)}
.primary{background:var(--accent);color:var(--ground);border:1px solid var(--accent)}
.ghost[aria-expanded="true"]{background:var(--soft)}
.edit{display:grid;gap:12px;padding:14px 18px 4px;border-bottom:1px solid var(--line);margin-bottom:4px}
.edit label{display:grid;gap:4px;font:600 13px var(--body);color:var(--ink2)}
.edit label .n{font:600 11px var(--mono);margin-left:6px}
.edit input,.edit textarea{font:400 16px/1.4 var(--body);color:var(--ink);background:var(--ground);border:1px solid var(--line-field);border-radius:8px;padding:10px 12px;min-height:44px;width:100%;box-sizing:border-box;resize:vertical}
.edit .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.state{font-size:13px;color:var(--ink2)}
.phone{padding:16px 18px 0}
.phone iframe{display:block;width:100%;max-width:390px;height:760px;margin:0 auto;border:1px solid var(--line);border-radius:28px;background:#E9EEE6}
[data-mail="dark"] .phone iframe{background:#0E1815}
.meta{margin:0;padding:14px 18px 18px;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px}
.meta dt{font:600 12px var(--mono);color:var(--ink2);letter-spacing:.04em;text-transform:uppercase;padding-top:2px}
.meta dd{margin:0;color:var(--ink);min-width:0;overflow-wrap:anywhere}
.meta code{font:400 13px var(--mono)}
.note{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px;max-width:720px}
.note h3{font:700 18px/1.2 var(--head);margin:0 0 8px}
.note p{margin:0;color:var(--ink2)}
@media (prefers-reduced-motion:no-preference){.seg button,.ghost{transition:background .15s}}
</style>
<div class="top">
  <h1>Lunch Sorted email mock-ups</h1>
  <div class="lede">Every email in the program, drawn in the real shell at phone width. Tap <b>Edit copy</b> on any card to change its words; the phone redraws as you type, and <b>Save</b> keeps the change for the next pull into the plan.</div>
  <div class="seg" role="group" aria-label="Email appearance"><button type="button" id="mailLight" aria-pressed="true">Light</button><button type="button" id="mailDark" aria-pressed="false">Dark</button></div>
</div>
<div class="banner" id="dbNote" hidden></div>
<nav class="toc">${groups.map(g => `<a href="#${slug(g)}">${esc(g)}</a>`).join('')}<a href="#not-sent">Not sent</a></nav>
<p class="legend">The <span class="cut">|</span> in a subject marks character 37, where the Gmail app on iPhone cuts it; Apple Mail shows 48. The number after it is the subject’s length.</p>
${sections}
<script>
${PARTS_INLINE}
</script>
<script>
const SITE = ${JSON.stringify(copy.site)}, STOP = SITE + '/api/auth/mail-stop?t=TOKEN';
const BASE = ${JSON.stringify(copy.emails)};
const IMG = ${JSON.stringify(IMG)};
const GMAIL = 37;
const byId = Object.fromEntries(BASE.map(e => [e.id, e]));
let saved = {};      /* the store's overlay, by id: the fields a person changed and saved */
let draft = {};      /* unsaved edits in this view, by id */
let dark = false;
try { dark = localStorage.getItem('ls-mail-dark') === '1'; } catch {}

const esc2 = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const splitLines = (s) => String(s).split('\\n').map(x => x.trim()).filter(Boolean);
const FIELDS = ['subject', 'preheader', 'headline', 'lines', 'fine', 'buttonLabel'];
const merged = (id) => {
  const e = { ...byId[id], ...(saved[id] || {}), ...(draft[id] || {}) };
  const o = { ...e, button: e.button ? { ...e.button, label: e.buttonLabel || e.button.label } : null };
  delete o.buttonLabel; delete o.updatedAt;
  return o;
};
const fill = (html) => html
  .replace('https://lunchsorted.app/icons/icon-192.png', IMG.icon)
  .replace('@media (prefers-color-scheme: dark)', dark ? '@media all' : '@media not all')
  .replace('<head>', '<head><base target="_blank">');
const cutMark = (s) => s.length > GMAIL ? esc2(s.slice(0, GMAIL)) + '<span class="cut" title="Where the Gmail app cuts the subject">|</span>' + esc2(s.slice(GMAIL)) : esc2(s);

const renderCard = (id) => {
  const art = document.getElementById(id); if (!art) return;
  const e = merged(id);
  const out = renderEmail(e, { site: SITE, img: (k) => IMG[k] || '', stopUrl: STOP });
  art.querySelector('iframe').srcdoc = fill(out.html);
  art.querySelector('[data-subj]').innerHTML = cutMark(e.subject) + ' <span class="count">' + e.subject.length + '</span>';
  art.querySelector('[data-pre]').textContent = e.preheader;
  art.querySelector('[data-edited]').hidden = !saved[id];
  art.querySelector('[data-revert]').hidden = !saved[id] || !db;
  const c = art.querySelector('[data-count]'); if (c) c.textContent = e.subject.length + (e.subject.length > GMAIL ? ' (Gmail cuts at 37)' : '');
};
const fillForm = (id) => {
  const art = document.getElementById(id), e = merged(id), f = art.querySelector('form');
  f.subject.value = e.subject; f.preheader.value = e.preheader; f.headline.value = e.headline;
  f.lines.value = (e.lines || []).join('\\n'); f.fine.value = (e.fine || []).join('\\n');
  if (f.buttonLabel) f.buttonLabel.value = e.button ? e.button.label : '';
};
const readForm = (id) => {
  const f = document.getElementById(id).querySelector('form');
  const d = { subject: f.subject.value.trim(), preheader: f.preheader.value.trim(), headline: f.headline.value.trim(), lines: splitLines(f.lines.value), fine: splitLines(f.fine.value) };
  if (f.buttonLabel) d.buttonLabel = f.buttonLabel.value.trim();
  return d;
};
/* only what differs from the plan's copy is kept, so the pull back into copy.json is the diff */
const diffFromBase = (id, d) => {
  const b = byId[id], out = {};
  for (const k of FIELDS) {
    const bv = k === 'buttonLabel' ? (b.button ? b.button.label : undefined) : b[k];
    if (d[k] === undefined) continue;
    if (JSON.stringify(d[k]) !== JSON.stringify(bv)) out[k] = d[k];
  }
  return out;
};
const specText = (id) => {
  const e = merged(id);
  return ['Subject (' + e.subject.length + '): ' + e.subject, 'Preheader: ' + e.preheader, 'Headline: ' + e.headline,
    'Visual: ' + (e.visual ? e.visual.alt + ' (' + e.visual.key + ')' : 'none'), 'Lines:', ...e.lines.map(x => '  ' + x),
    ...(e.code ? ['Code: ' + e.code] : []), ...(e.fine.length ? ['Small print:', ...e.fine.map(x => '  ' + x)] : []),
    'Button: ' + (e.button ? e.button.label + '  →  ' + e.button.href : 'none'), 'Voice: ' + (e.signed ? 'Liz, signed' : 'product')].join('\\n');
};

let db = null, timers = {};
const setState = (id, msg) => { document.getElementById(id).querySelector('[data-state]').textContent = msg; };
const renderAll = () => BASE.forEach(e => { renderCard(e.id); if (!draft[e.id]) fillForm(e.id); });

document.querySelectorAll('.card').forEach(art => {
  const id = art.dataset.id, f = art.querySelector('form');
  art.querySelector('[data-edit]').onclick = (ev) => { const open = f.hidden; f.hidden = !open; ev.currentTarget.setAttribute('aria-expanded', String(open)); if (open) { fillForm(id); f.subject.focus(); } };
  f.addEventListener('input', () => { clearTimeout(timers[id]); timers[id] = setTimeout(() => { draft[id] = readForm(id); renderCard(id); setState(id, 'Previewing. Not saved yet.'); }, 150); });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!db) { setState(id, 'Open the page signed in to save.'); return; }
    const d = diffFromBase(id, readForm(id));
    setState(id, 'Saving…');
    try {
      if (Object.keys(d).length) await db.doc('copy/' + id).set({ ...d, updatedAt: new Date().toISOString() });
      else await db.doc('copy/' + id).delete();
      delete draft[id]; setState(id, Object.keys(d).length ? 'Saved.' : 'Same as the plan; nothing to save.');
    } catch (e) { setState(id, e && e.code === 'invalid_argument' ? 'You can read this page but not save to it.' : 'Could not save. Try again in a moment.'); }
  });
  art.querySelector('[data-discard]').onclick = () => { delete draft[id]; fillForm(id); renderCard(id); setState(id, ''); };
  art.querySelector('[data-revert]').onclick = async () => {
    if (!db) return; setState(id, 'Reverting…');
    try { await db.doc('copy/' + id).delete(); delete draft[id]; setState(id, 'Back to the plan’s copy.'); }
    catch { setState(id, 'Could not revert. Try again in a moment.'); }
  };
  art.querySelector('[data-copytext]').onclick = async (ev) => {
    const t = specText(id), b = ev.currentTarget;
    try { await navigator.clipboard.writeText(t); b.textContent = 'Copied'; } catch { window.getSelection && window.prompt === undefined; b.textContent = 'Select and copy below'; const pre = document.createElement('pre'); pre.textContent = t; pre.style.cssText = 'white-space:pre-wrap;font:13px var(--mono);padding:0 18px'; art.insertBefore(pre, art.querySelector('.phone')); }
    setTimeout(() => { b.textContent = 'Copy spec'; }, 1500);
  };
});
const setDark = (v) => { dark = v; try { localStorage.setItem('ls-mail-dark', v ? '1' : '0'); } catch {} document.documentElement.setAttribute('data-mail', v ? 'dark' : 'light'); document.getElementById('mailLight').setAttribute('aria-pressed', String(!v)); document.getElementById('mailDark').setAttribute('aria-pressed', String(v)); BASE.forEach(e => renderCard(e.id)); };
document.getElementById('mailLight').onclick = () => setDark(false);
document.getElementById('mailDark').onclick = () => setDark(true);
setDark(dark);
renderAll();

/* the store lights up when the viewer has it; without it the page still previews, and says so */
(async () => {
  const note = document.getElementById('dbNote');
  try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch { db = null; }
  if (!db) { note.innerHTML = '<b>Preview only.</b> Edits redraw the phone but cannot be saved from here; open the page signed in on claude.ai to save them.'; note.hidden = false; document.querySelectorAll('[data-save]').forEach(b => { b.disabled = true; }); return; }
  db.collection('copy').onSnapshot((snap) => {
    saved = {}; snap.docs.forEach(d => { if (d.exists) saved[d.id] = d.data(); });
    renderAll();
    const n = Object.keys(saved).length;
    note.innerHTML = n ? '<b>' + n + ' email' + (n === 1 ? '' : 's') + ' edited.</b> Saved edits are marked on their card and wait here for the next pull into the plan.' : '<b>No edits saved yet.</b> Tap Edit copy on a card, change a line, and Save.';
    note.hidden = false;
  }, () => { note.innerHTML = '<b>Preview only.</b> The store could not be reached; edits redraw the phone but will not save.'; note.hidden = false; });
})();
</script>`;
fs.writeFileSync(OUT, page);
console.log('page', OUT, Math.round(fs.statSync(OUT).size / 1024) + 'KB,', copy.emails.length, 'emails');

/* ---- report.md: rewrite each email's content-spec block from the same copy ------------------ */
const report = path.join(HERE, 'report.md');
if (fs.existsSync(report)) {
  const lines = fs.readFileSync(report, 'utf8').split('\n');
  const num = (n) => String(n).replace(/[A-Za-z]/g, '');
  const byNum = {};
  for (const e of copy.emails) (byNum[num(e.n)] ||= []).push(e);
  const KEEP = /^(Beta variant|Joiner variant|Never|Text part|Headers|Voice):/;
  const block = (es, old) => {
    const out = [];
    const one = (e, label) => {
      if (label) out.push(label);
      const pad = (k, v) => out.push((k + ':').padEnd(15) + v);
      pad(`Subject (${e.subject.length})`, e.subject);
      pad('Preheader', e.preheader);
      pad('Headline', e.headline);
      pad('Visual', e.visual ? `${e.visual.alt} (${e.visual.key}${e.visual.crop != null ? ', a new crop via scripts/mail-shots.mjs' : ', exists'})` : 'none');
      e.lines.forEach((x, i) => out.push((i ? '' : 'Lines:').padEnd(15) + x));
      if (e.code) pad('Code', `${e.code}, in the code box`);
      e.fine.forEach((x, i) => out.push((i ? '' : 'Small print:').padEnd(15) + x));
      pad('Button', e.button ? `${e.button.label}  →  ${copy.site}${e.button.href}` : 'none');
      pad('Voice', e.signed ? 'Liz, signed "Liz"' : 'product');
      pad('Headers', e.lifecycle ? 'stop link + List-Unsubscribe' : 'none (transactional)');
    };
    if (es.length === 1) one(es[0]); else es.forEach((e, i) => { if (i) out.push(''); one(e, `Version ${String.fromCharCode(65 + i)} (${e.name.replace(/^Day \d+: /, '')})`); });
    /* lines of the old block that this copy does not carry (variants, what never appears) stay */
    const kept = [];
    for (let i = 0; i < old.length; i++) {
      const m = old[i].match(/^([A-Za-z][A-Za-z ]*):/);
      if (m && KEEP.test(old[i]) && !/^(Headers|Voice):/.test(old[i])) { kept.push(old[i]); while (old[i + 1] && /^\s{10,}/.test(old[i + 1])) kept.push(old[++i]); }
    }
    return kept.length ? [...out, ...kept] : out;
  };
  let changed = 0;
  for (const [n, es] of Object.entries(byNum)) {
    const h = lines.findIndex(l => new RegExp(`^\\*\\*${n}\\. `).test(l));
    if (h < 0) continue;
    const open = lines.findIndex((l, i) => i > h && l.startsWith('```'));
    const close = lines.findIndex((l, i) => i > open && l.startsWith('```'));
    if (open < 0 || close < 0) continue;
    const fresh = block(es, lines.slice(open + 1, close));
    lines.splice(open + 1, close - open - 1, ...fresh);
    changed++;
  }
  fs.writeFileSync(report, lines.join('\n'));
  console.log('report', changed, 'spec blocks rewritten');
}
