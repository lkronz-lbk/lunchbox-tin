# Reply to App Review

The rejection is the standard information request for a developer account with no
review history. Nothing about the app was judged. Paste sections 2 to 6 into the
Resolution Center reply, and also into the Notes field of App Review Information so
the next submission does not ask again.

## 1 · Screen recording (only you can make this)

On a real iPhone running the current iOS, with the TestFlight build installed. Record
the whole thing on a **throwaway email address, not the review account** — that way you
can finish the deletion on camera, and the reviewer's own account survives. Start the
recording before you open the app, and do not narrate.

Delete the app first, so it opens as a parent's first run.

1. **Launch** from the Home Screen. Let the launch screen show.
2. **Register.** Answer the first screen — the name, and the three questions under it. This is account creation in this
   app: it makes the household. Then enter the throwaway email, tap "Email me the link",
   switch to Mail, open the email, and come back with the code or the link. A new
   household gets the whole plan free for three weeks, so everything below is unlocked.
3. **Week.** The five planned lunchboxes. Tap Shuffle all, then Shuffle day on one day,
   then the swap arrow on a single compartment.
4. **Shop.** The list grouped by aisle. Tick one item as already at home. Tap the share
   button, show the sheet, cancel.
5. **Recipes.** Open the tab, open a recipe, change the batch size, switch US to Metric,
   tap Cook it step by step, advance two steps, tick an ingredient, tap Done.
6. **Switch on a paid feature.** Tap the sliders beside the lunchbox name to open the
   lunchbox settings and scroll to **Their say**. The section header carries a green
   **Household plan** chip — on a new account it reads "Household plan · 21 days".
   Switch on **They pick their box each day**, leave it on Each part, and tap Done. This
   is the clearest shot of a paid feature being reached inside the app, and it is off by
   default so the reviewer sees it change.
7. **Pack, and the kid's pick.** Today's box, tick Packed, then tap "Let … pick" and make
   one choice on the kid's-pick screen, then hand the phone back.
8. **Where the plan is bought.** Account tab. The plan card reads "Everything is on for N
   more days" with a **Keep the Household plan** button. Tap it: the sheet lists what the
   plan holds and what it costs. Tap through to buy and let **Safari open on our website**,
   which is what Apple needs to see for an external purchase, then close Safari and come
   back without paying. Nothing is charged.
9. **Sign out and back in.** Account tab, Sign out, then sign in again with the same
   email. This is the login flow on its own, which is what they asked to see separately
   from registration.
10. **Delete the account.** Account tab, "Delete my account and data", complete it, and
   let the app come back to its empty state. Finish it — do not stop at the confirmation.

There is no user-generated content shared between users, so there is nothing to record
for reporting or blocking.

**Say this in the reply**, because a reviewer will look for a sign-up screen and not find
one: the app has no password and no separate registration step. Answering the three
questions creates the household on the phone, and entering an email address for the first
time is what attaches an account to it. The same screen signs you in afterwards.

## 2 · Purpose and audience

Lunch Sorted plans a week of packed school lunches for a parent who makes them.

The problem it solves: deciding what to pack, five days a week, for a child who will
only eat certain things, inside whatever rules the school sends home. The app asks three
questions, then plans the five school days — a main, a side, a fruit and a sweet for each
school day — matched so each box has some contrast of texture and flavor, and rolls
every planned box into one shopping list grouped by aisle.

The audience is parents and caregivers of school-age children in the United States. The
parent is the user throughout. A child sees exactly one screen, the kid's pick, which
the parent opens and hands over; it asks the child for nothing, collects nothing, and
offers only a choice between two foods already on that week's plan. The app is not in
the Kids Category and does not target children.

## 3 · Setting up and reaching the main features

**Signing in.** The review account is in App Review Information. On the sign-in screen,
enter that email address, tap "Email me the link", then type the code into the "code from
the email" field on the same screen. That address is sent no email and its code is fixed, but it is still checked
inside the usual fifteen-minute window. Tapping "Email me the link" is still required, because it opens the
window the code is checked against.

That account is already set up with a planned week, so you land on lunches rather than an
empty app.

**Where things are.** Week: the five planned boxes; Shuffle all redraws the week, Shuffle
day one day, and the arrow on a compartment swaps one food. Shop: everything to buy, by
aisle; the share button sends it to Notes or Reminders. Recipes: a tab of its own, with
two recipes included; open one to scale the batch, switch between US and metric, or cook
it a step at a time. Pack: the next school day's box and one Packed check; "Let … pick"
opens the kid's-pick screen. Account: sign-in, the plan, the other parent's invite, and
"Delete my account and data".

School rules and allergens are behind the sliders icon beside the lunchbox name, along
with the switch for the kid's pick.

## 4 · External services

| Service | What it does | Where |
|---|---|---|
| Netlify | Hosting and the serverless functions | United States |
| Neon | PostgreSQL, the household document once a parent signs in | United States |
| Resend | Transactional email: the sign-in link, trial and reminder emails | United States |
| Stripe | The Household plan subscription, on our website in Safari | United States |
| Google Fonts | Two web fonts | — |

The app makes no other outbound calls. Everything else is our own domain.

**No in-app purchase.** The Household plan is sold on lunchsorted.app. Where the app
mentions the plan it opens Safari to our site; the app itself takes no payment and uses
no StoreKit product.

**Why nothing appears locked in the recording.** Every new household gets the whole plan
free for three weeks, with no card and nothing to cancel, so a freshly registered account
has every feature on. The paid path is on the Account tab, where the plan card offers to
keep the plan and hands off to our website. After the three weeks, planning the week, the
shopping list, the pack list and the idea bank stay free for one lunchbox; writing in your
own foods, the kid's pick, the after-school review, the pantry, extra lunchboxes and
sharing with another parent are the paid plan.

**No AI services of any kind.** No model provider, no inference API, no generated content.
The only feature that touches an outside page is recipe import: when a signed-in parent
pastes the address of a recipe, our own server fetches that page and reads the standard
recipe markup off it. No third party is involved and nothing is generated.

**No analytics or advertising SDKs in the app.** The marketing pages carry Google
Analytics; the app at /app/ does not, and never has.

## 5 · Regional differences

There are none. The app is offered in the United States only, in English (U.S.), and
behaves identically for every user. Nothing is gated by region, and no content differs by
region. Amounts can be shown in US measures or metric, but that is a per-parent toggle,
not a regional one.

## 6 · Regulated material and third-party content

The app is not in a regulated industry. It is a meal planner, not a medical device and
not a health service. It makes no nutritional or medical claims. The allergen settings
are a filter a parent sets for their own child, which flags foods in that parent's own
list; the app never advises on allergies and says so.

The only third-party material in the app is its two included recipes. Both come from
Recipes for Healthy Kids, developed for the United States Department of Agriculture and
published by the federal government, which places them in the public domain. Both are
credited in the app, on the recipe itself, with a link to the source:

  https://www.fna.usda.gov/tn/recipes-healthy-kids-cookbook-homes

The method and the amounts are theirs; the wording of the steps is ours. The two fonts
are licensed under the SIL Open Font License. There is no other third-party content:
no stock imagery and no licensed data. No food in the idea bank is named
after a brand.
