/* One transactional sender. Resend when a key is present; otherwise, outside
   production, the message is logged and (for sign-in) returned to the caller
   so a developer or the test suite can follow it. Production without a key is
   an error, never a silent no-op. The test suite captures every message
   through the global hook instead. */
import { siteEnv } from './db.js';

const FROM = () => process.env.MAIL_FROM || 'Lunch Sorted <hello@mail.lunchsorted.app>';
const REPLY_TO = 'hello@lunchsorted.app';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function send(msg) {
  if (globalThis.__LS_MAIL) { globalThis.__LS_MAIL.push(msg); return { captured: true }; }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (siteEnv() === 'production') throw new Error('RESEND_API_KEY is not set');
    console.log(`[mail] to ${msg.to}: ${msg.subject}\n${msg.text}`);
    return { logged: true };
  }
  /* a slow mail service must never hold a sign-in past the function's own limit */
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(4000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM(), to: [msg.to], reply_to: REPLY_TO, subject: msg.subject, text: msg.text, html: msg.html })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return {};
}

/* every message ends the same way: who it is from, how to reply, and for the
   reminders, how to stop them */
function foot(stopUrl) {
  const text = `\n\n— Lunch Sorted, from Lila Bloom Enterprises. Reply to this email and a person reads it.` + (stopUrl ? `\nStop these reminders: ${stopUrl}` : '');
  const html = `<p style="color:#6E7F75;font-size:13px;margin-top:28px">— Lunch Sorted, from Lila Bloom Enterprises. Reply to this email and a person reads it.` + (stopUrl ? ` <a href="${esc(stopUrl)}" style="color:#6E7F75">Stop these reminders</a>.` : '') + `</p>`;
  return { text, html };
}
const btn = (href, label) => `<p style="margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:#2E5A48;color:#FBFCF9;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:12px">${esc(label)}</a></p>`;

export async function sendMagicLink(to, link, code) {
  const r = await send({
    to,
    subject: 'Your Lunch Sorted sign-in link',
    text: `Tap to sign in to Lunch Sorted:\n\n${link}\n\nUsing the app from your home screen? Open it and type this code instead:\n\n${code}\n\nBoth work once and expire in 15 minutes. If you did not ask for this, ignore this email.` + foot().text,
    html: `<p>Tap to sign in to Lunch Sorted:</p>${btn(link, 'Sign in to Lunch Sorted')}<p>Using the app from your home screen? Open it and type this code instead:</p><p style="font:600 22px ui-monospace,monospace;letter-spacing:.08em">${esc(code)}</p><p style="color:#6E7F75;font-size:13px">Both work once and expire in 15 minutes. If you did not ask for this, ignore this email.</p>` + foot().html
  });
  return r.logged || r.captured ? { devLink: link, devCode: code } : {};
}

export function sendWelcome(to, site, stopUrl) {
  const app = `${site}/app/`;
  return send({
    to,
    subject: 'You’re in. Everything is on for three weeks.',
    text: `Welcome to Lunch Sorted.\n\nYou are signed in. While your household's first three weeks run, everything is on: every lunchbox, kid's pick, the morning review, a pantry that remembers, and the other parent's phone. No card, nothing to cancel.\n\nOpen the planner: ${app}\n\nWorth doing this week: add it to your phone's home screen (on iPhone: Share, then Add to Home Screen), and if you set the household up, invite the other parent from Setup so you both see the same week.\n\nAfter the three weeks, planning and the shopping list stay free for good. The rest is the Household plan, when you want it; the prices are in the app.` + foot(stopUrl).text,
    html: `<p>Welcome to Lunch Sorted.</p><p>You are signed in. While your household’s first three weeks run, everything is on: every lunchbox, kid’s pick, the morning review, a pantry that remembers, and the other parent’s phone. No card, nothing to cancel.</p>${btn(app, 'Open the planner')}<p>Worth doing this week: add it to your phone’s home screen (on iPhone: Share, then <b>Add to Home Screen</b>), and if you set the household up, invite the other parent from Setup so you both see the same week.</p><p>After the three weeks, planning and the shopping list stay free for good. The rest is the Household plan, when you want it; the prices are in the app.</p>` + foot(stopUrl).html
  });
}

/* the date as the parent reads it, in the household's own zone (the document carries the phone's);
   the function runs in UTC, and a household that never said falls back to the East Coast */
export const dateWords = (d, tz) => {
  for (const zone of [tz, 'America/New_York']) {
    if (!zone) continue;                                       /* a household that never said is read as the East Coast, not as the server's clock */
    try { return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: zone }); } catch { /* not a zone the runtime knows */ }
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

export function sendTrialEnding(to, site, end, stopUrl, tz) {
  const keep = `${site}/app/?upgrade=1`, when = dateWords(end, tz);
  return send({
    to,
    subject: `Your three weeks of everything end ${when}`,
    text: `Your three weeks of Lunch Sorted with everything on end on ${when}.\n\nThe lunches stay, and planning and the shopping list stay free for good. Kid's pick, the morning review and the pantry pause unless you keep the Household plan; the lunchboxes and phones you already have stay as they are, you just can't add more. $29 a year, $3.99 a month, or $79 once, forever.\n\nKeep everything: ${keep}\n\nNothing happens automatically. If you do nothing, the free planner carries on.` + foot(stopUrl).text,
    html: `<p>Your three weeks of Lunch Sorted with everything on end on <b>${esc(when)}</b>.</p><p>The lunches stay, and planning and the shopping list stay free for good. Kid’s pick, the morning review and the pantry pause unless you keep the Household plan; the lunchboxes and phones you already have stay as they are, you just can’t add more. $29 a year, $3.99 a month, or $79 once, forever.</p>${btn(keep, 'Keep everything')}<p style="color:#6E7F75;font-size:13px">Nothing happens automatically. If you do nothing, the free planner carries on.</p>` + foot(stopUrl).html
  });
}

export function sendTrialEnded(to, site, stopUrl) {
  const keep = `${site}/app/?upgrade=1`;
  return send({
    to,
    subject: 'Your three weeks are up. The lunches stay.',
    text: `Your three weeks of everything on Lunch Sorted are up.\n\nPlanning the week and the shopping list are still free, and everything you added is still there. Kid's pick, the morning review and the pantry are waiting under the Household plan, along with adding lunchboxes and phones: $29 a year, $3.99 a month, or $79 once, forever.\n\nSwitch it back on: ${keep}\n\nThis is the last email about it.` + foot(stopUrl).text,
    html: `<p>Your three weeks of everything on Lunch Sorted are up.</p><p>Planning the week and the shopping list are still free, and everything you added is still there. Kid’s pick, the morning review and the pantry are waiting under the Household plan, along with adding lunchboxes and phones: $29 a year, $3.99 a month, or $79 once, forever.</p>${btn(keep, 'Switch it back on')}<p style="color:#6E7F75;font-size:13px">This is the last email about it.</p>` + foot(stopUrl).html
  });
}
