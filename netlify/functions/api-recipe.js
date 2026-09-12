import dns from 'node:dns/promises';
import { json, fail, clientIp, ipKey, throttled } from '../lib/db.js';

/* Reading a recipe off a page a parent found.
   POST /api/recipe {url} -> {recipe:{title, m, y, ing[], steps[], src, url}}

   The app cannot fetch another site itself — its policy is connect-src 'self',
   and no recipe site would allow it anyway — so this is the one thing the server
   does on a page's behalf. What it returns is the recipe the page already
   publishes for search engines (schema.org JSON-LD, and the microdata fallback
   under it) and nothing else: not the page, not its headers, not a byte that did
   not parse as a recipe. That is the point. A function that handed back whatever
   it was pointed at would be an open proxy on our own domain; this one is no use
   for anything but recipes, and it refuses to look anywhere but the public web.  */

const MAX_BYTES = 1_500_000;          /* a recipe page that needs more than this is not publishing a recipe */
const MAX_HOPS = 3;
const TIMEOUT_MS = 8000;
const UA = 'LunchSortedBot/1.0 (+https://lunchsorted.app/help.html)';

/* ---- where this function may look.
   Only the public web over https. Everything private is refused by address,
   after the name is resolved, so a hostname that points at 127.0.0.1 or at a
   cloud metadata service is refused just as an IP literal would be. The name is
   resolved again at every redirect. (A name that resolves differently between
   this check and the connection would still slip through; closing that needs
   pinning the socket to the address, which the platform's fetch does not
   offer. The cap on what comes back is the second line of defence: nothing
   leaves here that did not parse as a recipe.) */
const BAD_HOST = /^(localhost|.*\.(local|internal|localdomain|home|lan))$/i;

function privateAddress(ip) {
  const v4 = ip.includes('.') ? ip.replace(/^::ffff:/i, '') : null;
  if (v4 && /^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)                       /* link-local, and every cloud's metadata service */
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)             /* carrier-grade NAT */
      || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

export async function publicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: 'That does not look like a web address' }; }
  if (u.protocol !== 'https:') return { error: 'The address has to start with https' };
  if (u.port && u.port !== '443') return { error: 'That address is not a recipe page' };
  const host = u.hostname;
  /* a real recipe lives at a real name: no bare addresses (in any of the shapes a
     number can be written), no bracketed IPv6, nothing that only resolves inside
     a network */
  if (BAD_HOST.test(host) || !host.includes('.') || host.startsWith('[')
      || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return { error: 'That address is not a recipe page' };
  let addrs;
  try { addrs = await dns.lookup(host, { all: true, verbatim: true }); }
  catch { return { error: 'We could not reach that page' }; }
  if (!addrs.length || addrs.some(a => privateAddress(a.address))) return { error: 'That address is not a recipe page' };
  return { url: u };
}

/* one hop, with the body capped as it arrives rather than after */
async function readPage(start) {
  let target = start, hops = 0;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    while (true) {
      const ok = await publicUrl(target);
      if (ok.error) return ok;
      const res = await fetch(ok.url.href, {
        method: 'GET', redirect: 'manual', signal: ctl.signal,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' }
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (++hops > MAX_HOPS) return { error: 'That page kept redirecting' };
        target = new URL(res.headers.get('location'), ok.url).href;
        continue;
      }
      if (!res.ok) return { error: res.status === 404 ? 'That page is not there' : 'That page would not open for us' };
      const type = res.headers.get('content-type') || '';
      if (type && !/text\/html|application\/xhtml/i.test(type)) return { error: 'That is not a recipe page' };
      const reader = res.body && res.body.getReader();
      if (!reader) return { error: 'That page would not open for us' };
      const parts = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); break; }
        parts.push(value);
      }
      return { html: Buffer.concat(parts).toString('utf8'), url: ok.url };
    }
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? 'That page took too long' : 'We could not reach that page' };
  } finally { clearTimeout(timer); }
}

/* ---- turning a page into a recipe */
const ENTS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#160': ' ',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', frac13: '\u2153', frac23: '\u2154', deg: '\u00b0',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };
function text(v) {
  return String(v == null ? '' : v)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (all, e) => {
      const k = e.toLowerCase();
      if (ENTS[k]) return ENTS[k];
      const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : /^#/.test(e) ? parseInt(e.slice(1), 10) : NaN;
      return Number.isFinite(n) && n > 31 && n < 0x10000 ? String.fromCharCode(n) : ' ';
    })
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)])/g, '$1')        /* a stripped tag leaves a gap the punctuation falls into */
    .trim();
}
const ISO = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/;
function minutes(v) {
  const m = ISO.exec(String(v || ''));
  if (!m) return 0;
  return (+(m[1] || 0) * 1440) + (+(m[2] || 0) * 60) + (+(m[3] || 0));
}
function yieldOf(v) {
  const s = Array.isArray(v) ? v.find(x => typeof x === 'string' || typeof x === 'number') : v;
  const n = parseInt(String(s == null ? '' : s).replace(/[^\d]/g, ' ').trim(), 10);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 0;
}
/* a string, a list of strings, HowToStep objects, or HowToSections holding them */
function steps(v, out = [], depth = 0) {
  if (depth > 3 || out.length > 60) return out;
  if (Array.isArray(v)) { v.forEach(x => steps(x, out, depth + 1)); return out; }
  if (v && typeof v === 'object') {
    if (v.itemListElement) return steps(v.itemListElement, out, depth + 1);
    if (v.steps) return steps(v.steps, out, depth + 1);
    const t = text(v.text || v.name || '');
    if (t) out.push(t);
    return out;
  }
  if (typeof v === 'string') {
    /* one long block: the list markup is the only thing that says where a step ends */
    String(v).split(/<\/(?:li|p|div)>|(?:\r?\n)+/i).map(text).filter(s => s.length > 2).forEach(s => out.push(s));
  }
  return out;
}
function isRecipe(node) {
  const t = node && node['@type'];
  return Array.isArray(t) ? t.some(x => String(x).toLowerCase() === 'recipe') : String(t || '').toLowerCase() === 'recipe';
}
function findRecipe(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) { for (const x of node) { const f = findRecipe(x, depth + 1); if (f) return f; } return null; }
  if (typeof node !== 'object') return null;
  if (isRecipe(node)) return node;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    if (node[k]) { const f = findRecipe(node[k], depth + 1); if (f) return f; }
  }
  return null;
}
function fromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')); } catch { continue; }
    const r = findRecipe(data);
    if (r) return r;
  }
  return null;
}
/* the pages that never adopted JSON-LD still tag the parts in the markup */
function fromMicrodata(html) {
  const grab = prop => [...html.matchAll(new RegExp(`itemprop=["']${prop}["'][^>]*>([\\s\\S]{0,2000}?)<\\/`, 'gi'))]
    .map(m => text(m[1])).filter(Boolean);
  const ing = grab('recipeIngredient').concat(grab('ingredients'));
  const ins = grab('recipeInstructions');
  if (!ing.length) return null;
  return { name: (grab('name')[0] || ''), recipeIngredient: ing, recipeInstructions: ins };
}
function titleOf(html) {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  return m ? text(m[1]).replace(/\s*[|–—-]\s*[^|–—-]{0,40}$/, '').trim() : '';
}

const clean = (list, max, n) => (Array.isArray(list) ? list : [list])
  .map(text).filter(Boolean).map(s => s.slice(0, max)).slice(0, n);

/* the whole of the reading, with no network in it, so the suite can hold a page
   up against it and see exactly what a parent would get back */
export function parseRecipeHtml(html, href) {
  const ld = fromJsonLd(html) || fromMicrodata(html);
  if (!ld) return null;
  const ing = clean(ld.recipeIngredient || ld.ingredients || [], 120, 40);
  const how = steps(ld.recipeInstructions).map(s => s.slice(0, 600)).slice(0, 30);
  if (!ing.length && !how.length) return null;
  const total = minutes(ld.totalTime) || (minutes(ld.prepTime) + minutes(ld.cookTime));
  let host = '', full = '';
  try { const u = new URL(href); host = u.hostname.replace(/^www\./, ''); full = u.href; } catch {}
  return {
    title: (text(ld.name) || titleOf(html)).slice(0, 80),
    m: total > 0 && total <= 1440 ? total : 0,
    y: yieldOf(ld.recipeYield),
    ing, steps: how,
    src: host.slice(0, 60), url: full.slice(0, 300)
  };
}

export default async (req, context) => {
  if (req.method !== 'POST') return fail('Not found', 404);
  try {
    /* a reader on our domain is worth abusing, so it is capped per address per hour;
       a deploy with no database still reads recipes, it just cannot count them */
    const key = 'recipe:' + ipKey(clientIp(req, context));
    try { if (key !== 'recipe:' && await throttled(key, 30, 3600)) return fail('That is a lot of recipes at once. Try again in a little while.', 429); }
    catch (e) { console.warn('api-recipe: throttle unavailable', e && e.message); }

    const body = await req.json().catch(() => ({}));
    const raw = typeof body.url === 'string' ? body.url.trim() : '';
    if (!raw || raw.length > 500) return fail('Paste the address of the recipe page', 400);

    const page = await readPage(raw);
    if (page.error) return fail(page.error, 422);

    const recipe = parseRecipeHtml(page.html, page.url.href);
    if (!recipe) return fail('We could not find a recipe on that page. Copy the recipe and paste it in instead.', 422);
    return json({ recipe });
  } catch (e) {
    console.error('api-recipe', e);
    return fail('Something went wrong on our side', 500);
  }
};

export const config = { path: '/api/recipe' };
