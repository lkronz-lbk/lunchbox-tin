-- 0009 (written as 0006 on dev, renumbered when dev met main's 0006_storekit: Netlify refuses two of one number): two small tables for the people who look after the app rather than the people who
-- use it. Neither holds a lunch, a food, a name or an address.
--
-- milestones: one row a household a moment on the way from a sign-up to a paid plan, so
-- "of the households that signed up in September, how many planned a week, came back in
-- week two, opened a checkout, paid" is one query rather than a guess. The kinds:
--   signed_up     the household row was made (backfilled from households.created_at: exact)
--   first_plan    the first push whose document held a planned week
--   week_two      the household reached the server between seven and fourteen days old
--   second_phone  someone joined it on an invite
--   checkout      a Stripe checkout page was opened for it
--   paid          Stripe first reported it paid (backfilled from the entitlement's last
--                 event, so a household paying before this migration carries an
--                 approximate date, never an earlier one than the truth)
-- The first of each kind is kept and later ones ignored; a household's rows go with it.
--
-- app_errors: what the planner reports when its own code breaks: the message, where in the
-- code, the build, the browser type and the time. No session is read and no household is
-- named. Rows older than thirty days go with the rest of the housekeeping (netlify/lib/db.js).

CREATE TABLE IF NOT EXISTS milestones (
  household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, kind)
);
CREATE INDEX IF NOT EXISTS milestones_kind_at_idx ON milestones (kind, at);

INSERT INTO milestones (household_id, kind, at)
  SELECT id, 'signed_up', created_at FROM households
  ON CONFLICT DO NOTHING;
INSERT INTO milestones (household_id, kind, at)
  SELECT household_id, 'paid', COALESCE(event_at, updated_at) FROM entitlements
  WHERE (source = 'stripe' AND status IN ('active', 'past_due'))
     OR (status = 'canceled' AND stripe_customer_id IS NOT NULL)
  ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS app_errors (
  id      SERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  build   TEXT NOT NULL,
  kind    TEXT NOT NULL,                     -- error | rejection
  message TEXT NOT NULL,
  place   TEXT,                              -- path:line:column inside the app
  stack   TEXT,
  agent   TEXT                               -- the browser type, as the phone reports it
);
CREATE INDEX IF NOT EXISTS app_errors_at_idx ON app_errors (at);
