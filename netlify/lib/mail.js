/* One transactional sender. Resend when a key is present; otherwise, outside
   production, the message is logged and (for sign-in) returned to the caller
   so a developer or the test suite can follow it. Production without a key is
   an error, never a silent no-op. The test suite captures every message
   through the global hook instead. */
import { siteEnv } from './db.js';
import { esc, p, h1, small, sig, btn, codeBox, steps, bullets, link, pic, shell, footText } from './mail-parts.js';
export * from './mail-parts.js';

const FROM = () => process.env.MAIL_FROM || 'Lunch Sorted <hello@mail.lunchsorted.app>';
const REPLY_TO = 'hello@lunchsorted.app';

/* the key alone, as Resend gives it: re_, then letters, digits and underscores. The build
   (scripts/migrate.mjs) refuses the deploy over anything more, a line break pasted with it above all,
   in words that name the variable and never what it holds, and the last good deploy stays live.
   Production's build must also see a key: a deploy without one could send no sign-in link. It cannot
   tell a key that is absent from one scoped to Functions alone, which would still send, so it names
   both. Netlify's own CONTEXT marks a production build, whatever SITE_ENV says: a local run of the
   script, a preview and a branch deploy are not held to it */
export function resendKey() {
  const key = process.env.RESEND_API_KEY || '';
  if (!key && process.env.CONTEXT === 'production') throw new Error('RESEND_API_KEY is absent from this production build, or not scoped to Builds (the build cannot tell which); a deploy without it could send no sign-in link, so set it in Production with the Builds scope as well as Functions');
  if (key && !/^re_[A-Za-z0-9_]+$/.test(key)) throw new Error('RESEND_API_KEY must be re_, then letters, digits and underscores only; look for a space or a line break pasted with it');
  return key;
}

/* Resend's own words about a refusal are kept for the log, but cut short, with every secret the send
   holds blanked out by value, wherever it sits and however an answer might have escaped what is
   around it: the key, each run of four or more characters of it between spaces, and the sign-in
   link's token and code the caller passes. So is anything else shaped like a key, or like a link's
   token (a reminder's stop link). Its error answers never quote any of them; this makes sure of it */
const scrub = (s, secrets) => {
  let out = String(s);
  for (const secret of secrets) for (const piece of [secret, ...secret.split(/\s+/)]) if (piece.length >= 4) out = out.split(piece).join('…');
  return out.replace(/re_[A-Za-z0-9_]+/g, 're_…').replace(/\bt=[^&\s"'<>\\]+/g, 't=…').slice(0, 300);
};

export async function send(msg, secrets = []) {
  if (globalThis.__LS_MAIL) { globalThis.__LS_MAIL.push(msg); return { captured: true }; }
  const raw = process.env.RESEND_API_KEY || '';
  if (!raw) {
    if (siteEnv() === 'production') throw new Error('RESEND_API_KEY is not set');
    console.log(`[mail] to ${msg.to}: ${msg.subject}\n${msg.text}`);
    return { logged: true };
  }
  /* gentler than the build: here a refusal would stop every sign-in link, and a variable scoped to
     Functions alone never met the build. So whitespace around the key is dropped, and only a key that
     could never work is refused, before fetch sees it and in words of our own: nothing left, or a
     character still in it that fetch will not put in a header, which is a line break, any other
     control character but tab, or one beyond Latin-1. fetch refuses a line break in words that quote
     the header whole, and the rest without saying why, so the log would read as if no answer came.
     Anything else goes to Resend, which refuses what is not a key in its own words */
  const key = raw.trim();
  if (!key) throw new Error('RESEND_API_KEY holds only spaces or line breaks, so nothing was sent; paste the key alone');
  if (/[^\t\x20-\x7e\x80-\xff]/.test(key)) throw new Error('RESEND_API_KEY has a line break or a character no request can carry in it, so nothing was sent; paste the key alone');
  /* a slow mail service must never hold a sign-in past the function's own limit */
  const init = {
    method: 'POST', signal: AbortSignal.timeout(4000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM(), to: [msg.to], reply_to: REPLY_TO, subject: msg.subject, text: msg.text, html: msg.html })
  };
  const doFetch = globalThis.__LS_RESEND_FETCH || fetch;
  /* no answer (the network failed, fetch refused the request, or the four seconds ran out), or an
     error answer that could not be read, is told in fixed words of our own. fetch's own error can
     quote a header it refused to send, and one of these headers is the key, so its message, its stack
     and the error itself (as a cause) stay here */
  let res, text;
  try { res = await doFetch('https://api.resend.com/emails', init); if (!res.ok) text = await res.text(); }
  catch { throw new Error(`${res ? 'Resend answered with an error, but the answer could not be read' : 'No answer from Resend'} (fetch's own error is left out, as it can quote the key)`); }
  if (!res.ok) throw new Error(`Resend ${res.status}: ${scrub(text, [key, ...secrets.filter(Boolean).map(String)])}`);
  return {};
}

/* ---------------------------------------------------------------- the emails

   Each says one thing, in the register HANDBOOK.md sets for email: "we" where the product
   speaks, "I" and a signature where Liz does, never both in one message. */

export async function sendMagicLink(to, link, code) {
  const site = new URL(link).origin, subject = 'Your sign-in link for Lunch Sorted';
  const r = await send({
    to, subject,
    text: `Here is your sign-in link for Lunch Sorted:\n\n${link}\n\nIf you opened Lunch Sorted from your home screen, the link may land in Safari instead. Type this code into the app and it signs you in there:\n\n${code}\n\nThe link and the code each work once, for the next 15 minutes. If you didn't ask for this, ignore it; nothing changes on your account.` + footText(),
    html: shell({ site, subject, preheader: 'It works once, for the next 15 minutes.',
      body: h1('Here is your sign-in link.') + btn(link, 'Sign in to Lunch Sorted')
        + p('If you opened Lunch Sorted from your home screen, the link may land in Safari instead. Type this code into the app and it signs you in there:')
        + codeBox(code)
        + small('The link and the code each work once, for the next 15 minutes. If you didn’t ask for this, ignore it; nothing changes on your account.') })
  }, [(String(link).match(/[?&]t=([^&#]+)/) || [])[1], code]);   /* the two secrets in it, blanked should Resend ever quote them back */
  return r.logged || r.captured ? { devLink: link, devCode: code } : {};
}

/* the beta testers' private Facebook group: the quick stuff, screenshots, questions, what the kid did */
export const BETA_GROUP = 'https://fb.me/g/7QlD2hwuL/xxqnw6dQ';
export function sendWelcome(to, site, stopUrl, beta) {
  const app = `${site}/app/`;
  if (beta) {
    const subject = 'Welcome to the beta: Lunch Sorted is yours, free forever';
    return send({
      to, subject,
      text: `Hi,\n\nThank you for testing Lunch Sorted. You're signed in, and your household has the whole planner, free, for good. Not just for the beta. No card, ever.\n\nOpen the planner: ${app}\n\nOver your first week I'll send three short emails, each about one part of the app and what to try with it. Reply to any of them; I read every one.\n\nThe other testers and I are in a private Facebook group for the quick stuff: a screenshot, a question, what your kid did with it. Join us there:\n${BETA_GROUP}\n\nLiz` + footText(stopUrl),
      html: shell({ site, subject, stopUrl, preheader: 'The whole planner, for good. No card, ever.',
        body: h1('Thank you for testing Lunch Sorted.')
          + p('You’re signed in, and your household has the whole planner, free, for good. Not just for the beta. No card, ever.')
          + btn(app, 'Open the planner')
          + p('Over your first week I’ll send three short emails, each about one part of the app and what to try with it. Reply to any of them; I read every one.')
          + p(`The other testers and I are in a ${link(BETA_GROUP, 'private Facebook group')} for the quick stuff: a screenshot, a question, what your kid did with it.`)
          + sig() })
    });
  }
  const subject = 'Welcome to Lunch Sorted';
  return send({
    to, subject,
    text: `Hi,\n\nYou're signed in, and your household's first three weeks start now. Everything in the planner is on, including the parts that belong to the Household plan later. There's no card on file and nothing to cancel.\n\nOpen the planner: ${app}\n\nIf someone else packs some mornings, invite them from Account so you're both looking at the same week. And if you'd like the planner to open like an app, add it to your home screen: in Safari, tap Share, then Add to Home Screen.\n\nWhen the three weeks are up, planning the week, the shopping list and the idea bank stay free for good, and everything you've made stays where it is. We'll send one email a few days before.` + footText(stopUrl),
    html: shell({ site, subject, stopUrl, preheader: 'Your first three weeks start now. No card, nothing to cancel.',
      body: h1('You’re signed in.')
        + p('Your household’s first three weeks start now. Everything in the planner is on, including the parts that belong to the Household plan later. There’s no card on file and nothing to cancel.')
        + btn(app, 'Open the planner')
        + p('If someone else packs some mornings, invite them from <b>Account</b> so you’re both looking at the same week. And if you’d like the planner to open like an app, add it to your home screen: in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.')
        + small('When the three weeks are up, planning the week, the shopping list and the idea bank stay free for good, and everything you’ve made stays where it is. We’ll send one email a few days before.') })
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

/* what the plan costs, in words, from Stripe's prices (lib/stripe.js priceInfo), so an email never
   quotes a price the website has moved on from. Without them the email names no price at all. */
const dollars = (p) => new Intl.NumberFormat('en-US', { style: 'currency', currency: (p.currency || 'usd').toUpperCase(), minimumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100);
export function priceWords(prices) {
  const y = prices && prices.year, m = prices && prices.month;
  if (!y || !Number.isFinite(y.amount)) return '';
  return `${dollars(y)} a year${m && Number.isFinite(m.amount) ? `, or ${dollars(m)} a month` : ''}${y.founding ? ' (the founding price, yours for as long as you stay)' : ''}`;
}

/* what the Household plan keeps on, in the same words in both reminders */
const PLAN_PARTS = 'writing in your own foods, the kid’s pick, the after-school review and the pantry, and adding another lunchbox or another phone';
const plain = (s) => s.replace(/’/g, "'");

export function sendTrialEnding(to, site, end, stopUrl, tz, price = '') {
  const keep = `${site}/app/?upgrade=1`, when = dateWords(end, tz), subject = `Your free three weeks end ${when}`;
  const priceLine = price ? ` It is ${price}.` : '';
  return send({
    to, subject,
    text: `Your household's three weeks with everything on end on ${when}.\n\nNothing disappears. Every lunchbox, food and week you've made stays, and planning the week, the shopping list and the idea bank stay free for good.\n\nWhat pauses is the part that remembers and shares: ${plain(PLAN_PARTS)}. The Household plan keeps all of that on.${priceLine}\n\nKeep everything on: ${keep}\n\nIf you do nothing, the free planner carries on as it is. There is no card on file, so there is nothing to cancel.` + footText(stopUrl),
    html: shell({ site, subject, stopUrl, preheader: 'Nothing disappears. Here is what pauses, and how to keep it.',
      body: h1(`Your three weeks end ${when}.`)
        + p('Nothing disappears. Every lunchbox, food and week you’ve made stays, and planning the week, the shopping list and the idea bank stay free for good.')
        + p(`What pauses is the part that remembers and shares: ${PLAN_PARTS}. The Household plan keeps all of that on.${esc(priceLine)}`)
        + btn(keep, 'Keep everything on')
        + small('If you do nothing, the free planner carries on as it is. There is no card on file, so there is nothing to cancel.') })
  });
}

export function sendTrialEnded(to, site, stopUrl, price = '') {
  const keep = `${site}/app/?upgrade=1`, subject = 'Your three weeks are up. Everything you made is still there.';
  const priceLine = price ? ` It is ${price}.` : '';
  return send({
    to, subject,
    text: `Your household's three weeks with everything on are up.\n\nPlanning the week, the shopping list and the idea bank are still free, and everything you added is still there. The part that remembers and shares has paused: ${plain(PLAN_PARTS)}. The Household plan switches it back on, with everything exactly as you left it.${priceLine}\n\nSwitch it back on: ${keep}\n\nThis is the last email about it.` + footText(stopUrl),
    html: shell({ site, subject, stopUrl, preheader: 'The free planner carries on. This is the last email about it.',
      body: h1('Your three weeks are up.')
        + p('Planning the week, the shopping list and the idea bank are still free, and everything you added is still there.')
        + p(`The part that remembers and shares has paused: ${PLAN_PARTS}. The Household plan switches it back on, with everything exactly as you left it.${esc(priceLine)}`)
        + btn(keep, 'Switch it back on')
        + small('This is the last email about it.') })
  });
}

/* the beta testers' first week: three emails in Liz's voice, one feature each, the steps to try it,
   a screenshot from the app (public/img/mail-day*.png, made by scripts/mail-shots.mjs) and the form */
export const TESTER_DAYS = [1, 3, 6];
export const PLANNED = [
  'Sending the shopping list straight to Instacart or Walmart',
  'A reminder the evening before, and a widget for the home screen',
  'Home-cooked or store-bought: tell it which you are, and it suggests the right one',
  'A quality score for each box',
  'Macros and targets for a kid on a set diet'
];
export function sendTester(to, site, day, stopUrl) {
  const fb = `${site}/feedback.html`;
  const strip = (x) => x.replace(/<[^>]+>/g, '');
  const numbered = (arr) => arr.map((x, i) => `${i + 1}. ${strip(x)}`).join('\n');
  const notes = {
    1: { subject: 'Thank you for beta testing Lunch Sorted',
         preheader: 'Day one: the week, planned in a minute.',
         intro: 'Thank you for testing Lunch Sorted. I built it because I was tired of thinking about lunch every single day, and what you tell me this week is what I fix next.',
         feature: 'the week, planned in a minute.',
         steps: ['Open the app and tap <b>Week</b>. If it is empty, tap <b>Plan the week</b>. With more than one lunchbox it asks whose first, and each box gets its own tab along the top.',
                 'Not sure about something? Tap that compartment and pick another, or tap the arrows beside the day to shuffle it. Like a day as it is? Tap the lock beside it and Plan the week leaves it alone.',
                 'Tap <b>Shop</b>. That is your grocery list, by aisle. Check off what is already home, then <b>Copy</b> it or <b>Send</b> it to Notes or a text.',
                 'Tomorrow morning, tap <b>Pack</b>, then <b>Packed</b>. Field trip? <b>No lunch today</b> beside the box takes the day off.'],
         alt: 'The Week tab: Monday’s box planned, with its lock, its shuffle and No lunch today beside it',
         ask: 'One question for today: did the boxes make sense for your kid? Tell me on the feedback form. It takes a minute.' },
    3: { subject: 'Today, let your kid pick their lunch',
         preheader: 'Day three: a lunch they chose comes home emptier.',
         intro: 'Thanks for sticking with it. Today is the part I’m proudest of: the kid’s pick. In my house, a lunch they chose comes home emptier.',
         feature: 'let them pick.',
         steps: ['Tap the settings button beside your kid’s name and switch on <b>They pick their box each day</b>.',
                 'On <b>Foods</b>, tap the picture beside a food and add a photo of the real thing, so a little one can pick without reading.',
                 'This evening, open <b>Pack</b>, tap <b>Let [your kid’s name] pick</b>, and hand over the phone.'],
         alt: 'The kid’s pick: two pictures to choose between',
         ask: 'There are two ways to pick under that switch, <b>Each part</b> and <b>Whole box</b>. Try both if you can, and tell me which one your kid took to.' },
    6: { subject: 'Almost a week in. What came home?',
         preheader: 'Day six: the after-school review, and what I’m planning next.',
         intro: 'Almost a week in, and thank you. This is the last of the three: what came home.',
         feature: 'what came home.',
         steps: ['After your kid gets home, <b>Pack</b> asks how it went. Tap <b>All eaten</b>, or <b>Ate it</b>, <b>Some</b>, <b>Came home</b> or <b>Didn’t get to it</b> under each food.',
                 'That is it. Next week’s plan leans toward what actually got eaten, and a food that came home twice in a row sits out for three weeks.',
                 'While you are on <b>Foods</b>, try <b>Add your own</b>, with what to buy for it, so the list carries your family’s real food.',
                 'And along the bottom, <b>Recipes</b>: every recipe in one place for the whole household, searchable by name or by what is in the cupboard. <b>Import a recipe</b> brings in one you found somewhere else.'],
         alt: 'What came home: All eaten in one tap, or Ate it, Some, Came home or Didn’t get to it under each food',
         ask: 'Did you cook from a recipe this week? And here is what I’m planning next:',
         after: 'Would those help? What would you add? And would you keep using Lunch Sorted? Tell me why, either way.' }
  }[day];
  if (!notes) throw new Error('no tester note for day ' + day);
  const text = `Hi,\n\n${plain(strip(notes.intro))}\n\nToday's feature: ${strip(notes.feature)}\n\n${plain(numbered(notes.steps))}\n\n${plain(strip(notes.ask))}`
    + (notes.after ? `\n${PLANNED.map(x => '- ' + x).join('\n')}\n\n${plain(notes.after)}` : '')
    + `\n\nSend feedback: ${fb}\n\nLiz` + footText(stopUrl);
  const html = shell({ site, subject: notes.subject, stopUrl, preheader: notes.preheader,
    body: h1(`Today’s feature: ${notes.feature}`)
      + p(notes.intro)
      + steps(notes.steps)
      + pic(`${site}/img/mail-day${day}.png`, notes.alt)
      + p(notes.ask)
      + (notes.after ? bullets(PLANNED.map(esc)) + p(notes.after) : '')
      + btn(fb, 'Send feedback')
      + sig() });
  return send({ to, subject: notes.subject, text, html });
}

