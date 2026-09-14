# Launch copy — September 2026

Paste-ready text for the September launch. The images live on the design canvas;
this is everything that goes in a box next to them.

Written against `.claude/skills/pinterest-pinning-checklist` (Lila Bloom's, which
is the house method). Lead terms come from [keywords.md](keywords.md).

---

## Keywords

Settled. The content pipeline app's topic 17 (school lunchbox prep, run 13
September 2026) supplies the lead terms, and they live in
[keywords.md](keywords.md) with their momentum tags and the three rising terms we
deliberately do **not** chase because the product can't back them.

Two method notes carried over from the house pinning checklist:

- **No hashtags in Pinterest descriptions, and no `#ad`.** `#ad` is for affiliate
  content; Lunch Sorted is our own product, so there is nothing to disclose.
  Instagram is the opposite — see below.
- **Boards.** Three new ones on the Lunch Sorted account (School Lunch Ideas,
  Nut-Free Lunches, Bento Lunchbox Ideas). Don't pin one image to two boards in
  the same week.

---

## Pinterest

Link for all four, changing the campaign name per pin:

```
https://lunchsorted.app/?utm_source=pinterest&utm_medium=social&utm_campaign=<campaign>
```

Netlify Analytics reports by path, not query string, so the UTM alone won't show
up in the numbers. A `/pin` redirect would make these countable — one line in
`netlify.toml`, not yet done.

### Pin 1 — Week three (`pin-1-week-three.png`)

Lead term: `bento box lunch ideas kids` — tier 1, **rising**. The image shows a
four-compartment tin, which is what the term describes.

**Title:** Bento Box Lunch Ideas for Kids: A Week Planned in About a Minute *(63 chars)*

**Description:**
> Bento box lunch ideas for kids, planned a week at a time instead of one box at a time. Answer three questions and it fills five compartment boxes — a main, side, fruit and sweet — matched so each one works together, then writes the grocery list. Free, ages 5-11. Plan this week's lunches!

**Campaign:** `bento-week` · **Board:** Bento Lunchbox Ideas
**Topics:** School Lunch, Kids Lunch Ideas, Lunch Box Ideas, Bento, Family Life

### Pin 2 — School rules (`pin-2-school-rules.png`)

Lead term: `nut-free school lunch ideas` — tier 2, **rising**, and named in the
research headline as a wide-open lane.

**Title:** Nut-Free School Lunch Ideas for a No-Microwave Classroom *(56 chars)*

**Description:**
> Nut-free school lunch ideas that still work with no microwave and twenty minutes to eat. Set your school's rules once — nut-free, seed-free, dairy-free, cold only — and anything that breaks them gets flagged with the reason instead of quietly disappearing. Free, ages 5-11. Try it this week!

**Campaign:** `nut-free` · **Board:** Nut-Free Lunches
**Topics:** School Lunch, Food Allergies, Kids Lunch Ideas, Parenting Tips, Back To School

### Pin 3 — The list (`pin-3-shopping-list.png`)

Lead term: `meal prep lunch box` — tier 2, **rising**.

**Title:** Meal Prep Lunch Box: Plan Five Lunches, Get the Grocery List *(58 chars)*

**Description:**
> Meal prep lunch box planning without the Sunday spiral: plan five lunches and the grocery list writes itself, grouped by aisle with quantities. Tick off what the pantry already has and shop the rest. One list covers every kid. Free, ages 5-11. Plan your week!

**Campaign:** `meal-prep` · **Board:** School Lunch Ideas
**Topics:** School Lunch, Meal Planning, Kids Lunch Ideas, Grocery List, Family Life

### Pin 4 — Kid-led packing (`pin-4-kid-led.png`)

Lead term: `kid led lunchbox packing` — tier 3, **rising**, wide open, and the one
feature no competitor can copy.

**Title:** Kid-Led Lunchbox Packing: Let Them Choose, Inside Your Rules *(58 chars)*

**Description:**
> Kid-led lunchbox packing without handing over the whole decision. The night before, your child picks tomorrow's lunch from the week you already planned — every option already inside your school's rules and already shopped for. A lunch they chose comes home emptier. Free, ages 5-11. Try it tonight!

**Campaign:** `kid-led` · **Board:** School Lunch Ideas
**Topics:** School Lunch, Kids Lunch Ideas, Parenting Tips, Picky Eaters, Family Life

> Topics are **not editable after posting** — add all five when you post, taking
> the closest match from Pinterest's own suggested list.

---

## Instagram

Opposite rules to Pinterest: hashtags help, but few and relevant beats thirty
generic. **Five per post, maximum**, always including one local tag.

### The hashtag sets

From the pipeline run, which caps it at **five per post**. Each set below mixes
broad, mid and niche, and always spends one slot on local — see
[keywords.md](keywords.md) for the full validated list.

**General:** `#schoollunch #lunchboxideas #schoollunchideas #packedlunch #<town>moms`
**Bento / week angle:** `#lunchbox #bentolunch #lunchboxideas #lunchboxinspo #<town>moms`
**Kid-led angle:** `#lunchboxmom #schoollunch #funlunch #lunchboxlove #<town>moms`
**Allergy angle:** `#schoollunch #lunchboxideas #healthylunchbox #packedlunch #<town>moms`
— the pipeline's set has no allergy tags. `#nutfreelunch` and `#foodallergymom`
are the obvious additions but are unvalidated; use them knowing that.

### Post 1 — the carousel (App Store images)

> I built a lunch planner because I was out of ideas by week three.
>
> Three questions — what can go in the box, what has to stay out, how picky they are — and it plans the week, matches each box so it works together, and writes the grocery list. Five minutes on a Sunday instead of five panics at 7am.
>
> It's free to plan, there's nothing to download, and it works with no signal in the kitchen.
>
> lunchsorted.app — link in bio.
>
> #schoollunch #schoollunchideas #lunchboxideas #packedlunch #<town>moms

> **The screen recordings are made, not filmed.** `node scripts/store-clips.mjs`
> drives the real app and writes `week`, `rules`, `shop` and `kidpick` to
> `store/clips/` as 1080×1920 MP4 with tap dots — no captions burned in, so the
> words below go on in the edit. Re-run it after any UI change. What it cannot
> make is the human half: the counter, the hands, the kitchen, your voice.

### Reel 1 — Week three

**On screen, beat by beat:**

| Time | On screen | Shot |
|---|---|---|
| 0.0s | *Week 3. I've run out of ideas.* | Empty lunchboxes on the counter |
| 2.5s | *Three questions.* | Screen: the setup questions |
| 5.0s | *That's it.* | Screen: the week drawing itself |
| 9.0s | *Five lunches. Matched. Shopped for.* | Screen: scroll the week |
| 13.0s | *lunchsorted.app — free to plan* | End card |

**Caption:**
> Week three is when it stops being cute and starts being a chore. Five lunches a week, every week, until June.
>
> This plans the whole week in about a minute — and tells you *why* each box goes together, which is the bit a Pinterest board never does.
>
> Free to plan at lunchsorted.app 🥪
>
> #schoollunch #lunchboxideas #schoollunchideas #packedlunch #<town>moms

### Reel 2 — The rules

| Time | On screen | Shot |
|---|---|---|
| 0.0s | *Nut-free.* | Black frame, text only |
| 1.0s | *No microwave.* | Same |
| 2.0s | *Twenty minutes to eat it.* | Same |
| 3.5s | *Tell it once.* | Screen: toggling the rules on |
| 7.0s | *It re-checks the whole week.* | Screen: week redrawing |
| 11.0s | *And it says why.* | Screen: a flagged food |
| 15.0s | *lunchsorted.app* | End card |

**Caption:**
> If your classroom is nut-free with no microwave and a twenty-minute eating window, you already know the hard part isn't ideas — it's ideas that are *allowed*.
>
> Set the rules once. Anything that breaks them gets flagged, with the reason, instead of quietly disappearing from your list.
>
> Free to plan at lunchsorted.app
>
> #schoollunch #lunchboxideas #healthylunchbox #nutfreelunch #<town>moms

### Reel 3 — The list

| Time | On screen | Shot |
|---|---|---|
| 0.0s | *I planned 5 lunches and it wrote my grocery list.* | Screen: the finished week |
| 3.0s | *One tap.* | Screen: tapping through to Shop |
| 5.0s | *Sorted by aisle.* | Screen: scrolling the list |
| 9.0s | *Tick what you already have.* | Screen: ticking items off |
| 12.0s | *lunchsorted.app* | End card |

**Caption:**
> Planning the lunches was never the whole job. The list was.
>
> Five boxes planned, one grocery list, grouped by aisle, with the pantry ticked off. One list covers every kid.
>
> Free to plan at lunchsorted.app
>
> #schoollunch #lunchboxideas #packedlunch #lunchboxmom #<town>moms

### Launch day post (`post-launch.png`)

> It's open to everyone today.
>
> A few weeks ago I asked this group to test a lunch planner I'd built for my own 7am problem. [N] of you said yes, and you found things I would never have found alone — thank you, genuinely.
>
> It's free to plan: three questions, a week of matched lunchboxes, a grocery list that writes itself. No download, no card, works with no signal.
>
> lunchsorted.app
>
> #schoollunch #schoollunchideas #lunchboxideas #backtoschool #<town>moms

### Tester quote posts (`post-tester-quote.png`)

One a day for four days after launch. Caption is the quote in full, then:

> [Full quote] — [First name], who tested it for three weeks.
>
> Free to plan at lunchsorted.app
>
> #schoollunch #lunchboxideas #lunchboxlove #packedlunch #<town>moms

**Get permission in writing before you post anyone's words or name**, even in a
friendly group. A screenshot of them saying "yes, go ahead" is enough.

---

## Where each asset goes

| Asset | Pinterest | Instagram | Facebook |
|---|---|---|---|
| pin-1 / 2 / 3 / 4 | ✓ feed pin | — | — |
| reel covers 1-3 | ✓ as video pin covers | ✓ reel cover | ✓ cross-post |
| post-launch | — | ✓ feed | ✓ group |
| post-tester-quote | — | ✓ feed | ✓ group |
| story-kids-pick | ✓ video pin | ✓ story | ✓ story |
| handout | — | — | — (print / PTA email) |

Every reel is three posts: Instagram, then cross-posted to Facebook, then
uploaded to Pinterest as a video pin with a keyword-led description of its own.
Same file, three surfaces.
