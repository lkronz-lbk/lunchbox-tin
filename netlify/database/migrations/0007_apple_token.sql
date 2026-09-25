-- 0007: the token the iPhone app hands the App Store with every purchase. Apple
-- returns it in every transaction and every notification, so a notification can
-- be matched to its household even when it arrives before the phone has told us
-- about the purchase. Each household gets its own from the moment its row exists.
-- Kept apart from 0006, which a branch deploy may already have applied to staging.
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS apple_account_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_apple_token_key ON entitlements (apple_account_token);
