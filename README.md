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
  balance, tangy against savory); each compartment carries the words the pairing used
  (crunchy, soft, protein, tangy, sweet, salty, juicy, hearty, light), two at most. Keep a
  compartment and it survives the next shuffle; shuffling that one compartment on purpose
  un-keeps it. Every compartment that can change shows a small swap arrow; a kept one, a lock.
- **More than one lunchbox** — Plan the week draws them together: the fullest food list leads,
  and every other box starts from the same foods, swapping only where that box's school rules or
  its own food list say otherwise. Shuffling one box, or swapping one compartment, changes that
  box alone. Turn it off under Account → Lunchboxes (**Match the boxes**), or the gear. Pack, Week and Foods carry the
  lunchboxes as folder tabs, one tap each; on Pack each tab shows whether that box is packed or
  still owes an answer, and one line names who is left to pack. With matching on, Shuffle all
  on Week is the household draw; with more than one box, Shuffle all on Week and a day's Shuffle first ask
  whose boxes (a day's starts with the box on screen), leave the rest untouched, and offer Undo; the
  "Plan the week" banner draws everything with no sheet. A food added from the
  idea bank or by hand goes into every lunchbox unless you say otherwise; a box whose rules keep
  it out is skipped and named when another box takes it, and gets it flagged when it is the only
  box. The "Add it to" choice sticks for the rest of the session. A lunchbox filled with "Fill the
  list for me" is planned on its own until the next Plan the week matches it in; the toast after
  Plan the week says how many compartments had to differ.
- **Plan ahead** — one more week (`kid.next`), reached by the Next button beside the week's date, drawn and
  shuffled like this one, listed on Shop under *Next week*, and rolled into `kid.week` the moment this
  week has gone. Pack, the kid's pick and the review read only this week. Merged and normalised like
  the first week.
- **Shop** — every planned box rolled into one aisle-grouped list across all lunchboxes. A dish
  goes on the list as what you buy for it (`buy` on the food: turkey and cheese pinwheels are
  deli turkey, cheese slices and tortillas; `ING_AISLE` puts each part in its aisle), one line
  per thing with a count, and the dishes it is for underneath. Bank foods carry their lists,
  a food seeded before lists existed takes the bank's, and "Add your own" asks for one.
  **Copy** puts the list on the clipboard grouped by aisle; the share button opens the phone’s share
  sheet (Notes, Reminders, a text) where there is one, the browser's on the web and the
  Share plugin in the iPhone app.
- **Recipes** — the sixth tab, and the household's, not a lunchbox's: one list however
  many kids are packed for, so it carries no lunchbox tabs. What the household has kept
  sits above the idea bank's seventy, with a search that matches a name or an ingredient
  ("oats" for what is in the cupboard) and a row that opens straight into cooking. The
  bank's are free to cook from, food list or no food list; keeping one of your own is
  the Household plan. A recipe is a record on the account (`S.recipes[]`: `n`, minutes,
  what it makes, ingredient lines, steps, where it came from, plus the usual
  `id`/`createdAt`/`updatedAt`/`deletedAt`), and a food points at one with `recipeId`
  rather than carrying a copy — so the same dish in three lunchboxes is three pointers
  to one record, and changing it changes it everywhere. It merges by `unionById` like
  members and lunchboxes, and `pruneRecipes()` drops tombstones at ninety days. A
  document written by v17, with the recipe still on the food, is lifted on the way
  through `normalizeAccount`: one library record per food name, however many boxes held
  it. A food resolves to a recipe by `recipeId`, then the library by name, then the
  bank's by name — the same fallback `buy` uses. A recipe of the household's named after
  a bank dish replaces the bank's row on the tab; removing yours brings it back. Keeping
  one points every same-named food at it, in every lunchbox, with an Undo. The cap is 300
  records (`RECIPES_MAX`), and the byte ceiling bites first: a removed recipe keeps only
  its name and its tombstone, so it stops riding every sync. The lift's id is worked out
  from the name (`liftedId`), not minted at random, so two phones normalising the same v17
  document agree on it and the merge collapses them instead of keeping both.
- **Cooking one** — **Cook it step by step** is one step on the screen at a time with a
  progress bar, the ingredients behind a summary, and a box to tick per ingredient —
  none of which is written to the document, because a half-made recipe is not something
  the other phone needs. **Cups or grams** converts what can honestly be converted, both
  ways: a cup of a thing whose density we know is weighed, a pourable thing is given in
  millilitres, an oven set in Fahrenheit carries its Celsius, anything under about 15 g
  stays a spoonful, a cup of cherry tomatoes stays a cup, and a recipe written in grams
  reads back in cups. The + and − change how much it makes — lunches for the app's own
  mains, whatever the recipe counted in for anything else — and scale every amount,
  rounded to the eighths a measuring cup is marked in. Amounts are stored as the text a
  recipe writes (`parseIng` reads the number and the unit off the front), so a line the
  app cannot read is shown exactly as written rather than mangled. The cups-or-grams
  choice is kept on the phone (`lunchsorted-units`), not in the household document.
  The recipe also reaches a parent where they need it: a **Recipe** tag on the Foods
  list, a button on the compartment sheet on Week, and named under the box on Pack.
- **Importing a recipe** — `Recipes → Import a recipe`, gated because it writes to the
  household; the idea bank stays free. Two ways in. The address of a recipe page goes to
  `POST /api/recipe`, which reads the schema.org JSON-LD the page already publishes for
  search engines, the microdata under that, and failing both the article itself — an
  "Ingredients" heading and the list under it, which is how a great many recipes are
  published, a shop's blog post among them — and returns the parts and nothing else —
  not the page, not its headers — so the function is no use as a proxy. It asks for a
  session, which is what keeps the privacy page's promise that signed out nothing you
  type leaves the phone, and gives the throttle an account to count rather than an
  address anyone can rotate. It opens only https, only a named host on the public web,
  reads every resolved address as bytes and refuses the private, loopback, link-local
  and multicast ones in every notation they can be written in, re-checks at each
  redirect, caps the body it reads and the time it takes, bounds the parser so a page
  cannot make reading it expensive, and answers every failure in the same words so it is
  not a map of someone else's network. A video has no recipe to read, so the second way
  is pasting the words under it: the same parser runs on the phone with no network,
  reading a title, `Serves 4`, `Prep 10 minutes`, ingredient lines and numbered steps out
  of a caption. What comes back is named and kept on the Recipes tab; putting it on a
  lunchbox's food list is offered afterwards rather than done, and only then are the
  compartment, aisle, shopping line and allergens guessed and shown for the parent to
  correct, because the school rules go by them.
- **Pack** — the next school day's box with ice-pack, sealed-container and no-protein
  flags, and one **Packed** check per box that fills every compartment at once (the packed
  rows stay per compartment underneath, so sync and the other phone are unchanged). The
  compartments there are not buttons: only Week changes a box, and only Week shows the swap
  arrows. **Kid's pick** lives here, behind the lunchbox's "They pick their box
  each day" switch (Household plan), for the next box not yet in the bag. Two ways, chosen
  under "How they pick" and both trading within the week already shopped for, so nothing
  is drawn and the shopping list never changes: **Each part** (the default) asks for each
  compartment in turn (main, side, fruit, sweet, and snack or drink if the box has them), this day's food against the same part of a later
  box, and choosing the other trades those two parts between the days; each choice is
  saved as it is made, so stopping early keeps it. **Whole box** shows this day's box
  against the next one, and choosing the other trades the whole days. A box with anything
  already in the bag is never offered or traded. What the kid chose locks against a shuffle
  and is marked `picker: 'kid'` with the adult who handed the phone over; the part or box
  the kid passed on loses its mark. A manual swap or shuffle clears the mark. Both ways are
  in for the beta testers to compare; one may go. In the iPhone app a "Remind us the night
  before" switch with a time (on by default at 6pm beside the kid's say, household settings)
  schedules a local notification only on evenings before one of that lunchbox's pack days
  that still has a box to pick. A food can carry a **photo** of the real thing, for the
  kid who cannot read yet: the thumbnail on the Foods tab opens the camera or the roll, the
  phone shrinks the picture to a 192-pixel square JPEG under 16 KB (`food.img`, a data URL,
  re-checked on every import and merge), and the kid's-pick screens and the Foods list show
  it in place of the emoji; tapping it again offers "Take another" or "Remove the photo".
  Every food has an emoji icon derived from its name, so
  custom foods get a picture too. A household that packs the night before (Account →
  Lunchboxes → **When do you pack?**) sees tomorrow's box from 3pm.
- **Did they eat it?** — from 3pm on a pack day, or the morning after, the Pack view asks about
  that box: ate it / some / came home, per compartment, or "All eaten". Outcomes are
  stored against the food, so they survive re-plans. "Answer later" replaces the card with a one-line "Answer now" until the next
  3pm or the next open; a red dot on the Pack tab says an answer is owed, and the iPhone app can
  remind at 3pm (Account → Lunchboxes → **Remind us at three**, off until switched on). From 3pm today's box has gone:
  no re-draw, swap, kid's pick, shopping line or merge touches it. The draw leans toward foods that get
  eaten, and anything that came home twice running is rested for three weeks. Outgoing weeks
  are archived (`kid.past`) so Monday can still ask about Friday.
- **Safety** — anything pasted in or read from storage is rebuilt from a whitelist before it
  becomes state, so a bad import can never brick the app; a save the app can't read is kept
  under a dated backup key rather than overwritten; "Clear the plans" and, signed out, "Erase everything"
  are two-tap, deleting a food offers Undo, and the shopping checks survive a plan clear.
- **A parent may override a rule** for one compartment: pick a flagged food from the
  compartment sheet and it goes in, rule named, with Undo. The compartment carries a `!`, the day
  an *Against the rules* chip, and the rules sweep leaves it alone. The override is recorded
  against that exact food in that compartment (`day.over`), so a re-draw, another choice, the food
  deleted or the compartment switched off ends it; when the kid's pick trades a part or a box, it
  travels with its food.
- **Rules re-check the plan.** Changing any rule sweeps the week on screen: a food that now
  breaks a rule leaves its compartment — locked, kid-picked or not — and the compartment is
  drawn again, with a toast saying how many changed. Switching a compartment off clears it
  from the live week and the shopping list; past weeks keep it for history.
- **Anchoring.** A new plan goes into this week while at least two pack days (today included)
  are still ahead and only covers the days still to come; otherwise it goes into next week. An
  existing plan is re-drawn in place until its last day has gone by, and a shuffle never touches
  a day that has already gone: what was packed stays exactly as it was, for the review and the
  pack checks. The shopping list likewise skips days already gone. The morning review only asks about a
  day the plan already existed on, or that had something checked into the bag.
- **Lunchbox settings** — the gear beside the lunchbox name on Week, Pack, Shop and Foods:
  lunchboxes, name, pack days, per-lunchbox school rules (cold-only, no ice pack, short
  eating time, no chocolate or candy), allergen exclusions (including seeds & sesame), a
  free-text avoid list, the kid's say. Optional **snack** and **drink** compartments per
  lunchbox: switching one on seeds a few foods and fills the current week, so the tin never
  grows an empty cell.
- **Account** — the sixth tab is a short list of rows, each opening its own page over the
  tab with a Done button that comes back to the row it left. **Account** (or **This phone**
  signed out): who this phone is signed in as, sign out, leave the household, backup and
  copy-out/paste-in transfer between phones, clear the plans, delete the account, and
  — only on a phone that has never signed in — erase everything.
  **Household**: the people, your name, and the two invites. **Subscription** (only where
  Stripe is configured, and never for a caretaker): the plan, what it costs while there is
  something to pay, the date it
  renews or ends, and how to stop it. **Lunchboxes**: the lunchbox settings, the same page
  the gear opens. **Contact support**: the help sheet, the same one the ? opens. Signed out
  the sign-in card stays on the tab itself, because that is the one thing that tab is for
  and a `?join=` link lands there. The open page is `UI.pane`, which never reaches the
  account document, so a tap is never read as a change; `paneOK()` is the single test for
  whether a pane may be on screen and the render asks it too, because a pane is opened by a
  link from an email and by the return from Stripe as well as by a tap.

## Data model

Built for more than one user from the start, though it runs today with no accounts:

```
account            one household — a server only ever has to filter by account id
├── members[]      the adults who use it; per-person actions record `by: memberId`
├── kids[]         lunchbox profiles, each with its OWN rules, foods, week, pack state
├── recipes[]      household-wide: the recipe library; a food points at one by id
├── align          household-wide: {on, updatedAt} — draw every lunchbox from the same foods
└── pantry{}       household-wide, keyed by normalized food name
```

The account carries `tz`, the IANA zone of the phone that made it (a joining phone never
moves it), so the server's emails say dates in the household's own day; a household from
before the zone was kept learns it from its next change, and one that never says is read
as the East Coast.

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
- [x] Import the repo into Netlify, attach the domain; `dev` as a branch deploy, previews on.
- [x] Neon project with `production` and `staging` branches; `NETLIFY_DATABASE_URL` and
      `STAGING_DATABASE_URL` scoped to their contexts.
- [x] Resend: `mail.lunchsorted.app` verified, `RESEND_API_KEY` and `MAIL_FROM` set.
- [x] Stripe: product and three prices in test and live mode, a webhook endpoint per mode,
      keys, secrets and price ids scoped per context (Billing, below).
- [ ] Confirm HTTPS covers `www.lunchsorted.app` as well as the apex.
- [ ] On the staging URL, `curl -sI https://<staging>/api/billing` must show one
      `cache-control: public, max-age=…` line; if Netlify's `/api/*` header rule reaches
      function responses instead, every app open becomes a function call (remove that rule).
- [ ] Check the Netlify **Forms** tab receives a test submission from the waitlist form.
- [ ] Reshoot the marketing and store screenshots on a machine that can reach
      fonts.gstatic.com. The bottom bar shows five tabs in the three marketing shots that
      include it: `public/img/screen-week.*`, `screen-pack.*` and `screen-shop.*`.
      `screen-kidpick.*` is the handover screen and has no bar; the six
      `store/screenshots/*.png` and the three `public/img/mail-day*.png` are all cropped
      above it, so none of those nine is wrong about the tab. Separately stale:
      `screen-pack.*` and `store/screenshots/02-pack.png` (the box now carries a
      "Making it?" row) and `06-foods.png` (the Foods rows now carry a Recipe tag).
      Add a Recipes shot to both sets — `public/img/screen-recipes.png|webp` as a fifth
      figure on the site (widen `.shots` to `repeat(5,1fr)`), and
      `store/screenshots/07-recipes.png` as a seventh store slot. `npm run dev`, then
      `npm run shots`; `node scripts/store-shots.mjs` for the store set. Shot where the
      fonts cannot load, they come out in the fallback face.
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

`netlify.toml` carries a per-context environment block that sets `SITE_ENV` for the build;
Netlify does not pass toml variables to functions, so `SITE_ENV` is also set in the Netlify
UI per context (`production`, `staging`, `preview`), and the code falls back to Netlify's
`CONTEXT` variable if it is missing. The keys themselves live in the Netlify UI, scoped by
deploy context. That is the seam that
matters: production reads its own database and its live Stripe key, and neither can reach
a branch deploy or a pull request preview. The build refuses a Stripe key scoped to the
wrong context.

**Netlify setup, once:** Site configuration → Build & deploy → Branches and deploy
contexts → add `dev` as a branch deploy, and leave Deploy Previews on.

## Tests

```
npm install
npx playwright install chromium
npm test
```

Every browser the suite opens has its clock pinned to the most recent Tuesday, so the week it
plans is the same week whatever day it runs on (a Thursday used to leave the kid's pick with
nothing to offer). `SMOKE_TODAY=2026-09-14 npm test` pins another day.

`tests/smoke.mjs` starts its own static server and drives a real browser: first-run
onboarding, the week draw and its trait words, packing, the kid's pick, the morning review
and resting, the school rules re-checking a live plan, compartments switching on and off,
anchoring, the shopping list, recipes (the bank's own, cook mode, the measures and the scaling,
reading a page's markup, the page reader refusing anything but the public web, a pasted caption,
and a hostile recipe rendered as words), a second lunchbox with its own rules, export/import (including
refusing junk, hostile ids and a save it cannot read), the v1 → v2 migration, pruning, the
generated CSP, the service worker, an offline launch, the landing page, accounts and sync
(below), and billing: the key guard, webhook signatures, a checkout, every webhook event the
code handles including a redelivery after a failure and one arriving out of order, the
gates, the plan line, cancellation, forever, a refund, who may manage billing, a deleted
account stopping its subscription, the onboarding email step, the welcome email, the daily
reminder job and its stop link, the pricing section on the landing page, and the iPhone
app's paths: a checkout that returns through `/back.html`, that page under its own policy,
and a phone that identifies as the app leading with the code and never being told to add
itself to the Home Screen. The browser never downloads fonts, so a run takes about two minutes. No test framework — one file, one dependency. CI runs it on every push to `main` or `dev` and on every pull request.

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
3. **Built, behind the same switch** — Stripe Checkout on the web (below). Needs the four
   `STRIPE_*` variables per context and a webhook endpoint registered in Stripe.
4. **Built** — the Capacitor iOS shell (`ios/`, `ios/README.md`) for the US storefront: it
   loads the web app, opens Stripe in Safari and takes the parent back through `/back.html`,
   builds on CI without a Mac, with the night-before kid's-pick reminder (6pm by default), and
   `testflight.yml` archives, signs and uploads it from an App Store Connect key. Next for it: the first TestFlight build, then the share
   sheet and a Home Screen widget; payments stay on the web.

- **Help** — the ? at the top of every tab opens a sheet: fifteen one-line answers, "Ask a
  question" (the feedback email with the build and phone filled in) and "More answers", which
  is `public/help.html`, the longer FAQ on the site (linked from the site footer).

### Migrations are frozen once applied

Netlify checks every applied migration file against what it ran, byte for byte, and a
deploy that changes one fails ("has been modified after being applied"): comments included.
A change to the schema, or to a comment, is a new numbered file.

### Beta testers

Feedback lands in one place: `public/feedback.html` is a Netlify form (email, what they were
doing, what happened, would they keep it) that posts to `/thanks.html`; submissions are under
Forms in the Netlify dashboard, which can email each one. The help sheet's "Send feedback"
and the site footer point at it. `cron-tester.js` sends every beta household three short
emails in its first week (days 1, 3, 6 after it switched on; `notices` kinds `tester_1/3/6`),
each in Liz's voice with one feature, the steps, a screenshot (`public/img/mail-day*.png`, made by
`scripts/mail-shots.mjs`; rerun it when those screens change) and the form; the last one lists
`PLANNED` (mail.js) and asks what they would add. The form asks the same: an ideas box and the
planned list as check boxes. "No more of these" is honored.


`/beta` (netlify/functions/beta.js; `/tester` is the short link with a source tag for GA4) is the page to hand out: it shows the spots left and one
button into the app with the code from `BETA_CODE` (Netlify env, per context). The app keeps the
code on the phone until a parent is signed in, then `POST /api/billing/beta` switches the
household to forever for good, refused once `BETA_CAP` (default 25; 0 closes it) households
carry `source = 'code'`. A household that checks out with a 100%-off Stripe code (TESTER) is
written the same way and kept so through later Stripe events; `/admin` lists them under
"Beta testers", a row a person rather than a row a household, beside the "Standard users"
roster of everyone else.

### Releasing an app change

Bump `APP_BUILD` in `public/app/index.html` and `VERSION` in `public/app/sw.js` together, and
write that build's `WHATS_NEW` line beside them: one sentence a parent sees once, on the first
open after the update, with an OK (a phone new to the app is never shown it). `npm run csp`
refuses a build whose note names an older build, so the note cannot be forgotten; set the
text to `''` for a release with nothing to say.

### Backlog (ideas to revisit, not scheduled)

- **Home-cooked or store-bought.** Setup asks whether sides and sweets are mostly cooked at
  home or bought ready-made. A family that never bakes should not be offered a slice of
  zucchini bread unless there is a store-bought equivalent to recommend in its place; foods
  carry a `homemade` flag and a suggested packaged stand-in.
- **Shopping-list hand-off.** The share sheet covers Notes, Reminders and a text; next an
  Instacart / Walmart cart, so the shop happens where the family already shops.
- **Rated products.** Pull in product ratings (Yuka or similar) so the packaged suggestions
  above lean toward well-rated items, and flag a poorly rated pantry staple with an
  alternative.
- **A quality score, and macros.** Two ideas that need research before design. A per-box
  quality score the draw could aim for, without brand names or a barcode scanner (bloat
  we do not need at launch): whole foods against processed ones, or a healthy spread of
  macros for the child's age range, shown as one mark a parent can switch off. And the
  Yuka-style approach of scoring named products from Open Food Facts, which needs the
  scanner and real brands, so later if at all. Questions to settle first: what a
  defensible score is for a child's lunch (age bands, the school-day share of daily
  intake), whether the 200-food library can carry a whole/processed flag honestly, and
  how not to become "not medical advice" territory.
- **Macros and medical diets.** Per-kid targets (carbs, protein, calories, sodium) and a
  per-day tally, for children with diabetes, allergies beyond avoidance, or a prescribed
  diet. Needs nutrition data per food, portion sizes, and a clear "not medical advice"
  line.
- **What the morning review is called.** The app and the emails both call it the morning
  review, but it asks once the box is home, not the next morning, and the tester emails now
  say "after your kid gets home". Settle on one name and change it everywhere at once: the
  paywall line and the help sheet in `public/app/index.html`, the welcome and both trial
  emails in `netlify/lib/mail.js`, the site, and the store listing.

## Accounts and sync

Signed out, the app is exactly the phone-only app it always was. Signed in, the household
document also lives on the server, versioned, and every phone in the household reads and
writes the same one.

- **Sign-in** is an email (`POST /api/auth/request`) carrying a link and a short code. The
  link opens a page with one button, so a mail scanner that follows links cannot spend it;
  the button posts to `/api/auth/verify` with a nonce the page set in a cookie, so a form
  posted from anywhere else is refused. The code (`POST /api/auth/code`) signs in the phone
  where the app is installed when the link would open in another browser. Each works once,
  on its own, for fifteen minutes: a link opened in the wrong browser does not spend the code.
  On a phone with the iPhone app installed the link opens the app itself, because
  `public/.well-known/apple-app-site-association` claims that one route and its token and
  nothing else; a join link, a Stripe return and the planner on a home screen all stay in
  Safari. If the device is already signed in as someone else, the page says so and names
  both, because carrying on would join that phone's week to the other household.
  A browser the link signs in that has never built a week says so and points back to the
  code, and never pushes its empty household over the phone that did. Sessions are HttpOnly cookies for 180 days; links, codes and
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
  link that works once, for a week; opening it lands at the top of the Account tab with the sign-in
  card and the inviter's name. A phone that already has lunches brings them into the
  household when it joins, and keeps the member it already was. A helper receives only the
  plan, the foods in it and the ticks (no rules, allergens, history or addresses), cannot
  push (the server refuses, and the app says "Only a parent can change the plan"), and
  their ticks stay on their phone.
- **Leaving** a household leaves the lunches with it: the phone starts fresh in its own
  empty household. Being removed signs that person's phones out; whatever is on their phone
  stays there. **Delete my account and data** — the only irreversible control, gated on
  typing DELETE rather than a second tap, and the only destructive one offered at all once
  signed in, because a document that belongs to the household cannot be erased from one
  phone — removes the household from the server and from that
  phone, and cannot be undone.
- **Environment**: production reads `NETLIFY_DATABASE_URL` (Netlify DB / Neon); branch
  deploys and previews read `STAGING_DATABASE_URL` and refuse to run without it, so they
  can never touch production data or migrate it. `RESEND_API_KEY` and `MAIL_FROM` send the
  emails; without a key, production refuses and a deploy with `DEV_LINKS=1` (or the test
  suite) returns the link and code to the caller instead. `SITE_ENV` is set per context in the Netlify UI (and in `netlify.toml` for the build).
  `REVIEW_EMAIL` and `REVIEW_CODE` (production only, for App Review): that one address signs
  in with that standing code and is sent no email; eight or more letters and digits, and
  nothing else about it is special.
  `node scripts/migrate.mjs` applies `netlify/database/migrations/*.sql` once each as the
  build command; every statement is idempotent, so a half-applied file is harmless.
  Housekeeping (expired links, sessions and invites, old rate-limit rows) rides along with
  about one request in twenty-five.
- **Tests** run the same functions in-process against PGlite, an in-memory Postgres, and
  drive three browser contexts through sign-in by link and by code, a forged sign-in form,
  invite, joining with lunches of one's own, an edit on each phone, an un-tick round trip,
  a helper's refused push, sign-out and delete, plus the merge rules on their own.

## Billing

The plan is a row on the household (`entitlements`) that only Stripe's webhook writes.
Free, for good, is one lunchbox, the week's plan, the shopping list, the pack list, and the
built-in idea bank to build the food list from. The **Household** plan (yearly, or once
forever) is the part that remembers and shares: a food written in the parent's own words,
kid's pick, the morning review and resting, a pantry that carries over, every lunchbox, the
other parent's phone and a caretaker's pack list. **Every household gets all of it for its
first 21 days**, no card, counted from the account document's `createdAt` (the same clock on
every phone and on the server), and then drops to free with the premium pieces locked in
place, not hidden: the kid's-pick button, the review card, the pantry tick and "Add your
own" on Foods stay on screen with a lock and open the plan sheet. During the three weeks the
same pieces wear a small "Household plan" tag so it is clear what is being tried; three days
before the end a banner says when, and once after it says what changed, each dismissable
once. With no `STRIPE_*` variables in a deploy nothing is gated or tagged and the app is
exactly the free one.
Nothing is ever taken away: a household whose plan or trial ends keeps every lunchbox,
member, tick, outcome and food it has, and cannot add more. A food already on the list is
drawn, shopped for and packed exactly as before; only the writing of a new one is gated, and
the idea bank stays free so a free list is never stuck with what it has.

- **Checkout** (`POST /api/billing/checkout {plan, client?}`) opens Stripe's hosted page for the
  signed-in household (owner or adult; a caretaker cannot buy). The session carries the
  household id, comes back to `/app/?paid=1` or `/app/?paid=0` (to `/back.html?paid=…` when
  `client` is `ios`: the iPhone app opens Stripe in Safari, and that page hands the parent
  back to the app through the `lunchsorted://` scheme), allows promotion codes,
  and asks Stripe Tax to add tax where it applies (if Tax is not finished in the
  dashboard the session is retried without it and the error logged). A household that
  already has the plan is not sold it again (409).
- **Webhook** (`POST /api/billing/webhook`, signature checked against the raw body, five
  minutes of clock drift, and the event's `livemode` must match the deploy context) listens
  for `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `customer.subscription.created / updated / deleted` and `charge.refunded`; anything else
  is acknowledged and dropped. An event id is recorded once it has been applied, so Stripe's
  retries are no-ops but a delivery that failed halfway is retried for real. Every write is
  one upsert that only applies when the event is not older than the last one applied, so
  two deliveries racing each other are ordered by Postgres. On checkout the subscription
  is read back from Stripe for its renewal date, so the plan line is complete at once. A
  lifetime purchase is never lowered by a subscription ending; buying forever on top of a
  yearly plan stops the yearly plan at its period end; a fresh yearly checkout replaces an
  unpaid one; a forever purchase refunded in full is undone (a yearly refund is paired with
  cancelling the subscription in the dashboard). Deleting the account, or an owner folding
  their household into another, cancels its subscription first.
- **Portal** (`POST /api/billing/portal`) opens Stripe's customer portal for the card,
  invoices and cancellation, and comes back to `/app/?portal=1` (`/back.html?portal=1` for
  the iPhone app). It is for the owner and
  whoever paid (`paid_by`); another parent sees the plan but not the card. It stays
  available after a plan ends, for the invoices.
- **In the app**, the Account tab carries a **Subscription** row whose caption is the same
  one-line state (Free, On for N more days, Renews DATE, Ends DATE, Payment failed, Forever,
  Switching on…). The page behind it names the plan, what it costs — matched from the price
  id the entitlement carries, so a monthly household is not quoted the yearly price — the
  date it renews or ends, and a card saying how to stop it, which differs for a parent who
  cannot open the portal. Straight after paying it says only that the payment arrived and
  the plan is switching on, because the webhook has not landed and every other row would
  still read Free. It also offers "Get the Household plan" or "Switch to forever", and
  "Manage billing" (the main button when a
  payment has failed). A second lunchbox or an invite on a free household opens the plan
  sheet with both prices (read from Stripe, cached an hour, never typed into the app);
  signed out it offers sign-in first, and remembers what you were doing so the sheet, or
  the lunchbox, comes back after the sign-in or the payment. The server refuses an invite
  from a free household (402) whatever the app shows, honouring the same 21 days from the
  document's `createdAt`; the lunchbox, kid's-pick, review and pantry gates are the app's
  alone (a parent who edits their own document's birthday extends their own trial, and
  nothing more).
  Coming back from Checkout the app pulls up to eight times over about twenty seconds until
  the webhook has landed; a caretaker sees none of this.
- **Environment**, per deploy context, test keys everywhere but production:
  `STRIPE_SECRET_KEY` (production refuses a test key, every other context refuses a live
  one), `STRIPE_WEBHOOK_SECRET` (one endpoint per context: the staging URL and the
  production URL each give their own), `STRIPE_PRICE_YEAR` and `STRIPE_PRICE_LIFETIME`
  (the two price ids; test mode and live mode have different ones) and, optionally,
  `STRIPE_PRICE_MONTH`, which adds a monthly button to the sheet when set. `STRIPE_TAX=0` turns
  automatic tax off. Stripe is called over plain `fetch`; there is no SDK.
- **Email.** Sign-in asks for the address at the end of onboarding, once the week is built
  (skippable; offline or already signed in, the step does not appear). A first sign-in gets
  one welcome email. A scheduled function (`cron-trial.js`, 14:00 UTC daily, runs only on the
  published deploy) emails the owner and adults of a household whose three weeks end in about
  three days, and again the day after they end: one email per household per kind, claimed in
  `notices` before sending so a retried run never sends twice; paid households never; anyone
  who tapped the stop link never (`users.mail_ok`, via a per-user token at
  `/api/auth/mail-stop?t=`). Sign-in links still come when asked for. Every email carries
  reply-to hello@lunchsorted.app. The reminder's button opens the app at `/app/?upgrade=1`,
  which opens the plan sheet on arrival. The suite captures every email through
  `globalThis.__LS_MAIL`; nothing reaches Resend from a test.
- **The numbers**, at `/admin`, for the emails in `ADMIN_EMAILS` (comma-separated) and nobody
  else: households, on trial, lapsed, paying by plan, sign-ins, reminder emails sent, invites.
  Counts from the database; a stranger is asked to sign in, a signed-in parent who is not
  listed gets not-found. Below the counts are two rosters, "Standard users" and "Beta
  testers", a row a person: email, household, role (owner, parent, caretaker), plan, status,
  joined (or the day a beta code was used), last seen, days seen, what the household has on
  it besides the owner, and who those people are with the day each was last active. Every
  column sorts, role, plan, status and the household column filter, there is a search box,
  and thirty rows show at a time; a fold under each table lists whatever is filtered as
  comma-separated lines for a spreadsheet. The rows are rendered into the page and the one
  inline script only reorders them, allowed by its own sha256 and nothing else. `days_seen`
  and `last_day` on `users` (migration 0005) are what "days seen" counts: the same hourly
  touch that moves `last_seen_at` adds one when the New York day turns over, so signed-out
  use never reaches it, and the days from before the counter are read back from the session
  rows as a floor.
- **Stripe setup, once per mode:** one product, two prices; Developers → Webhooks → add
  `https://<site>/api/billing/webhook` with the six event types above and paste the
  signing secret; Settings → Billing → Customer portal → save the default configuration
  (live mode has none until it is saved once); Settings → Billing → Subscriptions and
  emails → send the renewal reminder and failed-payment emails (the terms promise both),
  and after the retries "cancel the subscription" rather than leave it unpaid; Stripe Tax
  on, with the origin address. Never add a Payment Link for the product: a link accepts a
  `client_reference_id` from anyone, and the webhook would honor it.
