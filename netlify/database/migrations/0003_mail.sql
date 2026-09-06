-- 0003: reminder emails. A person can stop them with one tap on a link that
-- carries a token only their email ever received; a household is written to
-- once per kind of notice, so a retried job never sends twice.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mail_ok BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mail_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_mail_token_idx ON users (mail_token);

CREATE TABLE IF NOT EXISTS notices (
  household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                       -- trial_ending | trial_ended
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, kind)
);
