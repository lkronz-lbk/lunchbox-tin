import { sql, siteUrl, siteEnv } from '../lib/db.js';
import { billingEnabled } from '../lib/stripe.js';
import { trialEnd, stampOrNull } from '../lib/trial.js';
import { sendTrialEnding, sendTrialEnded } from '../lib/mail.js';

/* Once a day: the households whose three weeks end in about three days get one
   email saying when; the ones whose three weeks ended yesterday get one saying
   what changed. Each household, each kind, once; paid households never; anyone
   who tapped "stop these reminders" never. Runs only on the published deploy. */
const DAY = 86400000;
const PER_RUN = 200;

export async function run(now = Date.now(), siteOverride = '') {
  const out = { ending: 0, ended: 0, skipped: 0 };
  if (!billingEnabled()) return out;
  const site = siteOverride || siteUrl(null);
  const q = sql();
  /* candidates: rows young enough to be in either window, or every row while the billing
     floor is recent enough that an old household's three weeks are still running */
  const since = stampOrNull(process.env.BILLING_SINCE);
  const rows = since && now - since.getTime() < 25 * DAY
    ? await q`SELECT h.id, h.created_at, h.doc->>'createdAt' AS doc_created, h.doc->>'tz' AS tz, e.plan, e.status FROM households h LEFT JOIN entitlements e ON e.household_id = h.id ORDER BY h.id LIMIT 5000`
    : await q`SELECT h.id, h.created_at, h.doc->>'createdAt' AS doc_created, h.doc->>'tz' AS tz, e.plan, e.status FROM households h LEFT JOIN entitlements e ON e.household_id = h.id WHERE h.created_at > now() - interval '40 days' ORDER BY h.id LIMIT 5000`;
  let sent = 0;
  for (const h of rows) {
    if (sent >= PER_RUN) break;
    const paid = h.plan && h.plan !== 'free' && (h.status === 'active' || h.status === 'past_due');
    if (paid) continue;
    const end = trialEnd(h); if (!end) continue;
    const left = end.getTime() - now;
    /* the window for "ending" is wide enough that a large cohort with one shared start still gets through over two runs */
    const kind = left > 1 * DAY && left <= 4 * DAY ? 'trial_ending' : left <= 0 && left > -2 * DAY ? 'trial_ended' : null;
    if (!kind) continue;
    /* the notice row is claimed first, so two overlapping runs cannot both send; anything that
       goes wrong for this household releases the claim and moves on to the next */
    const claimed = await q`INSERT INTO notices (household_id, kind) VALUES (${h.id}, ${kind}) ON CONFLICT DO NOTHING RETURNING household_id`;
    if (!claimed.length) continue;
    let any = false;
    try {
      const people = await q`
        SELECT u.id, u.email, u.mail_ok, u.mail_token FROM household_members m JOIN users u ON u.id = m.user_id
        WHERE m.household_id = ${h.id} AND m.role IN ('owner', 'adult') ORDER BY m.joined_at`;
      for (const p of people) {
        if (!p.mail_ok) { out.skipped++; continue; }
        let token = p.mail_token;
        if (!token) { const [u] = await q`UPDATE users SET mail_token = replace(gen_random_uuid()::text, '-', '') WHERE id = ${p.id} AND mail_token IS NULL RETURNING mail_token`; token = u ? u.mail_token : (await q`SELECT mail_token FROM users WHERE id = ${p.id}`)[0].mail_token; }
        const stop = `${site}/api/auth/mail-stop?t=${token}`;
        try {
          const tz = typeof h.tz === 'string' && h.tz.length <= 64 && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(h.tz) ? h.tz : null;   /* the document is the phone's word; only a zone-shaped one is tried */
          if (kind === 'trial_ending') await sendTrialEnding(p.email, site, end, stop, tz); else await sendTrialEnded(p.email, site, stop);
          any = true; sent++;
        } catch (e) { console.error('cron-trial: could not send to', p.id, e.message); }
      }
    } catch (e) { console.error('cron-trial: household', h.id, e.message); }
    if (any) out[kind === 'trial_ending' ? 'ending' : 'ended']++;
    else await q`DELETE FROM notices WHERE household_id = ${h.id} AND kind = ${kind}`;   /* nobody could be reached: try again tomorrow */
  }
  console.log(`cron-trial: ending=${out.ending} ended=${out.ended} skipped=${out.skipped}`);
  return out;
}

/* only the schedule on the published deploy may run this: not a branch deploy, not a
   browser that found the path (a scheduled invocation carries next_run in its body) */
export default async function handler(req) {
  if (siteEnv() !== 'production') return new Response('not here', { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || !body.next_run) return new Response('not found', { status: 404 });
  try { await run(); return new Response('ok'); }
  catch (e) { console.error('cron-trial', e); return new Response('failed', { status: 500 }); }
}

export const config = { schedule: '0 14 * * *' };
