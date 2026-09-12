import dns from 'node:dns/promises';
import net from 'node:net';
import { json, fail, throttled } from '../lib/db.js';
import { currentUser } from '../lib/auth.js';

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
/* Every way a page can fail to give us a recipe answers with the same sentence.
   Told apart, the failures are a map of someone else's network: this name resolves
   and resolves inside, that one does not exist, that one is behind a firewall that
   drops rather than refuses. A parent cannot act on the difference; a scanner can. */
const NO_RECIPE = 'We could not read a recipe from that page. Copy the recipe and paste it in instead.';

/* An address as its bytes, so a range test is a range test. Matching the front of
   the string misses every address that is a private one wearing a hat: ::127.0.0.1,
   the NAT64 and 6to4 encodings of it, and IPv6 multicast. */
function addrBytes(ip) {
  if (net.isIPv4(ip)) return ip.split('.').map(Number);
  if (!net.isIPv6(ip)) return null;
  let s = ip.toLowerCase().replace(/%.*$/, '');
  let v4 = [];
  const m = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
  if (m) { v4 = m[1].split('.').map(Number); s = s.slice(0, m.index + 1) + '0:0'; }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const tail = parts.length === 2 ? (parts[1] ? parts[1].split(':').filter(Boolean) : []) : null;
  const groups = tail === null ? head
    : head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill('0')).concat(tail);
  if (groups.length !== 8) return null;
  const out = [];
  for (const g of groups) { const n = parseInt(g, 16); if (!Number.isFinite(n)) return null; out.push((n >> 8) & 255, n & 255); }
  if (v4.length === 4) { out[12] = v4[0]; out[13] = v4[1]; out[14] = v4[2]; out[15] = v4[3]; }
  return out;
}
function privateV4(b) {
  const [a, c, d] = b;
  return a === 0 || a === 10 || a === 127 || a >= 224            /* this network, private, loopback, multicast and above */
    || (a === 169 && c === 254)                                  /* link-local, and every cloud's metadata service */
    || (a === 172 && c >= 16 && c <= 31)
    || (a === 192 && c === 168)
    || (a === 192 && c === 0 && (d === 0 || d === 2))             /* IETF protocol assignments, TEST-NET-1 */
    || (a === 198 && c === 51 && d === 100)                       /* TEST-NET-2 */
    || (a === 203 && c === 0 && d === 113)                        /* TEST-NET-3 */
    || (a === 100 && c >= 64 && c <= 127)                         /* carrier-grade NAT */
    || (a === 198 && (c === 18 || c === 19));                     /* benchmarking */
}
export function privateAddress(ip) {
  const b = addrBytes(ip);
  if (!b) return true;                                           /* unreadable is unreachable: we do not open what we cannot check */
  if (b.length === 4) return privateV4(b);
  const lead = b.slice(0, 10).every(x => x === 0);
  if (lead && b[10] === 0xff && b[11] === 0xff) return privateV4(b.slice(12));   /* ::ffff:a.b.c.d */
  if (lead) return true;                                         /* ::/96 — ::, ::1 and ::a.b.c.d */
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true; /* 64:ff9b::/96, NAT64 */
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(b.slice(2, 6));            /* 2002::/16, 6to4 */
  if (b[0] === 0xff) return true;                                /* multicast */
  if ((b[0] & 0xfe) === 0xfc) return true;                       /* fc00::/7, unique local */
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;      /* fe80::/10, link-local */
  return false;
}

export async function publicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: 'That does not look like a web address' }; }
  if (u.protocol !== 'https:') return { error: 'The address has to start with https' };
  if (u.port && u.port !== '443') return { error: NO_RECIPE };
  /* a token someone pasted by accident is not stored, not synced, and not shown to a caretaker */
  u.username = ''; u.password = ''; u.hash = '';
  const host = u.hostname;
  /* a real recipe lives at a real name: no bare addresses (in any of the shapes a
     number can be written), no bracketed IPv6, nothing that only resolves inside
     a network */
  if (BAD_HOST.test(host) || !host.includes('.') || host.startsWith('[')
      || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return { error: NO_RECIPE };
  let addrs;
  try { addrs = await dns.lookup(host, { all: true, verbatim: true }); }
  catch { return { error: NO_RECIPE }; }
  if (!addrs.length || addrs.some(a => privateAddress(a.address))) return { error: NO_RECIPE };
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
        if (++hops > MAX_HOPS) return { error: NO_RECIPE };
        target = new URL(res.headers.get('location'), ok.url).href;
        continue;
      }
      if (!res.ok) return { error: NO_RECIPE };
      /* a response with no type at all is not taken on trust: a recipe page says it is HTML */
      const type = res.headers.get('content-type') || '';
      if (!/^\s*(?:text\/html|application\/xhtml\+xml)\s*(?:;|$)/i.test(type)) return { error: NO_RECIPE };
      const reader = res.body && res.body.getReader();
      if (!reader) return { error: NO_RECIPE };
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
    console.warn('api-recipe: fetch failed', e && e.name, e && e.message);   /* the detail stays in the log, where it is ours */
    return { error: NO_RECIPE };
  } finally { clearTimeout(timer); }
}

/* ---- turning a page into a recipe */
const ENTS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#160': ' ',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', frac13: '\u2153', frac23: '\u2154', deg: '\u00b0',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };
/* Capped at the head. Both tag-stripping passes scan to the end of the buffer from
   every unmatched "<", so a field carrying a megabyte of them costs a minute of CPU
   on an endpoint someone else points at us. Every caller truncates to 600 characters
   or fewer anyway, so nothing a recipe needs is lost here.
   Note that this DECODES entities after stripping tags, so markup that arrived
   escaped comes back out as literal markup. Every consumer escapes it on the way to
   the screen; nothing here may be treated as safe HTML. */
const TEXT_MAX = 4000;
function text(v) {
  return String(v == null ? '' : v).slice(0, TEXT_MAX)
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
    String(v).slice(0, 200000).split(/<\/(?:li|p|div)>|(?:\r?\n)+/i)
      .slice(0, 200).map(text).filter(s => s.length > 2).forEach(s => { if (out.length < 60) out.push(s); });
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
/* The opening tag is matched, then the close is found by scanning forward. A single
   pattern spanning both would backtrack from every unclosed opening to the end of the
   buffer, so a page carrying thousands of them — well inside the size cap — would cost
   seconds of CPU per request on an endpoint anyone can call. */
const OPEN_LD = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>/gi;
function fromJsonLd(html) {
  OPEN_LD.lastIndex = 0;
  let m, seen = 0;
  while (seen++ < 20 && (m = OPEN_LD.exec(html))) {
    const end = html.indexOf('</script>', OPEN_LD.lastIndex);
    if (end < 0) break;
    const body = html.slice(OPEN_LD.lastIndex, end);
    OPEN_LD.lastIndex = end + 9;
    let data;
    try { data = JSON.parse(body.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')); } catch { continue; }
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

export default async (req) => {
  if (req.method !== 'POST') return fail('Not found', 404);
  try {
    /* Signed in, and nothing else. This is the one thing on the site that fetches an
       address a caller chose, so it is not left open to the internet: a session means
       someone proved control of an email address, it gives the throttle an account to
       count rather than an address anyone can rotate, and it keeps the promise the
       privacy page makes — that until you sign in, nothing you type leaves the phone.
       Pasting a recipe in needs none of this and never leaves the phone at all. */
    const user = await currentUser(req);
    if (!user) return fail('Sign in to read a recipe off a page, or paste the recipe in instead', 401);

    /* the body is capped before it is parsed, not after */
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 2000) return fail('Paste the address of the recipe page', 400);
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return fail('Paste the address of the recipe page', 400); }
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url || url.length > 500) return fail('Paste the address of the recipe page', 400);

    /* a reader that fetches is worth abusing, so it is counted per account per hour.
       If the store cannot be reached the answer is no: reading a page is a convenience,
       and a database hiccup must not be the moment the only limit disappears. */
    try {
      if (await throttled(`recipe:${user.id}`, 30, 3600))
        return fail('That is a lot of recipes at once. Try again in a little while.', 429);
    } catch (e) {
      console.error('api-recipe: throttle unavailable', e && e.message);
      return fail('We cannot read recipes just now. Paste the recipe in instead.', 503);
    }

    const page = await readPage(url);
    if (page.error) return fail(page.error, 422);

    const recipe = parseRecipeHtml(page.html, page.url.href);
    if (!recipe) return fail(NO_RECIPE, 422);
    return json({ recipe });
  } catch (e) {
    console.error('api-recipe', e);
    return fail('Something went wrong on our side', 500);
  }
};

export const config = { path: '/api/recipe' };
