import { sql, siteUrl } from '../lib/db.js';
import { sendTester, TESTER_DAYS } from '../lib/mail.js';

/* Once a day: every household that came in on the beta gets three short emails in its first
   week, on days 1, 3 and 6 after it switched on, each with one thing to try and the feedback
   form. Each household, each day, once; anyone who tapped "no more of these" never. */
const DAY = 86400000;

export async function run(now = Date.now(), siteOverride = '') {
  const out = { sent: 0, skipped: 0 };
  const site = siteOverride || siteUrl(null);
  const q = sql();
  const rows = await q`SELECT household_id AS id, event_at FROM entitlements WHERE source = 'code' AND event_at > now() - interval '10 days' ORDER BY event_at LIMIT 500`;
  for (const h of rows) {
    const age = (now - new Date(h.event_at).getTime()) / DAY;
    /* the latest day that has come, so a household that was missed a day still gets that note, once */
    const day = TESTER_DAYS.filter(d => age >= d && age < d + 2).pop();
    if (!day) continue;
    const kind = 'tester_' + day;
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
        try { await sendTester(p.email, site, day, `${site}/api/auth/mail-stop?t=${token}`); any = true; out.sent++; }
        catch (e) { console.error('cron-tester: could not send to', p.id, e.message); }
      }
    } catch (e) { console.error('cron-tester: household', h.id, e.message); }
    if (!any) await q`DELETE FROM notices WHERE household_id = ${h.id} AND kind = ${kind}`;   /* nobody could be reached: try again tomorrow */
  }
  console.log(`cron-tester: sent=${out.sent} skipped=${out.skipped}`);
  return out;
}

export default async function handler(req) {
  const body = await req.json().catch(() => null);
  if (!body || !body.next_run) return new Response('not found', { status: 404 });
  try { await run(); return new Response('ok'); }
  catch (e) { console.error('cron-tester', e); return new Response('failed', { status: 500 }); }
}

export const config = { schedule: '0 15 * * *' };
