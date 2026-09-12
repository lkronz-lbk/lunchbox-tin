-- 0005: how many days each person has used the app. A counter and the day it last
-- counted, on the person's own row, rather than a day-by-day history of anybody: it is
-- what the numbers page needs and nothing more. The day is the New York day, the same
-- day that page reports in.

ALTER TABLE users ADD COLUMN IF NOT EXISTS days_seen INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_day DATE;

-- History, from the only rows that carry it. A session that stayed open for weeks
-- remembers the day it began and the day it was last used and nothing in between, so a
-- count from before this column is a floor, never a total.
UPDATE users u SET days_seen = d.n, last_day = d.last
  FROM (SELECT user_id, count(*)::int AS n, max(day) AS last FROM (
          SELECT user_id, (created_at AT TIME ZONE 'America/New_York')::date AS day FROM sessions
          UNION
          SELECT user_id, (last_used_at AT TIME ZONE 'America/New_York')::date FROM sessions WHERE last_used_at IS NOT NULL
          UNION
          SELECT id, (last_seen_at AT TIME ZONE 'America/New_York')::date FROM users WHERE last_seen_at IS NOT NULL
        ) x GROUP BY user_id) d
  WHERE u.id = d.user_id;
