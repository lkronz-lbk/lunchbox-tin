import { sql } from './db.js';

/* The entitlement row is the only truth about a household's plan, and only a way of paying
   writes it: Stripe through its webhook, a beta tester's code through Stripe's checkout, and the
   App Store through a signed transaction the phone passes on or Apple's own notifications. Each
   orders its own deliveries against its own clock, and none may undo a plan another holds live.

   An App Store plan counts as held only until its end date has passed by more than three days
   (lapsed() in lib/apple.js says the same in JavaScript): a missed notification must not leave it
   blocking the website for good. That condition is written out in each statement below, since a
   tagged sql template sends everything interpolated as a value, never as SQL. */

/* The writer for Stripe and codes, on Stripe's clock (event_at). Every write is one upsert that
   applies only when
   - the event is not older than the last one applied to the row, so two deliveries racing each
     other are ordered by Postgres, not by us; and
   - the row is not held by a live App Store plan. Stripe's stamps and Apple's cannot be compared,
     so without this a late Stripe delivery (the cancellation of a subscription that ended months
     ago, retried) would pass the check above and wipe a plan the household is paying Apple for.
   Returns whether the row was written. */
export async function write(hid, at, v) {
  const rows = await sql()`
    INSERT INTO entitlements (household_id, plan, source, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id, paid_by, event_at, updated_at)
    VALUES (${hid}, ${v.plan}, ${v.source}, ${v.status}, ${v.periodEnd || null}, ${!!v.cancelAtPeriodEnd}, ${v.customer || null}, ${v.subscription || null}, ${v.price || null}, ${v.paidBy || null}, ${at}, now())
    ON CONFLICT (household_id) DO UPDATE SET plan = EXCLUDED.plan,
      source = CASE WHEN ${!!v.keepCode} AND entitlements.source = 'code' AND EXCLUDED.plan <> 'free' THEN 'code' ELSE EXCLUDED.source END,   /* a tester stays a tester through renewals; a real purchase later is a sale */
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, entitlements.stripe_customer_id),
      stripe_subscription_id = EXCLUDED.stripe_subscription_id, stripe_price_id = EXCLUDED.stripe_price_id,
      paid_by = COALESCE(EXCLUDED.paid_by, entitlements.paid_by), event_at = EXCLUDED.event_at, updated_at = now()
    WHERE (entitlements.event_at IS NULL OR entitlements.event_at <= EXCLUDED.event_at)
      AND NOT (entitlements.source = 'apple' AND entitlements.status IN ('active', 'past_due')
               AND (entitlements.current_period_end IS NULL OR entitlements.current_period_end > now() - interval '3 days'))
    RETURNING household_id`;
  return rows.length > 0;
}

/* The writer for the App Store, on Apple's clock (apple_event_at), never compared with Stripe's.
   It applies only when the delivery is not older than the last Apple one applied, and:
   - the row is not held live by the web: a Stripe subscription, a beta code or a comp;
   - forever from the App Store is never lowered by some other purchase, a subscription still
     renewing beside it (Apple cannot cancel one for us, as Stripe can); its own refund may end it;
   - the row, held live by one App Store purchase, is never ended by a lapse or refund of another.
   The last two are also checked in api-apple.js to name the outcome; here they hold even when two
   deliveries race, a Restore linking several purchases at once or a link beside a notification.
   cancelAtPeriodEnd null means the delivery did not say (a transaction from the phone carries no
   renewal info), so the row keeps what the last notification set. paid_by is Stripe's alone: it
   opens the Stripe billing portal, and a purchase through Apple must not open another parent's.
   The unique index on apple_original_transaction_id throws if the purchase is another household's. */
export async function writeApple(hid, at, v) {
  const keepCancel = v.cancelAtPeriodEnd === null || v.cancelAtPeriodEnd === undefined;
  const live = v.status === 'active' || v.status === 'past_due';
  const rows = await sql()`
    INSERT INTO entitlements (household_id, plan, source, status, current_period_end, cancel_at_period_end, apple_original_transaction_id, apple_product_id, apple_event_at, updated_at)
    VALUES (${hid}, ${v.plan}, ${v.source}, ${v.status}, ${v.periodEnd || null}, ${!!v.cancelAtPeriodEnd}, ${v.original}, ${v.product}, ${at}, now())
    ON CONFLICT (household_id) DO UPDATE SET plan = EXCLUDED.plan, source = EXCLUDED.source, status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = CASE WHEN ${keepCancel} THEN entitlements.cancel_at_period_end ELSE EXCLUDED.cancel_at_period_end END,
      apple_original_transaction_id = EXCLUDED.apple_original_transaction_id, apple_product_id = EXCLUDED.apple_product_id,
      apple_event_at = EXCLUDED.apple_event_at, updated_at = now()
    WHERE (entitlements.apple_event_at IS NULL OR entitlements.apple_event_at <= EXCLUDED.apple_event_at)
      AND NOT (entitlements.source IN ('stripe', 'code', 'comp') AND entitlements.status IN ('active', 'past_due'))
      AND NOT (entitlements.source = 'apple' AND entitlements.status IN ('active', 'past_due')
               AND (entitlements.current_period_end IS NULL OR entitlements.current_period_end > now() - interval '3 days')
               AND entitlements.apple_original_transaction_id IS DISTINCT FROM EXCLUDED.apple_original_transaction_id
               AND (NOT ${live} OR (entitlements.plan = 'lifetime' AND EXCLUDED.plan <> 'lifetime')))
    RETURNING household_id`;
  return rows.length > 0;
}
