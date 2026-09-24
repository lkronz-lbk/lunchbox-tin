import { sql, json, fail, throttled } from '../lib/db.js';
import { currentUser } from '../lib/auth.js';
import { verifyJws, stateOf, envOk, BUNDLE_ID, PRODUCTS } from '../lib/apple.js';
import { writeApple } from '../lib/entitlement.js';

/* The iPhone app's way of paying. The phone buys through StoreKit and tells us straight away;
   Apple's servers tell us everything after, renewals and refunds included. Either way what
   arrives is signed by Apple and checked (lib/apple.js) before it can touch the row, and the
   row is written by lib/entitlement.js alone.
   POST /api/apple/link   {signedTransaction}  -> {entitlement}   the phone, after a purchase or Restore
   POST /api/apple/notify {signedPayload}      -> Apple, App Store Server Notifications version 2   */

const LIVE = new Set(['active', 'past_due']);
const WEB = new Set(['stripe', 'code', 'comp']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (ms) => new Date(Number(ms)).toISOString();

async function membership(userId) {
  const rows = await sql()`
    SELECT h.id, m.role, e.apple_account_token AS token
    FROM household_members m JOIN households h ON h.id = m.household_id
    LEFT JOIN entitlements e ON e.household_id = h.id WHERE m.user_id = ${userId}`;
  return rows[0] || null;
}

/* the household a purchase belongs to: the one it is already bound to, or the one whose token
   the phone handed Apple when it was bought */
async function householdFor(txn) {
  const q = sql();
  const byTxn = await q`SELECT household_id FROM entitlements WHERE apple_original_transaction_id = ${String(txn.originalTransactionId)}`;
  if (byTxn[0]) return byTxn[0].household_id;
  if (!UUID.test(txn.appAccountToken || '')) return null;
  const byToken = await q`SELECT household_id FROM entitlements WHERE apple_account_token = ${txn.appAccountToken.toLowerCase()}`;
  return byToken[0] ? byToken[0].household_id : null;
}

async function apply(hid, at, txn, renewal, paidBy) {
  const st = stateOf(txn, renewal);
  if (!st) return 'unknown product';
  const [cur] = await sql()`SELECT plan, status, source, apple_original_transaction_id AS original FROM entitlements WHERE household_id = ${hid}`;
  const original = String(txn.originalTransactionId);
  /* forever already: a subscription renewing or lapsing beside it changes nothing. Apple cannot
     cancel a subscription for us the way Stripe can, so one bought before forever may run on. */
  if (cur && cur.plan === 'lifetime' && LIVE.has(cur.status) && PRODUCTS[txn.productId] !== 'lifetime') return 'lifetime kept';
  /* a purchase other than the one the household is bound to takes the row only by being live:
     a refund of a subscription long lapsed must not end the one being paid for now */
  if (cur && cur.source === 'apple' && LIVE.has(cur.status) && cur.original && cur.original !== original && !LIVE.has(st.status)) return 'other purchase';
  try {
    const ok = await writeApple(hid, at, { ...st, original, product: txn.productId, paidBy });
    return ok ? 'applied' : 'stale';
  } catch (e) {
    if (e && (e.code === '23505' || /unique|duplicate/i.test(e.message || ''))) return 'elsewhere';
    throw e;
  }
}

async function entitlementOf(hid) {
  const [e] = await sql()`SELECT plan, source, status, current_period_end AS "currentPeriodEnd", cancel_at_period_end AS "cancelAtPeriodEnd" FROM entitlements WHERE household_id = ${hid}`;
  return e || null;
}

export default async function handler(req) {
  const action = new URL(req.url).pathname.replace(/\/$/, '').split('/').pop();
  if (req.method !== 'POST' || !['link', 'notify'].includes(action)) return fail('Not found', 404);

  if (action === 'notify') {
    const raw = await req.text();
    if (raw.length > 65536) return fail('Too large', 413);
    let body; try { body = JSON.parse(raw); } catch { return fail('Bad request'); }
    let n, txn, renewal;
    try {
      n = verifyJws(body && body.signedPayload);
      if (n.data && n.data.signedTransactionInfo) txn = verifyJws(n.data.signedTransactionInfo);
      if (n.data && n.data.signedRenewalInfo) renewal = verifyJws(n.data.signedRenewalInfo);
    } catch { return fail('Bad signature', 400); }
    if (typeof n.notificationUUID !== 'string' || typeof n.notificationType !== 'string' || !Number.isFinite(n.signedDate)) return fail('Bad request');
    const d = n.data || {};
    if (d.bundleId !== BUNDLE_ID || !envOk(d.environment)) return fail('Wrong app', 400);
    /* TEST, and the summaries of a renewal extension, carry no purchase to apply */
    if (!txn) return json({ received: true, ignored: true });
    if (txn.bundleId !== BUNDLE_ID || String(txn.originalTransactionId || '') === '') return fail('Wrong app', 400);
    const seen = await sql()`INSERT INTO apple_events (id, type) VALUES (${n.notificationUUID}, ${n.notificationType}) ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (!seen.length) return json({ received: true, duplicate: true });
    let outcome;
    try {
      const hid = await householdFor(txn);
      outcome = hid ? await apply(hid, iso(n.signedDate), txn, renewal || null, null) : 'no household';
    } catch (e) {
      /* unrecorded, so Apple's retry applies it */
      await sql()`DELETE FROM apple_events WHERE id = ${n.notificationUUID}`;
      console.error('apple:', n.notificationType, n.notificationUUID, e.message);
      return fail('Could not apply', 500);
    }
    console.log(`apple: ${n.notificationType}${n.subtype ? '/' + n.subtype : ''} ${n.notificationUUID} -> ${outcome}`);
    if (Math.random() < 0.05) await sql()`DELETE FROM apple_events WHERE received_at < now() - interval '30 days'`;
    return json({ received: true });
  }

  /* link: the phone, signed in, straight after StoreKit says a purchase or a restore went through */
  const user = await currentUser(req);
  if (!user) return fail('Not signed in', 401);
  if (await throttled('apple:' + user.id, 30, 3600)) return fail('Too many tries in an hour; try again shortly', 429);
  const h = await membership(user.id);
  if (!h) return fail('Not in a household', 404);
  if (h.role === 'helper') return fail('Only a parent can change the plan', 403);
  const body = await req.json().catch(() => ({}));
  let txn;
  try { txn = verifyJws(body && body.signedTransaction); } catch { return fail('That purchase could not be checked', 400); }
  if (txn.bundleId !== BUNDLE_ID || !envOk(txn.environment) || !PRODUCTS[txn.productId] || String(txn.originalTransactionId || '') === '') return fail('That purchase is not for Lunch Sorted', 400);
  /* bought for another household: the Apple ID is the same, the household is not */
  const elsewhere = () => fail('This purchase belongs to another household', 409, { elsewhere: true });
  if (UUID.test(txn.appAccountToken || '') && h.token && txn.appAccountToken.toLowerCase() !== String(h.token).toLowerCase()) return elsewhere();
  const outcome = await apply(h.id, iso(txn.signedDate), txn, null, user.id);
  if (outcome === 'elsewhere') return elsewhere();
  const e = await entitlementOf(h.id);
  if (outcome === 'stale' && e && WEB.has(e.source) && LIVE.has(e.status)) return fail('This household already has the plan through the website', 409, { paying: true, entitlement: e });
  return json({ ok: true, outcome, entitlement: e });
}

export const config = { path: ['/api/apple/link', '/api/apple/notify'] };
