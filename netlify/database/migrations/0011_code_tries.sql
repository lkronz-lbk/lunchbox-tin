-- 0011: a sign-in code counts its own wrong tries, on its link row. Eight spend it (CODE_TRIES in
-- netlify/lib/auth.js), counted one at a time however many arrive together, and a try at an address
-- with no code waiting writes nothing anywhere. Until now the count was a row in rate_events keyed on
-- the address, which a stranger could write for any address at all. Nothing reads the column until
-- the code that uses it is live, and the old code never touches it.
-- And the throttle counts from before they were kept under a digest go: their keys hold an email
-- address, and nothing reads them any more. Any the old code writes while this deploy builds go with
-- the sweep a day later.
ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS code_tries INT NOT NULL DEFAULT 0;
DELETE FROM rate_events WHERE key LIKE 'link:%@%' OR key LIKE 'code:%@%';
