-- 0002: billing. Stripe writes the entitlement row through the webhook and
-- nothing else does; these columns let it do so idempotently and in order.

ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS paid_by INT REFERENCES users(id) ON DELETE SET NULL;   -- whose card: they and the owner may open the portal
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ;            -- when Stripe created the last event applied here; an older one arriving late is ignored
CREATE INDEX IF NOT EXISTS entitlements_customer_idx ON entitlements (stripe_customer_id);
CREATE INDEX IF NOT EXISTS entitlements_subscription_idx ON entitlements (stripe_subscription_id);

-- every webhook delivery is recorded once, so a retry of one already applied is a no-op
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_events_received_idx ON stripe_events (received_at);
