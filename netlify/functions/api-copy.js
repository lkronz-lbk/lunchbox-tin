/* /admin/copy — the words on the home page, editable by the people named in
   ADMIN_EMAILS. Layout, colours and structure are not here on purpose: this
   screen changes wording only.

   Two steps, and the split is deliberate. Saving writes rows into site_copy and
   costs nothing, so an edit can be fiddled with all afternoon. Putting the
   words on the site pings a Netlify build hook; the build runs
   `scripts/copy.mjs --apply`, which folds the saved words into
   public/index.html before publishing. So the live site stays plain static
   HTML — no script on the page, no function in front of it, no per-visitor
   cost — and a search engine sees exactly what a parent sees. The wording
   committed in git is always the fallback: clear a row and the original comes
   back at the next deploy.

   The page has no script of its own either; it is a form that posts to itself
   and answers with a redirect, so a reload never saves anything twice.
   Sessions are SameSite=Lax cookies, so a form on someone else's site arrives
   without one, and the origin is checked as well. */
import { sql, siteEnv } from '../lib/db.js';
import { currentUser, sameOrigin } from '../lib/auth.js';
import { page as shell, esc, isAdmin } from '../lib/page.js';
import { FIELDS } from '../lib/copy-fields.js';
import { checkValue, MAX_COPY } from '../lib/copy.js';

const CSS = `.bar{position:sticky;top:0;background:var(--ground);padding:9px 0;margin:0 0 6px;border-bottom:1px solid var(--edge);display:flex;gap:10px;align-items:center;flex-wrap:wrap;z-index:2}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 17px;border-radius:12px;border:1.6px solid var(--accent);background:var(--accent);color:var(--accent-fg);font:600 15px "Familjen Grotesk","Trebuchet MS",sans-serif;text-decoration:none;cursor:pointer}
.btn.quiet{background:var(--surface);color:var(--ink);border-color:var(--edge)}
.note{font-size:13.5px;color:var(--ink-2);margin:0 0 14px}
.jump{margin:0 0 18px;font-size:14px;line-height:2.1}
.jump a{margin-right:14px;white-space:nowrap}
.f{background:var(--surface);border:1px solid var(--edge);border-radius:14px;padding:14px 15px;margin:0 0 10px}
.f.edited{border-color:var(--accent);border-width:1.6px}
.f.wrong{border-color:var(--warn);border-width:1.6px}
.f label{display:block;font:600 15px "Familjen Grotesk","Trebuchet MS",sans-serif;margin:0 0 2px}
.f .why{font-size:13.5px;color:var(--ink-2);margin:0 0 8px}
.f textarea{width:100%;min-height:44px;padding:9px 11px;border-radius:10px;border:1.5px solid var(--edge);background:var(--ground);color:var(--ink);font:16px/1.45 Karla,"Helvetica Neue",sans-serif;resize:vertical}
.f textarea:focus{border-color:var(--accent)}
.f .was{font-size:13.5px;color:var(--ink-2);margin:8px 0 0}
.f .was b{color:var(--ink-3);font-weight:400}
.f .restore{display:flex;gap:9px;align-items:center;min-height:44px;font-size:14px;color:var(--ink-2)}
.f .restore input{width:20px;height:20px;flex:none}
.f .bad{color:var(--warn);font-size:14px;margin:8px 0 0}
.tag{font:600 10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-left:8px}
.flash{background:var(--surface);border:1.6px solid var(--accent);border-radius:14px;padding:12px 15px;margin:0 0 16px;font-size:14.5px}
.flash.wrong{border-color:var(--warn)}
.flash form{margin:10px 0 0}`;

const page = (title, body, status = 200) => shell(title, body, { status, css: CSS, forms: true });

/* the middle of home.hero.title, in the order the sections appear on the page */
const SECTIONS = {
  meta: ['In Google, and when the link is shared', 'Nobody reads these on the page; everybody reads them in a search result or a group chat.', 'In Google'],
  nav: ['The top of the page', '', 'The top'],
  hero: ['The first screen', 'What a parent sees before scrolling. This is the one that decides whether they stay.', 'First screen'],
  how: ['How it works', '', 'How it works'],
  what: ['The four compartments', '', 'Compartments'],
  phone: ['On your phone', '', 'On your phone'],
  install: ['Adding it to the home screen', '', 'Home screen'],
  price: ['What it costs', 'Words only. What Stripe charges is set in Stripe; change it there first.', 'What it costs'],
  next: ['What is coming, and the email form', '', 'What is coming'],
  footer: ['The bottom of the page', '', 'The bottom']
};
const sectionOf = (key) => key.split('.')[1];
/* no prototype: a posted name like __proto__ must miss, not inherit a match */
const bare = (pairs) => Object.assign(Object.create(null), Object.fromEntries(pairs));
const BY_KEY = bare(FIELDS.map(f => [f.key, f]));
const FIRST = {};                                    /* the first field of each section, for the jump links */
for (const f of FIELDS) if (FIRST[sectionOf(f.key)] == null) FIRST[sectionOf(f.key)] = f.key;

async function load() {
  try {
    const q = sql();
    const [rows, meta] = await Promise.all([q`SELECT key, value FROM site_copy`, q`SELECT key, at FROM site_meta WHERE key IN ('edited', 'published')`]);
    const when = bare(meta.map(m => [m.key, new Date(m.at).getTime()]));
    /* a row whose name has since been renamed or taken off the page: it changes
       nothing, and without this it could never be seen or cleared */
    const orphans = rows.filter(r => !Object.hasOwn(BY_KEY, r.key)).map(r => r.key);
    return { values: bare(rows.map(r => [r.key, r.value])), orphans, waiting: !!when.edited && when.edited > (when.published || 0) };
  } catch (e) { console.error('api-copy read', e); return null; }
}
const stamp = (key) => sql()`INSERT INTO site_meta (key, at) VALUES (${key}, now()) ON CONFLICT (key) DO UPDATE SET at = now()`;

/* Netlify rebuilds and republishes when this is pinged. Only production has a
   hook: a branch deploy writes to its own database, so a rebuild triggered from
   there would republish production's words, not the ones just typed. */
async function rebuild() {
  const hook = process.env.NETLIFY_BUILD_HOOK;
  if (siteEnv() !== 'production') return 'off';
  if (!hook || !/^https:\/\/api\.netlify\.com\/build_hooks\/[\w-]+$/.test(hook)) return 'off';
  /* a hook that hangs must not hold the function open to the platform timeout */
  try { return (await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(8000) })).ok ? 'sent' : 'failed'; }
  catch (e) { console.error('api-copy hook', e); return 'failed'; }
}

function field(f, value, error) {
  const edited = value.trim() !== f.original.trim();
  const rows = Math.min(10, Math.max(2, Math.ceil(Math.max(f.original.length, value.length) / 38)));
  const marks = (f.tags || []).map(t => `<${t}>…</${t}>`).join(' and ');
  const why = [f.note, marks ? `Keep the ${marks} markers where they are.` : ''].filter(Boolean).join(' ');
  return `<div class="f${error ? ' wrong' : edited ? ' edited' : ''}">
<label for="${esc(f.key)}">${esc(f.label)}${edited ? '<span class="tag">edited</span>' : ''}</label>
${why ? `<p class="why">${esc(why)}</p>` : ''}
<textarea id="${esc(f.key)}" name="f:${esc(f.key)}" rows="${rows}" maxlength="${MAX_COPY}" spellcheck="true">${esc(value)}</textarea>
${error ? `<p class="bad">${esc(error)}</p>` : ''}
${f.key.startsWith('home.meta.') ? `<p class="was">${value.trim().length} characters as it stands.</p>` : ''}
${edited ? `<p class="was">It started as: <b>${esc(f.original)}</b></p>
<label class="restore"><input type="checkbox" name="r:${esc(f.key)}" value="1"> Throw away what I wrote and put that back</label>` : ''}
</div>`;
}

function form(values, errors = {}, flash = '', state = {}) {
  const out = [];
  let section = '';
  for (const f of FIELDS) {
    const s = sectionOf(f.key);
    if (s !== section) {
      section = s;
      const [title, blurb] = Object.hasOwn(SECTIONS, s) ? SECTIONS[s] : [s, ''];
      out.push(`<h2>${esc(title)}</h2>${blurb ? `<p class="note">${esc(blurb)}</p>` : ''}`);
    }
    const value = values[f.key] == null ? f.original : values[f.key];
    out.push(field(f, value, errors[f.key]));
  }
  const jump = Object.entries(SECTIONS).filter(([s]) => FIRST[s])
    .map(([s, [, , short]]) => `<a href="#${esc(FIRST[s])}">${esc(short)}</a>`).join('\n');   /* the whitespace is what lets the row wrap */
  const publish = `<form method="POST" action="/admin/copy"><input type="hidden" name="publish" value="1"><button class="btn" type="submit">Put the words on the site</button></form>`;
  const orphans = (state.orphans || []).length;
  return `<h1>The words on the home page</h1>
<p class="sub">${siteEnv() === 'production' ? 'The live site' : `The ${esc(siteEnv())} copy — edits here never reach lunchsorted.app`} · wording only: the layout, the colours and the screenshots are not editable here</p>
${flash ? `<div class="flash">${flash}</div>` : ''}
${state.waiting ? `<div class="flash">Saved words are waiting for the site. ${publish}</div>` : ''}
${orphans ? `<div class="flash">${orphans} saved string${orphans === 1 ? '' : 's'} no longer match anything on the page — the page was changed after they were written, so they do nothing.
<form method="POST" action="/admin/copy"><input type="hidden" name="tidy" value="1"><button class="btn quiet" type="submit">Clear them out</button></form></div>` : ''}
<p class="note">Saving keeps your words here and changes nothing a parent sees. When you are happy, put them on the site: it publishes again, and the change is live in a minute or two.</p>
<p class="jump">${jump}</p>
<form method="POST" action="/admin/copy">
<div class="bar"><button class="btn" type="submit">Save the words</button>
<a class="btn quiet" href="/" target="_blank" rel="noopener">See the page (new tab)</a></div>
${out.join('\n')}
<div class="bar" style="border-top:1px solid var(--edge);border-bottom:0"><button class="btn" type="submit">Save the words</button></div>
</form>
<p class="note" style="margin-top:22px">Only &lt;b&gt;bold&lt;/b&gt;, &lt;i&gt;italic&lt;/i&gt;, &lt;small&gt;small&lt;/small&gt; and links are markup here; anything else in angle brackets is shown as text. Tags left open are closed for you, so a slip cannot run on down the page. <a href="/admin">The numbers</a>.</p>`;
}

const seeOther = (to) => new Response('', { status: 303, headers: { location: to, 'cache-control': 'no-store' } });

export default async function handler(req) {
  try {
    const user = await currentUser(req);
    if (!user) return page('Sign in first', `<h1>Sign in first.</h1><p>Open <a href="/app/">the planner</a>, sign in from Setup, then come back to this page.</p>`, 401);
    if (!isAdmin(user)) return page('Not found', `<h1>Not found.</h1><p><a href="/app/">Back to Lunch Sorted</a></p>`, 404);

    if (req.method === 'POST') {
      if (!sameOrigin(req, process.env.URL || '')) return page('Not from here', `<h1>That form did not come from this site.</h1><p><a href="/admin/copy">Start again</a></p>`, 403);
      if (Number(req.headers.get('content-length') || 0) > 300000) return page('Too much', `<h1>That was too much text to save at once.</h1><p><a href="/admin/copy">Start again</a></p>`, 413);
      const body = await req.formData();
      const q = sql();

      if (body.get('publish')) {
        const built = await rebuild();
        if (built === 'sent') await stamp('published');
        return seeOther('/admin/copy?build=' + built);
      }

      const state = await load();
      /* without knowing what is stored, a save could quietly do nothing at all */
      if (!state) return page('No database', `<h1>Nothing was saved.</h1><p>The database did not answer, so your words were not written down. <a href="/admin/copy">Try again</a>.</p>`, 503);
      if (body.get('tidy')) {
        if (state.orphans.length) { await sql()`DELETE FROM site_copy WHERE key = ANY(${state.orphans})`; await stamp('edited'); }
        return seeOther('/admin/copy?tidied=' + state.orphans.length);
      }
      const current = state.values;
      /* what is stored comes first, so a box the form did not send is redrawn as
         it is saved rather than as it is committed */
      const values = bare(Object.entries(current)), errors = Object.create(null), writes = [];
      for (const [name, raw] of body.entries()) {
        if (!name.startsWith('f:')) continue;
        const key = name.slice(2);
        if (!Object.hasOwn(BY_KEY, key)) continue;            /* a name we do not publish is not a name we save */
        const f = BY_KEY[key];
        if (body.get('r:' + key)) {
          values[key] = f.original;
          if (current[key] != null) writes.push(q`DELETE FROM site_copy WHERE key = ${key}`);
          continue;
        }
        const { value, error } = checkValue(raw);
        if (error) { values[key] = String(raw); errors[key] = error; continue; }
        values[key] = value;
        if (value === f.original.trim()) {
          /* back to the committed wording: the row goes, so git stays the source */
          if (current[key] != null) writes.push(q`DELETE FROM site_copy WHERE key = ${key}`);
        } else if (current[key] !== value) {
          writes.push(q`INSERT INTO site_copy (key, value, updated_by) VALUES (${key}, ${value}, ${user.id})
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`);
        }
      }
      /* one round of statements rather than one after another, so rewriting the
         whole page is a moment and not a minute */
      if (writes.length) { await Promise.all(writes); await stamp('edited'); }

      const wrong = Object.keys(errors);
      if (wrong.length) {
        const flash = `<b>${wrong.length === 1 ? 'One box was' : `${wrong.length} boxes were`} left empty, so ${wrong.length === 1 ? 'it was' : 'they were'} not saved.</b>
${wrong.map(k => `<a href="#${esc(k)}">${esc(BY_KEY[k].label)}</a>`).join(' · ')}${writes.length ? `<br>The other ${writes.length} change${writes.length === 1 ? '' : 's'} ${writes.length === 1 ? 'was' : 'were'} saved, and ${writes.length === 1 ? 'is' : 'are'} waiting to go on the site.` : ''}`;
        return page('Check these', form(values, errors, flash, state), 400);
      }
      const first = Object.keys(values).find(k => values[k].trim() !== BY_KEY[k].original.trim());
      return seeOther(`/admin/copy?saved=${writes.length}` + (first ? '#' + first : ''));
    }

    const state = await load();
    if (!state) return page('No database', `<h1>The words cannot be loaded right now.</h1><p>The database did not answer. <a href="/admin/copy">Try again</a>.</p>`, 503);
    const url = new URL(req.url);
    const saved = url.searchParams.get('saved'), n = Number(saved), build = url.searchParams.get('build'), tidied = url.searchParams.get('tidied');
    const flash = build === 'sent' ? 'The site is being published now. Give it a minute or two, then look at the page.'
      : build === 'failed' ? 'Netlify did not take the request to publish. Nothing is lost — the words are still saved; try again in a minute.'
      : build === 'off' ? (siteEnv() === 'production'
          ? 'Nothing was published: this site has no build hook set, so the words will appear at the next deploy.'
          : 'Nothing was published: this is not the live site, and edits here never reach lunchsorted.app.')
      : tidied != null ? `Cleared ${tidied} string${tidied === '1' ? '' : 's'} that no longer matched the page.`
      : saved == null ? ''
      : n > 0 ? `Saved ${n} change${n === 1 ? '' : 's'}. Nothing a parent sees has changed yet — use “Put the words on the site” when you are happy.`
      : 'Nothing had changed, so nothing was saved.';
    return page('The words', form(state.values, {}, flash, state));
  } catch (e) {
    console.error('api-copy', e);
    return page('Something went wrong', `<h1>Something went wrong on our side.</h1><p><a href="/admin/copy">Try again</a></p>`, 500);
  }
}

export const config = { path: ['/api/copy', '/admin/copy'] };
