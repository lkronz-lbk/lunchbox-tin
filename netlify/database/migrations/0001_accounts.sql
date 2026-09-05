-- 0001: accounts, households, sync, invites, entitlements
-- One household document per household (the same JSON the app keeps on the
-- phone), versioned so two phones can never overwrite each other blind.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

-- magic links and sessions store only a hash of the secret, so a database
-- read never yields a usable token
CREATE TABLE magic_links (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX magic_links_email_idx ON magic_links (email, created_at);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'web',          -- web (cookie) | native (bearer)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE households (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT 'My household',
  owner_user_id  INT NOT NULL REFERENCES users(id),
  doc            JSONB,                              -- the account document; null until the first push
  version        INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'adult',        -- owner | adult | helper
  member_id    TEXT NOT NULL,                        -- this person's member id inside the document
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);
CREATE UNIQUE INDEX household_members_user_idx ON household_members (user_id);   -- one household per person, for now

CREATE TABLE invites (
  code_hash    TEXT PRIMARY KEY,
  household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'adult',
  created_by   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_by      INT REFERENCES users(id) ON DELETE SET NULL,
  used_at      TIMESTAMPTZ
);

CREATE TABLE entitlements (
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
CREATE TABLE rate_events (
  key TEXT NOT NULL,
  at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rate_events_key_idx ON rate_events (key, at);
