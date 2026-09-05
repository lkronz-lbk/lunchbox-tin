import { sql, json, fail, siteUrl, throttled } from '../lib/db.js';
import { currentUser } from '../lib/auth.js';
import { billingEnabled, isProduction, prices, priceInfo, stripe, verifyWebhook, periodEnd, subscriptionStatus, cancelSubscription } from '../lib/stripe.js';

/* Payment happens on Stripe's own page; this side only opens the door and
   listens for the answer. Nothing the browser sends can grant a plan: the
   entitlement row is written by the webhook alone.
   GET  /api/billing                    -> {enabled, prices}   public, cacheable
   POST /api/billing/checkout {plan}    -> {url}  Stripe Checkout for this household (owner or adult)
   POST /api/billing/portal             -> {url}  Stripe's customer portal: card, invoices, cancel (owner, or whoever paid)
   POST /api/billing/webhook            -> Stripe, signed                                              */

const PLANS = { year: 'household', lifetime: 'lifetime' };
const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded']);

async function membership(userId) {
  const rows = await sql()`
    SELECT h.id, h.owner_user_id, m.role, e.plan, e.status, e.stripe_customer_id, e.stripe_subscription_id, e.paid_by
    FROM household_members m JOIN households h ON h.id = m.household_id
    LEFT JOIN entitlements e ON e.household_id = h.id WHERE m.user_id = ${userId}`;
  return rows[0] || null;
}

/* ---- the webhook ---- */
const idOf = (v) => typeof v === 'string' ? v : v && v.id;
async function household(idText) {
  const id = Number(idText);
  if (!Number.isInteger(id) || id < 1) return null;
  const rows = await sql()`SELECT id FROM households WHERE id = ${id}`;
  return rows[0] ? id : null;
}
async function householdFor(obj) {
  const byMeta = await household(obj.metadata && obj.metadata.household_id);
  if (byMeta) return byMeta;
  const q = sql();
  if (obj.object === 'subscription') {
    const bySub = await q`SELECT household_id FROM entitlements WHERE stripe_subscription_id = ${obj.id}`;
    if (bySub[0]) return bySub[0].household_id;
  }
  const cust = idOf(obj.customer);
  const byCust = cust ? await q`SELECT household_id FROM entitlements WHERE stripe_customer_id = ${cust}` : [];
  return byCust[0] ? byCust[0].household_id : null;
}

/* Every write is one upsert that only applies when the event is not older than the last one
   applied to the row, so two deliveries racing each other are ordered by Postgres, not by us. */
async function write(hid, at, v) {
  const rows = await sql()`
    INSERT INTO entitlements (household_id, plan, source, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id, paid_by, event_at, updated_at)
    VALUES (${hid}, ${v.plan}, ${v.source}, ${v.status}, ${v.periodEnd || null}, ${!!v.cancelAtPeriodEnd}, ${v.customer || null}, ${v.subscription || null}, ${v.price || null}, ${v.paidBy || null}, ${at}, now())
    ON CONFLICT (household_id) DO UPDATE SET plan = EXCLUDED.plan, source = EXCLUDED.source, status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, entitlements.stripe_customer_id),
      stripe_subscription_id = EXCLUDED.stripe_subscription_id, stripe_price_id = EXCLUDED.stripe_price_id,
      paid_by = COALESCE(EXCLUDED.paid_by, entitlements.paid_by), event_at = EXCLUDED.event_at, updated_at = now()
    WHERE entitlements.event_at IS NULL OR entitlements.event_at <= EXCLUDED.event_at
    RETURNING household_id`;
  return rows.length > 0;
}

async function applyEvent(ev) {
  const q = sql();
  const at = new Date(ev.created * 1000).toISOString();
  const obj = ev.data && ev.data.object;
  if (!obj) return 'skipped';

  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') return 'unpaid';   /* a bank debit still clearing: the succeeded event follows */
    const hid = await household(obj.client_reference_id || (obj.metadata && obj.metadata.household_id));
    if (!hid) return 'no household';
    const cust = idOf(obj.customer);
    const paidBy = Number(obj.metadata && obj.metadata.user_id) || null;
    const plan = PLANS[obj.metadata && obj.metadata.plan] || (obj.mode === 'payment' ? 'lifetime' : 'household');
    const [cur] = await q`SELECT plan, stripe_subscription_id FROM entitlements WHERE household_id = ${hid}`;
    const oldSub = cur && cur.stripe_subscription_id;
    if (plan === 'lifetime') {
      const ok = await write(hid, at, { plan: 'lifetime', source: 'stripe', status: 'active', customer: cust, subscription: null, price: prices().lifetime, paidBy });
      /* a yearly plan bought before this one stops at its period end, so nobody pays twice */
      if (ok && oldSub) { try { await stripe('POST', `/subscriptions/${oldSub}`, { cancel_at_period_end: true }); } catch (e) { console.error('billing: could not stop the old subscription', oldSub, e.message); } }
      return ok ? 'applied' : 'stale';
    }
    if (cur && cur.plan === 'lifetime') return 'lifetime kept';        /* forever already; a yearly checkout cannot lower it */
    const subId = idOf(obj.subscription);
    /* the subscription's own dates come with it, so the plan line has its renewal date from the
       first moment and the subscription.created event, which may carry an earlier stamp, is not needed */
    let sub = null;
    if (subId) { try { sub = await stripe('GET', `/subscriptions/${subId}`); } catch (e) { console.error('billing: could not read', subId, e.message); } }
    const ok = await write(hid, at, { plan: 'household', source: 'stripe', status: sub ? subscriptionStatus(sub) : 'active', periodEnd: periodEnd(sub),
      cancelAtPeriodEnd: sub && sub.cancel_at_period_end, customer: cust, subscription: subId, price: prices().year, paidBy });
    /* a second subscription for the same household (a card that failed, then a fresh checkout) replaces the first */
    if (ok && oldSub && subId && oldSub !== subId) await cancelSubscription(oldSub);
    return ok ? 'applied' : 'stale';
  }

  if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
    const hid = await householdFor(obj);
    if (!hid) return 'no household';
    const [cur] = await q`SELECT plan, stripe_subscription_id FROM entitlements WHERE household_id = ${hid}`;
    if (cur && cur.plan === 'lifetime') return 'lifetime kept';        /* a subscription winding down after a lifetime purchase changes nothing */
    if (cur && cur.stripe_subscription_id && cur.stripe_subscription_id !== obj.id) return 'other subscription';   /* an older one of the same customer */
    const status = ev.type === 'customer.subscription.deleted' ? 'canceled' : subscriptionStatus(obj);
    const price = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
    const ok = await write(hid, at, { plan: status === 'canceled' ? 'free' : 'household', source: status === 'canceled' ? 'none' : 'stripe', status,
      periodEnd: periodEnd(obj), cancelAtPeriodEnd: obj.cancel_at_period_end, customer: idOf(obj.customer), subscription: obj.id, price });
    return ok ? 'applied' : 'stale';
  }

  if (ev.type === 'charge.refunded') {
    /* a forever purchase refunded in full is a forever purchase undone; a yearly refund is
       paired with cancelling the subscription in the dashboard, which arrives as its own event */
    if (!obj.refunded) return 'partial';
    const hid = await householdFor(obj);
    if (!hid) return 'no household';
    const [cur] = await q`SELECT plan FROM entitlements WHERE household_id = ${hid}`;
    if (!cur || cur.plan !== 'lifetime') return 'not lifetime';
    const ok = await write(hid, at, { plan: 'free', source: 'none', status: 'canceled', customer: idOf(obj.customer), subscription: null, price: null });
    return ok ? 'applied' : 'stale';
  }
  return 'skipped';
}

export default async function handler(req, context) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const action = parts[parts.length - 1] === 'billing' ? '' : parts[parts.length - 1];
  try {
    if (req.method === 'GET' && !action) {
      if (!billingEnabled()) return json({ enabled: false }, 200, { 'cache-control': 'public, max-age=300' });
      let p = null; try { p = await priceInfo(); } catch (e) { console.error('billing: prices', e.message); }
      /* without prices the gates still stand and the buttons say "Yearly plan" / "Once, forever"; ask again soon */
      return json({ enabled: true, prices: p }, 200, { 'cache-control': p ? 'public, max-age=3600' : 'public, max-age=60' });
    }

    if (req.method === 'POST' && action === 'webhook') {
      const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
      const raw = await req.text();
      if (!verifyWebhook(raw, req.headers.get('stripe-signature'), secret)) return fail('Bad signature', 400);
      let ev; try { ev = JSON.parse(raw); } catch { return fail('Bad request'); }
      if (!ev || typeof ev.id !== 'string' || typeof ev.type !== 'string' || !Number.isFinite(ev.created)) return fail('Bad request');
      /* a test-mode event can never touch production households, whatever secret was pasted where */
      if (ev.livemode !== isProduction()) return fail('Wrong mode', 400);
      if (!HANDLED.has(ev.type)) return json({ received: true, ignored: true });
      const seen = await sql()`INSERT INTO stripe_events (id, type) VALUES (${ev.id}, ${ev.type}) ON CONFLICT (id) DO NOTHING RETURNING id`;
      if (!seen.length) return json({ received: true, duplicate: true });
      let outcome;
      try { outcome = await applyEvent(ev); }
      catch (e) {
        /* not applied, so not seen: Stripe's retry gets another go */
        await sql()`DELETE FROM stripe_events WHERE id = ${ev.id}`;
        throw e;
      }
      console.log(`billing: ${ev.type} ${ev.id} -> ${outcome}`);
      if (Math.random() < 0.05) await sql()`DELETE FROM stripe_events WHERE received_at < now() - interval '30 days'`;
      return json({ received: true });
    }

    if (req.method !== 'POST' || !['checkout', 'portal'].includes(action)) return fail('Not found', 404);
    if (!billingEnabled()) return fail('Billing is not switched on here', 503);
    const user = await currentUser(req);
    if (!user) return fail('Not signed in', 401);
    if (await throttled('billing:' + user.id, 20, 3600)) return fail('Too many tries in an hour; try again shortly', 429);
    const h = await membership(user.id);
    if (!h) return fail('Not in a household', 404);
    if (h.role === 'helper') return fail('Only a parent can change the plan', 403);
    const site = siteUrl(req);

    if (action === 'checkout') {
      const body = await req.json().catch(() => ({}));
      const plan = body.plan === 'lifetime' ? 'lifetime' : 'year';
      if (h.plan === 'lifetime' && h.status === 'active') return fail('This household already has Lunch Sorted forever', 409);
      if (plan === 'year' && h.plan === 'household' && h.status === 'active') return fail('This household already has the yearly plan', 409);
      if (plan === 'year' && h.plan === 'household' && h.status === 'past_due') return fail('The yearly plan is waiting on a payment; update the card in Manage billing', 409);
      const params = {
        mode: plan === 'lifetime' ? 'payment' : 'subscription',
        line_items: [{ price: prices()[plan], quantity: 1 }],
        client_reference_id: String(h.id),
        metadata: { household_id: String(h.id), plan, user_id: String(user.id) },
        success_url: `${site}/app/?paid=1`,
        cancel_url: `${site}/app/?paid=0`,
        allow_promotion_codes: true,
        automatic_tax: { enabled: process.env.STRIPE_TAX !== '0' },
        billing_address_collection: 'auto'
      };
      if (plan === 'year') params.subscription_data = { metadata: { household_id: String(h.id), plan } };
      else params.invoice_creation = { enabled: true };
      if (h.stripe_customer_id) { params.customer = h.stripe_customer_id; params.customer_update = { address: 'auto', name: 'auto' }; }
      else params.customer_email = user.email;
      let session;
      try { session = await stripe('POST', '/checkout/sessions', params); }
      catch (e) {
        if (!/tax/i.test(String(e.message))) throw e;
        /* Stripe Tax not finished in the dashboard: sell without it rather than not at all, loudly */
        console.error('billing: automatic tax refused, retrying without it:', e.message);
        params.automatic_tax = { enabled: false };
        session = await stripe('POST', '/checkout/sessions', params);
      }
      console.log(`billing: checkout household=${h.id} plan=${plan} tax=${params.automatic_tax.enabled}`);
      return json({ url: session.url });
    }

    if (action === 'portal') {
      if (!h.stripe_customer_id) return fail('Nothing has been bought for this household yet', 404);
      /* the portal shows the card and the invoices: the owner's business, and the payer's */
      if (h.owner_user_id !== user.id && h.paid_by !== user.id) return fail('Only the owner, or whoever paid, can manage billing', 403);
      const ps = await stripe('POST', '/billing_portal/sessions', { customer: h.stripe_customer_id, return_url: `${site}/app/?portal=1` });
      return json({ url: ps.url });
    }
    return fail('Not found', 404);
  } catch (e) {
    console.error('api-billing', e);
    return fail('Something went wrong on our side', 500);
  }
}

export const config = { path: ['/api/billing', '/api/billing/*'] };
