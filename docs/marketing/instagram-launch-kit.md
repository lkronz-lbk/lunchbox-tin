# Instagram launch kit — day one

Everything needed to set up the account and schedule the first three weeks.
Written 18 September 2026, with the iPhone app in App Store review and the web
planner already live and free.

**The anchor date is Monday 28 September.** Everything before it builds the
profile so that a stranger who lands on it that week finds something finished.

Files: reels in `store/clips/`, carousel and covers rendered from the design
canvas. Keyword and hashtag sources in [keywords.md](keywords.md).

---

## 1 · The profile

Set this up **before** the first post. An account with one reel and no bio
converts nobody.

**Account type: Business.** A personal account shows you no Insights — no
reach, no profile visits, no link taps, which is three of the four numbers in
section 6 — and it cannot take the email button, the category, or scheduling
from Meta Business Suite. Switching keeps the followers, posts and handle, and
it is reversible.

> **Check the audio library the moment you switch.** Business accounts have
> historically had a narrower commercial-music library than personal or Creator
> ones — licensing, not a setting — so trending tracks can come back greyed out.
> Since "pick something with the ↗ arrow" is load-bearing for every reel here,
> open a new reel, scroll the trending list, and try one. If the tracks you want
> are unavailable, switch to **Creator**: you keep Insights, the contact button
> and scheduling, and lose only the App Page category, which is the smaller loss.

**Username:** `@lunch.sorted`. Keep it the same as the domain — it is the whole
point of the name.

**Name field** (30 characters, and *searchable* — this is the one people
overlook):

> `Lunch Sorted · Packed Lunches`

**Bio** (150 characters):

> Plan a week of packed school lunches in one minute.
> Your school's rules built in — nut-free, no microwave, picky.
> Free, no download ↓

That is 121 characters, so there is room if you want to add the town ("Made in
[TOWN]") which would help the local angle a lot.

No emoji in it, deliberately — the brand doesn't use them anywhere else. Add a
single 🥪 if you want the bio to feel warmer; don't add five.

**Link:** `lunchsorted.app`. One link, not a link-in-bio service — one fewer tap
and one fewer thing to break. Revisit when the App Store listing goes live and
you genuinely have two destinations.

**Category:** App Page. **Contact:** the email button on, pointing at
hello@lunchsorted.app.

**Profile picture:** three versions in `avatar/`, all 1080×1080, all tested at
32px because that is the only size that matters. Instagram crops a square to a
circle, so upload the square and let it crop.

| File | What it is |
|---|---|
| `avatar-a-full-bleed.png` | The four compartments run to every edge, a pale cross between them. Nothing is lost to the crop. |
| `avatar-b-tin-filled.png` | The tin itself, sized so its corners tuck just inside the circle instead of floating in the middle of it. |
| `avatar-c-full-bleed-dark.png` | A, with the dark ground. Use it if the grid ends up dark. |

A is the one to start with: at 32px the four colors are still four colors, which
is the whole job of a profile picture that small. `avatar.html` is the source —
open it and re-screenshot at 1080 if the brand colors ever move.

**Highlights** — make three empty ones now and fill as you go: *How it works*,
*Real weeks*, *Questions*. A profile with highlights looks established; one
without looks like it started yesterday.

### The Facebook page

Every reel in this kit is three posts — Instagram, Facebook, then Pinterest as a
video pin — so the page is worth the twenty minutes. Set it up now, not on
launch morning.

- **Link the page to the Instagram account** in Accounts Center. This is the
  step everything else depends on: cross-posting, managing both from Meta
  Business Suite, and any advertising later. Do it first and the rest is filling
  in fields.
- **Name** Lunch Sorted, **username** `facebook.com/lunchsorted` so it matches
  everywhere else. **Category** App Page.
- **Profile picture:** the same `avatar-a-full-bleed.png`. The same mark in both
  places is most of what a brand is at this stage.
- **Cover:** `facebook-cover.png` (1640×856), rendered from the design canvas.
  Dark ground, the headline on the left, the planned week bleeding off the right
  edge. Facebook crops the top and bottom on a desktop and a sliver off each
  side on a phone, so the text keeps a clear band above and below and starts
  well in from the left; the phone is the one thing allowed to run off the edge,
  because losing a slice of it costs nothing.
- **Action button:** *Use app*, pointing at lunchsorted.app.
- **About + email:** the bio text, and hello@lunchsorted.app.

**Cross-posting:** the *Share to Facebook* toggle on an Instagram post does the
job and keeps one upload. The exception is reels you want Facebook to rank on
their own merits — uploading those natively to the page generally does better
than a cross-post, so it is worth testing once you have three or four reels out.

> **The moms group is not a place for the page.** Post there as *yourself*, from
> your personal profile. A page posting into a community group reads as an ad,
> converts worse, and in plenty of groups is against the rules outright. The
> launch post in the calendar below is you talking to people who already know
> you — keep it that way.

---

## 2 · The carousel — the post that explains the app

Six slides, 1080×1350 (4:5, the tallest Instagram allows in feed, so it takes
the most screen). This is the post you pin to the top of the profile and the one
everyone who taps through from a reel will read.

`carousel-1.png` … `carousel-6.png`

It follows the onboarding journey in order — the week you already have, then
each thing you can do to it — so a stranger sees a phone screen on slide one and
knows it is an app before they swipe. Headlines are five words or fewer; the
screenshot is the slide, the words are the label.

| Slide | Screen | Headline |
|---|---|---|
| 1 | The planned week | Five lunches. One tap. |
| 2 | Swapping one compartment | Not that one? Swap it. |
| 3 | The shopping list, checked off | Check off what's home. |
| 4 | The idea bank | Only food they'll eat. |
| 5 | The Pack tab | Then it's just a checklist. |
| 6 | — | Where to go, and what it costs |

**Caption:**

> Five packed lunches a week. Every week. Until June.
>
> This plans all five in one minute — matched boxes, your school's rules built in, and the grocery list written for you. Swap anything you don't like. Check off what's already in the cupboard.
>
> Free to plan, nothing to download. The iPhone app is with Apple now.
>
> lunchsorted.app — link in bio.
>
> #schoollunch #lunchboxideas #schoollunchideas #packedlunch #<town>moms

**Alt text** (set per slide, Advanced settings → Write alt text): describe what
is on the slide plainly. Slide 1: "The planner showing a week of five
lunchboxes, each with a main, side, fruit and sweet."

**Pin it to your profile** as soon as it is posted.

---

## 3 · The reels

Four silent MP4s, 1080×1920, no captions burned in: `week`, `rules`, `shop`,
`kidpick`. Add trending audio and your on-screen text in the edit.

### On covers — and how long to hold them

Two different things, and mixing them up costs reach:

- **The cover** is set at upload (*Cover → Add from camera roll*). It is the
  grid thumbnail and the still shown before playback. **It is not held inside
  the video at all** — it costs you no watch time.
- **A title card burned into the video** is a different thing, and it *does*
  cost you. Over 70% of viewers decide within three seconds, so a static card
  eats the window that decides whether the reel gets distributed. **If you burn
  one in, keep it under 0.7 seconds.**

So: upload `reel-cover-*.png` as the cover, and let the video **start on motion
from frame one**, with your hook as a text overlay *over* the moving footage.
Never open on a still.

Covers: `reel-cover-1-week-three.png` · `reel-cover-2-school-rules.png` ·
`reel-cover-3-the-list.png`.

### Audio

Pick from Instagram's own trending list inside the app — you cannot pick it from
a scheduler and keep the reach. Two rules: choose something with the **↗ arrow**
next to it, and **save audio you like** to a folder as you scroll, so you are
not hunting at posting time. Volume: original audio down to 0, music at 40–60%.

### Per reel

**Reel A — week three** (`week.mp4`, cover 1)

| Time | On-screen text |
|---|---|
| 0.0s | Week 3. I've run out of ideas. |
| 2.5s | Three taps. |
| 5.0s | That's it. |
| 9.0s | Five lunches. Matched. Shopped for. |
| 13.0s | lunchsorted.app — free to plan |

> Week three is when packing lunch stops being cute and starts being a chore. Five a week, every week, until June.
>
> This plans the whole week in one minute — and tells you *why* each box goes together, which is the bit a Pinterest board never does.
>
> Free to plan, link in bio.
>
> #schoollunch #lunchboxideas #schoollunchideas #packedlunch #<town>moms

**Reel B — the rules** (`rules.mp4`, cover 2)

| Time | On-screen text |
|---|---|
| 0.0s | Nut-free. |
| 1.0s | No microwave. |
| 2.0s | Twenty minutes to eat it. |
| 3.5s | Tell it once. |
| 7.0s | It re-checks the whole week. |
| 11.0s | And it tells you why. |

> If your classroom is nut-free with no microwave and a twenty-minute eating window, the hard part was never ideas. It's ideas that are *allowed*.
>
> Set the rules once. Anything that breaks them gets flagged, with the reason, instead of quietly vanishing from your list.
>
> Free to plan, link in bio.
>
> #schoollunch #lunchboxideas #healthylunchbox #nutfreelunch #<town>moms

**Reel C — the list** (`shop.mp4`, cover 3)

| Time | On-screen text |
|---|---|
| 0.0s | I planned 5 lunches and it wrote my grocery list. |
| 3.0s | One tap. |
| 5.0s | Sorted by aisle. |
| 9.0s | Check off what you already have. |

> Planning the lunches was never the whole job. The list was.
>
> Five boxes planned, one grocery list grouped by aisle, the pantry checked off. One list covers every kid in the house.
>
> Free to plan, link in bio.
>
> #schoollunch #lunchboxideas #packedlunch #lunchboxmom #<town>moms

**Reel D — kid's pick** (`kidpick.mp4`, no cover made yet — use a frame)

> The night before, they pick tomorrow's lunch from the week you already planned. Every option is inside your rules and already in the fridge.
>
> A lunch they chose comes home emptier. That's the whole theory and so far it's holding.
>
> Free to plan, link in bio.
>
> #lunchboxmom #schoollunch #funlunch #lunchboxlove #<town>moms

---

## 4 · The schedule

Three feed posts and two to three reels a week is the sustainable rate for one
person. More than that for a fortnight and then nothing is worse than steady.

**Times:** 7–8am (drop-off scroll) or 8–9pm (after bedtime) — parents are on
their phones at both. Pick one and be consistent for a month before judging.

### Week one — build the profile (18–27 Sept)

| Day | Post | Time |
|---|---|---|
| **Fri 18** | Set up the profile completely. Post nothing. | — |
| **Sat 19** | **The carousel.** Pin it. | 8pm |
| **Sun 20** | Story: the carousel reshared, "what I've been building" | 7pm |
| **Mon 21** | **Reel A — week three** | 8pm |
| **Tue 22** | Story: behind the scenes, the real Monday box | 8am |
| **Wed 23** | **Reel B — the rules** | 8pm |
| **Thu 24** | Story poll: "Is your classroom nut-free?" | 8am |
| **Fri 25** | Feed post: a single screenshot of a real week + short caption | 8pm |
| **Sat 26** | Quiet. Comment on ten accounts in the niche instead. | — |
| **Sun 27** | Story: "It's open to everyone tomorrow" | 7pm |

### Launch week (28 Sept – 4 Oct)

| Day | Post | Time |
|---|---|---|
| **Mon 28** | **Launch post** (`post-launch.png`) + the same in the moms group | 8am |
| **Mon 28** | Story: launch post reshared with a link sticker | 8pm |
| **Tue 29** | **Tester quote 1** (`post-tester-quote.png`) | 8pm |
| **Wed 30** | **Reel C — the list** | 8pm |
| **Thu 1** | **Tester quote 2** | 8pm |
| **Fri 2** | Story Q&A: "Ask me anything about packing lunch" | 8am |
| **Sat 3** | **Tester quote 3** | 10am |
| **Sun 4** | Story: the week ahead, planned live | 7pm |

### Week three (5–11 Oct)

| Day | Post | Time |
|---|---|---|
| **Mon 5** | **Reel D — kid's pick** | 8pm |
| **Wed 7** | Carousel #2: "Five lunches that survive a nut-free classroom" | 8pm |
| **Thu 8** | **The founder reel** — thirty seconds to camera, why you built it | 8pm |
| **Sat 10** | Feed post: the first month, honestly — what worked | 10am |

The founder reel is the one I would protect in the calendar above everything
else. It is the only post here that nobody else could make.

---

## 5 · Before you hit publish, every time

- **Cover set** from the camera roll, not auto-picked from a random frame
- **Trending audio** with the ↗ arrow, original audio muted
- **Alt text** written (Advanced settings)
- **Location tag** — your town, on every single post. This is the cheapest
  targeting you have and it is free
- **Five hashtags maximum**, one of them local
- **Caption's first line works alone** — everything after it is hidden behind
  "more"
- **Reply to every comment in the first hour.** Early engagement is what the
  ranking actually responds to, and for the first month you will have few enough
  comments that this is possible

**Scheduling:** Meta Business Suite schedules feed posts and carousels fine.
Reels you should post **from the phone, in the app**, because that is the only
way to attach trending audio and keep the reach. Stories are always manual.

So: batch-schedule the carousels and static posts on a Sunday; set a phone
reminder for each reel.

---

## 6 · What to watch, and what to ignore

For the first month the only numbers worth reading:

- **Reach on reels** — is it above your follower count? If yes the hook works
- **Profile visits** — the reel's actual job
- **Link taps** in bio — the profile's actual job
- **New households on `/admin`** — the only number that is real

Ignore likes and follower count for four weeks. They lag everything else and
watching them daily will make you change things that were working.

**The one diagnostic that matters:** if reach is high and profile visits are
low, the reel entertained but didn't sell. If profile visits are high and link
taps are low, the bio or the carousel is failing. Fix the one the numbers point
at, not the one you feel worst about.
