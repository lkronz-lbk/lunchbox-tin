-- 0005: one row per person per day they had the app open, so the numbers page can
-- count days in the app instead of guessing from the session rows. The day is the
-- New York day, the same day the numbers page reports in.

CREATE TABLE IF NOT EXISTS user_days (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- History, from the only rows that carry it. A session that stayed open for weeks
-- remembers the day it began and the day it was last used and nothing in between,
-- so a day count from before this table is a floor, never a total.
INSERT INTO user_days (user_id, day)
  SELECT user_id, (created_at AT TIME ZONE 'America/New_York')::date FROM sessions
  ON CONFLICT DO NOTHING;
INSERT INTO user_days (user_id, day)
  SELECT user_id, (last_used_at AT TIME ZONE 'America/New_York')::date FROM sessions WHERE last_used_at IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO user_days (user_id, day)
  SELECT id, (last_seen_at AT TIME ZONE 'America/New_York')::date FROM users WHERE last_seen_at IS NOT NULL
  ON CONFLICT DO NOTHING;
