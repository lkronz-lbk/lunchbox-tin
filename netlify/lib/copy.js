/* Site copy: the words on the marketing pages, without the layout.

   Every editable string in public/*.html carries a data-copy name:

     <h1 data-copy="home.hero.title" data-copy-label="The headline"
         data-copy-note="What a parent reads first ...">Lunch, sorted.</h1>

   The label is what the editing screen calls it, in a parent's words; the note
   is the sentence under it. Neither may contain a straight double quote.

   The committed HTML holds the original wording, so the site reads correctly
   with an empty database and a reset is always possible. An edit made at
   /admin/copy is a row in site_copy, and scripts/copy.mjs folds those rows into
   the pages at build time — the published site stays plain static HTML with no
   script, no fetch and no function in front of it. */

/* The home page only. The planner at /app/ is not copy, it is the product, and
   privacy.html and terms.html are statements about what the code actually does,
   so they change when the code does — not from an editing screen. */
export const PAGES = ['index.html'];

/* a slot whose element carries no children of its own (a meta tag) is edited
   through its content attribute instead of its innards */
const VOID = new Set(['meta', 'img', 'input', 'br', 'link']);

const OPEN = /<([a-zA-Z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\bdata-copy="([^"]+)"((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/* The tag's other attributes, each with where its value sits in the page. Walked
   attribute by attribute rather than searched: a note that mentions content="
   must not be mistaken for the content attribute itself. */
function attrsOf(m) {
  const out = Object.create(null);
  const beforeAt = m.index + 1 + m[1].length;
  const afterAt = beforeAt + m[2].length + ('data-copy="' + m[3] + '"').length;
  for (const [text, base] of [[m[2], beforeAt], [m[4], afterAt]]) {
    const re = /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g;
    for (let a; (a = re.exec(text));) {
      const name = a[1].toLowerCase();
      if (out[name]) continue;                        /* the first one wins, as it does in a browser */
      out[name] = { value: a[2], start: base + a.index + a[0].length - a[2].length - 1 };
    }
  }
  return out;
}
const attr = (attrs, name) => (attrs[name] ? attrs[name].value : '');

/* Where each editable string lives in one page's HTML: the name, what it is
   for, the original wording, and the exact span to replace. */
export function slots(html) {
  const out = [];
  OPEN.lastIndex = 0;
  for (let m; (m = OPEN.exec(html));) {
    const tag = m[1].toLowerCase(), attrs = attrsOf(m), key = m[3];
    const note = attr(attrs, 'data-copy-note'), label = attr(attrs, 'data-copy-label');
    /* an unbalanced quote inside a label or note would end the tag early and
       quietly swallow the rest of it, so it is caught here rather than shipped */
    if ((m[0].match(/"/g) || []).length % 2) throw new Error(`a straight quote inside an attribute of ${key}`);
    if (VOID.has(tag)) {
      /* the content attribute of a meta tag: the span is the value inside its quotes */
      if (!attrs.content) throw new Error(`data-copy on <${tag}> without a content attribute: ${key}`);
      const start = attrs.content.start;
      const end = start + attrs.content.value.length;
      out.push({ key, note, label, tag, plain: true, start, end, original: html.slice(start, end) });
      continue;
    }
    const openEnd = m.index + m[0].length;
    const end = closeOf(html, tag, openEnd);
    if (end < 0) throw new Error(`data-copy element <${tag}> is never closed: ${key}`);
    out.push({ key, note, label, tag, plain: tag === 'title', start: openEnd, end, original: html.slice(openEnd, end) });
  }
  const seen = new Set();
  for (const s of out) {
    if (!/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/.test(s.key)) throw new Error(`data-copy name is not in the form page.section.thing: ${s.key}`);
    if (seen.has(s.key)) throw new Error(`two elements share the data-copy name ${s.key}`);
    seen.add(s.key);
  }
  return out;
}

/* the index of the '<' that closes this element, counting nested ones of the same name */
function closeOf(html, tag, from) {
  const open = new RegExp('<' + tag + '\\b', 'gi'), close = new RegExp('</' + tag + '\\s*>', 'gi');
  let depth = 1, i = from;
  for (;;) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) return -1;
    if (o && o.index < c.index) { depth++; i = o.index + o[0].length; continue; }
    if (--depth === 0) return c.index;
    i = c.index + c[0].length;
  }
}

/* Everything editable on a page, in reading order, for the editor to draw.
   Punctuation written as an entity in the HTML is shown as the character it
   stands for: nobody should have to type &mdash; into a box. */
export function fields(html, page) {
  return slots(html).map(s => {
    if (!s.label) throw new Error(`no data-copy-label on ${s.key}; the editing screen needs a name a parent would use`);
    /* which inline tags the committed wording already uses, so the editor can
       name them rather than talk about markup in general */
    const tags = [...new Set([...s.original.matchAll(/<([a-z][\w-]*)/gi)].map(t => t[1].toLowerCase()))];
    return { key: s.key, label: s.label, note: s.note, page, plain: s.plain, tags, original: readable(s.original) };
  });
}

/* &nbsp; is deliberately not here: it looks like a space in a box, and decoding
   it would quietly lose a non-breaking space on the first edit of that string */
const ENTITIES = { amp: '&', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', '#8217': '\u2019', '#8216': '\u2018', '#8212': '\u2014' };
export const readable = (s) => String(s).trim().replace(/\s*\n\s*/g, ' ').replace(/&([a-z]+|#\d+);/gi, (m, name) => ENTITIES[name.toLowerCase()] != null ? ENTITIES[name.toLowerCase()] : m);

/* Put the edited words back into the page. Values are written by an admin, but
   they are still cleaned to plain text plus a short list of inline tags, so a
   pasted <script> or an onclick can never reach the published HTML. (The site's
   Content-Security-Policy is script-src 'none' as well; this is the first of
   the two locks, not the only one.) */
export function applyCopy(html, overrides) {
  const list = slots(html).filter(s => typeof overrides[s.key] === 'string');
  /* back to front, so an earlier replacement cannot shift a later span */
  for (const s of list.reverse()) {
    /* a link typed inside something that is already a link is nonsense a browser
       resolves unpredictably, so the three button slots take no links at all */
    const value = s.plain ? escapeText(overrides[s.key]) : sanitizeInline(overrides[s.key], { links: s.tag !== 'a' });
    html = html.slice(0, s.start) + value + html.slice(s.end);
  }
  return html;
}

/* The names are for the build and the editor; a visitor never needs to carry
   them, so they are taken out of the published page. */
export const stripMarks = (html) => html.replace(/\s+data-copy(?:-note|-label)?="[^"]*"/g, '');

/* &mdash; and friends are kept; a bare & is not an entity and is escaped */
const escapeAmp = (s) => s.replace(/&(?!#\d+;|#x[0-9a-f]+;|[a-z][a-z0-9]{1,31};)/gi, '&amp;');
export const escapeText = (s) => escapeAmp(String(s)).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const INLINE = { b: 1, i: 1, em: 1, strong: 1, small: 1, br: 1, a: 1 };

/* Text, plus a short list of inline tags, and nothing else. Anything not on the
   list arrives as visible text rather than markup; every allowed tag is written
   out again from scratch, so no attribute survives except a link's own href.
   Tags are balanced as well as cleaned: a stray </b> is dropped and an unclosed
   <b> is closed at the end, because an edit to the wording must never be able to
   bold the rest of the page or close a button early. */
export function sanitizeInline(text, { links = true } = {}) {
  let out = '';
  const src = String(text), open = [];
  const re = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let at = 0;
  for (let m; (m = re.exec(src));) {
    out += escapeText(src.slice(at, m.index));
    at = m.index + m[0].length;
    const tag = m[1].toLowerCase(), closing = m[0][1] === '/';
    /* inside something that is already a link, a link is dropped and its words
       kept; a stray </a> on a button would otherwise show up as text */
    if (tag === 'a' && !links) continue;
    if (!INLINE[tag]) { out += escapeText(m[0]); continue; }
    if (tag === 'br') { out += '<br>'; continue; }
    if (closing) {
      const i = open.lastIndexOf(tag);
      if (i < 0) continue;                              /* a close with nothing open: dropped */
      while (open.length > i) out += `</${open.pop()}>`; /* and anything left open inside it, closed */
      continue;
    }
    if (tag === 'a') {
      if (open.includes('a')) continue;                 /* no link inside a link */
      const href = attr(attrsOfText(m[2]), 'href');
      /* our own pages and plain https links only: no javascript:, no data:, no //host */
      out += /^(https:\/\/[^"\s]+|\/(?!\/)[^"\s]*|#[\w-]+)$/.test(href) ? `<a href="${escapeText(href)}">` : '<a>';
      open.push('a');
      continue;
    }
    out += `<${tag}>`;
    open.push(tag);
  }
  out += escapeText(src.slice(at));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/* the attributes of a tag written by an admin, with no page offsets to keep */
function attrsOfText(text) {
  const out = Object.create(null);
  const re = /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g;
  for (let a; (a = re.exec(text));) if (!out[a[1].toLowerCase()]) out[a[1].toLowerCase()] = { value: a[2] };
  return out;
}

/* what a saved value may not be: empty, or long enough to be a paste accident */
export const MAX_COPY = 1200;
export function checkValue(v) {
  const s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  /* markup with no words in it would leave a blank headline or a blank price */
  if (!s || !s.replace(/<[^>]*>/g, '').trim()) return { error: 'This needs some words in it. To go back to the wording it started with, tick the box under it.' };
  if (s.length > MAX_COPY) return { error: `This is ${s.length} characters; the limit is ${MAX_COPY}.` };
  return { value: s.replace(/\s*\n\s*/g, ' ') };
}
