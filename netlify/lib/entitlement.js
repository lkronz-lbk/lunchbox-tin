import { sql } from './db.js';

/* The entitlement row is the only truth about a household's plan, and only a way of paying
   writes it: Stripe through its webhook, a beta tester's code through Stripe's checkout, and
   in time the App Store through its server notifications. Each orders its own deliveries
   against its own clock, and none may undo a plan another currently holds.

   This is the writer for Stripe and codes, on Stripe's clock (event_at). Every write is one
   upsert that applies only when
   - the event is not older than the last one applied to the row, so two deliveries racing
     each other are ordered by Postgres, not by us; and
   - the row is not held by a live App Store plan. Stripe's stamps and Apple's cannot be
     compared, so without this a late Stripe delivery (the cancellation of a subscription that
     ended months ago, retried) would pass the check above and wipe a plan the household is
     paying Apple for. It never matches until the App Store writes its first row.
   The App Store's writer belongs beside this one, on apple_event_at, with the same refusal
   the other way round. Returns whether the row was written. */
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
      AND NOT (entitlements.source = 'apple' AND entitlements.status IN ('active', 'past_due'))
    RETURNING household_id`;
  return rows.length > 0;
}
