# CLAUDE.md

## What this is

**Lunch Sorted** (lunchsorted.app, a Lila Bloom Enterprises product): a school-lunch planner for
parents. Plans a week of packed lunches from foods the kid will eat, pairs them, enforces the
school's rules, builds the shopping list, tracks what came home, lets the kid pick which of the
week's boxes is next. Phone-first PWA; accounts, sync, Stripe on the web and a Capacitor iOS shell built;
TestFlight next. It was briefly "Five Boxes" and before that "Lunchbox Tin", which the repository is
still named after.

This is its own product with its own repo. It shares nothing with Royalty Ink except the
author and the Netlify + Neon stack. Read `README.md` first; it is the product spec.

## Product rules (never violate)

- The parent is the user. A child only ever sees the kid's-pick screen, handed over by the
  parent, and is never asked for anything. Stay out of Apple's Kids Category and out of COPPA
  scope: nickname or initials are enough, allergens are optional, no analytics SDKs.
- School rules flag foods; they never delete them. A rule change re-checks the live plan. A
  parent may override a rule for one compartment; it stays flagged, ends when that food leaves
  the compartment, and travels with the food when the kid's pick trades it.
- Pairing is deterministic (`pairScore`, `bestAssignment`). Randomness lives only in draws.
- Lunchboxes are aligned, never merged. Plan the week starts every box from the lead box's
  foods and swaps only where a box's own rules or its own food list say otherwise; a
  per-lunchbox shuffle or a single swap never reaches the other boxes.
- A day that has gone — any day before today, and today from 3pm once the box is home — is
  never rewritten by a re-draw, a swap, the kid's pick, a rules sweep or a merge. What was packed stays.
- Two "came home" in a row rests a food for three weeks, everywhere a food can be drawn —
  including the aligned draw. The rule's own exception: a list too short to fill the week may
  draw a resting food rather than leave a compartment empty.
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
npm run shots         # regenerate public/img/screen-*.png|webp (needs `npm run dev` running)
npm run migrate       # apply netlify/database/migrations/*.sql (needs NETLIFY_DATABASE_URL)
```

Run `npm run csp` before every commit that touches the app; `npm test` refuses a stale hash.
Bump `VERSION` in `public/app/sw.js` and `APP_BUILD` in `public/app/index.html` on every deploy that changes the app, and write that build's `WHATS_NEW` line beside `APP_BUILD` (`npm run csp` refuses a stale one).

## Before any change, on every machine

Work lands on `main` from more than one place — this machine, and Claude on Liz's phone — so a
checkout can be days behind without anything looking wrong. The multi-lunchbox work of
2026-09-10 was built on a `dev` that was 69 commits behind production and could not be merged.
Never again:

1. `git fetch origin` first, every session, before reading any code.
2. Bring local `main` level: `git branch -f main origin/main` (or `git pull --ff-only` on it).
   Everything pushed from the phone must come back onto this machine.
3. Build only on a branch that contains `origin/main`. If `dev` is behind, bring it level first
   (`git merge --ff-only origin/main` from `dev`). If that refuses, `dev` has diverged: stop and
   say so rather than build on it.
4. Commit before the session ends. Uncommitted work left across sessions interleaves with the
   next session's and cannot be split apart afterwards.

## Layout

- `public/app/index.html`: the whole app, one file, vanilla JS, three inline script blocks
  (merge rules, the app, service-worker registration). `public/app/sw.js`, `manifest.webmanifest`.
- `public/index.html`, `public/privacy.html`, `public/terms.html`: the site. `public/img/og.png` and the four
  screenshots carry the product name; regenerate them on a rename.
- `netlify/functions/`: `api-auth.js` (magic links, sessions, delete), `api-household.js`
  (document sync, invites, members), `api-billing.js` (Stripe checkout, portal, webhook),
  `cron-trial.js` (the daily reminder emails, scheduled, production only), `api-admin.js`
  (the numbers page at `/admin`, for `ADMIN_EMAILS`), `api-recipe.js` (reads a recipe off a page
  a parent found — https only, named public hosts only, nothing returned that is not a recipe).
  `netlify/lib/`: `db.js`, `auth.js`, `mail.js`, `stripe.js`, `trial.js`.
- `netlify/database/migrations/`: numbered SQL, applied by `scripts/migrate.mjs` at build.
- `ios/`: the Capacitor iPhone shell (Swift Package Manager, no CocoaPods); `capacitor.config.json`
  points it at the live app; `ios-www/` is the placeholder web directory Capacitor insists on;
  `public/back.html` hands a parent back from Stripe in Safari. `ios/README.md` has the build,
  TestFlight and universal-link steps. `.github/workflows/ios.yml` compiles it on a macOS runner; `testflight.yml` archives, signs and uploads it.
- `store/`: the App Store listing (`listing.md`: every field, the privacy answers, the review
  notes) and its screenshots, made by `scripts/store-shots.mjs` + `scripts/store-compose.py`
  with the two brand fonts checked in beside them (both SIL Open Font License).
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
- **release-reviewer**: if the change alters what a parent sees or how the app behaves — it checks
  the marketing screenshots in `public/img/`, the in-app `helpSheet()` and `public/help.html`, and
  drafts the replacements.

Do not deploy with unresolved findings unless the user waves them off.
