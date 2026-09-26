-- 0006: the App Store as a second way to pay. The entitlement row stays the only
-- truth about a household's plan, and Apple, like Stripe, only ever writes it.
-- source was written for this in 0001. The values in use are none, stripe, code
-- (a beta tester on a 100%-off code), comp and, from here, apple.

-- an App Store subscription keeps one original transaction id for its whole life,
-- across every renewal; the product id says which plan it is
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS apple_product_id TEXT;

-- Apple's clock, kept apart from Stripe's. event_at orders Stripe's deliveries
-- among themselves and apple_event_at orders Apple's. The two services' stamps
-- cannot be compared with each other, which is why lib/entitlement.js also refuses
-- to let one source overwrite a plan the other currently holds.
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS apple_event_at TIMESTAMPTZ;

-- one App Store subscription unlocks exactly one household. Without this, one
-- Apple ID restoring into household after household would unlock every one.
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_apple_txn_key ON entitlements (apple_original_transaction_id) WHERE apple_original_transaction_id IS NOT NULL;

-- every App Store Server Notification is recorded once, by its notificationUUID,
-- so a retry of one already applied is a no-op
CREATE TABLE IF NOT EXISTS apple_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS apple_events_received_idx ON apple_events (received_at);
