-- 0005: the words on the marketing pages. One row per edited slot; a slot with
-- no row here shows whatever is written in public/*.html, so the committed HTML
-- stays the source of truth and the database only ever holds the differences.

CREATE TABLE IF NOT EXISTS site_copy (
  key        TEXT PRIMARY KEY,                                   -- the data-copy name in the page, e.g. home.hero.title
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL
);

-- when the words were last put on the site, so the editor can say whether an
-- edit is still waiting for a deploy
CREATE TABLE IF NOT EXISTS site_meta (
  key TEXT PRIMARY KEY,
  at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
