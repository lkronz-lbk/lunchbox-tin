import { sql, json, fail, siteUrl, throttled, milestone, recentKeys, mark, unmark } from '../lib/db.js';
import { codeMatches, betaCap, betaCount } from '../lib/beta.js';
import { currentUser } from '../lib/auth.js';
import { billingEnabled, isProduction, prices, priceInfo, stripe, verifyWebhook, periodEnd, subscriptionStatus, cancelSubscription, withinTime } from '../lib/stripe.js';
import { write, cancelAndForget } from '../lib/entitlement.js';
import { appleLive, lapsed } from '../lib/apple.js';
import { chargeLaterUntil } from '../lib/trial.js';

/* Payment happens on Stripe's own page; this side only opens the door and
   listens for the answer. Nothing the browser sends can grant a plan: the
   entitlement row is written by the webhook alone.
   GET  /api/billing                    -> {enabled, prices}   public, cacheable
   POST /api/billing/checkout {plan}    -> {url}  Stripe Checkout for this household (owner or adult)
   POST /api/billing/portal             -> {url}  Stripe's customer portal: card, invoices, cancel (owner, or whoever paid)
   POST /api/billing/webhook            -> Stripe, signed                                              */

const PLANS = { year: 'household', lifetime: 'lifetime' };
const STRIPE_STATES = ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];
const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded']);

async function membership(userId) {
  const rows = await sql()`
    SELECT h.id, h.owner_user_id, h.created_at, h.trial_extra_days, h.doc->>'createdAt' AS doc_created, m.role, e.plan, e.status, e.source, e.current_period_end, e.stripe_customer_id, e.stripe_subscription_id, e.paid_by
    FROM household_members m JOIN households h ON h.id = m.household_id
    LEFT JOIN entitlements e ON e.household_id = h.id WHERE m.user_id = ${userId}`;
  return rows[0] || null;
}

/* ---- the webhook ---- */
const idOf = (v) => typeof v === 'string' ? v : v && v.id;
/* forever held on the row: the beta's, a code's, a purchase's, or the App Store's while it lasts (a
   sandbox one lapses, and the website sells the plan again, as checkout below decides) */
const foreverHeld = (r) => !!r && r.plan === 'lifetime' && r.status === 'active' && !(r.source === 'apple' && lapsed(r.current_period_end));
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

  if (ev.type === 'checkout.session.expired') {
    /* the session is gone at Stripe: its mark goes too, so nobody is told someone is paying */
    const hid = await household(obj.client_reference_id || (obj.metadata && obj.metadata.household_id));
    if (!hid) return 'no household';
    for (const k of await recentKeys(`checkout:${hid}:`, 1800)) if (k.split(':').slice(3).join(':') === obj.id) await unmark(k);
    return 'closed';
  }
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') return 'unpaid';   /* a bank debit still clearing: the succeeded event follows */
    const hid = await household(obj.client_reference_id || (obj.metadata && obj.metadata.household_id));
    if (!hid) return 'no household';
    /* paid: any other checkout still open for the household is closed at Stripe, so two parents who
       tapped within the same second cannot both pay; then the household's marks are cleared */
    for (const k of await recentKeys(`checkout:${hid}:`, 1800)) {
      const sid = k.split(':').slice(3).join(':');
      if (sid && sid !== obj.id) { try { await stripe('POST', `/checkout/sessions/${sid}/expire`, {}); } catch (e) { console.error('billing: could not close the other checkout', sid, e.message); } }
    }
    await unmark(`checkout:${hid}:`);
    const cust = idOf(obj.customer);
    const paidBy = Number(obj.metadata && obj.metadata.user_id) || null;
    const plan = PLANS[obj.metadata && obj.metadata.plan] || (obj.mode === 'payment' ? 'lifetime' : 'household');
    /* nothing charged: a 100%-off code (the beta testers), which the admin page lists. A plan bought
       inside the three weeks is also $0 today, charged when they end: a sale, unless its code is the
       100%-off one, which only the coupon itself can say */
    const deferred = !!(obj.metadata && obj.metadata.charge_later);
    const source = obj.amount_total !== 0 ? 'stripe' : !deferred ? 'code' : (await fullyOff(obj)) ? 'code' : 'stripe';
    const [cur] = await q`SELECT plan, status, source, current_period_end, stripe_subscription_id FROM entitlements WHERE household_id = ${hid}`;
    const oldSub = cur && cur.stripe_subscription_id;
    if (plan === 'lifetime') {
      const ok = await write(hid, at, { plan: 'lifetime', source, status: 'active', customer: cust, subscription: null, price: prices().lifetime, paidBy, charged: obj.payment_status === 'paid' });
      /* a yearly plan bought before this one stops at its period end, so nobody pays twice */
      if (ok && oldSub) { try { await stripe('POST', `/subscriptions/${oldSub}`, { cancel_at_period_end: true }); } catch (e) { console.error('billing: could not stop the old subscription', oldSub, e.message); } }
      return ok ? 'applied' : 'stale';
    }
    if (foreverHeld(cur)) {
      /* forever already, which a yearly checkout cannot lower. One paid after the forever was written (a
         checkout left open in a tab while the beta was claimed) would charge for nothing every year, with
         nothing on the row to name it: it is ended now and its payment given back, as for the App Store below */
      const late = idOf(obj.subscription);
      return late ? undoCheckout(obj, late, 'the household had forever') : 'lifetime kept';
    }
    const subId = idOf(obj.subscription);
    /* the subscription's own dates come with it, so the plan line has its renewal date from the
       first moment and the subscription.created event, which may carry an earlier stamp, is not needed */
    let sub = null;
    if (subId) { try { sub = await withinTime(3000, () => stripe('GET', `/subscriptions/${subId}`)); } catch (e) { console.error('billing: could not read', subId, e.message); } }   /* three seconds at most: the replaced subscription's cancel below must keep its time */
    const ok = await write(hid, at, { plan: 'household', source, status: sub ? subscriptionStatus(sub) : 'active', periodEnd: periodEnd(sub),
      cancelAtPeriodEnd: sub && sub.cancel_at_period_end, customer: cust, subscription: subId, price: prices()[obj.metadata && obj.metadata.plan === 'month' ? 'month' : 'year'] || null, paidBy,
      charged: obj.payment_status === 'paid', keepForever: true });   /* $0 today inside the three weeks: charged later, on the subscription's own event */
    /* a second subscription for the same household (a card that failed, then a fresh checkout) replaces the first */
    if (ok && oldSub && subId && oldSub !== subId && !(await cancelSubscription(oldSub))) console.error('billing: CANCEL BY HAND', oldSub, 'replaced by', subId);
    if (!ok) {
      /* paid on the web once the household held the plan another way: through the App Store (a
         checkout left open in a tab, then the iPhone), or forever, the beta's claimed while this event
         was on its way (between the read above and this write). The row stays as it is, so this
         subscription would charge for nothing, and with nothing on the row nobody could cancel it. It
         is ended now and its payment given back. */
      const [row] = await q`SELECT plan, status, source, current_period_end FROM entitlements WHERE household_id = ${hid}`;
      if (appleLive(row) && subId) return undoCheckout(obj, subId, 'the App Store held the plan');
      if (foreverHeld(row) && subId) return undoCheckout(obj, subId, 'the household had forever');
    }
    return ok ? 'applied' : 'stale';
  }

  if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
    const hid = await householdFor(obj);
    if (!hid) return 'no household';
    const [cur] = await q`SELECT plan, status, source, current_period_end, stripe_subscription_id FROM entitlements WHERE household_id = ${hid}`;
    /* only a subscription that is this household's own: its metadata names the household, or the row names it. One
       found only through the customer (made in the dashboard, or for anything else sold on this Stripe account) is
       left to the rules below */
    const ours = (obj.metadata && String(obj.metadata.household_id) === String(hid)) || (!!cur && cur.stripe_subscription_id === obj.id);
    if (ours && (foreverHeld(cur) || appleLive(cur))) {
      /* forever held, or a plan the App Store holds: the website sells no plan over either, so a Stripe subscription
         beside one only bills for nothing. One winding down (an old yearly after a forever bought through Stripe)
         changes nothing. One still able to charge (left by a beta claim before claims cancelled them, or a first
         charge Stripe was still retrying when the household bought on the iPhone) is read at Stripe, since this
         event may be an old one, and cancelled, the log asking for its last charge to be looked at (a checkout's own
         is refunded by its undo when that runs, but a retried undo decides afresh). If Stripe cannot say, or will
         not cancel it, the event goes back to Stripe to be tried again */
      const kept = foreverHeld(cur) ? 'lifetime kept' : 'the App Store holds it';
      /* an App Store plan past its end, inside the three days it is held while Apple's word is awaited, may not be
         renewed: the event goes back to Stripe rather than cancel beside a plan the household could be left
         without, its deleted event too, so that once the plan lapses an older event cannot be written over the
         ending. Stripe's retries only roughly outlast the three days, so each wait says BY HAND */
      if (cur.source === 'apple' && cur.current_period_end && Date.parse(cur.current_period_end) < Date.now())
        throw new Error(`CHECK BY HAND if Stripe stops retrying: ${obj.id} waits beside an App Store plan past its end`);
      if (ev.type === 'customer.subscription.deleted') return kept;
      let now = null, noRecord = false;
      try { now = await stripe('GET', `/subscriptions/${obj.id}`); } catch (e) { if (!(e.status === 404 && e.code === 'resource_missing')) throw e; noRecord = true; }
      if (noRecord) return kept;
      if (!(now && typeof now === 'object' && STRIPE_STATES.includes(now.status))) throw new Error(`no state for ${obj.id} beside a plan held another way`);
      /* winding down only while it has nothing left to collect: one set to end at its period end that Stripe is still
         retrying (a first charge that failed, then Cancel pressed in the portal) can still go through */
      if (['canceled', 'incomplete_expired', 'incomplete'].includes(now.status) || (now.cancel_at_period_end && (now.status === 'active' || now.status === 'trialing'))) return kept;
      /* said before the cancel, whatever its outcome, so a retry that finds it cancelled loses nothing */
      if (now.status === 'active' || now.status === 'past_due') console.error('billing: CHECK BY HAND the last charge of', obj.id, 'cancelled: it was charging beside a plan held another way');
      if (!(await cancelSubscription(obj.id))) throw new Error(`CANCEL BY HAND ${obj.id}: still able to charge beside a plan held another way`);
      return kept + ', its subscription cancelled';
    }
    if (cur && cur.stripe_subscription_id && cur.stripe_subscription_id !== obj.id) return 'other subscription';   /* an older one of the same customer */
    if (appleLive(cur)) {
      /* the household pays Apple for the plan, and write() turns this news away. One still able to charge, with
         no end set (an App Store purchase came while Stripe was retrying its first charge, and could not cancel it
         then), would bill the household beside Apple: it is cancelled, and if the event says a charge went through
         (active), the log asks for it to be looked at. If Stripe will not cancel it, the event goes back to Stripe
         to be tried again */
      if (ev.type === 'customer.subscription.deleted' || obj.cancel_at_period_end || ['canceled', 'incomplete_expired'].includes(obj.status)) return 'App Store kept';
      if (!(await cancelAndForget(hid, obj.id))) throw new Error(`CANCEL BY HAND ${obj.id}: still able to charge beside the App Store`);
      if (obj.status === 'active') console.error('billing: CHECK BY HAND the last charge of', obj.id, 'cancelled: it was charging beside the App Store');
      return 'App Store kept, its subscription cancelled';
    }
    const status = ev.type === 'customer.subscription.deleted' ? 'canceled' : subscriptionStatus(obj);
    const price = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
    const ok = await write(hid, at, { plan: status === 'canceled' ? 'free' : 'household', source: status === 'canceled' ? 'none' : 'stripe', status,
      periodEnd: periodEnd(obj), cancelAtPeriodEnd: obj.cancel_at_period_end, customer: idOf(obj.customer), subscription: obj.id, price, keepCode: true, keepForever: true,
      charged: obj.status === 'active' || obj.status === 'past_due' });   /* trialing has charged nothing yet */
    return ok ? 'applied' : 'stale';
  }

  if (ev.type === 'charge.refunded') {
    /* a forever purchase refunded in full is a forever purchase undone; a yearly refund is
       paired with cancelling the subscription in the dashboard, which arrives as its own event.
       Only a forever bought through Stripe took money through Stripe (Apple's own refund ends one
       bought there). The beta's, or a 100%-off code's, charged nothing, but keeps the customer of
       anything bought before, so a charge of that customer refunded now is an earlier one, and the
       forever stays */
    if (!obj.refunded) return 'partial';
    const hid = await householdFor(obj);
    if (!hid) return 'no household';
    const [cur] = await q`SELECT plan, source FROM entitlements WHERE household_id = ${hid}`;
    if (!cur || cur.plan !== 'lifetime') return 'not lifetime';
    if (cur.source !== 'stripe') return 'not a Stripe sale';
    const ok = await write(hid, at, { plan: 'free', source: 'none', status: 'canceled', customer: idOf(obj.customer), subscription: null, price: null });
    return ok ? 'applied' : 'stale';
  }
  return 'skipped';
}

/* whether a checkout carried a code that takes the whole price off */
async function fullyOff(obj) {
  for (const d of (Array.isArray(obj.discounts) ? obj.discounts : [])) {
    let c = d && d.coupon;
    try {
      if (typeof c === 'string') c = await stripe('GET', `/coupons/${c}`);
      else if (!c && d && d.promotion_code) { const p = await stripe('GET', `/promotion_codes/${idOf(d.promotion_code)}`); c = p && (p.coupon || (p.promotion && p.promotion.coupon)); if (typeof c === 'string') c = await stripe('GET', `/coupons/${c}`); }
    } catch (e) { console.error('billing: could not read a code on', obj.id, e.message); c = null; }
    if (c && Number(c.percent_off) === 100) return true;
  }
  return false;
}

/* a web checkout paid for a household that already holds the plan another way: the subscription it
   started would charge for nothing, with nothing on the row to name it, so it is ended and its payment
   given back. What could not be done is logged, and said in the outcome, to be done by hand */
async function undoCheckout(obj, subId, held) {
  const ended = await cancelSubscription(subId), refunded = await refundCheckout(obj, held);
  if (!ended) console.error('billing: CANCEL BY HAND', subId, 'paid while', held);
  /* one bought inside the three weeks charged nothing at checkout, but undone more than 48 hours after it (Stripe's
     floor for the first charge; webhooks failing that long), its first charge may have been taken since */
  const late = !obj.amount_total && !!(obj.metadata && obj.metadata.charge_later) && Number(obj.created) > 0 && Date.now() / 1000 - obj.created > 48 * 3600;
  if (late) console.error('billing: CHECK BY HAND for a first charge on', subId, 'paid while', held);
  const outcome = `${ended ? 'canceled' : 'CANCEL BY HAND'}, ${!refunded ? 'REFUND BY HAND' : obj.amount_total ? 'refunded' : late ? 'CHECK BY HAND for a first charge since' : 'nothing charged at checkout'}: ${held}`;
  /* not finished: the event goes back to Stripe, which delivers it again, and the undo runs again. A second go
     repeats nothing: a cancel already made answers no such subscription, and the refund carries its idempotency
     key, or, a day on, finds its charge already refunded */
  if (!ended || !refunded) throw new Error(outcome);
  return outcome;
}

/* gives back what a checkout charged, through the invoice it paid; older Stripe accounts name the
   payment on the invoice, newer ones list it under invoice_payments. Returns whether it was refunded. */
async function refundCheckout(obj, held) {
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
  } catch (e) {
    if (e.code === 'charge_already_refunded') return true;   /* an earlier go at the same undo, past the key's day */
    console.error('billing: REFUND BY HAND, checkout', obj.id, 'paid while', held + ':', e.message); return false;
  }
}

/* every Stripe call a billing request makes shares one eight-second budget, inside Netlify's ten (lib/stripe.js) */
export default function handler(req, context) { return withinTime(8000, () => serve(req, context)); }

async function serve(req, context) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const action = parts[parts.length - 1] === 'billing' ? '' : parts[parts.length - 1];
  try {
    if (req.method === 'GET' && !action) {
      if (!billingEnabled()) return json({ enabled: false }, 200, { 'cache-control': 'public, max-age=300' });
      let p = null; try { p = await priceInfo(); } catch (e) { console.error('billing: prices', e.message); }
      /* without prices the gates still stand and the button says "Yearly plan"; with one of them
         missing the others still show. Either way, ask again soon */
      const whole = !!p && Object.entries(prices()).every(([k, id]) => !id || p[k]);
      return json({ enabled: true, prices: p, since: process.env.BILLING_SINCE || null }, 200, { 'cache-control': whole ? 'public, max-age=3600' : 'public, max-age=60' });
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
      /* an event counts as seen once it has been applied, so one that failed, or whose function was ended
         halfway, is delivered again by Stripe and applied for real. Applying one twice repeats nothing:
         writes are ordered by the event's own stamp, a second cancel answers no such subscription, a
         refund carries its idempotency key, and a milestone is kept once */
      const [already] = await sql()`SELECT 1 AS seen FROM stripe_events WHERE id = ${ev.id}`;
      if (already) return json({ received: true, duplicate: true });
      const outcome = await applyEvent(ev);
      await sql()`INSERT INTO stripe_events (id, type) VALUES (${ev.id}, ${ev.type}) ON CONFLICT (id) DO NOTHING`;
      console.log(`billing: ${ev.type} ${ev.id} -> ${outcome}`);
      if (Math.random() < 0.05) await sql()`DELETE FROM stripe_events WHERE received_at < now() - interval '30 days'`;
      return json({ received: true });
    }

    if (req.method !== 'POST' || !['checkout', 'portal', 'beta', 'close'].includes(action)) return fail('Not found', 404);
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
      /* the plan held already, forever or through the App Store. A Stripe subscription still on the row is one
         an App Store purchase could not cancel when it came (a first charge Stripe was retrying reads as ended):
         it is tried again here, and the answer is the same either way */
      if ((foreverHeld(h) || appleLive(h)) && h.stripe_subscription_id && !(await cancelAndForget(h.id, h.stripe_subscription_id))) console.error('billing: CANCEL BY HAND', h.stripe_subscription_id, 'beside a plan held another way');
      if (foreverHeld(h)) return json({ ok: true, already: true });
      if (appleLive(h)) return fail('This household pays through the App Store on an iPhone; the plan is managed there', 409, { apple: true });
      /* a household paying for the Household plan is a customer, not a tester: the card would go on being charged */
      if (h.stripe_subscription_id && (h.status === 'active' || h.status === 'past_due')) return fail('This household already has the Household plan', 409, { paying: true });
      /* two claims in the same instant can both pass this count and land at cap + 1: fine for a hand-shared link and a cap of 25 */
      if (await betaCount() >= betaCap()) return fail('The beta is full', 409, { full: true });
      /* a subscription still on the row can still charge: a first charge that failed when the three
         weeks ended reads as ended here while Stripe goes on retrying the card, and a retry that went
         through after the claim would bill the forever every year, with nothing left on the row to
         find it by. Stripe's word decides, since the row can be behind it: a plan Stripe says is paid
         for, or a renewal it is retrying, is refused as above; one that has ended, or that Stripe has
         no record of, is left; anything else is cancelled first. If Stripe cannot say, the claim waits */
      const sub = h.stripe_subscription_id;
      if (sub) {
        let atStripe = null, noRecord = false;
        try { atStripe = await stripe('GET', `/subscriptions/${sub}`); }
        catch (e) { if (!(e.status === 404 && e.code === 'resource_missing')) { console.error('billing: beta could not read', sub, e.message); return fail('Try again in a moment', 503); } noRecord = true; }
        /* an answer that does not say which of Stripe's states it is in is no answer: nothing is cancelled on a guess */
        const said = atStripe && typeof atStripe === 'object' ? atStripe.status : atStripe, state = atStripe && typeof atStripe === 'object' ? said : undefined;
        if (!noRecord && !STRIPE_STATES.includes(state)) { console.error('billing: beta could not read', sub, 'state:', String(JSON.stringify(said)).slice(0, 40)); return fail('Try again in a moment', 503); }
        if (!noRecord && state !== 'canceled' && state !== 'incomplete_expired') {
          if (subscriptionStatus(atStripe) !== 'canceled') return fail('This household already has the Household plan', 409, { paying: true });
          if (!(await cancelSubscription(sub))) { console.log(`billing: beta household=${h.id} waits: ${sub} could not be cancelled`); return fail('Try again in a moment', 503); }
        }
      }
      /* over the row as it was read: a checkout that lands meanwhile makes the write miss, and the next
         try meets the refusal above. Whoever claims is not made the payer: that opens another parent's
         card and invoices in the portal, and an earlier payer's stays theirs */
      const ok = await write(h.id, new Date().toISOString(), { plan: 'lifetime', source: 'code', status: 'active', customer: h.stripe_customer_id || null, subscription: null, price: null, expectSub: sub || null });
      console.log(`billing: beta household=${h.id} ${ok ? 'on' : 'stale'}`);
      if (!ok) return fail('Try again in a moment', 503);                /* a Stripe event stamped ahead of our clock, or a checkout just landed: the code stays on the phone */
      return json({ ok: true });
    }
    const site = siteUrl(req);

    /* backing out of Stripe: the caller's own open checkout is closed at once, so the other parent
       is not told someone is paying for the half hour the session would otherwise live */
    if (action === 'close') {
      const mine = (await recentKeys(`checkout:${h.id}:`, 1800)).filter(k => k.split(':')[2] === String(user.id));
      for (const k of mine) {
        const sid = k.split(':').slice(3).join(':');
        if (sid) { try { await stripe('POST', `/checkout/sessions/${sid}/expire`, {}); } catch (e) { console.error('billing: could not close the checkout', sid, e.message); } }
        await unmark(k);
      }
      return json({ closed: mine.length });
    }

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
      /* one checkout at a time for a household: both parents paying on the last day would leave one
         subscription cancelling the other with no refund. Another member's checkout, still open, is
         refused; this member's own is closed at Stripe and replaced, so backing out and trying again works. */
      const open = await recentKeys(`checkout:${h.id}:`, 1800);
      if (open.some(k => k.split(':')[2] !== String(user.id))) return fail('The other parent is paying right now \u2014 the plan switches on when they finish', 409, { open: true });
      for (const k of open) {
        const sid = k.split(':').slice(3).join(':');
        if (sid) { try { await stripe('POST', `/checkout/sessions/${sid}/expire`, {}); } catch (e) { console.error('billing: could not close the earlier checkout', sid, e.message); } }
      }
      if (open.length) await unmark(`checkout:${h.id}:`);
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
      const later = chargeLaterUntil(h);
      if (later) {
        params.subscription_data.trial_end = Math.floor(new Date(later).getTime() / 1000);
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
      await mark(`checkout:${h.id}:${user.id}:${session.id}`);
      await milestone(h.id, 'checkout');
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
