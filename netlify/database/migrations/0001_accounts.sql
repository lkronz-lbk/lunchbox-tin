-- 0001: accounts, households, sync, invites, entitlements
-- One household document per household (the same JSON the app keeps on the
-- phone), versioned so two phones can never overwrite each other blind.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

-- magic links and sessions store only a hash of the secret, so a database
-- read never yields a usable token
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash  TEXT PRIMARY KEY,
  code_hash   TEXT,                                  -- the short code in the same email, for a phone that cannot open the link in the app
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS magic_links_email_idx ON magic_links (email, created_at);
CREATE INDEX IF NOT EXISTS magic_links_expires_idx ON magic_links (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'web',          -- web (cookie) | native (bearer)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS households (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT 'My household',
  owner_user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc            JSONB,                              -- the account document; null until the first push
  version        INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'adult',        -- owner | adult | helper
  member_id    TEXT NOT NULL,                        -- this person's member id inside the document
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS household_members_user_idx ON household_members (user_id);   -- one household per person, for now

CREATE TABLE IF NOT EXISTS invites (
  code_hash    TEXT PRIMARY KEY,
  household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'adult',
  created_by   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_by      INT REFERENCES users(id) ON DELETE SET NULL,
  used_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invites_expires_idx ON invites (expires_at);
CREATE INDEX IF NOT EXISTS invites_household_idx ON invites (household_id);
CREATE INDEX IF NOT EXISTS invites_created_by_idx ON invites (created_by);
CREATE INDEX IF NOT EXISTS invites_used_by_idx ON invites (used_by);
CREATE INDEX IF NOT EXISTS households_owner_idx ON households (owner_user_id);
CREATE INDEX IF NOT EXISTS magic_links_code_idx ON magic_links (email, code_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS entitlements (
  household_id           INT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free',      -- free | household | lifetime
  source                 TEXT NOT NULL DEFAULT 'none',      -- none | stripe | apple | comp
  status                 TEXT NOT NULL DEFAULT 'none',      -- none | active | past_due | canceled
  current_period_end     TIMESTAMPTZ,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- throttling that survives function cold starts
CREATE TABLE IF NOT EXISTS rate_events (
  key TEXT NOT NULL,
  at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_events_key_idx ON rate_events (key, at);
CREATE INDEX IF NOT EXISTS rate_events_at_idx ON rate_events (at);
