/* The look of every email, and the one renderer that draws an email from its copy.

   Built from the app's own design tokens (HANDBOOK.md, The brand): the page ground, one card, the
   icon and the name at the top, the body, then the same closing line on every message. Tables, not
   flex, because that is what mail clients lay out; every color is written inline and again as a
   class, so the inline copy carries clients that drop the stylesheet and the class carries the dark
   set to Apple Mail, which honors prefers-color-scheme. Gmail loads no web font, so each stack ends
   in the system sans.

   This file imports nothing, on purpose: docs/email-program/build.mjs inlines it into the mock-up
   page so the browser draws an email exactly as the server would. The copy itself lives in
   docs/email-program/copy.json; mail.js reads the same shapes when it sends. */

export const C = {
  light: { ground: '#E9EEE6', surface: '#FBFCF9', ink: '#16241E', ink2: '#3E4D45', line: '#CFDACB', accent: '#2A5141', soft: '#DCE8DF', onAccent: '#FBFCF9' },
  dark:  { ground: '#0E1815', surface: '#17251F', ink: '#E6EEE7', ink2: '#AFC1B6', line: '#2B3E36', accent: '#81CBA8', soft: '#1F332A', onAccent: '#0E1815' }
};
const L = C.light, D = C.dark;
export const F = {
  head: "'Familjen Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif",
  body: "Karla,'Helvetica Neue',Helvetica,Arial,sans-serif",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace"
};
export const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@700&family=Karla:wght@400;700&family=IBM+Plex+Mono:wght@600&display=swap';
export const CLOSING = '— Lunch Sorted, from Lila Bloom Enterprises. Reply to this email and a person reads it.';

export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* the little the copy may mark up: **bold** and [a link](https://…). Everything else is text */
export const md = (s) => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" class="link" style="color:${L.accent};font-weight:700">${t}</a>`);
export const plainMd = (s) => String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');

/* the pieces a body is made of; each writes its colors inline and names the class the dark set hangs on */
export const p = (html) => `<p class="ink" style="margin:0 0 16px;font:400 17px/1.5 ${F.body};color:${L.ink}">${html}</p>`;
export const line = (html) => `<p class="ink" style="margin:0 0 10px;font:400 17px/1.5 ${F.body};color:${L.ink}">${html}</p>`;
export const h1 = (text) => `<h1 class="ink" style="margin:0 0 16px;font:700 26px/1.2 ${F.head};color:${L.ink};letter-spacing:-.01em">${esc(text)}</h1>`;
export const small = (html) => `<p class="ink2" style="margin:0 0 12px;font:400 15px/1.5 ${F.body};color:${L.ink2}">${html}</p>`;
export const sig = () => `<p class="ink" style="margin:20px 0 0;font:400 17px/1.5 ${F.body};color:${L.ink}">Liz</p>`;
export const btn = (href, label) => `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px"><tr><td class="btn" style="background:${L.accent};border-radius:12px"><a href="${esc(href)}" class="btn" style="display:inline-block;padding:14px 24px;font:700 17px/1.2 ${F.body};color:${L.onAccent};text-decoration:none;border-radius:12px;background:${L.accent}">${esc(label)}</a></td></tr></table>`;
export const codeBox = (c) => `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px"><tr><td class="code" style="background:${L.soft};border-radius:12px;padding:14px 22px;font:600 26px/1.2 ${F.mono};color:${L.ink};letter-spacing:.12em">${esc(c)}</td></tr></table>`;
export const steps = (arr) => `<ol style="margin:0 0 20px;padding-left:24px">${arr.map(x => `<li class="ink" style="margin:0 0 10px;font:400 17px/1.5 ${F.body};color:${L.ink}">${x}</li>`).join('')}</ol>`;
export const bullets = (arr) => `<ul style="margin:0 0 16px;padding-left:24px">${arr.map(x => `<li class="ink" style="margin:0 0 6px;font:400 17px/1.5 ${F.body};color:${L.ink}">${x}</li>`).join('')}</ul>`;
export const link = (href, label) => `<a href="${esc(href)}" class="link" style="color:${L.accent};font-weight:700">${esc(label)}</a>`;
export const pic = (src, alt) => `<img src="${esc(src)}" width="300" alt="${esc(alt)}" class="shot" style="display:block;width:300px;max-width:100%;height:auto;border:1px solid ${L.line};border-radius:12px;margin:4px 0 24px">`;
/* a crop that is not cut yet: the whole screen seen through a 300 by 400 window, marked as a stand-in.
   A sent email never uses this; scripts/mail-shots.mjs cuts the real file first */
export const crop = (src, alt, top) => `<div class="shot" style="width:300px;max-width:100%;height:400px;overflow:hidden;border:1px solid ${L.line};border-radius:12px;margin:4px 0 6px"><img src="${esc(src)}" width="300" alt="${esc(alt)}" style="display:block;width:300px;max-width:100%;height:auto;margin-top:-${Number(top) || 0}px"></div>` + small('Stand-in crop; the real one is cut from the app by scripts/mail-shots.mjs.');

/* the shell: a preheader the inbox shows beside the subject, the card, the closing line, and for
   the reminders the stop link. `site` is where the icon is served from */
export function shell({ site, subject, preheader = '', body, stopUrl }) {
  const foot = esc(CLOSING) + (stopUrl ? ` ${link(stopUrl, 'Stop these reminders')}.` : '');
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<link href="${FONTS_URL}" rel="stylesheet">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  @media (max-width: 600px) {
    .card { border-radius: 0 !important; }
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
    .gutter { padding: 0 !important; }
    .btn a { display: block !important; text-align: center !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .ground { background: ${D.ground} !important; }
    .card { background: ${D.surface} !important; }
    .ink { color: ${D.ink} !important; }
    .ink2 { color: ${D.ink2} !important; }
    .rule, .shot { border-color: ${D.line} !important; }
    .btn { background: ${D.accent} !important; color: ${D.onAccent} !important; }
    .code { background: ${D.soft} !important; color: ${D.ink} !important; }
    .link { color: ${D.accent} !important; }
  }
</style>
</head>
<body class="ground" style="margin:0;padding:0;background:${L.ground}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="ground" style="background:${L.ground}">
<tr><td align="center" class="gutter" style="padding:28px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="card" style="max-width:560px;background:${L.surface};border-radius:20px">
    <tr><td class="pad" style="padding:28px 32px 4px">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
        <td style="padding-right:12px;vertical-align:middle"><img src="${esc(site)}/icons/icon-192.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:10px"></td>
        <td class="ink" style="vertical-align:middle;font:700 20px/1 ${F.head};color:${L.ink}">Lunch Sorted</td>
      </tr></table>
    </td></tr>
    <tr><td class="pad" style="padding:24px 32px 12px">
${body}
    </td></tr>
    <tr><td class="pad rule" style="padding:20px 32px 28px;border-top:1px solid ${L.line}">
      <p class="ink2" style="margin:0;font:400 14px/1.5 ${F.body};color:${L.ink2}">${foot}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
export const footText = (stopUrl) => `\n\n${CLOSING}` + (stopUrl ? `\nStop these reminders: ${stopUrl}` : '');

/* One email from its copy (the shape of docs/email-program/copy.json), as HTML and as text.
   e: { subject, preheader, headline, lines[], fine[], code, visual {key, alt, crop}, button {label, href},
        buttonFirst, signed, lifecycle }
   o: { site, img(key) -> URL, stopUrl }. Button hrefs that start with / are rooted at site */
export function renderEmail(e, o) {
  const site = o.site, href = e.button && (e.button.href.startsWith('/') ? site + e.button.href : e.button.href);
  const button = e.button ? btn(href, e.button.label) : '';
  const visual = e.visual ? (e.visual.crop != null ? crop(o.img(e.visual.key), e.visual.alt, e.visual.crop) : pic(o.img(e.visual.key), e.visual.alt)) : '';
  const body = h1(e.headline)
    + (e.buttonFirst ? button : '')
    + visual
    + (e.lines || []).map(x => line(md(x))).join('')
    + (e.lines && e.lines.length ? '<div style="height:8px"></div>' : '')
    + (e.code ? codeBox(e.code) : '')
    + (e.fine || []).map(x => small(md(x))).join('')
    + (e.buttonFirst ? '' : button)
    + (e.signed ? sig() : '');
  const stopUrl = e.lifecycle ? o.stopUrl : undefined;
  const text = [e.headline, '', ...(e.lines || []).map(plainMd), ...(e.code ? ['', e.code] : []), ...(e.fine && e.fine.length ? ['', ...e.fine.map(plainMd)] : []),
    ...(e.button ? ['', `${e.button.label}: ${href}`] : []), ...(e.signed ? ['', 'Liz'] : [])].join('\n') + footText(stopUrl);
  return { subject: e.subject, preheader: e.preheader, html: shell({ site, subject: e.subject, preheader: e.preheader, body, stopUrl }), text };
}
