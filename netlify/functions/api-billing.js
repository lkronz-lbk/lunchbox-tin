import { sql, json, fail, siteUrl, throttled } from '../lib/db.js';
import { codeMatches, betaCap, betaCount } from '../lib/beta.js';
import { currentUser } from '../lib/auth.js';
import { billingEnabled, isProduction, prices, priceInfo, stripe, verifyWebhook, periodEnd, subscriptionStatus, cancelSubscription } from '../lib/stripe.js';
import { write } from '../lib/entitlement.js';
import { appleLive, lapsed } from '../lib/apple.js';
import { trialEnd } from '../lib/trial.js';

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
    SELECT h.id, h.owner_user_id, h.created_at, h.doc->>'createdAt' AS doc_created, m.role, e.plan, e.status, e.source, e.current_period_end, e.stripe_customer_id, e.stripe_subscription_id, e.paid_by
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

/* the row itself is written by lib/entitlement.js, which every way of paying shares */
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
    /* nothing charged: a 100%-off code (the beta testers), which the admin page lists; or a plan bought
       inside the three weeks, charged when they end, which is a sale like any other */
    const deferred = !!(obj.metadata && obj.metadata.charge_later);
    const source = obj.amount_total === 0 && !deferred ? 'code' : 'stripe';
    const [cur] = await q`SELECT plan, stripe_subscription_id FROM entitlements WHERE household_id = ${hid}`;
    const oldSub = cur && cur.stripe_subscription_id;
    if (plan === 'lifetime') {
      const ok = await write(hid, at, { plan: 'lifetime', source, status: 'active', customer: cust, subscription: null, price: prices().lifetime, paidBy });
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
    const ok = await write(hid, at, { plan: 'household', source, status: sub ? subscriptionStatus(sub) : 'active', periodEnd: periodEnd(sub),
      cancelAtPeriodEnd: sub && sub.cancel_at_period_end, customer: cust, subscription: subId, price: prices()[obj.metadata && obj.metadata.plan === 'month' ? 'month' : 'year'] || null, paidBy });
    /* a second subscription for the same household (a card that failed, then a fresh checkout) replaces the first */
    if (ok && oldSub && subId && oldSub !== subId) await cancelSubscription(oldSub);
    if (!ok) {
      /* paid on the web after the household had bought the plan through the App Store (a checkout
         left open in a tab, then the iPhone): the row stays Apple's, so this subscription would
         charge for nothing, and with no customer on the row nobody could cancel it. It is ended now
         and its payment given back. */
      const [row] = await q`SELECT plan, status, source, current_period_end FROM entitlements WHERE household_id = ${hid}`;
      if (appleLive(row) && subId) { await cancelSubscription(subId); return (await refundCheckout(obj)) ? 'refunded: the App Store holds it' : 'canceled: the App Store holds it; refund by hand'; }
    }
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
      periodEnd: periodEnd(obj), cancelAtPeriodEnd: obj.cancel_at_period_end, customer: idOf(obj.customer), subscription: obj.id, price, keepCode: true });
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

/* gives back what a checkout charged, through the invoice it paid; older Stripe accounts name the
   payment on the invoice, newer ones list it under invoice_payments. Returns whether it was refunded. */
async function refundCheckout(obj) {
  if (!obj.amount_total || !obj.invoice) return !obj.amount_total;
  try {
    const invId = typeof obj.invoice === 'string' ? obj.invoice : obj.invoice.id;
    const inv = await stripe('GET', `/invoices/${invId}`);
    let pi = idOf(inv.payment_intent), charge = idOf(inv.charge);
    if (!pi && !charge) {
      const pays = await stripe('GET', '/invoice_payments', { invoice: invId });
      const p = pays && pays.data && pays.data[0] && pays.data[0].payment;
      pi = p && idOf(p.payment_intent); charge = p && idOf(p.charge);
    }
    if (!pi && !charge) throw new Error('no payment on ' + invId);
    await stripe('POST', '/refunds', pi ? { payment_intent: pi } : { charge }, 'refund-' + obj.id);
    return true;
  } catch (e) { console.error('billing: REFUND BY HAND, checkout', obj.id, 'paid while the App Store held the plan:', e.message); return false; }
}

export default async function handler(req, context) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const action = parts[parts.length - 1] === 'billing' ? '' : parts[parts.length - 1];
  try {
    if (req.method === 'GET' && !action) {
      if (!billingEnabled()) return json({ enabled: false }, 200, { 'cache-control': 'public, max-age=300' });
      let p = null; try { p = await priceInfo(); } catch (e) { console.error('billing: prices', e.message); }
      /* without prices the gates still stand and the button says "Yearly plan"; ask again soon */
      return json({ enabled: true, prices: p, since: process.env.BILLING_SINCE || null }, 200, { 'cache-control': p ? 'public, max-age=3600' : 'public, max-age=60' });
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

    if (req.method !== 'POST' || !['checkout', 'portal', 'beta'].includes(action)) return fail('Not found', 404);
    if (action !== 'beta' && !billingEnabled()) return fail('Billing is not switched on here', 503);
    const user = await currentUser(req);
    if (!user) return fail('Not signed in', 401);
    if (await throttled('billing:' + user.id, 20, 3600)) return fail('Too many tries in an hour; try again shortly', 429);
    const h = await membership(user.id);
    if (!h) return fail('Not in a household', 404);
    if (h.role === 'helper') return fail('Only a parent can change the plan', 403);

    if (action === 'beta') {
      /* the beta link: forever, free, for the first BETA_CAP households; the code is in the link, the cap is the limit */
      const body = await req.json().catch(() => ({}));
      if (await throttled('beta:' + user.id, 5, 3600)) return fail('Too many tries in an hour; try again shortly', 429);
      if (!codeMatches(body.code)) return fail('That beta link is not right', 404);
      if (h.plan === 'lifetime' && h.status === 'active' && !(h.source === 'apple' && lapsed(h.current_period_end))) return json({ ok: true, already: true });
      if (appleLive(h)) return fail('This household pays through the App Store on an iPhone; the plan is managed there', 409, { apple: true });
      /* a household paying for the Household plan is a customer, not a tester: the card would go on being charged */
      if (h.stripe_subscription_id && (h.status === 'active' || h.status === 'past_due')) return fail('This household already has the Household plan', 409, { paying: true });
      /* two claims in the same instant can both pass this count and land at cap + 1: fine for a hand-shared link and a cap of 25 */
      if (await betaCount() >= betaCap()) return fail('The beta is full', 409, { full: true });
      const ok = await write(h.id, new Date().toISOString(), { plan: 'lifetime', source: 'code', status: 'active', customer: h.stripe_customer_id || null, subscription: null, price: null, paidBy: user.id });
      console.log(`billing: beta household=${h.id} ${ok ? 'on' : 'stale'}`);
      if (!ok) return fail('Try again in a moment', 503);                /* a Stripe event stamped ahead of our clock: the code stays on the phone */
      return json({ ok: true });
    }
    const site = siteUrl(req);

    if (action === 'checkout') {
      const body = await req.json().catch(() => ({}));
      /* forever is no longer sold; an app open since it was asks, and is told so */
      if (body.plan === 'lifetime') return fail('Forever is no longer sold; the yearly and monthly plans are still here', 410);
      const plan = (body.plan === 'month' && prices().month) ? 'month' : 'year';
      /* the iPhone app sells through the App Store only; a checkout asked for from it is refused, not opened */
      if (body.client === 'ios') return fail('In the iPhone app the plan is bought through the App Store', 403, { appStore: true });
      const back = `${site}/app/`;
      /* each platform sells the plan its own way: a household paying Apple is not sold it again here */
      if (appleLive(h)) return fail('This household pays through the App Store on an iPhone; the plan is managed there', 409, { apple: true });
      /* an App Store plan days past its end, its notification missed, holds nothing: the website sells the plan again */
      const held = !(h.source === 'apple' && lapsed(h.current_period_end));
      if (held && h.plan === 'lifetime' && h.status === 'active') return fail('This household already has Lunch Sorted forever', 409);
      /* a monthly or yearly household switches between the two in Manage billing, not with a second subscription */
      if (held && h.plan === 'household' && h.status === 'active') return fail('This household already has the Household plan; change how it is billed in Manage billing', 409);
      if (held && h.plan === 'household' && h.status === 'past_due') return fail('The Household plan is waiting on a payment; update the card in Manage billing', 409);
      const params = {
        mode: 'subscription',
        line_items: [{ price: prices()[plan], quantity: 1 }],
        client_reference_id: String(h.id),
        metadata: { household_id: String(h.id), plan, user_id: String(user.id) },
        success_url: `${back}?paid=1`,
        cancel_url: `${back}?paid=0`,
        allow_promotion_codes: true,
        automatic_tax: { enabled: process.env.STRIPE_TAX !== '0' },
        billing_address_collection: 'auto',
        /* half an hour, Stripe's shortest: a checkout left open in a tab cannot be paid long after the household has moved on */
        expires_at: Math.floor(Date.now() / 1000) + 1800
      };
      params.subscription_data = { metadata: { household_id: String(h.id), plan } };
      /* bought inside the free three weeks: the card is taken now and first charged when they end, so
         the year or month runs from there and no free day is lost. Stripe wants that date at least 48
         hours out; closer than that the plan is charged today, and the app says so (chargeLater()). */
      const te = trialEnd(h);
      if (te && te.getTime() - Date.now() > 49 * 3600000) {
        params.subscription_data.trial_end = Math.floor(te.getTime() / 1000);
        params.metadata.charge_later = '1';
      }
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
      console.log(`billing: checkout household=${h.id} plan=${plan} tax=${params.automatic_tax.enabled} client=${body.client === 'ios' ? 'ios' : 'web'}`);
      return json({ url: session.url });
    }

    if (action === 'portal') {
      if (!h.stripe_customer_id) return fail('Nothing has been bought for this household yet', 404);
      /* the portal shows the card and the invoices: the owner's business, and the payer's */
      if (h.owner_user_id !== user.id && h.paid_by !== user.id) return fail('Only the owner, or whoever paid, can manage billing', 403);
      const body = await req.json().catch(() => ({}));
      const ps = await stripe('POST', '/billing_portal/sessions', { customer: h.stripe_customer_id, return_url: `${body.client === 'ios' ? `${site}/back.html` : `${site}/app/`}?portal=1` });
      return json({ url: ps.url });
    }
    return fail('Not found', 404);
  } catch (e) {
    console.error('api-billing', e);
    return fail('Something went wrong on our side', 500);
  }
}

export const config = { path: ['/api/billing', '/api/billing/*'] };
