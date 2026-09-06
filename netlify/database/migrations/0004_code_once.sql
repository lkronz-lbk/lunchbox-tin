-- 0004: the link and the code in one sign-in email are each spent once, on their
-- own: a link opened in the wrong browser must not burn the code the phone needs.
ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS code_used_at TIMESTAMPTZ;
