# App Store listing

Everything App Store Connect asks for, in the order it asks. Paste from here. Character
limits are Apple's. Screenshots are in `screenshots/`, regenerated with
`CHROMIUM_PATH=… node scripts/store-shots.mjs`; they are 1320×2868, the 6.9-inch slot,
and App Store Connect scales them for the smaller phones.

## App information

| Field | Value |
|---|---|
| Name (30) | Lunch Sorted |
| Subtitle (30) | School lunches, planned | 
| Bundle ID | app.lunchsorted |
| SKU | lunchsorted |
| Primary language | English (U.S.) |
| Primary category | Food & Drink |
| Secondary category | Productivity |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | 4+ (every questionnaire answer is None / No; see below) |
| Availability | United States only (Pricing and Availability → Availability). Linking out to Stripe is what the US storefront permits. |
| Price | Free |
| Copyright | 2026 Lila Bloom Enterprises |
| Support URL | https://lunchsorted.app/ |
| Marketing URL | https://lunchsorted.app/ |
| Privacy policy URL | https://lunchsorted.app/privacy.html |
| Seller / contact | your legal name (individual enrolment), hello@lunchsorted.app |

## Version information

**Promotional text** (170; can change without a new build)

> A week of packed school lunches in about a minute. Free to plan; everything on for your first three weeks, no card.

**Description** (4000)

> Answer three questions and get a week of packed school lunches: a main, a side, a fruit and a sweet for every school day, matched so each box goes together, with the shopping list built for you.
>
> Lunch Sorted is for the parent standing at the kitchen counter. No blank screen, no database of your child's foods to build before you get anything back. Tell it what can go in the box, what has to stay out, and how picky they are, and the week is planned before you have put the kettle on.
>
> THE WEEK
> Not a random draw. Something crunchy against a soft main, protein when the main is light, something tangy to cut the salt, and a sentence under each box saying why it was built that way. Keep a compartment you like and it survives the next shuffle. A day that has gone is never rewritten.
>
> YOUR SCHOOL'S RULES
> Nut-free, seed-free, dairy-free, cold lunches only, no ice pack, a short eating window, no chocolate, plus anything else you list. Foods that break a rule are flagged in your list, never silently dropped, so you always know why something stopped appearing.
>
> THE SHOPPING LIST
> Every planned box rolls into one list, grouped by aisle. Tick what the pantry already has and shop the rest. More than one kid? One list covers them all.
>
> MORNINGS
> The next school day as a checklist, with a flag when the box needs an ice pack, a sealed container, or is missing any protein.
>
> KID'S PICK
> The night before, hand them the phone. Two pictures per compartment, both inside your rules; they tap the one they want and hand it back. A lunch they chose tends to come home emptier.
>
> WHAT CAME HOME
> Tell it what was eaten, what came home, and what to rest. Next week's draw leans toward what actually gets eaten.
>
> TWO PHONES, ONE PLAN
> Sign in with your email, no password, and the other parent sees the same week. A helper can be given the pack list and nothing else.
>
> Everything works offline and stays on your phone until you choose to sign in.
>
> FREE, AND THE HOUSEHOLD PLAN
> Planning the week, the shopping list and the pack list are free for good, for one lunchbox. Kid's pick, the morning review, a pantry that remembers, more lunchboxes and sharing with the other parent are the Household plan. Every new household gets the whole plan for three weeks, no card. The Household plan is bought on our website, not in this app.
>
> Made by a parent, in Maryland. Questions: hello@lunchsorted.app

**Keywords** (100, comma-separated, no spaces after commas)

> school lunch,lunchbox,lunch planner,packed lunch,meal planner,kids lunch,bento,lunch ideas,picky eater,shopping list

**What's New** (first version)

> The first release. A week of school lunches in about a minute, your school's rules respected, the shopping list built for you, and the kid's pick.

**Support URL** https://lunchsorted.app/ · **Marketing URL** https://lunchsorted.app/

## Screenshots (6.9-inch, in this order)

1. `01-week.png`: A week of lunches in about a minute.
2. `02-pack.png`: Mornings become a checklist.
3. `03-kidpick.png`: Hand them the phone. They pick.
4. `04-shop.png`: The shopping list writes itself.
5. `05-rules.png`: Your school's rules, respected.
6. `06-foods.png`: Foods they'll actually eat.

No iPad screenshots: the app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`). No app preview video for version 1.

## App Privacy (the questionnaire)

Answer **Yes, we collect data from this app**, then:

| Data type | Collected? | Linked to the user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | No | App Functionality (sign-in, household sharing, the trial and renewal emails) |
| User Content → Other User Content | Yes (the household: lunchbox names, foods, rules, plans) | Yes | No | App Functionality |
| Identifiers → User ID | Yes (the account id) | Yes | No | App Functionality |
| Purchases → Purchase History | Yes (which plan the household has; Stripe holds the card) | Yes | No | App Functionality |
| Everything else (location, contacts, health, browsing, diagnostics, usage data, advertising data) | No | | | |

Notes that back the answers: there are no analytics or advertising SDKs and no third-party
cookies; the only network calls are to lunchsorted.app; Stripe runs on its own page in Safari.
Data is collected only after the parent signs in; until then nothing leaves the phone, and
App Store Connect has no way to say "optional", so answer as if signed in. The privacy label
shown on the store will read "Data Linked to You: Contact Info, User Content, Identifiers,
Purchases". Deletion: "Delete my account" in Setup, documented on the privacy page.

## Age rating questionnaire

Every question is **None** or **No**: no cartoon or realistic violence, no sexual content, no
profanity, no horror, no medical or treatment information, no alcohol, tobacco or drug
references, no gambling, no unrestricted web access (the WebView is bound to lunchsorted.app
only), no user-generated content shared publicly, no contests. Result: 4+.

**Made for Kids: No.** The parent is the user; the app is not in the Kids Category and does
not target children. The one screen a child touches (kid's pick) asks nothing of them.

## App Review information

**Sign-in required: Yes.** Provide the review account:

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
says so in the function log. Clear or change both variables once the app is approved. The reviewer enters the email on the sign-in screen, taps "Email me the link",
then types the code on the same screen; that address gets no email and its code stands until
you change the variable. Sign in once yourself with it first, answer the three questions and
build a week, so the reviewer lands on a planned household rather than an empty one. Nothing
else about that account is special: it gets the same three weeks of everything as any new
household, so do this within a few days of submitting, and if review drags past the three
weeks the reviewer will see the free tier with the plan's pieces locked, which is also fine.

**Contact information:** your name, phone, hello@lunchsorted.app.

**Notes** (paste)

> Lunch Sorted is a planner for parents. The parent is the user; a child only ever sees the "kid's pick" screen, which the parent opens and hands over, and it asks the child for nothing.
>
> How to test: open the app, tap "Already signed up? Sign in", enter the review email, tap "Email me the link", then type the code in the "code from the email" field on that same screen (the review account is sent no email; the code is standing). You land on a planned week. Week: shuffle or re-draw a day. Pack: tick compartments, tap "Let … pick" for the kid's-pick screen. Shop: the aisle-grouped list. Setup: the school rules, allergens, the second lunchbox, the other parent's invite.
>
> Payments: the Household plan is sold on our website (lunchsorted.app) and not in the app. The app does not use in-app purchase. Where the app mentions the plan, it opens Safari to our site; the app itself takes no payment. The review account is inside its free three weeks, so everything is on. This is a US-only listing.
>
> Offline: the app works without a network once opened once; airplane mode shows the same week.
>
> The app loads its interface from https://lunchsorted.app inside a WebView bound to that domain; the native layer provides the app icon, launch screen, Safari hand-off and URL scheme. All processing happens on our own servers (Netlify and Neon, United States).

**Attachment:** none needed.

## Before you press Submit

- [ ] `REVIEW_EMAIL` and `REVIEW_CODE` set in Netlify's Production scope, the code generated; signed in with them once and a week built, within a few days of submitting.
- [ ] After approval: clear both variables.
- [ ] Availability set to United States only.
- [ ] Privacy policy URL loads and matches the App Privacy answers above.
- [ ] Build uploaded from Xcode (Product → Archive) and attached to the version.
- [ ] Export compliance: the build carries `ITSAppUsesNonExemptEncryption = NO`, so no question is asked.
- [ ] Version 1.0, build 1; bump `CURRENT_PROJECT_VERSION` in Xcode for every upload.
