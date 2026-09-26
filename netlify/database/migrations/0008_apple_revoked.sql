-- 0008: every App Store transaction Apple has refunded or revoked, by its own id.
-- Kept apart from the household on purpose: a refund that arrives before the phone
-- has told us about the purchase, or a household deleted after one, must still stop
-- that transaction being linked again. Only the transaction is barred, not the
-- purchase: a subscription bought again later is a new transaction.
CREATE TABLE IF NOT EXISTS apple_revoked (
  transaction_id          TEXT PRIMARY KEY,
  original_transaction_id TEXT NOT NULL,
  revoked_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
