# Design every Lunch Sorted email for nine seconds

Lunch Sorted needs fifteen emails, not eight, and every one of them has to do its work in the roughly **nine seconds a parent gives an opened email** (Litmus measured 8.97 seconds in 2022, down from 13.4 in 2018) on a phone where **Apple Mail is about three quarters of opens** and the Gmail app shows only **37 characters of subject** ([Litmus](https://www.litmus.com/blog/trends-in-email-engagement); [Litmus](https://www.litmus.com/email-client-market-share); [EmailToolTester](https://www.emailtooltester.com/en/blog/email-subject-lines-character-limit/)). The owner's instinct is backed by the primary research: people scan in an F-pattern on mobile as well as desktop, only 19% of newsletters are read thoroughly, and the single controlled study of animation in email found it lowered trust, so the right shape is a subject that already says the thing, one headline, one cropped screenshot, three or four short lines, one button that opens the right screen of the app, and nothing else ([NN/g](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/); [Wylie, quoting NN/g](https://wyliecomm.com/2022/08/skim-scan-read); [NN/g](https://www.nngroup.com/articles/gif-emails/)). The admired consumer apps confirm the shape rather than the content: Duolingo, Headspace, Calm and Notion each send five to eleven emails in the first week or two, front-loaded, one idea per email, and the only published before-and-after (PostHog) found the shorter, more personal, single-ask version beat both the screenshot-heavy and the many-branch versions ([Sequenzy](https://www.sequenzy.com/email-examples/brands/duolingo/sequences/onboarding); [Reteno](https://gallery.reteno.com/flows/emails-headspace); [PostHog](https://posthog.com/blog/how-we-built-email-onboarding)). Three of today's eight emails break the brief's own facts and need changing regardless of research: the welcome promises "your first three weeks start now" when the clock started at household creation, the education series goes only to beta testers though every new household needs it, and the shell loads Google Fonts from Google's servers, which sends an IP address off the phone on every Apple Mail open. The additions are an account-deleted confirmation, a plan-is-on confirmation that tells an iPhone buyer how the plan reaches the web, a fourth education email, a once-only quiet-household nudge and a seasonal back-to-school send; the invite email is specified but held, and the weekly plan-your-week email is not recommended, chiefly because a digest with any content in it would put the child's foods into an email, which the product rules forbid, and a contentless one duplicates the Pack dot and the 6pm reminder the app already has. Measurement never touches the person: no open pixel (Apple's Mail Privacy Protection pre-fetches it anyway), no click tracking (it breaks universal links and writes per-person records at Resend), only counts per template per day from rows the server already holds.

## Part 1. The program: fifteen emails, what each is for, and what goes in it

The list below keeps the nine-second rule as its only aesthetic. Each email has one subject under 37 characters (the Gmail iPhone limit; Apple Mail shows 48, so the first 37 must carry the meaning), a preheader that finishes the subject's sentence (Apple Mail shows up to 99 characters of it over two lines, the Gmail app 39, so the meaning sits in the first 37), one headline that is the email's only `<h1>`, at most one image, three to five lines that a thumb can cover in one screen, and one button ([EmailToolTester](https://www.emailtooltester.com/en/blog/email-subject-lines-character-limit/); [Cakemail](https://www.cakemail.ca/blog/post/the-preheader-a-forgotten-element-to-optimize-your-open-rate)). Where the sender is Liz, the email says "I" and signs "Liz"; where it is the product, it says "we"; never both (HANDBOOK.md). Every email ends with the closing line already in `netlify/lib/mail.js` ("— Lunch Sorted, from Lila Bloom Enterprises. Reply to this email and a person reads it."), and the lifecycle ones carry the stop link and, new, the one-click headers from Part 2.

Deep-link targets use two things that exist today (`/app/?upgrade=1` opens Account › the plan; `/app/?join=CODE` opens the join flow) and one that does not: a `go=` parameter (`week`, `pack`, `shop`, `foods`, `account`) read beside `upgrade` in the boot block of `public/app/index.html` and stripped the same way with `history.replaceState`. It is one line per tab. Part 2 explains why `/app/*` must also be added to the `apple-app-site-association` file so a tap in Apple Mail opens the iPhone app instead of Safari.

Every "measure" line below is a count computed on the server from rows it already holds (the `notices` table records which household got which email and when; the household document it syncs carries whether a week is planned, whether the kid's pick is on, whether a review was answered; the `entitlements` table carries plan starts). None requires a new per-person record, a pixel, or a tracked link. "Within 48 hours of the email" is a join between `notices` and the document's timestamps, reported as a number per template per week on the existing `/admin` page.

### Account

**1. Sign-in link and code. Change.**

Purpose: get the parent signed in, in one tap or one typed code, with nothing else in the way. Trigger: the parent asks for a link; sent at once. Outcome: the link is verified or the code is typed within 15 minutes. Measure: links sent against links verified, both already in the `magic_links` table, as a weekly rate; a falling rate is the deliverability alarm.

Today's email is close to right and about twice as long as the admired ones. Across 168 captured login-code emails from 123 brands, 64% are plain text, 60% have a single button, the median subject is about 25 characters, and the stated pattern is "large, spaced digits near the top of the email, and ideally in the subject line"; Notion's whole code email is about 42 words, and Instacart's is 102 only because of a phishing paragraph ([Sequenzy](https://www.sequenzy.com/email-examples/saas-magic-link); [Sequenzy, Notion](https://www.sequenzy.com/email-examples/brands/notion/emails/your-temporary-notion-login-code); [Sequenzy, Instacart](https://www.sequenzy.com/email-examples/brands/instacart/emails/005650-is-your-instacart-verification-code)). The code goes into the subject for two practical reasons: a parent who opened the home-screen app and switched to Mail reads it from the notification without opening anything, and a unique subject stops Gmail collapsing every sign-in email into one thread. Notion's "You can sign up by entering the code ... or simply by clicking the magic link" is the model for explaining the choice in one sentence ([Sequenzy, Notion](https://www.sequenzy.com/email-examples/brands/notion/emails/your-notion-signup-code)).

```
Subject (27):  Your sign-in code is 482913
Preheader:     Tap the button, or type the code in the app. Each works once, for 15 minutes.
Headline:      Sign in to Lunch Sorted.
Visual:        none
Lines:         Tap the button below.
               Opened Lunch Sorted from your home screen? Type this code in the app instead:
               [482913, in the code box]
               If you didn't ask for this, ignore it. Nothing changes.
Button:        Sign in  →  https://lunchsorted.app/api/auth/verify?t=…  (a universal link today)
Voice:         product ("we" is not needed; no sign-off)
Headers:       none (transactional; no stop link, no List-Unsubscribe)
Text part:     the same four lines, the URL in full, the code on its own line
```

**2. Household invite. Add, but hold.**

Purpose: bring the other parent into the household when the share sheet did not reach them. Trigger: the inviting parent types an address on Account and taps "Email it"; sent at once; the link is the existing `/app/?join=CODE`. Outcome: the invite is consumed. Measure: invites created against invites consumed, already in the `invites` table, split by share link and email.

The consumer precedents cut both ways. Google's family invite is one sentence naming the inviter, one "Accept invitation" button, a line on what the joiner will see, and a two-week expiry; 1Password's subject is "Join [Account] on 1Password"; but AnyList sends an existing account only a push notification and OurGroceries sends nothing, letting both people type the same address ([Google Families](https://support.google.com/families/answer/6317858); [UW-Madison KB](https://kb.wisc.edu/security/147715); [AnyList](https://help.anylist.com/articles/share-list/); [OurGroceries](https://ourgroceries.com/user-guide)). Lunch Sorted's share link already travels by iMessage, which is where the other parent is. The spec is ready so the decision is cheap; the recommendation is to build it only if the invites table shows links going unconsumed (Part 4).

```
Subject (31):  Sam invited you to Lunch Sorted        (the inviter's first name; falls back to
                                                      "You're invited to Lunch Sorted", 30)
Preheader:     Same week, same list, on your phone too.
Headline:      Sam asked you to pack from the same plan.
Visual:        public/img/screen-week.png cropped to the week strip (new crop via scripts/mail-shots.mjs)
Lines:         You'll see the week, the list and the pack list Sam sees.
               You'll be asked to sign in with your email.
               This link works once and expires in 7 days.
Button:        Join the household  →  https://lunchsorted.app/app/?join=CODE
Voice:         product
Headers:       none (transactional)
Never:         the child's name, the lunchbox's name, any food
```

**3. Account deleted. Add.**

Purpose: confirm that the delete did what the parent asked, and say the one thing the server cannot do for them. Trigger: `POST /api/auth/delete` completes; sent once, after the rows are gone. Outcome: no "was I still charged?" reply. Measure: replies to this template at hello@ (a count the Feedback Desk already keeps), which should be near zero.

No captured consumer app sends a deletion email; Notion's help page sets the tone ("We're sad to see you go, but no hard feelings") and names a restore window ([Notion](https://www.notion.com/help/delete-your-account)). Lunch Sorted has no restore window, which is a reason to send the confirmation, not to skip it. The email matters most for billing: the delete handler cancels any Stripe subscription, but an App Store subscription cannot be cancelled by the server (`netlify/functions/api-apple.js` says so in its own comment), so the one line that must survive is where to cancel it. This is a change-of-standing notice under CAN-SPAM, so no opt-out is needed ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).

```
Subject (23):  Your account is deleted
Preheader:     Everything on our side is gone. One thing to check if you paid through the App Store.
Headline:      Your account is deleted.
Visual:        none
Lines:         Your sign-in, your household's copy on our side, and any invites are gone.
               A Household plan paid on the web is cancelled; nothing more is charged.
               Paid through the App Store? Apple keeps that one until you cancel it:
               Settings › your name › Subscriptions.
Button:        none (there is nothing to open; a text link to the Apple steps is enough)
Voice:         product
Headers:       none (transactional)
Text part:     the same lines
```

### First weeks

The sequence for every new household is the welcome at first sign-in and four education emails on days 1, 3, 6 and 10, counted from the household's first sign-in (the day the server first knows the address). The captured consumer apps run five to eight emails over the first five to fourteen days, front-loaded; Notion's run names exactly one feature per subject and repeats its best feature from four angles across the week rather than touring the product; Linear's is six emails over nine days, one job each ([Sequenzy, Notion](https://www.sequenzy.com/email-examples/brands/notion/sequences/onboarding); [Sequenzy, Linear](https://www.sequenzy.com/email-examples/brands/linear)). Appcues' rule for the genre is "one email, one goal, one action," and the only published numbers for a rewritten series are PostHog's: the personalized, single-ask version opened at 68% with a 16% click rate, the fuller versions fell to 2.4–4% ([Appcues](https://www.appcues.com/blog/onboarding-users-with-email); [PostHog](https://posthog.com/blog/how-we-built-email-onboarding)). Today's day-1 email teaches four screens in four numbered steps; the research says it is being skimmed at best, and the brief says the same in plainer words.

The hour: today's crons fire at 14:00 and 15:00 UTC, which is 7–8am on the West Coast and 10–11am in Maryland. The household document carries the phone's time zone, and Resend's send API accepts `scheduled_at`, so each cron can schedule every email for 7:30am in the household's own zone instead of sending at the server's hour ([Resend API](https://resend.com/docs/api-reference/emails/send-email)). Duolingo's captured habit (Tuesdays, around 9pm UTC) is an observation of one brand, not evidence of a best hour ([Sequenzy, Duolingo](https://www.sequenzy.com/email-examples/brands/duolingo)); morning is an inference from the product (the Week and Shop steps are morning or weekend work, and "tonight" in the kid's-pick email needs to be read before 6pm).

**4. Welcome. Change.**

Purpose: say the one thing the parent needs on day one and set up the reply habit. Trigger: first successful sign-in; sent at once. Outcome: a planned week exists within 48 hours. Measure: share of households sent the welcome whose document carries a planned week within 48 hours.

Today's welcome does four jobs (trial explanation, invite, home screen, what stays free) in two paragraphs, and its first line, "your first three weeks start now," is untrue for anyone who planned before signing in because the 21 days count from household creation. The captured welcomes people admire do one: Duolingo's subject promises "2 important tips" and caps the teaching there; the shortest good ones are under about 110 words; Headspace shows what a four-job welcome becomes (about 165 words and five links); across 1,757 captured welcomes only 29% manage a single button, which is the gap to beat ([Sequenzy, welcome](https://www.sequenzy.com/email-examples/welcome); [Sequenzy, Headspace](https://www.sequenzy.com/email-examples/brands/headspace/emails/welcome-to-headspace); [Loops](https://loops.so/examples/welcome-email-examples)). The invite and home-screen tips move to day 10 and the plan-is-on email, where they belong. The trial sentence becomes exact: the app knows the end date, so the email can say it without promising a start. A parent who joined through an invite gets the same email with the trial line left out; their household's clock is not theirs to be told about.

```
Subject (34):  Welcome. Plan the week in a minute
Preheader:     Everything is on until [Friday, November 13]. No card, nothing to cancel.
Headline:      You're signed in.
Visual:        public/img/mail-day1.png (the Week tab's first day card; already exists)
Lines:         Open Week and tap Plan the week. The boxes are paired for you.
               Everything is on until [weekday, month day], including the Household plan's parts.
               There is no card on file and nothing to cancel.
               Reply to this email with anything. I read every one.
Button:        Plan the week  →  https://lunchsorted.app/app/?go=week
Voice:         Liz, signed "Liz"
Headers:       stop link + List-Unsubscribe (it leads a series)
Joiner variant: lines 2 and 3 dropped; "Sam's week is on your phone now" as line 2
```

**5. Beta welcome. Change (variant of 4).**

Same trigger and measure. The beta tester's version keeps its two facts (the whole planner, free, for good; three short emails coming) and the Facebook group link, loses the paragraph shape, and keeps Liz's voice. "Founding price" never appears; HANDBOOK.md retires "forever" as a sales word, and the current "free, for good" wording stays.

```
Subject (32):  Welcome to the beta. Yours, free
Preheader:     The whole planner, for good. No card, ever. Four short emails this week, from me.
Headline:      Thank you for testing Lunch Sorted.
Visual:        public/img/mail-day1.png
Lines:         Your household has the whole planner, free, for good. Not just for the beta.
               Open Week and tap Plan the week.
               Over the next ten days I'll send four short emails, one part of the app each.
               The other testers and I are in a private Facebook group for the quick stuff. [link]
Button:        Plan the week  →  https://lunchsorted.app/app/?go=week
Voice:         Liz
Headers:       stop link + List-Unsubscribe
```

**6. Day 1: the week, planned in a minute. Change (every household; Shop variant when the week is already planned).**

Purpose: the first win. Trigger: day 1 after first sign-in, 7:30am local. Outcome: a planned week and an opened shopping list. Measure: planned-week-within-48h and list-used-within-48h (the document already carries the Shop tab's check-offs; one check is the signal) for households sent this template.

This is Notion's trick applied cheaply: behavior decides the email, but the behavior is read from the document the server already syncs, not from tracking ([Sequenzy blog](https://www.sequenzy.com/blog/successful-saas-email-marketing-examples)). A household whose document already carries a planned week gets the Shop version; one that does not gets Plan the week. Today's day-1 email carried four steps and three screens; each version below carries one.

```
Version A (no week yet)
Subject (29):  The week, planned in a minute
Preheader:     Open Week, tap Plan the week. Swap any compartment, lock any day.
Headline:      The week, planned in a minute.
Visual:        public/img/mail-day1.png
Lines:         Open Week and tap Plan the week.
               Not sure about something? Tap that compartment and pick another.
               Like a day as it is? Tap the lock and the next plan leaves it alone.
Button:        Plan the week  →  https://lunchsorted.app/app/?go=week

Version B (week already planned)
Subject (19):  Your list, by aisle
Preheader:     Shop has the week's groceries sorted by aisle. Check off what's home.
Headline:      Your list is already written.
Visual:        new crop of public/img/screen-shop.png, the aisle list only (scripts/mail-shots.mjs)
Lines:         Open Shop. Everything the week needs, by aisle.
               Check off what's already home.
               Copy it, or Send it to Notes or a text.
Button:        Open the list  →  https://lunchsorted.app/app/?go=shop

Voice:         Liz (one line of "in my house" is allowed; no paragraph)
Headers:       stop link + List-Unsubscribe
Beta variant:  the button reads "Tell me how it went" → https://lunchsorted.app/feedback.html,
               with one question above it ("Did the boxes make sense for your kid?")
```

**7. Day 3: the kid's pick. Change (every household).**

Purpose: switch on the feature the product is proudest of, before the week's habits set. Trigger: day 3 after first sign-in, 7:30am local, so "tonight" is read before the 6pm night-before reminder. Outcome: the kid's pick switched on. Measure: share of households sent this template whose document shows the pick switched on within 7 days.

The captured apps send a nudge on day 1 and their first content email on day 2 to 4 (Calm day 2, Headspace day 4, Notion daily), so day 3 is inside the window where a lesson lands ([Growth Snippets](https://growthsnippets.substack.com/p/every-email-calm-sent-me-after-i); [Reteno](https://gallery.reteno.com/flows/emails-headspace)). The two modes (Each part, Whole box) stay as one line, not a second ask.

```
Subject (26):  Tonight, let your kid pick
Preheader:     In my house, a lunch they chose comes home emptier.
Headline:      Let them pick.
Visual:        public/img/mail-day3.png (two pictures to choose between; already exists)
Lines:         Beside your kid's name, switch on They pick their box each day.
               Tonight, open Pack, tap the Let … pick button, and hand over the phone.
               Each part lets them build it; Whole box picks between finished boxes.
Button:        Open Pack  →  https://lunchsorted.app/app/?go=pack
Voice:         Liz
Headers:       stop link + List-Unsubscribe
Beta variant:  button "Which did your kid take to?" → /feedback.html
Never:         the child's name (the app's button carries it; the email never does)
```

**8. Day 6: the after-school review. Change (every household).**

Purpose: start the feedback loop that makes week two better than week one. Trigger: day 6 after first sign-in, 7:30am local. Outcome: a review answered. Measure: share of households sent this template whose document records a review answer within 7 days.

Today's day-6 email carries four steps, the planned-features list and three questions. The review alone is the lesson, and the one fact that makes it worth a tap is the rule: two came-homes in a row rest a food for three weeks. Recipes and Add your own move to day 10 and out of this email entirely.

```
Subject (28):  After school: what came home
Preheader:     One tap when the box is home, and next week leans toward what got eaten.
Headline:      What came home.
Visual:        public/img/mail-day6.png (All eaten, or the four answers under each food; exists)
Lines:         When the box is home, Pack asks how it went.
               Tap All eaten, or answer under each food.
               A food that comes home twice in a row sits out for three weeks.
Button:        Open Pack  →  https://lunchsorted.app/app/?go=pack
Voice:         Liz
Headers:       stop link + List-Unsubscribe
Beta variant:  button "Would you keep using it? Tell me why" → /feedback.html,
               and the planned-features list as five short lines above it (testers only)
```

**9. Day 10: add your own foods. Add.**

Purpose: get the household's real food into the planner, which is what makes the list and the pairing theirs. Trigger: day 10 after first sign-in, 7:30am local. Outcome: at least one food added by the household. Measure: share of households sent this template whose document carries a parent-added food within 7 days.

This is the fourth and last education email; the memory note from the onboarding design holds Recipes until week two and this is that slot. Seven emails in three weeks (welcome, four lessons, two trial notices) sits inside the consumer range and well under the frequency at which a secondary survey reports over half of US consumers unsubscribing (four or more marketing messages from one sender in a month, a figure of unclear provenance, treated here as a ceiling to stay under, not a fact) ([EmailListValidation](https://emaillistvalidation.com/blog/unsubscribe-rate-by-send-frequency-how-often-is-too-often/)). A fifth lesson (Recipes and Import a recipe) is specified in the project's onboarding draft but not recommended now: the idea bank's two recipes are already in the free tier and discoverable from the Recipes tab.

```
Subject (18):  Add your own foods
Preheader:     What to buy for it goes on the list. The planner pairs it like the rest.
Headline:      Your family's real food.
Visual:        new crop of store/screenshots/08-foods's source screen without its baked headline
               (re-shoot the Foods tab through scripts/mail-shots.mjs; never ship the composed
               store image, see Part 2)
Lines:         On Foods, tap Add your own.
               Give it a name and what to buy for it.
               It joins the pairing and the list from the next Plan the week.
Button:        Open Foods  →  https://lunchsorted.app/app/?go=foods
Voice:         Liz
Headers:       stop link + List-Unsubscribe
```

### Trial

Lunch Sorted's trial takes no card and ends in a free tier where nothing is deleted, so the reminder is a product choice, not a legal one: California's amended Automatic Renewal Law requires a pre-expiry notice only for trials longer than 31 days, and Stripe's hosted seven-day reminder exists for card-on-file trials ([Cooley](https://www.cooley.com/news/insight/2025/2025-06-04-california-automatic-renewal-law-amendments-take-effect-on-july-1-2025); [Stripe](https://docs.stripe.com/billing/revenue-recovery/customer-emails)). The worry that a reminder lowers conversion has no published support; the two cases found went the other way (ShareFile's 2007 A/B: 62% paid conversion with a three-day reminder against 53% without; Blinkist, reported second-hand: trial starts up 23%, cancellations down 4%), and RevenueCat's 2025 data shows parents already set their own reminders ([MarketingSherpa](https://marketingsherpa.com/article/case-study/simple-email-cancellation-reminder-lifts); [Indie Hackers](https://www.indiehackers.com/post/tip-increase-trial-signups-by-notifying-users-when-their-trials-are-about-to-end-51d2e789bf); [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2025/)). Among 212 captured trial-ending emails the median subject is 38 characters, the typical send is day 10 of 14 (about three days out), 58–63% have one button, and discounts appear in 2 of 212; the price is not in the reminder, it is on the page the button opens ([Sequenzy](https://www.sequenzy.com/email-examples/trial-ending)). The freemium precedents frame it as keep, not lose: Sendbird's "keep your free account," Sentry's "What to expect," Todoist's and Notion's "nothing is lost, X becomes view-only" ([Sequenzy, Sendbird](https://www.sequenzy.com/email-examples/brands/sendbird/sequences/onboarding); [Sequenzy, Sentry](https://www.sequenzy.com/email-examples/brands/sentry/sequences/onboarding); [Todoist](https://ai.todoist.com/help/articles/what-happens-when-i-downgrade-dOhlH9qQe); [Notion](https://www.notion.com/help/plan-downgrade)).

Is a second nudge ("ends tomorrow") warranted? The captured sequences cluster at 3, 2 and 1 days out, but those are card-on-file trials where the next day costs money ([Sequenzy](https://www.sequenzy.com/email-examples/trial-ending)). Here nothing is charged, the ended email is itself the second touch, and the Dropbox forum shows what an over-stated loss email costs in trust ([Dropbox Community](https://dropboxforum.com/discussions/101001018/i-received-an-email-that-my-trial-has-ended-but-i-have-a-paid-subscription/801749)). Recommendation: two emails, not three; revisit if the ending-to-plan rate is low and the ended-to-plan rate is lower still, which would say parents wanted a last call. The owner decides (Part 4).

**10. Three weeks ending. Change.**

Purpose: say what pauses and what stays, with the one tap that keeps everything on. Trigger: the existing cron window (end in 1–4 days; first hit wins), sent at 7:30am local. Outcome: the Household plan started before the end. Measure: entitlement rows from Stripe or the App Store written within 7 days of the send, as a share of households sent.

The subject keeps the weekday and drops the date (35 characters at its longest, "Wednesday"); the headline carries the full date. The price line comes out of the email and stays on the plan pane, for three reasons: the captured norm, the pending Supreme Court case on Apple's anti-steering rules (the live guideline permits out-of-app communication about other purchase methods, but the US carve-out is what certiorari puts at risk), and the fact that an iPhone household may buy at the App Store's price rather than Stripe's ([Sequenzy](https://www.sequenzy.com/email-examples/trial-ending); [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/); [IPWatchdog](https://ipwatchdog.com/2026/06/30/high-court-grants-cert-in-apples-challenge-to-ninth-circuit-contempt-ruling-in-app-store-dispute/)). The owner may overrule (Part 4); if so, the existing `priceWords` line stays and is always read from Stripe.

```
Subject (32–35):  Your free three weeks end Friday
Preheader:     Nothing disappears. Here is what pauses, and the tap that keeps it on.
Headline:      Everything is on until Friday, November 13.
Visual:        none (a screenshot here reads as a sales page; the captured reminders carry none)
Lines:         Stays free, for good: the week's plan, the shopping list, the pack list, the idea bank.
               Pauses: your own foods, the kid's pick, the after-school review, the pantry,
               a second lunchbox, a second phone.
               The Household plan keeps all of it on. Do nothing, and the free planner carries on.
Button:        Keep everything on  →  https://lunchsorted.app/app/?upgrade=1
Voice:         product
Headers:       stop link + List-Unsubscribe (CAN-SPAM reads it as a change-of-standing notice while
               the subject stays a notice; the headers cost nothing)
```

**11. Three weeks up. Change.**

Purpose: confirm what still works, name what paused, and say it is the last word. Trigger: the existing cron window (ended within the last 2 days; never to a household whose paid plan ended). Outcome: the plan started, or a settled free household that does not stop mail. Measure: entitlement rows within 14 days of the send; stop-link taps on this template as a share of sends (the `mail_ok` flip is already counted on `/admin`).

Duolingo's re-engagement stops after two emails, the second titled "Your last reminder from me"; Calm's goes quiet after day 10 ([Sequenzy, Duolingo](https://www.sequenzy.com/email-examples/brands/duolingo); [Growth Snippets](https://growthsnippets.substack.com/p/every-email-calm-sent-me-after-i)). "This is the last email about it" stays, and is true: nothing in the program emails the free household about the plan again except the once-only quiet nudge and the seasonal send, both of which are about the planner, not the plan.

```
Subject (23):  Your three weeks are up
Preheader:     The free planner carries on. Everything you made is still there.
Headline:      Everything you made is still there.
Visual:        none
Lines:         Still free: the week's plan, the shopping list, the pack list, the idea bank.
               Paused, exactly as you left it: your own foods, the kid's pick, the review, the pantry.
               The Household plan switches it back on. This is the last email about it.
Button:        Switch it back on  →  https://lunchsorted.app/app/?upgrade=1
Voice:         product
Headers:       stop link + List-Unsubscribe
```

### Billing

Stripe and the App Store already send the receipts and the dunning. Stripe emails a receipt after each successful payment when the setting is on, sends a failed-payment email after every Smart Retry (the recommended default is 8 tries in 2 weeks), an expiring-card email a month ahead, and renewal reminders at a configurable lead, each with a hosted update-card link in the account's branding ([Stripe, receipts](https://docs.stripe.com/payments/advanced/receipts); [Stripe, customer emails](https://docs.stripe.com/billing/revenue-recovery/customer-emails); [Stripe, Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)). On iPhone, Apple runs its own retries, a billing grace period of 3, 16 or 28 days, and from iOS 16.4 a system sheet in the app that asks for a new card ([App Store Connect Help](https://developer.apple.com/help/app-store-connect/manage-subscriptions/enable-billing-grace-period-for-auto-renewable-subscriptions); [Apple](https://developer.apple.com/app-store/subscriptions/)). Baremetrics' million-email dunning dataset says the day-0 email recovers most (13.25%) and anything after day 15 a third as much, so adding a founder-written dunning email on top of Stripe's eight would add volume without recovery; Lunch Sorted should turn Stripe's emails on and write none of its own ([Baremetrics](https://baremetrics.com/blog/improve-dunning-recovery-rate)). The app already tells a household whose first charge failed, in the plan's own words (the cron skips it on purpose). A price-change notice is not needed while the founding price is kept for the household's life; if it ever rises, Apple handles its side automatically and California requires 7–30 days' notice on the web ([Apple](https://developer.apple.com/app-store/subscriptions/); [California AG](https://oag.ca.gov/news/press-releases/attorney-general-bonta-issues-consumer-alert-california%E2%80%99s-automatic-renewal-law)). What neither platform sends is the cross-platform fact a parent of this product needs: that a plan bought on one side works on the other, and how.

**12. The Household plan is on. Add.**

Purpose: confirm the plan from Lunch Sorted's side, say where it works and where it is managed, and turn the purchase into the second phone. Trigger: an entitlement row written by Stripe's webhook or Apple's notification for a signed-in household (a purchase signed out has no address, and joins the household at the next sign-in, when this email then goes); once per plan start; never for a beta code. Outcome: the other parent joins, or at least nothing is bought twice. Measure: households with a second adult member within 14 days of the send; refunds and duplicate purchases across platforms (already visible in Stripe and App Store Connect).

```
Subject (24):  The Household plan is on
Preheader:     On every phone that signs in to your household. Paid once, works everywhere.
Headline:      Thank you. The Household plan is on.
Visual:        none
Lines:         Everything is on again: your own foods, the kid's pick, the review, the pantry,
               another lunchbox, another phone.
               It works on every phone that signs in to this household, web or iPhone.
               Paid on iPhone: manage it in Settings › your name › Subscriptions.
               Paid on the web: Manage billing on Account.
Button:        one member →  Add the other parent  →  https://lunchsorted.app/app/?go=account
               two or more →  Open the planner    →  https://lunchsorted.app/app/
Voice:         Liz ("Thank you" is hers)
Headers:       none (transactional: confirms a transaction)
```

### Ongoing

**13. The quiet household. Add, once only.**

Purpose: one honest tap back for a household that stopped, with nothing to sell. Trigger: a signed-in household whose document has not synced for 14 days, eligible from day 28 after first sign-in so it never stacks on the trial notices; sent once in the household's life, Sunday 4pm local. Outcome: a sync within 7 days. Measure: share of households sent that synced within 7 days, against the share of equally quiet households not yet sent (a natural comparison from the same table, no tracking).

Behavior-triggered beats calendar-triggered in the captured sequences (Notion's quiet-user prompt), and the win-back evidence says to stop early: Klaviyo's study of e-commerce win-backs found revenue per recipient falls after the third email and the best subject was the plain "It's been awhile" (35% open); Duolingo sends two and stops ([Sequenzy blog](https://www.sequenzy.com/blog/successful-saas-email-marketing-examples); [Marketing Dive on Klaviyo](https://www.marketingdive.com/news/study-limit-win-back-email-campaigns-to-3-sends/506339/)). No source addresses when to stop emailing a free-tier household that never paid, so this program sends one and stops, which is the conservative reading. The Sunday-afternoon hour is inference from the family-app convention below.

```
Subject (32):  The planner is where you left it
Preheader:     Next week's boxes take a minute. Nothing has moved.
Headline:      Still here, where you left it.
Visual:        public/img/mail-day1.png
Lines:         Everything you made is still in the planner.
               Open Week, tap Plan the week, and next week is done.
               If lunches have changed, tell me what happened. I read every reply.
Button:        Plan the week  →  https://lunchsorted.app/app/?go=week
Voice:         Liz
Headers:       stop link + List-Unsubscribe
```

**14. Back to school. Add later; the owner picks the dates.**

Purpose: meet the calendar the product lives on. Trigger: a date, once in late summer and once in early January, to every household with mail on; sent through the same API path as the rest (not Resend Broadcasts, which would mean uploading the address list to Resend's contact store). Outcome: planned weeks in the first school week. Measure: planned-week-within-7-days among recipients, as a count.

None of the sources address seasonal products; the calendar moments are inference from what the product is. The one-email, no-discount shape follows RevenueCat's win-back guidance (ask at all matters more than discount size; 20% and 30% converted the same) and the Klaviyo ceiling of three ([RevenueCat](https://www.revenuecat.com/blog/growth/win-back-customers-how-to-guide.md); [Marketing Dive](https://www.marketingdive.com/news/study-limit-win-back-email-campaigns-to-3-sends/506339/)). US school start dates vary by state and district, which is why the date is the owner's.

```
Subject (34):  School starts. Plan the first week
Preheader:     Open Week, tap Plan the week. The list writes itself.
Headline:      The first week back, planned in a minute.
Visual:        public/img/mail-day1.png (or a fresh seasonal crop of the Week tab)
Lines:         Open Week and tap Plan the week.
               Shop has the groceries by aisle.
               Tomorrow morning, Pack has the box.
Button:        Plan the week  →  https://lunchsorted.app/app/?go=week
Voice:         Liz
Headers:       stop link + List-Unsubscribe; CAN-SPAM treats this as commercial, so the footer
               needs the postal address (Part 2)
```

**15. The weekly plan-your-week nudge. Do not send; spec held.**

The recommendation is no, on four grounds that stack. First, a weekly email with the week's lunches in it is impossible under the product rules: nothing about the child, foods included, goes into an email, and the server would in any case be writing the household's foods into a third party's outbox. Second, a contentless nudge ("Sunday: plan the week") duplicates what the app already does on the phone (the Pack dot, the ring on a lunchbox tab, the 6pm night-before reminder on iPhone). Third, the family-app convention is opt-in and sparse: Cozi's weekly agenda goes out Sundays only to the family members who switch it on, eMeals lets the subscriber pick the day, and no study links a weekly digest to retention in a subscription app ([Cozi](https://www.cozi.com/blog/be-prepared-with-agenda-emails/); [eMeals](https://support.emeals.com/portal/en/kb/articles/can-i-get-my-weekly-meal-plan-menu-emailed-to-me)). Fourth, Resend's free plan is 100 emails a day; a Sunday send to every household competes with that day's sign-in links, which must never lose ([Resend](https://resend.com/docs/knowledge-base/resend-sending-limits)). MailerLite's 2025 data over 1.4 million campaigns does show weekly newsletters carry a lower unsubscribe rate (0.38%) than monthly (0.54%) or irregular ones (0.87%), but those are newsletters people subscribed to, not nudges from an app ([MailerLite](https://www.mailerlite.com/blog/email-cadence-and-frequency-best-practices)).

If the owner overrules: an Account switch, off by default; Sunday at 4pm in the household's zone (Cozi's "add changes by Saturday night" and a Monday school week make Sunday afternoon the inference; there is no primary data on the hour); subject "Sunday: plan the week" (21); no content from the household; one button to `?go=week`; RFC 8058 headers; and it stops itself for any household whose document shows the week already planned by Sunday noon.

## Part 2. The design rules the research supports

**Layout and type.** One column in a fluid table that is at most 600px wide and collapses to 100% under 480px with 20–24px side padding, which on a 390px iPhone gives a measure of 40–55 characters at 16–17px, comfortably under WCAG's 80-character ceiling; body 16–17px with line-height 1.5, the headline 22–28px, left-aligned, never justified ([Mailchimp](https://templates.mailchimp.com/design/mobile-friendliness/); [W3C 1.4.8](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)). The button is an `<a>` with padding, at least 44px tall and full-width under 480px, which meets WCAG 2.5.5 (AAA, 44px) and not merely 2.5.8 (AA, 24px), and matches the app's own 44px rule ([W3C 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html); [W3C 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). The order on the page is headline, image, lines, button, so that the F-pattern's top bar covers the headline and image and its left stem reaches the button without a scroll; both the Calm teardown and the Really Good Emails critique of Headspace fault the same thing, a button too far down ([NN/g](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/); [Growth Snippets](https://growthsnippets.substack.com/p/every-email-calm-sent-me-after-i); [Really Good Emails](https://reallygoodemails.com/emails/fit-headspace-into-any-day-or-night/info)). "Hero screenshot, headline, one button" as a layout has no measured study behind it; it is the reasoned default, and Part 3 says so. The existing shell in `mail.js` already does most of this (560px card, 17px Karla body, 26px headline, a padded `<a>` button); the changes are the mobile button width and the `pic` helper's dimensions.

**Screenshots.** Serve every image at twice its displayed CSS width with explicit `width` and `height` attributes, keep each under about 200KB, and never let text in an image carry meaning: images are blocked by default in desktop Outlook and AOL, proxied by Gmail and Apple, missing alt text in 51% of the 443,585 emails the Email Markup Consortium checked, and inverted unpredictably in Gmail's dark mode ([Litmus](https://www.litmus.com/blog/the-ultimate-guide-to-email-image-blocking); [EMC 2025](https://emailmarkup.org/en/reports/accessibility/2025/)). That rules out the eight App Store screenshots with their baked headlines; the five 750x1624 marketing screens are 2x for a 375px slot but two phone-screens tall, so crop to the region the email is about (a day card, the pick grid, the aisle list) at 280–320px wide and no more than about 420 CSS px tall, which is exactly what `scripts/mail-shots.mjs` does for the three existing crops; extend it rather than hand-crop. No source measured a phone frame against a bare crop; the frame adds bytes and width and shows the parent the phone they are holding, so the bare rounded crop stays. Animated GIFs play in Apple Mail and the Gmail app, show only a first frame in old Outlook, and the one controlled study found animation raised negative word choice 40%, cut positive 30%, and lowered trust (3.90 against 4.34 on 7) except when it demonstrated the product; a two-frame loop of the kid's pick is the only candidate, the first frame must stand alone, and a still is the default ([Can I Email](https://www.caniemail.com/features/image-gif/); [NN/g](https://www.nngroup.com/articles/gif-emails/)). The vendor case for GIFs (Dell's "42% more clicks") is folklore (Part 3). Alt text describes the screen in the parent's words and never carries a name, even the demo's.

**Dark mode.** Litmus's February 2025 table is the newest client-by-client source: Apple Mail honors `prefers-color-scheme` and otherwise leaves the design alone; the Gmail iOS app fully inverts with no media-query support; Gmail Android partially inverts; Gmail web does nothing ([Litmus](https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers)). The shell already declares both color-scheme metas and swaps the app's dark tokens under the media query, which about three quarters of this audience will honor; add `:root { color-scheme: light dark }`, give every text element its own color (already done inline), and check the Gmail-inverted rendering of the accent button (#2A5141 on #FBFCF9) against 7:1, since inversion is the one case the token set was not designed for. Screenshots stay light by default and swap to dark only under the media query; a dark screenshot inverted by Gmail becomes a washed-out light one. The "80% use dark mode" figure is unattributed; Litmus's own number is an average of 35% in 2022 ([Litmus](https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers)).

**Fonts and the Google Fonts question.** Apple Mail and Samsung Email load `@font-face`; Gmail, Yahoo and AOL never do; Outlook for Windows ignores the remote file ([Can I Email](https://www.caniemail.com/features/css-at-font-face/)). The shell's `<link>` to fonts.googleapis.com therefore shows Familjen Grotesk and Karla to roughly three quarters of opens and sends each of those opens' requests to Google (through Apple's proxy, which hides the IP, but still a third-party fetch triggered by the email). A Munich court fined a site operator in 2022 precisely for loading Google Fonts from Google's servers without consent, reasoning that self-hosting is a cost-free alternative; US law does not say the same, but the product's own promise ("nothing of the household leaves the phone, no analytics SDKs") does ([activeMind.legal](https://www.activemind.legal/guides/ruling-google-fonts/)). Two honest options: self-host the three woff2 files on lunchsorted.app (first-party, one server log line per Apple Mail open, no Google), or drop web fonts and let the stacks fall to San Francisco and Roboto/Arial, which already works for the Gmail quarter today. The recommendation is to drop them: the brand is carried by the voice, the tokens and the screenshots, and a sans-serif system face is what the app's own Gmail readers already see. The owner decides (Part 4). Either way, the font name stays first in the stack only if `mso-font-alt` is added; at 3.48% of opens Outlook does not matter here ([Litmus](https://www.litmus.com/email-client-market-share); [Can I Email](https://www.caniemail.com/features/css-at-font-face/)).

**Accessibility.** The 2025 EMC report found 99.89% of emails with serious or critical issues; the top defects are mechanical: body missing `dir` (98%) and `lang` (97%), layout tables without `role="presentation"` (86%), no `<h1>` (77%), links without discernible text (72%), contrast (59%), missing alt (51%), missing `<title>` (41%) ([EMC 2025](https://emailmarkup.org/en/reports/accessibility/2025/)). The shell already has `lang`, a `<title>` equal to the subject, presentation roles, one `<h1>` and a real `<a>` button; it lacks `dir="ltr"`. Keep 7:1 for text (4.5:1 at 24px, or 18.66px bold) in both palettes per WCAG 1.4.6, extend `npm run contrast` to the email tokens including a Gmail-inverted approximation, and keep link text that names the destination ("Open the list," never "here") ([W3C 1.4.6](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html)). State is never shown by fading or color alone, which is the app's rule and WCAG 1.4.1's.

**Plain text.** Keep the hand-written `text` part Resend is already given; Resend would otherwise generate one from the HTML, and auto-generated text from table layouts carries stray spaces and out-of-order alt text ([Resend API](https://resend.com/docs/api-reference/emails/send-email)). Apple Watch shows only the plain-text part, which is reason enough for it to mirror the HTML: the headline, the lines, the one URL written out in full (never a redirect), the stop URL on lifecycle mail, lines under 78 characters ([MacTrast](https://www.mactrast.com/2015/05/html-handler-quirk-allows-email-content-visible-only-on-apple-watch/amp/); [Suped](https://suped.com/email-deliverability/answers/should-i-still-send-multipartalternative-emails)). The claim that a missing text part hurts deliverability is weakly evidenced; the Watch and notification cases are the real reasons.

**Headers, unsubscribe and the law.** Below 5,000 messages a day Lunch Sorted is an "all senders" sender for Gmail: SPF or DKIM, a PTR record, TLS, RFC 5322 formatting, and a spam rate under 0.3% with 0.1% as the target; Yahoo's page states no volume threshold and asks for both SPF and DKIM, DMARC at least `p=none`, and a working one-click unsubscribe ([Google](https://support.google.com/a/answer/81126); [Google FAQ](https://support.google.com/a/answer/14229414); [Yahoo](https://senders.yahooinc.com/best-practices/)). Do the bulk-sender set anyway because it is cheap and Gmail said in November 2025 it is ramping up enforcement on non-compliant traffic: the sender already lives on the subdomain Resend recommends (mail.lunchsorted.app); add DMARC `p=none` with a `rua` address and a custom Return-Path so SPF aligns as well as DKIM ([Resend, domains](https://resend.com/docs/dashboard/domains/introduction); [Resend, DMARC](https://resend.com/docs/dashboard/domains/dmarc)). Resend does not add `List-Unsubscribe` to API sends; the `send()` call in `mail.js` must pass `headers: { 'List-Unsubscribe': '<https://lunchsorted.app/api/auth/mail-stop?t=TOKEN>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }` on every lifecycle email (4–11, 13–14) and none on the transactional ones (1–3, 12) ([Resend](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails)). RFC 8058 requires the POST to work with no human present and no redirect, the URI to carry an opaque token, and both headers to be inside the DKIM signature's `h=` tag; the existing `mail-stop` handler reads the token from the form body on POST, so it must also read it from the query string and answer a blank 200, and whether Resend's DKIM covers those headers is undocumented and needs one test send read through Gmail's "Show original" ([RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058)). CAN-SPAM treats a trial notice and a deletion confirmation as relationship content, but the education emails, the quiet nudge and the seasonal send are the kind a regulator reads as commercial, and commercial email must carry a valid physical postal address, which today's footer lacks ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)). Which address is the owner's call (Part 4); the cheapest compliance is to put it on every lifecycle email and skip the argument.

**Resend specifics.** The free plan is 100 emails a day, 3,000 a month, and 30 days of log retention; Pro is $20 a month with no daily cap ([Resend pricing](https://resend.com/pricing); [Resend limits](https://resend.com/docs/knowledge-base/resend-sending-limits)). A household in its first three weeks receives up to nine emails under this program (one or two sign-in links, the welcome, four lessons, two trial notices), so roughly ten new households a day exhausts the free tier, and the failure that matters is a sign-in link refused at 9pm because the morning's crons spent the day's hundred. Until Pro, the crons should share a daily budget (say 50 between them) and leave the rest for sign-ins; `PER_RUN` is already there to carry it. Use `tags` with the template name only (`template=day3`), never a household or person identifier, so webhook events can be grouped without naming anyone; use `scheduled_at` for the local-hour send; leave open and click tracking off, which is Resend's default and is set per domain ([Resend, tags](https://resend.com/docs/dashboard/emails/tags); [Resend, tracking](https://resend.com/docs/dashboard/domains/tracking)). Send everything, the seasonal email included, through the API from the crons rather than Broadcasts, so no address list lives in Resend's contact store; whether Broadcasts add the one-click POST header automatically could not be confirmed anyway.

**Deep links.** Today's AASA lists only `/api/auth/verify`, so the sign-in link opens the iPhone app and every other link in every email opens Safari. Add `/app/*` to the `applinks` components; the app's `appUrlOpen` handler already loads any lunchsorted.app URL, so `?go=week` will land on Week inside the app ([Capacitor](https://capacitorjs.com/docs/guides/deep-links)). Three landings then exist and all must work: the iPhone app from an Apple Mail tap; Safari or Chrome from the Gmail app (which may open Chrome, and whose link handling has been reported to defeat universal links), where the web app must recognize the session or offer the sign-in link in one tap; and Safari for home-screen PWA households, where iOS still routes Mail links to Safari rather than the installed web app, which is the reason the sign-in email carries a code at all ([Apple Developer Forums](https://developer.apple.com/forums/thread/757122); [Glide community](https://community.glideapps.com/t/open-url-from-other-app-in-pwa/59048); [WebKit bug 247270](https://bugs.webkit.org/show_bug.cgi?id=247270)). Never wrap a link in a tracking redirect: iOS evaluates the first URL tapped, so a redirect hop sends the parent to Safari; Customer.io documents the same failure for its own tracked links ([Customer.io](https://docs.customer.io/journeys/universal-links)). Test the Gmail app on a device before launch; the 2025–26 behavior rests on older write-ups.

**Measurement without the person.** Apple's Mail Privacy Protection loads remote content through Apple's proxy and hides whether the email was opened; Litmus puts MPP at 55–60% of all opens, which is why a 2025 median "open rate" of 43% includes millions of opens nobody made ([Apple](https://www.apple.com/privacy/features/); [Litmus](https://www.litmus.com/email-client-market-share); [Webtonic](https://www.webtonic.io/blog/open-rate-statistics)). So: no pixel, and no click tracking, which rewrites every link through a tracking subdomain, records a per-person click at Resend, and breaks the universal link ([Resend](https://resend.com/docs/dashboard/domains/tracking)). The measures in Part 1 are all outcomes the server can count from rows it already holds, joined by household id to the `notices` row and reported as counts per template per week; delivery health (bounces, complaints, suppressions) comes from Resend's webhooks, which carry no reading behavior, grouped by the template tag ([Resend, webhook events](https://resend.com/docs/dashboard/webhooks/event-types)); the spam rate comes from Google Postmaster Tools once the domain is verified there. If a click count is ever wanted, a first-party `/go/<template>` path listed in the AASA that increments one integer per template per day and 302s to the app would count taps without identifying anyone; no major client pre-fetches link targets, so the count would be clean of proxy noise, but this is inference and needs a device test on both landings before it is trusted. Before enabling even delivery webhooks, read the payload reference: the event-type page does not say whether `email.delivered` carries anything beyond the address.

## Part 3. What is solid, what is folklore, and what nobody could find

The solid ground is narrower than the volume of email advice suggests, and it is enough. The behavioral core rests on primary research with sample sizes: Litmus's read-time series (13.4 seconds in 2018 to 8.97 in 2022, from billions of opens) and its September 2026 client share (Apple 76.56%, Gmail 16.10%, Outlook 3.48%); NN/g's eyetracking (the F-pattern, 2006 and reconfirmed on mobile in 2017), its newsletter studies (51 seconds per issue, 19% read thoroughly, scannability "about 50% more important for newsletters than for websites"), and its controlled GIF study (121 respondents, p < 0.005); the EmailToolTester device measurements of 48/37/33 subject characters; the Email Markup Consortium's 443,585-email accessibility audit ([Litmus](https://www.litmus.com/blog/trends-in-email-engagement); [Litmus](https://www.litmus.com/email-client-market-share); [NN/g](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/); [Wylie, quoting NN/g](https://wyliecomm.com/2022/08/skim-scan-read); [NN/g](https://www.nngroup.com/articles/gif-emails/); [EmailToolTester](https://www.emailtooltester.com/en/blog/email-subject-lines-character-limit/); [EMC 2025](https://emailmarkup.org/en/reports/accessibility/2025/)). The rules are primary documents read directly: WCAG 2.2, RFC 8058, Google's and Yahoo's sender pages, the FTC's CAN-SPAM guide, Stripe's and Resend's documentation, and the live text of App Store Review Guideline 3.1.3. The comparables are real captures with dates (Sequenzy's September–October 2026 sign-up flows and its category statistics over 168 code emails, 1,757 welcomes and 212 trial-ending emails; Reteno's Headspace and Calm flows; a first-person year of Calm's mail), which settle timing, subjects and button counts but mostly not body copy. On trials and retention, the controlled or large-sample evidence is ShareFile's 2007 A/B, RevenueCat's 2025 report over 75,000 apps, Baremetrics' million-email dunning curve, Klaviyo's 2017 win-back study and MailerLite's 2025 cadence data ([MarketingSherpa](https://marketingsherpa.com/article/case-study/simple-email-cancellation-reminder-lifts); [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2025/); [Baremetrics](https://baremetrics.com/blog/improve-dunning-recovery-rate); [Marketing Dive](https://www.marketingdive.com/news/study-limit-win-back-email-campaigns-to-3-sends/506339/); [MailerLite](https://www.mailerlite.com/blog/email-cadence-and-frequency-best-practices)). Each of these is old, or from another industry, or both; the report leans on them for direction, not for a number to promise.

The folklore is the part the owner will hear quoted back by agencies, and none of it should appear in a Lunch Sorted brief. "A single CTA increased clicks 371% and sales 1,617%" traces to a 2014 blog post with no study behind it, and the only large-sample CTA study (Omnisend, 229 million holiday e-commerce emails) found two or three buttons beat one, which is why this report argues one button from reading time and focus, not from that figure ([Campaign Monitor](https://campaignmonitor.com/resources/knowledge-base/do-ctas-help-to-improve-email-response-rates); [Bloggers Passion](https://bloggerspassion.com/call-to-action-statistics/)). "Buttons lift clicks 127%" is unsourced; Dell's "42% more clicks from a GIF" is a 2012 vendor anecdote repeated for fourteen years; "over 70% of email is opened on mobile" and "over 80% use dark mode" have no traceable origin; "63% say onboarding emails influence retention" and its siblings circulate on vendor blogs without a study; the UK agency's 412,000-signup onboarding cohort is suspiciously precise and unverifiable; "5–15% conversion on trial-ending emails" and "a 5-email dunning sequence recovers 28–35%" are uncited vendor lines; "responsive email gets 15% higher click-to-open" could not be traced to the Litmus report it is credited to ([FulcrumTech](https://fulcrumtech.net/blog/how-to-use-animated-gifs-in-email-marketing/); [Userpilot](https://userpilot.com/blog/onboarding-email-best-practices/); [Visionary Marketing](https://visionary-marketing.co.uk/blog/customer-onboarding-statistics-2026); [DEV Community](https://dev.to/insightlab/the-dunning-email-sequence-that-recovers-30-of-failed-payments-2edh)). Two figures sit in between and are used here with their labels on: the 2022 glance/skim/read split (30/41/29) is Litmus data reported second-hand by a page that could not be re-read, and the Blinkist reminder result is Blinkist's own account relayed by Indie Hackers.

The gaps matter most where the brief wanted them least. Not one actual email from a food or family app was captured: Mealime, Paprika, Plan to Eat, eMeals, Samsung Food, Yummly, Cozi, AnyList, OurGroceries, HelloFresh and Instacart's onboarding are represented only by help-center descriptions, because Really Good Emails' brand pages returned 404 for every brand tried and Milled sat behind a bot check; a first-hand sign-up to each is the only way to close that, and it is a week of inbox-watching, not research. Nobody has measured app screenshots in onboarding email (PostHog's illustration-beats-screenshot result is one B2B team's A/B), a phone frame against a bare crop, or an educational email's effect on return visits separately from a nudge's. Apple's own trial-ending email for third-party subscriptions is not documented anywhere Apple writes, and the developer forum thread asking has no Apple answer, so the program assumes Apple sends none ([Apple Developer Forums](https://developer.apple.com/forums/thread/95882)). Whether the Gmail iOS app still fully inverts in 2026, whether Resend's DKIM signs the `List-Unsubscribe` headers, whether Broadcasts add the one-click POST header, what Resend's webhook payloads carry, and whether the Supreme Court has stayed any part of the Ninth Circuit's Apple ruling were all unanswerable from the sources reached; each is a one-hour check before launch, listed in Part 4 where it needs the owner and in the implementation ticket where it does not.

## Part 4. Decisions only the owner can make

1. **Postal address in the footer.** CAN-SPAM requires a valid physical postal address on commercial email; the education, quiet and seasonal emails are the ones most likely read that way. Which address (a PO box, a registered-agent address) goes on every lifecycle email.
2. **Web fonts.** Drop the Google Fonts link and ship the system stack (recommended), or self-host the three woff2 files on lunchsorted.app. Either ends the third-party fetch; only the first ends every fetch.
3. **The price in the trial emails.** Leave it on the plan pane (recommended: the captured norm, the pending Apple case, the App Store's own price), or keep the Stripe-read price line as today.
4. **A third trial email ("ends tomorrow").** Recommended against for a no-card trial; the owner may want the last call.
5. **The invite email.** Hold until the invites table shows share links going unconsumed (recommended), or build now from the spec.
6. **The seasonal dates.** Back-to-school varies by state; the owner picks the late-summer and January dates, or declines the email.
7. **The weekly nudge.** Not sending is the recommendation; if overruled, opt-in only, Sunday 4pm local, no household content.
8. **Resend Pro before volume.** $20 a month removes the 100-a-day cap that today sits between a cron and a parent's sign-in link; the alternative is a shared cron budget that leaves half the day for sign-ins.
9. **The sign-in code in the subject.** Recommended (readable from the notification, keeps threads apart); the alternative is a fixed subject with the code only in the body.
10. **The beta variant's single button.** The testers' button goes to the feedback form and the lesson's app action becomes a text link (recommended, since their job is feedback), or the reverse.

## Conclusion

The research changes one assumption underneath the current program: these emails are not read, they are judged, in a window short enough that the subject and the first line are the whole message and the body is the proof. That is why the rewrite is mostly subtraction (one job per email, one image, one button, the price and the tour and the planned-features list out), and why the additions are the three moments a parent actually wants a letter for: the sign-in they asked for, the plan they paid for, the account they closed. It also means the program's measure of success cannot be an open rate, which Apple has made meaningless for three quarters of this audience; it has to be whether a week got planned, a kid's pick got switched on, a review got answered, counted from the document the server already keeps.

The second shift is where the brand lives. Dropping web fonts, baked-text store images and any tracked link makes the emails plainer than the marketing screens, and the evidence says that is the right trade: the voice, the crop of the real screen and the button that opens the right tab are what a parent's thumb can use in nine seconds, and the product's privacy promise is cheaper to keep in email than anywhere else because nothing in a good email needs to know who opened it.
