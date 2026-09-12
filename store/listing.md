# App Store listing

Everything App Store Connect asks for, as a checklist, grouped by the page it asks on.
Paste from here. Character limits are Apple's. Tick as you go.

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
Banking). Individual enrolment publishes your legal name. Changing it later means changing
the enrolment, so settle it before launch.

## App Information

- [x] Name (30): **Lunch Sorted**
- [x] Subtitle (30): **School lunches, planned**
- [x] Bundle ID: `app.lunchsorted`
- [x] SKU: `lunchsorted`
- [x] Primary language: English (U.S.)
- [x] Primary category: Food & Drink
- [x] Secondary category: Productivity
- [x] Content rights: does not contain, show or access third-party content
- [x] Age rating: 4+ (the questionnaire is below; every answer None or No)
- [x] Privacy policy URL: `https://lunchsorted.app/privacy.html`

## Pricing and Availability

- [x] Price: Free
- [x] Availability: United States only. Linking out to Stripe is what the US storefront
      permits, and the product rule depends on it.
- [ ] Pre-orders: leave off. Pre-order needs App Review approval first and then a delayed
      release date, which trades launch speed for launch-day volume. Approval day should be
      release day.

## The version page: 1.0 Prepare for Submission

### Promotional text (170; changes without a new build)

- [x] Pasted

> A week of packed school lunches in about a minute, with no food list to build first. Always free to plan; everything else switched on for your first three weeks.

### Description (4000)

- [x] Pasted

> Our daughter started kindergarten and the lunch packing nearly broke me. I wanted it balanced. I wanted it healthy. I also wanted her to eat it, in the twenty minutes she gets to sit down. Most nights I was standing at the counter with the fridge open, out of ideas.
>
> So I built this.
>
> A WEEK OF LUNCHES PLANNED IN A MINUTE
> Answer three questions and you get five planned lunchboxes: a main, a side, a fruit and a sweet for every school day. Not a random shuffle. Something crunchy against a soft main, protein when the main is light, something sharp to cut the salt. Re-shuffle the whole week, or individual boxes if needed, or just switch out one item.
>
> NOTHING TO SET UP FIRST
> There is no food library to build before you get anything back. It starts with foods most kids eat and you adapt from there. Take out the options they refuse, and add more from a long list of ideas. On the Household plan you can write in that pickle roll-up only your kid will eat, or paste in the address of a recipe you found and let the app read the ingredients off it.
>
> YOUR SCHOOL'S RULES BUILT IN
> Nut free, seed free, dairy free, no microwave, no ice pack, a short eating window, no chocolate, or set your own. Set them per kid, per school. A food that breaks a rule gets flagged in your list, so you always know why something stopped showing up.
>
> THE SHOPPING LIST WRITES ITSELF
> Everything you planned across all kids, in one list, grouped by aisle. Send it to Notes, to Reminders, or as a text to whoever is nearer the store.
>
> THE RECIPE COMES WITH IT
> The dishes you cook rather than buy come with the recipe built in, free. One step at a time on the screen while you are at the counter, with a box to tick for each ingredient, in cups or in grams, scaled to how many lunches you are making. Found something on a blog or a reel? Paste the address, or the words under the video, and it becomes a food on your list with its shopping line already written.

> BUILT FOR MULTIPLE KIDS
> Simplify shopping by matching all kids' lunchboxes, while honoring each school's rules with alternative options. Kids with wildly different preferences can have totally different lunchbox plans. You choose your setup, and one shopping list still covers them all.
>
> LET THEM PICK
> Kids who help plan their lunches eat more of them. We have all seen it. Hand your kid the phone the night before and let them choose between two options within the week's plan. Everything they are choosing from is already on the shopping list, so there is nothing new to buy and nothing to renegotiate at seven in the morning.
>
> WHAT CAME HOME
> Tell it what got eaten and what came back. Next week leans toward the things that actually get eaten and rests the ones that keep coming home untouched.
>
> EVERYONE WHO PACKS
> Sign in with your email. No password to remember. Add your partner, a grandparent, a nanny, or anyone else who gets lunches out the door on a busy morning.
>
> It works online and off, and nothing leaves your phone until you choose to sign in.
>
> FREE: Planning the week, the shopping list and the pack list are free for good, for one lunchbox. Build the food list from a long list of ideas, with the recipe for everything you cook, take out the ones they refuse, and set your school's rules.
>
> THE PAID HOUSEHOLD PLAN: Add your own foods or bring in a recipe from anywhere, let them pick, track what came home, a shopping list that remembers what you already have at home, more lunchboxes and sharing with another parent. Every new household gets all of it free for three weeks, no card. Anything you added in those three weeks stays yours. The plan is bought on our website, not in this app.
>
> Made by a mom who no longer dreads packing lunches. hello@lunchsorted.app

### Keywords (100, comma-separated, no spaces after the commas)

- [x] Pasted

> lunchbox,bento,packed,meal,planner,kids,picky,eater,snack,grocery,shopping,list,allergy,recipe

### URLs and copyright

- [x] Support URL: `https://lunchsorted.app/help.html`. A reviewer following it should land
      on answers, not the sales page.
- [x] Marketing URL: `https://lunchsorted.app/`
- [x] Copyright: `2026 Lila Bloom Enterprises`. This one sits lower down the version page
      under General Information, beside the version number, not with the URLs.

### Screenshots (6.9-inch, in this order)

- [ ] Uploaded, regenerated after the last interface change

1. `01-week.png`: A week of lunches in about a minute.
2. `02-pack.png`: Mornings: one box, one check.
3. `03-kidpick.png`: Hand them the phone. They pick.
4. `04-shop.png`: The shopping list writes itself.
5. `05-rules.png`: Your school's rules, respected.
6. `06-foods.png`: Foods they'll actually eat.

They live in `screenshots/`, 1320×2868, the 6.9-inch slot, and App Store Connect scales
them for the smaller phones. Regenerate with `CHROMIUM_PATH=… node scripts/store-shots.mjs`.
No iPad screenshots: the app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`). No app preview
video for version 1.

### What's New (first version)

- [ ] Pasted

> The first release. A week of school lunches in about a minute, your school's rules respected, the shopping list built for you, and the kid's pick.

## App Privacy (the questionnaire)

- [x] Answered and published

Answer **Yes, we collect data from this app**, then:

| Data type | Collected? | Linked to the user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | No | App Functionality (sign-in, household sharing, the trial and renewal emails) |
| User Content → Other User Content | Yes (the household: lunchbox names, foods, rules, plans) | Yes | No | App Functionality |
| Identifiers → User ID | Yes (the account id) | Yes | No | App Functionality |
| Purchases → Purchase History | Yes (which plan the household has; Stripe holds the card) | Yes | No | App Functionality |
| Everything else (location, contacts, health, browsing, diagnostics, usage data, advertising data) | No | | | |

Notes that back the answers: there are no analytics or advertising SDKs in the app and no
third-party cookies; the site's analytics are on the marketing pages only and never inside
`/app/`; the only network calls are to lunchsorted.app; Stripe runs on its own page in
Safari. Diagnostics stays **No**: there is no crash or performance reporting of any kind,
and Apple's own crash logs are collected by Apple, not by the app, so they need no
declaring. Data is collected only after the parent signs in; until then nothing leaves the
phone, and App Store Connect has no way to say "optional", so answer as if signed in. The
label on the store will read "Data Linked to You: Contact Info, User Content, Identifiers,
Purchases". Deletion: "Delete my account and data" under Account → Account, confirmed by typing DELETE, offered to every signed-in person and not only the owner, documented on the privacy page.

## Age rating questionnaire

- [x] Answered: 4+

Every question is **None** or **No**: no cartoon or realistic violence, no sexual content, no
profanity, no horror, no medical or treatment information, no alcohol, tobacco or drug
references, no gambling, no unrestricted web access (the WebView is bound to lunchsorted.app
only), no user-generated content shared publicly, no contests.

**Made for Kids: No.** The parent is the user; the app is not in the Kids Category and does
not target children. The one screen a child touches (kid's pick) asks nothing of them.

## App Review information (bottom of the version page)

- [ ] Contact: your name, phone, hello@lunchsorted.app
- [ ] Sign-in required: **Yes**, with the review account below
- [ ] Notes pasted
- [ ] Attachment: none needed

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
within a few days of submitting, and if review drags past the three weeks the reviewer will see
the free tier with the plan's pieces locked, which is also fine.

**Notes** (paste)

> Lunch Sorted is a planner for parents. The parent is the user; a child only ever sees the "kid's pick" screen, which the parent opens and hands over, and it asks the child for nothing.
>
> How to test: open the app, tap "Already signed up? Sign in", enter the review email, tap "Email me the link", then type the code in the "code from the email" field on that same screen (the review account is sent no email; the code is standing). You land on a planned week. Week: shuffle the week or one day; tap a compartment (the swap arrow) to change it. Shop: the list is what to buy, by aisle; the share button sends it to Notes or Reminders. Pack: one Packed check per box; "Let … pick" opens the kid's-pick screen (it is switched on for this account; the switch is "They pick their box each day" under the gear beside the lunchbox name). The gear beside the lunchbox name: school rules, allergens, a second lunchbox, the kid's say. Account tab: sign-in, the plan, the other parent's invite. Turning the kid's say on may ask for notification permission; allow or deny, either is fine.
>
> Payments: the Household plan is sold on our website (lunchsorted.app) and not in the app. The app does not use in-app purchase. Where the app mentions the plan, it opens Safari to our site; the app itself takes no payment. The review account is inside its free three weeks, so everything is on. This is a US-only listing.
>
> Offline: the app works without a network once opened once; airplane mode shows the same week.
>
> The app loads its interface from https://lunchsorted.app inside a WebView bound to that domain; the native layer provides the app icon, launch screen, Safari hand-off and URL scheme. All processing happens on our own servers (Netlify and Neon, United States).

## Everything else in that sidebar: leave it alone

Most of what App Store Connect offers is conditional on something this app is not. None of
these block submission, and none need a decision now.

- [ ] **App Accessibility** (the accessibility labels): optional, and it can be added any
      time without a new build. Only tick a feature you have actually tested with it on.
      Worth doing after launch, not before.
- **In-App Events**: for a real, time-limited happening inside the app. There isn't one.
- **Custom Product Pages** and **Product Page Optimization**: alternate screenshots and copy
  for ad campaigns, and A/B tests of them. Both want traffic you do not have yet. Come back
  when there is a paid campaign to point at one.
- **Promo Codes**: unlocks paid downloads and in-app purchases. The app is free and has
  neither, so a code would do nothing.
- **Game Center**, **Vietnam Game License**: not a game.
- **In-App Purchases** and **Subscriptions**: deliberately empty, and they stay empty. The
  Household plan is a row on the household that Stripe flips. Adding a StoreKit product to
  "look normal" would break the product rule and hand Apple a cut of a web subscription.
- **App Store Server Notifications** and the **App-Specific Shared Secret**: both exist to
  tell a server about in-app purchase events. With no in-app purchases they have nothing to
  report. Leave both unset.
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

- [ ] Developer Program membership active, two-factor on
- [ ] Free Apps agreement showing **Active** under Business. No bank or tax forms: the app
      is free and the plan is sold on the web.
- [ ] Seller name settled. Individual enrolment publishes your legal name on the product page.
- [ ] `app.lunchsorted` registered under Identifiers with Associated Domains enabled
- [ ] `hello@lunchsorted.app` actually delivers. Apple mails it and reviewers use it.

## Getting a build up

- [ ] App Store Connect API key, role **Admin** (cloud signing needs Admin to make the
      certificate)
- [ ] The four repository secrets from `ios/README.md`: `APPSTORE_KEY_ID`,
      `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_P8`, `APPLE_TEAM_ID`
- [ ] TestFlight workflow run once and the build showing in App Store Connect. Do this early:
      first uploads are where signing surprises live.
- [ ] Installed on your own phone as an internal tester. External testing needs a beta review
      and is not on the path to launch; skip it if speed matters.
- [ ] Airplane mode opens the app, and a sign-in email link opens the app rather than Safari

## Before you press Submit

- [ ] `REVIEW_EMAIL` and `REVIEW_CODE` set in Netlify's Production scope, the code generated;
      signed in with them once and a week built, within a few days of submitting
- [ ] Screenshots regenerated since the last interface change
- [ ] Privacy policy URL loads and matches the App Privacy answers above
- [ ] Build attached to the version. Export compliance asks nothing: the build carries
      `ITSAppUsesNonExemptEncryption = NO`
- [ ] Version **1.0** in App Store Connect, matching `MARKETING_VERSION` in the Xcode
      project. Both build routes read it from there. The build number is the workflow run
      number, or `CURRENT_PROJECT_VERSION` when you archive in Xcode; it only has to be
      unique within a version.
- [ ] No risky deploy planned during review. The reviewer sees whatever is live on
      lunchsorted.app at the moment they look

## After approval

- [ ] Clear `REVIEW_EMAIL` and `REVIEW_CODE`
