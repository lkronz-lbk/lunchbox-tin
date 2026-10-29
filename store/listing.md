# App Store listing

Everything App Store Connect asks for, as a checklist, grouped by the page it asks on.
Paste from here. Character limits are Apple's. Check them off as you go.

## Where each field lives

App Store Connect splits one listing across four pages. Most of what looks missing is on
the version page, which is a different page from App Information.

| Page | How to reach it | What is on it |
|---|---|---|
| **App Information** | left sidebar, under General | Name, subtitle, categories, content rights, age rating, privacy policy URL |
| **Pricing and Availability** | left sidebar, under General | Price, countries |
| **App Privacy** | left sidebar, under General | The data questionnaire |
| **The version page** | left sidebar, under the **iOS App** heading, reading **1.0 Prepare for Submission** | Screenshots, promotional text, description, keywords, support and marketing URLs, copyright, the build, App Review information |

The version page is where promotional text, description, support URL, marketing URL,
copyright and the review contact all live. If there is no **1.0 Prepare for Submission**
row under iOS App, use the **+** beside that heading to add the version, and the fields
appear.

The **seller name** on the finished product page is not a listing field at all. It is the
legal entity name on the developer account, set under **Business** (Agreements, Tax and
Banking). Individual enrollment publishes your legal name. Changing it later means changing
the enrollment, so settle it before launch.

## App Information

- [x] Name (30): **Lunch Sorted: Lunchbox Planner** (entered on the 1.1 draft 2026-10-25; 1.0 is live as **Lunch Sorted**; why: `store/aso-2026-10-23.md`)
- [x] Subtitle (30): **Kids' school lunch ideas** (Liz, 2026-10-28, for 1.1; "School lunch ideas for kids" read as who the app is for. 1.0 is live as **School lunches, planned**.)
- [x] Bundle ID: `app.lunchsorted`
- [x] SKU: `lunchsorted`
- [x] Primary language: English (U.S.)
- [x] Primary category: Food & Drink
- [x] Secondary category: Productivity
- [x] Content rights: **read the question on the page before answering — it asks whether
      the app contains, displays OR ACCESSES third-party content, not whether we are
      licensed for it.** Two reasons the old "no" no longer holds, the second being the
      bigger one:
      1. The app ships two recipes from the USDA's Recipes for Healthy Kids cookbook, with
         a source line and a link to the original. They are US government works and so
         public domain — which settles that we may reprint them, not that they are ours.
         School teams of cooks, chefs, parents and students wrote them.
      2. **Import a recipe fetches a page the parent names and shows what it read.** That
         is accessing third-party content however the question is read, and it has been
         true since the Recipes tab shipped, before any USDA recipe was in the app. Nothing
         imported is redistributed: it is read on request, kept on that household's own
         document, and shown to nobody else.
      Neither of these is "open source" — that is a software licence, and no recipe in the
      app carries one.
- [x] Age rating: 4+ (the questionnaire is below; every answer None or No)
- [x] Privacy policy URL: `https://lunchsorted.app/privacy.html`

## Pricing and Availability

- [x] Price: Free
- [x] Availability: United States only for now. The in-app purchases work in any storefront;
      before expanding, set the price in each and file the EU Digital Services Act declaration.
- [x] Pre-orders: leave off. Pre-order needs App Review approval first and then a delayed
      release date, which trades launch speed for launch-day volume. Approval day should be
      release day.

## The version page: 1.0 Prepare for Submission

### Promotional text (170; changes without a new build)

- [x] Pasted

> A week of packed school lunches in a minute, with no food list to build first. Always free to plan; everything else switched on for your first three weeks.

### Description (4000)

- [ ] Pasted. Trimmed 2026-10-25 and corrected after the 2026-10-28 spec check, 3118 characters, for 1.1; the live 1.0 text is the older, longer one, and the previous draft here had grown past the limit.

> Our daughter started kindergarten and the lunch packing nearly broke me. I wanted a box that went together, and I wanted her to eat it in the twenty minutes she gets. Most nights I was at the counter with the fridge open, out of ideas. So I built this.
>
> A WEEK OF LUNCHES IN A MINUTE
> Answer three questions and get five lunchboxes: a main, a side, a fruit and a sweet for every school day. Not a random shuffle: something crunchy against a soft main, protein when the main is light. Plan the week again, shuffle one day, or switch out one item.
>
> NOTHING TO SET UP FIRST
> No food library to build. It starts with foods most kids eat; take out the ones they refuse, add more from a long list of ideas. On the Household plan, write in the pickle roll-up only your kid will eat, or paste the address of a recipe and let the app read the ingredients.
>
> YOUR SCHOOL'S RULES
> Nut free, dairy free, no microwave, no ice pack, a short eating window, or your own. Set per kid, per school. A food that breaks a rule is flagged, never silently dropped.
>
> THE SHOPPING LIST WRITES ITSELF
> Everything you planned, every kid, one list, grouped by aisle. Send it to Notes, to Reminders, or as a text to whoever is nearer the store.
>
> RECIPES
> Two kid-tested recipes come free. Keep your own, and once you have a few, search them by what is in the pantry. Cook one step at a time with a box to check off for each ingredient, in US measures or metric. Found one on a blog or a reel? Paste the address, or the words under the video, and it is yours.
>
> MORE THAN ONE KID
> Match the lunchboxes to keep shopping simple, with each school's rules honored by swaps, or give kids with different tastes different plans. One shopping list either way.
>
> LET THEM PICK
> Kids who help plan their lunches eat more of them. Hand over the phone the night before and let them choose between two boxes from the week's plan. Both are already on the shopping list, so nothing new to buy and nothing to renegotiate at seven in the morning.
>
> WHAT CAME HOME
> Tell it what got eaten and what came back. Next week leans toward what gets eaten and puts on hold what keeps coming home untouched.
>
> EVERYONE WHO PACKS
> Sign in with your email, no password. Add your partner, a grandparent, a nanny, anyone who gets lunches out the door.
>
> Works online and off. Your lunches never leave your phone until you choose to sign in.
>
> FREE: planning the week, the shopping list and the pack list, for one lunchbox, for good.
>
> THE HOUSEHOLD PLAN: your own foods and recipes, the kid's pick, what came home, a shopping list that knows what is already at home, more lunchboxes, and sharing with another parent. Free for your first three weeks, no card; what you added stays yours. Then yearly or monthly as an in-app purchase at the price the App Store shows. The launch price is a founding price, kept for as long as you stay subscribed. It renews automatically until you cancel in your Apple Account's subscriptions. Terms of use: https://lunchsorted.app/terms.html · Privacy: https://lunchsorted.app/privacy.html
>
> Made by a mom who no longer dreads packing lunches. hello@lunchsorted.app

### Keywords (100, comma-separated, no spaces after the commas)

- [x] Pasted

> box,bento,packed,meal,week,menu,picky,eater,snack,grocery,list,allergy,nut,free,recipe,kindergarten

(Entered on the 1.1 draft 2026-10-25. 1.0 is live with `lunchbox,bento,packed,meal,planner,kids,picky,eater,snack,grocery,shopping,list,allergy,recipe`; the words that moved into the title and subtitle left the field, as Apple asks.)

### URLs and copyright

- [x] Support URL: `https://lunchsorted.app/help.html`. A reviewer following it should land
      on answers, not the sales page.
- [x] Marketing URL: `https://lunchsorted.app/`
- [x] Copyright: `2026 Blue Hour Ventures LLC` (was `2026 Lila Bloom Enterprises` for 1.0; change it at the next version). This one sits lower down the version page
      under General Information, beside the version number, not with the URLs.

### Screenshots (6.9-inch, in this order)

- [x] Regenerated and recomposed 2026-10-28 on this branch, which is main at v31 plus the "in a minute" headline (`node scripts/store-shots.mjs`, `node scripts/iap-shot.mjs`; the composer needs the Python that has Pillow, `/usr/bin/python3` on this Mac, so run with `PATH=/usr/bin:$PATH`),
      pinned to Monday September 14: Phase A's screens, and 01-week taken with the kid's say
      on, so it shows Let Emma pick the week.
- [ ] Uploaded, with `store/iap-review.png` on both subscriptions. A version In Review cannot
      have its screenshots swapped without pulling the submission back: upload at the next
      editable moment.

1. `01-week.png`: A week of lunches in a minute. / Five boxes, matched so they go together.
2. `02-pack.png`: Mornings: one box, one check. / Today's box, and the week coming up.
3. `03-kidpick.png`: Hand them the phone. / They pick. It's already on the shopping list.
4. `04-shop.png`: The list writes itself. / Grouped by aisle. Send it to Notes or as a text.
5. `05-recipes.png`: Keep every recipe you find. / Paste a link, or the words under a reel.
6. `06-cook.png`: Cook it one step at a time. / Check off each ingredient as it goes in.
7. `07-rules.png`: Your school's rules, respected. / Nut free, no microwave, a short lunch. Flagged, never dropped.
8. `08-foods.png`: Foods they'll actually eat. / Start from what parents pack.

Redesigned 2026-10-28 at Liz's ask (the September set read as a document, not an ad; a tilted
collage after SchoolCafé's set was tried and rejected): calm. The page is the ground color, the
headline centered with its first line in the green, one upright phone with a heavy bezel
centered under it. Behind the phones two organic waves, the soft accent and the green, run
across the whole set: drawn once on a canvas eight frames wide and cut per frame, so each frame
carries a different slice of the same shape and the set reads as one (after Lunchbox Recipes'
listing, in our shapes). Headlines are sized to read at a third of this width.

They live in `screenshots/`, 1320×2868, the 6.9-inch slot, and App Store Connect scales
them for the smaller phones. Regenerate with `CHROMIUM_PATH=… node scripts/store-shots.mjs`.
No iPad screenshots: the app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`). No app preview
video for version 1.

### What's New (from 1.1 on)

- [ ] 1.1 is the first version with the field. The note is the release owner's, written for what
      1.1 ships; the first-release line that used to sit here does not fit a second release.

## App Privacy (the questionnaire)

- [x] Entered 2026-10-25 (the store label reads as the table below says). Crash Data and Usage Data were owed from v25: `main` carries the day-one work since
      2026-09-30 (v25), so enter both before 1.0 (7) is submitted, or at once if it already has
      been (README.md, "When the day-one work moves to main"). Everything else was answered and
      published earlier.

Answer **Yes, we collect data from this app**, then:

| Data type | Collected? | Linked to the user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | No | App Functionality (sign-in, household sharing, the trial and renewal emails) |
| User Content → Other User Content | Yes (the household: lunchbox names, foods, rules, plans) | Yes | No | App Functionality |
| Identifiers → User ID | Yes (the account id) | Yes | No | App Functionality |
| Purchases → Purchase History | Yes (which plan the household has, and the Stripe or App Store reference for it; Stripe and Apple hold the payment) | Yes | No | App Functionality |
| Usage Data → Product Interaction | Yes (six dated moments per household: made, first week planned, back in week two, second phone joined, checkout opened, first paid) | Yes | No | Analytics |
| Diagnostics → Crash Data | Yes (what the planner's own code reports when it breaks: the message, the trail of code it passed through, the build, the browser's user-agent string) | No | No | App Functionality |
| Everything else (location, contacts, health, browsing, performance data, advertising data) | No | | | |

Notes that back the answers: there are no analytics or advertising SDKs in the app and no
third-party cookies; the site's analytics are on the marketing pages only and never inside
`/app/`; the only network calls are to lunchsorted.app; purchases in the app go through
StoreKit and Apple takes the payment; the app never opens Stripe, to buy or to manage: a household
already paying on the website is told to change it at lunchsorted.app, named rather than linked. Diagnostics is **Yes, Crash Data, not linked, not tracking, App Functionality**: when the planner's
own code breaks it posts the message, the stack, the build and the browser's user-agent string to our own server
(`/api/errors`), with no session, no household and no identifier, kept thirty days; there is no
performance reporting, and Apple's own crash logs are collected by Apple, not by the app. Usage
Data is **Yes, Product Interaction, linked, not tracking, Analytics**: beside the day a person last
used the app and a count of the days they have used it (both run the service: the three-week
trial, the reminder emails, knowing whether an account is live), the servers keep six dates a
household (made, first week planned, back in week two, second phone joined, checkout opened,
first paid; migration 0009_milestones_errors), which measure whether the app is working for people and so are
declared as analytics. Nothing narrower than those six moments is recorded; revisit this answer
if anything else is ever kept. Everything linked to a person is collected only after the parent signs in; until then the one
thing that leaves the phone is a crash report, which names nobody. App Store Connect has no way to
say "optional", so answer as if signed in. The label on the store will read "Data Linked to You: Contact Info, User Content, Identifiers,
Purchases, Usage Data" and "Data Not Linked to You: Diagnostics". Deletion: "Delete my account and data" under Account → Account, confirmed by typing DELETE, offered to every signed-in person and not only the owner, documented on the privacy page.

## Age rating questionnaire

- [x] Answered: 4+

Every question is **None** or **No**: no cartoon or realistic violence, no sexual content, no
profanity, no horror, no medical or treatment information, no alcohol, tobacco or drug
references, no gambling, no unrestricted web access (the WebView is bound to lunchsorted.app
only), no user-generated content shared publicly, no contests.

**Made for Kids: No.** The parent is the user; the app is not in the Kids Category and does
not target children. The one screen a child touches (kid's pick) asks nothing of them.

## App Review information (bottom of the version page)

- [x] Contact: your name, phone, hello@lunchsorted.app
- [x] Sign-in required: **Yes**, with the review account below (it shows a planned household; buying needs no sign-in, as the Notes say)
- [x] Notes pasted
- [x] Attachment: none needed

| | |
|---|---|
| User name | the address in `REVIEW_EMAIL` (production scope) |
| Password | the code in `REVIEW_CODE` |

Set both in Netlify (Site configuration → Environment variables, Production scope only) before
submitting. Generate the code rather than choosing one, since it stands until you change it:

```
node -e "const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',b=require('crypto').randomBytes(8);console.log([...b].map(x=>a[x%32]).join('').replace(/(.{4})/,'\$1-'))"
```

The address must not be one of `ADMIN_EMAILS`; if it is, the account switches itself off and
says so in the function log. Clear or change both variables once the app is approved. The
reviewer enters the email on the sign-in screen, taps "Email me the link", then types the code
on the same screen; that address gets no email and its code stands until you change the
variable. Sign in once yourself with it first, answer the three questions and build a week, so
the reviewer lands on a planned household rather than an empty one. Nothing else about that
account is special: it gets the same three weeks of everything as any new household, so do this
within a few days of submitting. If review drags past the three weeks, lengthen them in Neon
(the household is 23): `UPDATE households SET trial_extra_days = trial_extra_days + 7 WHERE id = 23`.
Left alone, the reviewer sees the free tier with the plan's pieces locked, which is also fine.

**Notes** (paste)

> Lunch Sorted is a planner for parents. The parent is the user; a child only ever sees the "kid's pick" screen, which the parent opens and hands over, and it asks the child for nothing.
>
> How to test: open the app, tap "Already signed up? Sign in", enter the review email, tap "Email me the link", then type the code in the "code from the email" field on that same screen (the review account is sent no email; the code is standing). You land on a planned week. Week: Plan the week plans it again; beside each day, the lock holds that day and the crossed arrows shuffle it; tap a compartment (the small swap arrows) to change it, and the lock on that sheet holds just that one. Shop: the list is what to buy, by aisle; Send hands it to Notes, Reminders or a text. Pack: one Packed check per box; No lunch today beside the box takes a day off and Put it back restores it; "Let … pick" opens the kid's-pick screen (it is switched on for this account; the switch is "They pick their box each day" under the sliders icon beside the lunchbox name, labelled Lunchbox settings). The sliders icon beside the lunchbox name, labelled Lunchbox settings: school rules, allergens, a second lunchbox, the kid's say. Account tab: sign-in, the plan, the other parent's invite. Turning the kid's say on may ask for notification permission; allow or deny, either is fine.
>
> Payments: in the iPhone app the Household plan is sold only through in-app purchase: an auto-renewing subscription, yearly or monthly, in the group "Household". Account tab → Subscription → "Keep the Household plan" (or "Get the Household plan") opens the sheet with both at the App Store's prices, and Restore purchases, Terms of use and Privacy beside them. A parent on a computer or an Android phone can buy the same plan on our website instead, through Stripe; the iPhone app honors a plan bought there, under guideline 3.1.3(b), because the same plan is available in the app as an in-app purchase. The iPhone app never offers a web checkout. The review account is inside its free three weeks, so everything is on, and the purchase sheet is still reachable from Subscription; purchases in review go through the sandbox. This is a US-only listing.
>
> No sign-in is needed to buy (guideline 5.1.1(v)). On a fresh install, or after Account → Account → Sign out, type a name, tap "Plan the week", then "Not now — show me the week" when it offers a sign-in. Then Account tab → Subscription → "Keep the Household plan" opens the same sheet with both subscriptions; buying there switches the plan on for that iPhone with no account at all. Signing in is optional: the sheet and the Subscription page offer it, and it is what puts the plan on the other parent's phone too. A plan bought signed out moves to the household when the parent signs in to one they set up; a household they join takes it only through Restore purchases. Restore purchases works signed out as well.
>
> Recipes: two recipes are built in, from the USDA's Recipes for Healthy Kids cookbook (Food and Nutrition Administration, fna.usda.gov). They are US government works in the public domain; each is shown with a source line and a link to the original. Everything else on the Recipes tab is imported by the parent from a page or text they chose, stored on their own household and not published by us. Recipes tab → Import a recipe, if you want to see that path.
>
> Offline: the app works without a network once opened once; airplane mode shows the same week.
>
> The app loads its interface from https://lunchsorted.app inside a WebView bound to that domain; the native layer provides the app icon, launch screen, in-app purchase (StoreKit 2), and the URL scheme. All processing happens on our own servers (Netlify and Neon, United States).

**Reply to the 5.1.1(v) rejection of 1.0 (7)** (paste into the Resolution Center once the fix is live)

> Thank you. The iPhone app no longer asks for a sign-in before a purchase. The fix is live now with no new build, because the app loads its interface from lunchsorted.app. On a fresh install, or after Account → Account → Sign out, type a name, tap "Plan the week", then "Not now — show me the week". Then Account tab → Subscription → "Keep the Household plan" opens the sheet with both subscriptions, Restore purchases, Terms of use and Privacy; buying there switches the plan on for that iPhone with no account. Signing in is optional and offered beside the prices, never required: it is what puts the plan on the parent's other devices. A plan bought signed out moves to the household when the parent signs in to one they set up; a household they join takes it through Restore purchases.

**Reply to the 2.1(b) rejection of 1.0 (6)** (sent; kept for the record)

> The purchase failure you saw on iPad in 1.0 (6) is fixed in build 1.0 (7). This is an iPhone app, and on iPad it runs in a window of its own; the app now tells the App Store which window to show the payment sheet in, so buying the yearly or the monthly plan brings the sheet up as it does on iPhone.

## Everything else in that sidebar: leave it alone

Most of what App Store Connect offers is conditional on something this app is not. None of
these block submission, and none need a decision now.

- [ ] **App Accessibility** (the accessibility labels): optional, and it can be added any
      time without a new build. Only check a feature you have actually tested with it on.
      Worth doing after launch, not before.
- **In-App Events**: for a real, time-limited happening inside the app. There isn't one.
- **Custom Product Pages** and **Product Page Optimization**: alternate screenshots and copy
  for ad campaigns, and A/B tests of them. Both want traffic you do not have yet. Come back
  when there is a paid campaign to point at one.
- **Promo Codes**: the app now has in-app purchases, so codes (and subscription offer codes)
  would work. Not needed for launch; the beta testers' code is the website's.
- **Game Center**, **Vietnam Game License**: not a game.
- **Subscriptions**: one group, "Household" (display name "Household plan"), with
  `app.lunchsorted.household.annual` ($19.99, 1 year, level 1, "Household plan, yearly") and
  `app.lunchsorted.household.month` ($2.99, 1 month, level 2, "Household plan, monthly"), both
  described "Every lunchbox, both parents, kid's pick". These are the founding prices: when they
  go up, schedule the change with **keep the current price for existing subscribers**, always,
  because the terms promise it. No introductory offer; the app's three weeks are the trial.
  **In-App Purchases**: none; forever is not sold. Leave **Family Sharing** off on both: the plan is
  already the household's, shared through the household, and a family-shared transaction
  would arrive without the household's token. Product ids can never be reused, even deleted.
- **App Store Server Notifications**: Version 2, production and sandbox both
  `https://lunchsorted.app/api/apple/notify`. The **App-Specific Shared Secret** is for the
  old receipt API and stays unset.
- **Regulated Medical Devices**: required for the Medical or Health and Fitness categories,
  or if the age rating says medical information is frequent. This app is Food & Drink and
  answered None. It does not apply. Keep it that way: allergens in this app are a filter a
  parent sets, never advice, and the copy must never read as medical guidance.
- **Digital Services Act**: the EU trader declaration. It applies to apps distributed in the
  European Union, and this listing is United States only, so there is nothing to file. Know
  before expanding: completing it as an individual publishes your name, address, phone and
  email on the EU product page.

The one worth a look:

- [ ] **Nominations**: how you tell Apple's editorial team a launch or a notable update is
      coming. It is free, it is the only route to being featured, and Apple wants roughly
      three weeks' notice, so a nomination aimed at launch day needs filing before you
      submit. If that window has gone, aim one at the 1.1 update instead.

## Account level, once each

- [x] Developer Program membership active, two-factor on
- [ ] **Paid Applications** agreement showing **Active** under Business, with bank and tax
      forms done. Until it is, StoreKit returns no products and the plan sheet says the App
      Store is not answering. Join the App Store Small Business Program before the first sale.
- [x] Seller name: **Elizabeth Kronzek**, the legal entity on the account, until Apple
      converts the membership to an organization; then **Blue Hour Ventures LLC** (D-U-N-S
      number first). Lila Bloom Enterprises, the old sole-proprietorship name, is retired. Apple reissues the agreements from
      time to time and an unaccepted one takes your apps off sale, so check Business whenever
      Apple emails about updated terms. What renews annually is the Developer Program
      membership, on its enrollment anniversary.
- [x] `app.lunchsorted` registered under Identifiers with Associated Domains enabled
- [x] `hello@lunchsorted.app` actually delivers. Apple mails it and reviewers use it.

## Getting a build up

- [x] App Store Connect API key, role **Admin** (cloud signing needs Admin to make the
      certificate)
- [x] The four repository secrets from `ios/README.md`: `APPSTORE_KEY_ID`,
      `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_P8`, `APPLE_TEAM_ID`
- [x] TestFlight workflow run once and the build showing in App Store Connect. Do this early:
      first uploads are where signing surprises live.
- [x] Installed on your own phone as an internal tester. External testing needs a beta review
      and is not on the path to launch; skip it if speed matters.
- [x] Airplane mode opens the app, and a sign-in email link opens the app rather than Safari

## Before you press Submit

- [ ] The two subscriptions Ready to Submit, each with a display name, a description and a review
      screenshot (`store/iap-review.png`, the same image on both, made by `scripts/iap-shot.mjs`:
      the founding line, both prices, the renewal line, Restore purchases, Terms of use, Privacy;
      rerun it with the new prices after a price change), and selected on the version page under In-App Purchases
      and Subscriptions. A first in-app purchase is reviewed with the build.
- [ ] App Store Server Notifications URL set (above), and the code that answers it deployed

- [x] `REVIEW_EMAIL` and `REVIEW_CODE` set in Netlify's Production scope, the code generated;
      signed in with them once and a week built, within a few days of submitting
- [ ] Screenshots uploaded: regenerated on 2026-09-30, waiting for an editable version; see
      the note under Screenshots above
- [ ] Privacy policy URL loads and matches the App Privacy answers above — once the Crash
      Data and Usage Data rows are entered: `main` carries the day-one work since 2026-09-30
      (v25), the live app now collects both, and the questionnaire still says No until they
      are. The checklist is in README.md, "When the day-one work moves to main"
- [x] Build attached to the version. Export compliance asks nothing: the build carries
      `ITSAppUsesNonExemptEncryption = NO`
- [x] Version **1.1** in App Store Connect (1.0 before 2026-10-23), matching `MARKETING_VERSION` in the Xcode
      project. Both build routes read it from there. The build number is the workflow run
      number, or `CURRENT_PROJECT_VERSION` when you archive in Xcode; it only has to be
      unique within a version.
- [x] No risky deploy planned during review. The reviewer sees whatever is live on
      lunchsorted.app at the moment they look
- [ ] If the day-one work has reached `main` since the last submission: the two App Privacy
      rows above are entered and the description sentence is the new one (README.md, "When the
      day-one work moves to main")

## After approval

- [ ] Clear `REVIEW_EMAIL` and `REVIEW_CODE`
