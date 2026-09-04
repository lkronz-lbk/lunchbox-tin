# Five Boxes

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

Three questions on first run — cold or microwave, what to keep out, how picky — seed a
food list from a 200-item library and produce a planned week immediately. From there:

- **Week** — draws a main, side, fruit and sweet per pack day and *assigns* them to days
  by a deterministic pairing score (texture contrast, protein coverage, heavy/light
  balance, tangy against savory), then explains each day's box in a sentence. Lock a
  compartment and it survives the next shuffle.
- **Shop** — every planned box rolled into one aisle-grouped list across all lunchboxes.
- **Pack** — the next school day as a checklist, with ice-pack, sealed-container and
  no-protein flags. **Kid's pick** lives here: the parent taps "Let Emma pick", the child
  sees two parent-approved pictures per compartment (the draw's choice and the next-best
  pairing), taps one, and hands the phone back. Chosen compartments lock so a re-draw
  can't undo them, and the day records who picked. Every food has an emoji icon derived
  from its name, so custom foods get a picture too.
- **Did they eat it?** — the morning after a pack day, the Pack view asks about
  yesterday's box: ate it / some / came home, per compartment, or "All eaten". Outcomes are
  stored against the food, so they survive re-plans. The draw leans toward foods that get
  eaten, and anything that came home twice running is rested for three weeks. Outgoing weeks
  are archived (`kid.past`) so Monday can still ask about Friday.
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

Every record carries `id`/`createdAt`/`updatedAt`; deletion is a `deletedAt` tombstone,
so a future sync can merge and propagate removals. **All persistence goes through the
`Store` object** — two async methods over `localStorage`. Replacing those two bodies with
`fetch('/api/account')` is the entire backend seam. Schema migrations are keyed by the
version they upgrade *from* (`MIGRATIONS[1]` carries the original single-profile save
forward).

## Before this goes live

- [ ] Replace the placeholder contact address in `public/privacy.html` (`hello@example.com`).
- [ ] Point a real domain at the Netlify site and confirm HTTPS.
- [ ] Check the Netlify **Forms** tab receives a test submission from the waitlist form.
- [ ] Bump `VERSION` in `public/app/sw.js` on any release that changes the app shell,
      or installed home-screen copies will keep serving the old build.

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
onboarding, the week draw, packing, the shopping list, a second lunchbox with its own
rules, export/import (including refusing junk), the v1 → v2 migration, the service
worker, an offline launch, and the landing page. No test framework — one file, one
dependency. CI runs it on every push to `main` or `dev` and on every pull request.

Checks that must pass before launch but shouldn't block day-to-day work print as
`WARN` rather than failing — the placeholder privacy address is currently one.

## The name

The product is **Five Boxes** (a week of school lunches). The repository and directory are
still called `lunchbox-tin` from the working title; rename the GitHub repo whenever
convenient — Netlify follows the rename. Stored data under the old key is read and carried
forward automatically.

## Roadmap

1. **Now** — hosted, installable, free. Measure whether strangers return in week two.
2. **Next** — accounts and sync (Netlify Functions + Neon), swapping out `Store`.
3. **Then** — Stripe Checkout, free tier plus a school-year subscription.
4. **Later, only if the numbers justify it** — a Capacitor iOS wrapper with local
   notifications and a Home Screen widget.
