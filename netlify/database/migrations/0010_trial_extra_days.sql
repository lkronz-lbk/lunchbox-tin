-- 0010: days added to one household's three weeks, by hand, for a household that needs longer
-- (an App Review account, a parent who was ill). The trial is still computed, never stored: its
-- end is the household's birthday plus 21 days plus these. Nothing in the app or the API writes
-- it; only the owner of the database does, with
--   UPDATE households SET trial_extra_days = trial_extra_days + 7 WHERE id = <household>
ALTER TABLE households ADD COLUMN IF NOT EXISTS trial_extra_days INT NOT NULL DEFAULT 0 CHECK (trial_extra_days BETWEEN 0 AND 365);
