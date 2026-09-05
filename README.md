# Lunch Sorted

Plan a week of packed school lunches in about a minute. A static site: a marketing
page, and an installable offline web app. No build step, no framework, no server.

- **Landing page** — `public/index.html`
- **The app** — `public/app/index.html` (one self-contained file: markup, styles, logic)
- **PWA** — `public/app/manifest.webmanifest`, `public/app/sw.js`, icons in `public/icons/`
- **Deploy** — Netlify, publish directory `public`, no build command

## Running it locally

```
cd public && python3 -m http.server 8099
# then open http://127.0.0.1:8099/
```

A plain `file://` open works for the app too, but the service worker and manifest
need to be served over http, so use the server when testing install or offline.

## What the app does

A name and three questions on first run — cold or microwave, what to keep out, how picky — seed a
food list from a 200-item library and produce a planned week immediately. From there:

- **Week** — draws a main, side, fruit and sweet per pack day and *assigns* them to days
  by a deterministic pairing score (texture contrast, protein coverage, heavy/light
  balance, tangy against savory), then explains each day's box in a sentence. Keep a
  compartment and it survives the next shuffle; re-drawing that one compartment on purpose
  un-keeps it.
- **Shop** — every planned box rolled into one aisle-grouped list across all lunchboxes.
- **Pack** — the next school day as a checklist, with ice-pack, sealed-container and
  no-protein flags. **Kid's pick** lives here: the parent taps "Let Emma pick", the child
  sees two parent-approved pictures per compartment (the draw's choice, and the next-best
  by pairing score then eat history — for the main, by eat history alone; no randomness,
  and never a food that is resting), taps one, and
  hands the phone back. Each choice is saved the moment it is made, so stopping early
  keeps what was chosen. Chosen compartments lock so a re-draw can't undo them; the day
  records the adult who handed the phone over, marked `picker: 'kid'`. A manual swap or
  re-draw clears the mark. Every food has an emoji icon derived
  from its name, so custom foods get a picture too.
- **Did they eat it?** — the morning after a pack day, the Pack view asks about
  yesterday's box: ate it / some / came home, per compartment, or "All eaten". Outcomes are
  stored against the food, so they survive re-plans. The draw leans toward foods that get
  eaten, and anything that came home twice running is rested for three weeks. Outgoing weeks
  are archived (`kid.past`) so Monday can still ask about Friday.
- **Safety** — anything pasted in or read from storage is rebuilt from a whitelist before it
  becomes state, so a bad import can never brick the app; a save the app can't read is kept
  under a dated backup key rather than overwritten; "Clear the plans" and "Erase everything"
  are two-tap, deleting a food offers Undo, and the shopping ticks survive a plan clear.
- **Rules re-check the plan.** Changing any rule sweeps the week on screen: a food that now
  breaks a rule leaves its compartment — locked, kid-picked or not — and the compartment is
  drawn again, with a toast saying how many changed. Switching a compartment off clears it
  from the live week and the shopping list; past weeks keep it for history.
- **Anchoring.** A new plan goes into this week while at least two pack days (today included)
  are still ahead and only covers the days still to come; otherwise it goes into next week. An
  existing plan is re-drawn in place until its last day has gone by, and a re-draw never touches
  a day that has already gone: what was packed stays exactly as it was, for the review and the
  pack ticks. The shopping list likewise skips days already gone. The morning review only asks about a
  day the plan already existed on, or that had something ticked into the bag.
- **Setup** — lunchboxes, pack days, and per-lunchbox school rules: cold-only, no ice pack,
  short eating time, no chocolate or candy, allergen exclusions (including seeds & sesame),
  and a free-text avoid list. Optional **snack** and **drink** compartments per lunchbox:
  switching one on seeds a few foods and fills the current week, so the tin never grows an
  empty cell. Copy-out/paste-in transfer between phones lives here too.

## Data model

Built for more than one user from the start, though it runs today with no accounts:

```
account            one household — a server only ever has to filter by account id
├── members[]      the adults who use it; per-person actions record `by: memberId`
├── kids[]         lunchbox profiles, each with its OWN rules, foods, week, pack state
└── pantry{}       household-wide, keyed by normalized food name
```

Every entity (account, member, lunchbox, food, week) carries `id`/`createdAt`/`updatedAt`;
event rows (packed ticks, pantry ticks, eat answers, kid picks) carry `at`/`by`. Deletion is a
`deletedAt` tombstone (kept for ninety days; `prune()` also drops packed ticks from before the
current week and eat answers older than a year, so the document stays bounded),
so a future sync can merge and propagate removals. **All persistence goes through the
`Store` object** — two async methods over `localStorage`. Replacing those two bodies with
`fetch('/api/account')` is the entire backend seam. Schema migrations are keyed by the
version they upgrade *from* (`MIGRATIONS[1]` carries the original single-profile save
forward).

## Before this goes live

- [x] Contact address on the privacy page: hello@lunchsorted.app.
- [x] Domain: lunchsorted.app (the og:image and canonical URLs point at it).
- [ ] Import the repo into Netlify, attach the domain, confirm HTTPS; set
      `STAGING_DATABASE_URL` for branch deploys and previews, `RESEND_API_KEY` and
      `MAIL_FROM` for sign-in email.
- [ ] Check the Netlify **Forms** tab receives a test submission from the waitlist form.
- [ ] Run `npm run csp` after any change to `public/app/index.html` (the test suite refuses
      a stale hash), and bump `VERSION` in `public/app/sw.js` when icons, the manifest or the
      fonts change. The shell itself refreshes one launch behind a deploy without a bump.

## Environments

| Context | Branch | Where it lands |
| --- | --- | --- |
| Production | `main` | the live site |
| Staging | `dev` | `dev--<site>.netlify.app` |
| Preview | any pull request | a throwaway URL per PR |

Work on `dev`, look at the staging URL on a real phone, then open a PR into `main`.
Netlify marks staging and preview deploys `noindex`, so they never compete with the
live marketing page in search results.

`netlify.toml` carries a per-context environment block. It does nothing today —
there is no build step — but it is the seam that matters later: when the backend and
Stripe arrive, the test keys and staging database URL go there, and production
credentials never reach a pull request preview.

**Netlify setup, once:** Site configuration → Build & deploy → Branches and deploy
contexts → add `dev` as a branch deploy, and leave Deploy Previews on.

## Tests

```
npm install
npx playwright install chromium
npm test
```

`tests/smoke.mjs` starts its own static server and drives a real browser: first-run
onboarding, the week draw and its pairing notes, packing, the kid's pick, the morning review
and resting, the school rules re-checking a live plan, compartments switching on and off,
anchoring, the shopping list, a second lunchbox with its own rules, export/import (including
refusing junk, hostile ids and a save it cannot read), the v1 → v2 migration, pruning, the
generated CSP, the service worker, an offline launch, and the landing page. No test framework — one file, one
dependency. CI runs it on every push to `main` or `dev` and on every pull request.

Checks that must pass before launch but shouldn't block day-to-day work print as
`WARN` rather than failing — the placeholder privacy address is currently one.

## The name

The product is **Lunch Sorted**. It was briefly Five Boxes and, before that, Lunchbox Tin,
which the repository and directory are still named after; rename the GitHub repo whenever
convenient — Netlify follows the rename. Stored data under either earlier key is read and
carried forward automatically, exports from either name still import, and the tin stays as
the visual identity.

## Roadmap

1. **Now** — hosted, installable, free. Measure whether strangers return in week two.
2. **Built, not yet switched on** — accounts and sync (below). Needs a database and a
   mail sender in the Netlify environment.
3. **Then** — Stripe Checkout on the web, writing the household's entitlement row.
4. **Then** — a Capacitor iOS shell on the US storefront, with the night-before reminder,
   share sheet and a Home Screen widget; payments stay on the web.

## Accounts and sync

Signed out, the app is exactly the phone-only app it always was. Signed in, the household
document also lives on the server, versioned, and every phone in the household reads and
writes the same one.

- **Sign-in** is an email (`POST /api/auth/request`) carrying a link and a short code. The
  link opens a page with one button, so a mail scanner that follows links cannot spend it;
  the button posts to `/api/auth/verify` with a nonce the page set in a cookie, so a form
  posted from anywhere else is refused. The code (`POST /api/auth/code`) signs in the phone
  where the app is installed when the link would open in another browser. Both work once,
  for fifteen minutes. Sessions are HttpOnly cookies for 180 days; links, codes and
  sessions are stored as hashes. No passwords anywhere.
- **Households** (`/api/household`): one document per household with a version number.
  `PUT` with the version you last saw; if the server has moved on you get `409` with its
  copy, merge, and try again. The merge rules are the first script block in
  `public/app/index.html` (`window.LSMerge`): newer `updatedAt` wins per record, a newer
  deletion beats an older edit, packed and eat and pantry ticks merge by their own `at`
  stamps (an un-tick is a row marked `off`, so it travels too; a review row's stamp is its
  latest answer), the newer plan wins day by day except that a day already gone keeps the
  plan that existed on it, lists come out in a fixed order so both phones compute the same
  document, and the local copy wins ties. The test suite runs the block on its own. A push
  that fails is retried three times with growing waits, then waits for the next change;
  returning to the app pulls if the last sync is more than thirty seconds old.
- **Members**: owner, parent (adult), helper. An invite (`POST /api/household/invite`) is a
  link that works once, for a week; opening it lands at the top of Setup with the sign-in
  card and the inviter's name. A phone that already has lunches brings them into the
  household when it joins, and keeps the member it already was. A helper receives only the
  plan, the foods in it and the ticks (no rules, allergens, history or addresses), cannot
  push (the server refuses, and the app says "Only a parent can change the plan"), and
  their ticks stay on their phone.
- **Leaving** a household leaves the lunches with it: the phone starts fresh in its own
  empty household. Being removed signs that person's phones out; whatever is on their phone
  stays there. **Delete my account** removes the household from the server and from that
  phone, and cannot be undone.
- **Environment**: production reads `NETLIFY_DATABASE_URL` (Netlify DB / Neon); branch
  deploys and previews read `STAGING_DATABASE_URL` and refuse to run without it, so they
  can never touch production data or migrate it. `RESEND_API_KEY` and `MAIL_FROM` send the
  emails; without a key, production refuses and a deploy with `DEV_LINKS=1` (or the test
  suite) returns the link and code to the caller instead. `SITE_ENV` is set per context.
  `node scripts/migrate.mjs` applies `netlify/database/migrations/*.sql` once each as the
  build command; every statement is idempotent, so a half-applied file is harmless.
  Housekeeping (expired links, sessions and invites, old rate-limit rows) rides along with
  about one request in twenty-five.
- **Tests** run the same functions in-process against PGlite, an in-memory Postgres, and
  drive three browser contexts through sign-in by link and by code, a forged sign-in form,
  invite, joining with lunches of one's own, an edit on each phone, an un-tick round trip,
  a helper's refused push, sign-out and delete, plus the merge rules on their own.
