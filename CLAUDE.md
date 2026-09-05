# CLAUDE.md

## What this is

**Lunch Sorted** (lunchsorted.app, a Lila Bloom Enterprises product): a school-lunch planner for
parents. Plans a week of packed lunches from foods the kid will eat, pairs them, enforces the
school's rules, builds the shopping list, tracks what came home, lets the kid pick between two
pictures. Phone-first PWA today; accounts and sync built; Stripe on the web and a Capacitor iOS
shell next. It was briefly "Five Boxes" and before that "Lunchbox Tin", which the repository is
still named after.

This is its own product with its own repo. It shares nothing with Royalty Ink except the
author and the Netlify + Neon stack. Read `README.md` first; it is the product spec.

## Product rules (never violate)

- The parent is the user. A child only ever sees the kid's-pick screen, handed over by the
  parent, and is never asked for anything. Stay out of Apple's Kids Category and out of COPPA
  scope: nickname or initials are enough, allergens are optional, no analytics SDKs.
- School rules flag foods; they never delete them. A rule change re-checks the live plan.
- Pairing is deterministic (`pairScore`, `bestAssignment`). Randomness lives only in draws.
- A day that has gone is never rewritten by a re-draw. What was packed stays as it was.
- Two "came home" in a row rests a food for three weeks, everywhere a food can be drawn.
- Signed out, everything stays on the phone. Signed in, the household document is the unit
  of sync; merge by record timestamp (`LSMerge`), the local copy wins ties.
- Payments happen on the web, never through the App Store. The entitlement is a row on the
  household; Stripe (and one day StoreKit) only ever flip that row.
- Every user-visible string is written for a parent: no jargon, no IDs, descriptors under
  44px controls, nothing explanatory as a paragraph on screen.

## Commands

```
npm ci
npm run dev           # static server on :8099 (no API)
npm test              # CSP check, then the Playwright smoke suite with an in-process Postgres
npm run csp           # regenerate the CSP hashes in netlify.toml after any change to public/app/index.html
npm run migrate       # apply netlify/database/migrations/*.sql (needs NETLIFY_DATABASE_URL)
```

Run `npm run csp` before every commit that touches the app; `npm test` refuses a stale hash.
Bump `VERSION` in `public/app/sw.js` on every deploy that changes the app.

## Layout

- `public/app/index.html`: the whole app, one file, vanilla JS, three inline script blocks
  (merge rules, the app, service-worker registration). `public/app/sw.js`, `manifest.webmanifest`.
- `public/index.html`, `public/privacy.html`: the site. `public/img/og.png` and the four
  screenshots carry the product name; regenerate them on a rename.
- `netlify/functions/`: `api-auth.js` (magic links, sessions, delete), `api-household.js`
  (document sync, invites, members). `netlify/lib/`: `db.js`, `auth.js`, `mail.js`.
- `netlify/database/migrations/`: numbered SQL, applied by `scripts/migrate.mjs` at build.
- `tests/smoke.mjs`: one file, one command, real browser, real functions against PGlite.
- `scripts/csp.mjs`: generates and checks the Content-Security-Policy in `netlify.toml`.

## Conventions

- Design tokens live in the `:root` blocks of `public/app/index.html`; light and dark are both
  designed. No raw colours outside the token blocks. Tap targets are at least 44px.
- Every entity carries `id`/`createdAt`/`updatedAt`; deletion is a `deletedAt` tombstone;
  event rows carry `at`/`by`. Imports and boot go through `normalizeAccount()`.
- `dev` is the working branch; `main` deploys production; pull requests get previews.
  Merging to `main` is Liz's call.

## Mandatory review before deploy

Before merging to `main`, or when the user says the work is ready, run the reviewer agents in
`.claude/agents/` in parallel without being asked, then present their findings:

- **spec-checker**: always.
- **security-reviewer**: if the change touches `netlify/`, sign-in, sync, imports, or the CSP.
- **ux-reviewer**: if the change touches `public/app/index.html` markup or CSS, or the site.
- **efficiency-reviewer**: if the change adds a function, a query, a fetch, a cron, or a build step.

Do not deploy with unresolved findings unless the user waves them off.
