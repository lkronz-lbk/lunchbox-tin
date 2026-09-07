# Lunch Sorted — the marketing plan

Written 7 September 2026. Liz owns it; it is meant to be edited, not admired.
The week-by-week schedule is in [calendar.md](calendar.md); the tool decisions,
with prices and verdicts, are in [tools.md](tools.md).

Every claim that came from outside is numbered and listed under
[Sources](#sources), and tagged for how much weight it can carry:
**[primary]** the platform's own documentation, **[study]** a named dataset,
**[vendor]** a company selling the thing it is measuring, **[secondary]** a
trade blog reporting someone else's number. Treat vendor numbers as direction,
never as a forecast.

---

## The strategy in one paragraph

We missed the August 2026 back-to-school peak — the school year has already
started. That is a gift, not a loss: the searches that matter peak in August
(1), seasonal SEO needs four to six months of lead time to settle (2), and
Pinterest wants seasonal content 45–90 days before the peak (3). So the twelve
months from now are not "wait until next August". They are the only time the
compounding channels can be built cheaply, with nothing at stake. **Build the
content engine September to December, rehearse the launch in January when the
new semester starts, ship the iPhone app in spring, and point everything at
July–August 2027.** Between now and then the goal is not downloads. It is a
hundred pieces of indexed, pinned, dated content and thirty real parents who
will say something true about the app on camera.

---

## Who we are talking to

Three people, in the order they are worth pursuing.

**1. The Sunday-night planner.** A parent, most often a mother, of a 5–11 year
old, who packs four or five lunches a week and has decided this is the year she
stops doing it at 7am. She already searches "school lunch ideas", already has a
Pinterest board, already owns bento boxes. She is on Pinterest and in a school
Facebook group; US mothers 18–39 skew to Facebook and Instagram and away from
Reddit and TikTok relative to non-parents (4). **She is the whole plan.** She
converts because the product answers a question she is actively asking.

**2. The constrained parent.** Nut-free classroom, a dairy allergy, no
microwave, a twenty-minute eating window. This parent does not need lunch
*ideas*; she needs lunch ideas that are *allowed*. This is where the product is
not merely nicer than a Pinterest board but structurally different: rules flag
foods, and the list tells you why something stopped appearing. She has the
highest willingness to pay and the strongest word of mouth, because she is
already in the allergy groups doing the explaining. Smaller audience, far
better conversion. Every piece of content aimed at her should name the
constraint in the title.

**3. The second adult.** The other parent or the grandparent doing the Tuesday
pack. Not an acquisition target — a retention one. They arrive through an
invite, and their existence is the argument for the Household plan.

Not a target: children. Ever. No content invites a child, no ad targets one,
no screenshot puts a child's face on a page (7).

---

## What we say

The positioning is already right on the site and does not need re-inventing:
**a week of school lunches in about a minute, matched so each box goes together,
with the shopping list built for you.**

Four proof points, in the order that persuades:

1. **It is a minute, not a project.** Three questions, then a plan. No blank
   screen, no database of foods to build first. This is the whole reason
   someone chooses this over the Pinterest board they already have.
2. **The boxes go together.** Crunch against a soft main, protein when the main
   is light. It says *why*. This is the thing no list of ideas does.
3. **Your school's rules are respected, not guessed.** Nut-free, no microwave,
   no chocolate — and flagged, never silently dropped.
4. **The shopping list writes itself**, and mornings become a checklist.

The kid's-pick screen is the emotional close, not the opener: *"a lunch they
chose tends to come home emptier."* It is the line people repeat. Save it for
the end of a video, the last screenshot, the last line of a pin description.

Never say: AI, algorithm, meal-planning platform, optimize. The audience is a
tired parent at a kitchen counter, and the site's own rule — every string is
written for a parent, no jargon — applies to marketing too.

---

## The advantage nobody else has

Lila Bloom Kids is already a working audience machine pointed at the same
person: Pinterest boards with validated keyword clusters, a brand palette and
Canva templates, a Medium blog, affiliate list pages, and — most valuable —
documented workflows for all of it (`pinterest-pinning-checklist`,
`lila-bloom-keyword-clusters`, `medium-blog`, `affiliate-list-page`,
`lila-bloom-brand-palette`).

Two ways to use it, and the distinction matters:

- **Reuse the machine, not the brand.** Lunch Sorted is a Lila Bloom
  Enterprises product; it does not need to be a Lila Bloom Kids product. Pin
  from a Lunch Sorted account with its own boards, using the same keyword
  method and the same Canva discipline. Cross-promote from the existing
  boards where a lunch topic genuinely belongs — a "school lunch ideas" board
  is a fair place for a lunch planner.
- **The list pages are the model for the guides.** The affiliate list-page
  pattern (a static HTML page on Netlify, keyword-led, one job per page) is
  exactly what the Lunch Sorted guides should be, minus the affiliate links.
  Same skill, same build, new destination.

The thing to protect: the affiliate work is a *content* business, and the app
is a *product* business. Do not let the app's page fill up with affiliate
links to lunchboxes. It cheapens a paid product and confuses the pitch.

---

## The constraints that shape all of this

These are not obstacles to route around; they are decisions already made, and
the plan has to fit them.

- **No analytics SDKs, no pixels, anywhere.** The site carries
  `script-src 'none'`. There is no Meta pixel and no Google tag, which means
  no conversion optimisation, no retargeting, no lookalike audiences. **Paid
  social is therefore structurally weak for us and stays off the plan until
  there is a reason to change it.** See [Measurement](#measurement-without-tracking).
- **Payments happen on the web, never through the App Store.** The iPhone app
  can never say "subscribe" or link to a purchase page. The App Store listing
  sells a free planner; the plan is bought at lunchsorted.app. Marketing copy
  must never promise an in-app upgrade.
- **Out of the Kids Category, out of COPPA scope.** No content that addresses
  children, no child-directed advertising, no analytics that could be read as
  collecting from a child.
- **One person, part-time.** The plan below is sized for roughly six to eight
  hours a week, most of it in one Sunday block. A plan that needs twenty hours
  is a plan that stops in November.

---

## Channels, ranked

### 1. Pinterest — the primary channel, starting now

The audience is there, the intent is there ("school lunch ideas" is a Pinterest
search if ever there was one), the content compounds for months, and Liz
already knows how to do it.

What the documentation and the benchmark data say:

- **2:3 vertical, 1000×1500.** Other ratios are penalised in feed (3).
- **Fresh pins drive the overwhelming majority of traffic** — a 1.2M-pin
  benchmark puts it above 90% — and the algorithm favours new pins over repins
  (3, [study]/[vendor]).
- **Keyword-led titles and descriptions**, working link, original image (3).
- **Seasonal content 45–90 days before the peak**, because a large share of
  users plan 60+ days ahead (3). For an August peak that means **pinning
  back-to-school content from mid-May**, and it means the January semester
  content goes up in **November**.
- Cadence: 3–5 fresh pins a day is the often-quoted target (3). **We are not
  doing that.** Match cadence to what can be made well: **5–10 fresh pins a
  week**, every week, without a gap. Consistency beats volume, and a gap in
  December undoes November.

What to pin: the guides (below), each in three or four designs; single-box
"here's Tuesday" images; constraint-led pins ("Nut-free lunches that aren't a
sunbutter sandwich again"); and short video pins of the app drawing a week.

### 2. Guides on lunchsorted.app — the compounding asset

Small sites win on tightly-defined, long-tail, question-shaped queries; that is
also what gets quoted in AI answers (5, 6). We have no domain authority and no
budget, so the only viable SEO play is the specific question nobody has
answered well.

Build a `/guides/` section — static HTML in `public/`, same stack, same CSP, no
new infrastructure — and write eight to twelve pages targeting things like:

- what to pack when there's no microwave
- nut-free lunch ideas for kindergarten that aren't sunbutter
- how long a lunchbox stays cold without an ice pack
- what actually counts as a "seed-free" school
- lunches for a twenty-minute eating window
- what to do when everything comes home uneaten

Each guide: answers the question in the first paragraph, gives real examples,
and ends with one honest line about the app. Each guide is also four Pinterest
pins and a Medium cross-post. **Publish these September to December so they are
indexed and settled by the January and August peaks** (2).

This is the single highest-value build task on the list, and it is the one that
will not happen unless it is scheduled. It is scheduled in the calendar.

### 3. Short video — the demo is the ad

The app planning a week in fifteen seconds is genuinely satisfying to watch. No
actors, no AI avatars, no scripts about "revolutionising" anything: a thumb on
a phone, a week appearing, a shopping list.

What the data says: over 70% of viewers decide within three seconds, and
retention past three seconds is what buys distribution (8, [secondary]);
Facebook's own research says 65% of people who watch three seconds watch ten
(8, [study]); 85% watch without sound, so on-screen text is not optional (8);
change something visually every 1.5–2 seconds; keep it under 30 seconds where
possible (8).

So: **hook in the first second with the constraint, not the product** — "Nut-free
and no microwave" over the first frame — then show the week appearing. One
video a week, cut three ways (Reels, TikTok, Pinterest video). This is also the
raw material for the App Store preview video, which should be 15–30 seconds
(9).

### 4. Where parents already talk

Facebook groups and Reddit are where this product gets recommended by someone
who isn't us, which is worth more than anything we post. The rule in every one
of these places is the same and it is not negotiable: **be useful ten times
before mentioning the app once, and ask the moderators first.** A "recommend
me" thread is the one place a direct answer is welcome.

Targets: school-year parent groups, allergy-parent groups (the constrained
parent lives here), local PTA groups, and the school-lunch corners of Reddit.

### 5. Schools, PTAs and school nurses — underrated, cheap, on-message

A nut-free classroom letter goes to thirty families at once. A PTA newsletter
has a slot for "a free thing that helps". A school nurse knows every allergy
family in the building. Make a **one-page PDF for schools** — what it is, that
it is free to plan, that it collects nothing about children — and send it to
Liz's own school first. This is slow, unglamorous, and converts better than
anything on this page except Pinterest.

### 6. Email

Two lists, kept apart. The **waitlist** on the home page (Netlify Forms) is for
the iPhone launch and gets perhaps four emails all year. The **trial sequence**
already exists in the product (`cron-trial.js`: three days before the end, and
the day after).

What the benchmark data says to change: behaviour-triggered beats time-based by
a wide margin, a welcome should land within minutes, no more than two emails in
the first 48 hours, and people who touch the core feature in the first three
days convert several times better (10, [secondary]/[vendor]). We already send a
welcome. **The gap is a nudge to a household that signed up and never drew a
week.** That is a product change, not a marketing one, and it is worth more
than any of the channels above.

Set expectations honestly: opt-in trials with no card taken average around 9%
trial-to-paid, against 15–17% median for card-required trials (10). Our trial
takes no card, by design. **Nine percent is the number to beat, not thirty.**

### 7. The App Store, when it lands

- **Name (30 chars) and subtitle (30)** carry the most weight; the **100-char
  keyword field** is comma-separated with no spaces, and must not repeat words
  already in the name or subtitle (9, [primary]/[secondary]).
- **The first three screenshots** carry the whole pitch — most people never
  scroll (9). Ours exist already in `store/`.
- A **15–30 second preview video** raises conversion (9).
- **Custom product pages** — up to 70 — let one campaign have its own
  screenshots (9). Make one for the Pinterest traffic and one for the school
  outreach.
- Reviews matter more than metadata. Ask for one in the app only after a
  parent has packed a second week, never before.

### 8. Product Hunt — once, for the iPhone launch

Worth one day. Not our audience (makers, not parents), but it is a free backlink,
a press hook and a burst of feedback. The mechanics are well documented: launch
**12:01am Pacific**, Tuesday–Thursday for traffic (Friday for less competition),
prepare four to six weeks out, the first two to four hours of velocity decide
the day, stay in the comments, and **never ask for upvotes** — asking is against
the rules and reads badly (11).

### Not doing: paid ads

No pixel means no optimisation and no retargeting; a $29-a-year product with an
unproven funnel means a tiny margin for error. **Revisit only when we know what
a paying household is worth**, which needs a year of data. Until then, every
dollar goes to making content rather than distributing it.

---

## The collateral to make

Already exists: the site, `public/img/og.png`, four phone screenshots, the App
Store listing (`store/listing.md`) and its screenshots.

To make, in this order:

1. **Six Canva pin templates** in the Lunch Sorted palette (the four
   compartment colours are the brand and nothing else needs inventing).
2. **Eight to twelve guides** on `/guides/`.
3. **One 40-second explainer** — the whole product, one take, no voice actor.
4. **Twelve short demo clips**, one per week, from the same afternoon of
   screen recording.
5. **A one-page PDF for schools and PTAs.**
6. **A press one-pager** — what it is, who made it, what it costs, three
   screenshots, a contact address. Local parenting press and newsletters ask
   for exactly this.
7. **Thirty testimonials.** Ask every household that gets to week three. One
   honest sentence from a real parent outperforms every asset above.

---

## Measurement without tracking

We cannot use a pixel, and should not want to. What we can do:

- **Netlify Analytics ($9/mo)** — server-side, from the logs, no script on the
  page, no cookie, nothing collected from a device. It is the only analytics
  product that fits the privacy promise. Turn it on.
- **A landing path per channel.** `/pin`, `/pta`, `/ph` as redirects to `/`
  with the source in the URL; the logs then separate them.
- **The numbers page at `/admin`** already counts households per week, trials,
  lapses and paid plans from the database. That is the real scoreboard.
- **Weekly, in one line:** new households, trials ending, paid, and which
  guides got traffic. If a number does not change a decision, do not collect it.

The honest limit: we will know *how many* and *roughly from where*, never
*who*. That is the trade the product made on purpose, and it is the right one.

---

## Budget

| Item | Cost |
|---|---|
| Netlify Analytics | $9/mo |
| Canva Pro (already owned) | — |
| Claude (already owned) — copy, guides, pin text | — |
| One repurposing tool, if any (see tools.md) | $0–19/mo |
| Domain, hosting, Neon, Resend (already owned) | — |
| Apple Developer Program | $99/yr |
| **Total new spend** | **≈ $10–30/mo** |

---

## What would make me change my mind

- If the January push converts at three times the expected rate, bring the
  App Store launch forward and consider paid.
- If Pinterest is flat after twelve consistent weeks, the problem is the pins,
  not the channel — before abandoning it, change the hooks.
- If the guides bring traffic that does not open the planner, the guides are
  answering the wrong questions.
- If a school or PTA converts a whole class, stop everything and do that.

---

## Sources

1. Back-to-school and lunchbox search interest peaks around the start of
   August: [Google/Search trends coverage](https://blog.google/products-and-platforms/products/shopping/back-to-school-trends/),
   [Glimpse: Google Trends guide](https://meetglimpse.com/google-trends/) — [secondary]
2. Seasonal SEO needs four to six months of lead time:
   [Search Engine Journal](https://www.searchenginejournal.com/seasonal-seo-tips/438300/),
   [Victorious](https://victorious.com/blog/google-trends/) — [secondary]
3. Pinterest ratio, fresh pins, cadence and 45–90 day seasonal lead:
   [Ignite Social Media](https://www.ignitesocialmedia.com/pinterest-marketing/pinterest-content-strategy-in-2026-a-complete-guide/),
   [Your Pin Coach](https://yourpincoach.com/how-often-to-post-on-pinterest/),
   [Genviral](https://www.genviral.io/blog/pinterest-posting-strategy) — [vendor]/[study]
   (the 1.2M-pin figure is Tailwind's own benchmark)
4. Where parents are, and mothers' platform skew:
   [Sprout Social](https://sproutsocial.com/insights/marketing-to-parents/),
   [SongBird](https://www.songbirdmarketing.com/sb-spotlight/parents-on-social-media),
   [NIH/PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6626689) — [study]/[secondary]
5. Small sites win on tight niches and long-tail:
   [Semrush](https://www.semrush.com/blog/how-to-choose-long-tail-keywords/),
   [Thoughtshift](https://www.thoughtshift.co.uk/seo-content-strategy-in-2026-topics-structure-and-search-intent/) — [secondary]
6. Long-tail, question-shaped content and AI answers:
   [AI Flow Review](https://aiflowreview.com/ai-overviews-seo/) — [secondary]
7. Product rules and privacy promises: `CLAUDE.md`, `README.md`,
   `public/privacy.html` — [primary]
8. Short-form hooks, three-second retention, sound-off viewing, pacing:
   [Kapwing statistics roundup](https://www.kapwing.com/resources/short-form-video-statistics-tiktok-reels-and-shorts-by-the-numbers-in-2026/),
   [Hansen Insights](https://hansencommerce.com/insights-tiktok-hook-3-seconds) — [secondary]
   (the 65%/45% figures originate with Facebook's own research)
9. ASO: keyword field mechanics, screenshots, preview video, custom product
   pages: [AppTweak](https://www.apptweak.com/en/aso-blog/what-is-app-store-optimization-and-why-is-aso-important),
   [AppLaunchFlow](https://www.applaunchflow.com/blog/aso-best-practices) — [secondary]
   (confirm the field limits against App Store Connect before submitting)
10. Trial-to-paid benchmarks and onboarding email cadence:
    [Meisa](https://meisa.io/learn/trial-conversion-benchmarks),
    [Pulseahead](https://www.pulseahead.com/blog/trial-to-paid-conversion-benchmarks-in-saas),
    [Digital Applied](https://www.digitalapplied.com/blog/saas-customer-onboarding-email-sequence-2026-crm-playbook) — [vendor]/[secondary]
    (B2B-weighted; a $29/yr consumer app is not the same shape — direction only)
11. Product Hunt timing and rules:
    [Product Hunt's own launch guide](https://www.producthunt.com/launch) — [primary];
    [LaunchList checklist](https://getlaunchlist.com/checklists/producthunt) — [secondary]
12. Waitlist quality over volume, referral loops:
    [Waitlister](https://waitlister.me/growth-hub/guides/product-launch-strategy),
    [Unicorn Platform](https://unicornplatform.com/blog/waitlist-page-strategy-in-2026/) — [vendor]
