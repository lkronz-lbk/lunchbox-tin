# Dinner Picked: product spec (draft)

*Feed the Crew · Lunch Sorted's sibling · draft of 2026-10-06. Nothing here is built yet; this is the spec the build will follow, as `README.md` at the root is Lunch Sorted's.*

Dinner Picked plans a week of family dinners around the foods each person at the table will eat. It plans **one dinner a night**. Where someone won't eat part of it, it adds the smallest change that gets them fed, so the parent cooks once.

Both apps belong to the **Feed the Crew** family: **Lunch Sorted** (school lunches) and **Dinner Picked** (family dinners). They are two App Store apps. Each works on its own or together, and the **Feed the Crew bundle** unlocks both.

---

## 1. Who it's for

The user is **the parent who cooks at 5pm**: tired, short on time, and feeding at least one picky eater. Sometimes the picky eater is an adult. The parent is the only user.

As in Lunch Sorted, children appear only as nicknames. A child is never asked for anything and only sees a screen a parent hands over. Both apps stay out of Apple's Kids Category and out of COPPA scope.

What the parent wants to stop doing:
- deciding what's for dinner every afternoon
- cooking two or three dinners
- buying food that goes to waste

## 2. How a household plans dinner (the three ways)

The setting is **How we do dinner**. It lives in Setup and can be changed at any time. A change re-plans only nights that haven't happened and aren't locked.

| Choice | What a night looks like | Who it's for |
|---|---|---|
| **One dinner, adjusted where needed** *(default)* | One family meal, plus small changes for anyone it doesn't cover. Example: beef stew with mashed potatoes, and for the kids, egg noodles and peas from the yes list. | Most families: one cook, one dinner, a picky eater or two. |
| **One dinner for everyone** | One family meal, with no changes. The plan still shows who isn't covered, but it adds nothing. | Families who already eat one meal and want a plain planner. |
| **A kids' dinner and a grown-ups' dinner** | Two meals a night, chosen to share as much as possible: the same protein, the same side, one pot. | Families who really do cook two dinners now. The app makes the second one as cheap as it can. |

All three run on the same planner (section 4). Each later choice is the first one with a step turned off (adjustments) or widened (a whole second meal). That means one engine to build and test, not three.

## 3. The words on screen

| Term | Meaning |
|---|---|
| **The table** | Everyone who eats dinner. Each person is an **eater**: a nickname, grown-up or kid, plus that person's yes foods, no foods and diet. |
| **Members** | The adults who use the app, as in Lunch Sorted (owner, adult, caretaker). A member is usually also an eater. A grandparent who cooks Tuesdays may be a member who isn't an eater. |
| **Dinner** | One meal for the night, made of **parts**: a main (or base plus protein), sides, and an optional sauce or topping. One-pot dishes fill several parts at once. |
| **Yes list** | The foods an eater reliably eats: plain pasta, peas, apple slices, rice, bread, cheese stick. It is the dinner version of Lunch's food list, and it is what adjustments draw from. |
| **Adjustment** | The change for an eater, or a group of eaters, on one night. See section 4. |

## 4. The planner

### 4.1 Planning a week

1. **Cook nights and standing nights.**
   - The parent picks which nights the app plans.
   - The parent can fix standing nights: Taco Tuesday, pizza Friday, a leftovers night, eating out.
   - A standing night is planned in its fixed form, and only its parts can shuffle.
2. **The family meal.**
   - The meal for each night is drawn from the household's dinners. Randomness lives only in this draw, as in Lunch.
   - Week limits apply:
     - no protein two nights running
     - a weeknight time cap (default 30 minutes; weekends can be longer)
     - a big cook may be followed by its leftovers night
3. **Pairing.** Sides are paired to the main deterministically (Lunch's `pairScore`/`bestAssignment`, re-weighted for dinner).
4. **Coverage and adjustments** (in the default mode).
   - For each eater, the planner asks: is there at least one yes food on the table for them?
   - If not, it adds the **cheapest adjustment** that fixes it, trying these in order:
     1. **Serve it plain or on the side.** Sauce kept off, parts served separately ("deconstructed"). Costs nothing extra.
     2. **Add a no-cook yes food.** Bread, fruit, a cheese stick, raw carrots.
     3. **Add a quick-cook yes food** that fits the meal or shares a pot. Egg noodles beside stew; peas.
     4. **Swap one part for that eater.** Plain noodles instead of the mashed potatoes.
   - The planner never adds a second main in this mode.
   - It picks family meals so that few adjustments are needed. Fewer adjustments rank higher.
   - Lunch already has this shape: in Lunch, the lead lunchbox sets the plan, and each other box swaps only where its own rules or its own food list say otherwise.
5. **Group or individual.**
   - Adjustments are made for **the kids** as a group by default, so one pot of noodles feeds all of them.
   - An eater who differs from the group gets their own adjustment.
   - A grown-up on a diet (vegetarian, no gluten) is covered the same way, usually with a swap.

**In "A kids' dinner and a grown-ups' dinner" mode**, step 4 draws a whole kids' meal, ranked by how much it shares with the grown-ups' meal: the same protein, the same side, the same oven. **In "One dinner for everyone" mode**, step 4 only marks who isn't covered.

### 4.2 Rules carried over from Lunch Sorted (never violate)

- **Flag, never delete.**
  - An eater's diet or allergen flags a dinner or a part; it never removes it.
  - The parent can override once for that night. The override stays flagged, and it ends when that dish leaves the night.
- **Plan the week aligns; a single shuffle stays put.** Shuffling one night or one part never touches another night.
- **A night that has gone is never rewritten.** This covers any night before today, and tonight from the cutoff, or once the parent marks dinner made. What was cooked stays.
  - Dinner time defaults to 6pm and the cutoff to 9pm. Both are household settings.
- **Lock, Shuffle, Plan the week, Undo** work as they do in Lunch.

### 4.3 What the planner deliberately doesn't do

- **It doesn't plan a plate per person.** That would automate the short-order cooking that feeding experts advise against.
- **It doesn't count calories or make health claims.**

## 5. After dinner

Lunch's "came home" question becomes **How did dinner go?** It is optional and asked the next morning or that evening. It covers two things.

**The dish, once for the family:**
- Make again
- Fine
- Not for a while (the dish rests for three weeks)

**Each kid's adjustment and any new food on the plate:**
- Ate it
- Tried it
- Not yet

How the answers count (decided 2026-10-06):
- **A child's "not yet" rests that food for that child for a short while** (default 7 days; the parent can change it). After that, the planner offers it again **beside a yes food**. It is never dropped on its own, because feeding research says a new food can take 8 to 15 tastes.
- **The app counts tastes.** After about 15 tastes without an "ate it", it asks the parent once whether to keep offering it or take it off the list. The parent decides; the app never decides alone.
- **A grown-up's "not for me"** rests the food for three weeks, as "came home" does in Lunch.

This replaces Lunch's "came home twice, rest three weeks" rule for children at dinner.

**Leftovers** is a third outcome: "There's enough for lunch." See section 8.

## 6. Recipes and the dinner bank

Recipes are **led by foods first, then found, then adapted** (decided 2026-10-06):

1. **Built-in dinners.**
   - Most weeknight dinners need no recipe. "Tacos" is tortillas, beef, cheese, lettuce and salsa.
   - The **dinner bank** ships about 100 dinners as **lists of parts**, written in our own words and not taken from cookbooks. The app works on day one with no recipes at all.
2. **Found on a curated list of family-food blogs.**
   - We choose a list of trusted, kid-friendly recipe blogs.
   - Dinner Picked suggests their recipes as a **title, the site's name and a link**, never copied text or photos.
   - The parent taps **Save**, and Lunch's existing import reads that one page, with the blog credited and linked. The importer already accepts only a list of named public sites (`api-recipe.js`), so the curated list and that allowlist can be one list.
   - No scraping and no Pinterest copying. A parent can still paste any link or caption, as in Lunch.
3. **Adapted by AI.**
   - AI reads a saved recipe and works out its parts.
   - It then proposes each eater's adjustment, for example "pull the kids' portion before the chili goes in" or "egg noodles and peas from Noah's yes list".
   - AI never writes a recipe of its own.

Cook mode carries over and takes the lead:
- it scales to the number of eaters
- timers bring the main and the sides to the table together

*To do:* draw up the blog list, about 15–25 family-food blogs, with each blog's terms checked for linking and import.

## 7. The shopping list

Built like Lunch's list, from the week's parts, plus the dinner extras:
- **Amounts scaled to the table.** A kid counts as half a portion by default; the parent can change it.
- **Amounts merged across recipes:** two onions plus one onion becomes three.
- **Adjustment items marked:** "egg noodles · for the kids".
- **A shared list** when the household also uses Lunch Sorted. See the next section.

## 8. Lunch Sorted and Dinner Picked together

These features need **one household and one sign-in across both apps**, which is already decided:
- **Tonight's leftovers become tomorrow's lunch.** "There's enough for lunch" offers to put it in tomorrow's lunchbox in Lunch Sorted as a write-in.
- **One shopping list.** Either app can show both apps' lists merged by aisle.
- **One table.** A kid's Lunch Sorted foods can seed their dinner yes list (with the parent confirming), so a household that already uses one app sets up the other in a minute.
- **Each app opens the other** from its Account page.

Each app must stand alone. None of the above can be required.

## 9. Kid's pick, adapted

Kid's pick is off by default.
- When it's on, a kid picks **their night** once a week from two or three dinners the parent has already approved.
- The parent hands over the phone, exactly as in Lunch. Nothing is asked of the child, and nothing is stored about them beyond the pick.

## 10. Onboarding

There are four questions, then a planned week:
1. **Who's at the table?** Nicknames, grown-up or kid.
2. **Anything anyone doesn't eat?** Diets and allergens. Optional.
3. **Which nights do you cook, and how long on a weeknight?**
4. **What do the kids always eat?** Yes foods picked from a bank. This seeds adjustments.

The mode question is skipped. Everyone starts on "One dinner, adjusted where needed" and can switch in Setup.

## 11. Pricing (same structure as Lunch Sorted)

| | |
|---|---|
| Trial | 21 days of everything, no card |
| Plan | $19.99 a year or $2.99 a month, the same founding price as Lunch Sorted, kept while subscribed (decided) |
| Feed the Crew bundle | Both apps. *Price for Liz to set.* A starting point is $29.99 a year or $4.49 a month. |
| Payment | Through the App Store on iPhone and Stripe on the web, never crossed. A plan bought on one platform works on the other. |
| Free, for good | *Liz decides.* Proposal below. |

**Proposed free and paid line:**
- **Free:** one week planned at a time in **"One dinner for everyone"** mode, the shopping list and the dinner bank.
- **Paid:** adjustments, which are the product's difference; the kids' and grown-ups' mode; recipe import and cook mode; a second parent and sync; and the Lunch Sorted bridges.

The free tier has to be useful but plain. It is the same planner other apps offer, so the reason to pay is visible.

## 12. Product rules (draft "never violate" list for Dinner Picked's CLAUDE.md)

- The parent is the user. A child only ever sees the kid's-pick screen, handed over, and is never asked for anything. Nicknames only, and allergens are optional.
- One family meal is the default. The planner never plans a plate per person, and outside "A kids' dinner and a grown-ups' dinner" mode it never adds a second main.
- Adjustments use the cheapest step that covers the eater: plain, then add no-cook, then add quick-cook, then swap one part.
- Diets and allergens flag; they never delete. An override is for one night and stays flagged.
- Pairing is deterministic, and randomness lives only in draws.
- A night that has gone is never rewritten.
- A child's "not yet" is a taste, never a strike.
- Signed out, everything stays on the phone. Signed in, the household syncs, merged by record timestamp, with the local copy winning ties.
- Each platform takes payment its own way, and only a payment source writes the entitlement.
- Every word on screen is for a parent. No jargon, no IDs, no health claims.

## 13. How it reuses Lunch Sorted's code

| Lunch Sorted | Dinner Picked |
|---|---|
| Aligned lunchboxes: lead box, then a swap only where needed | **Adjustments**: family meal, then an adjustment only where needed. This is the backbone. |
| `pairScore`, `bestAssignment` | Side-to-main pairing, plus adjustment cost and week-level limits |
| School rules, overrides | Diets and allergens, overrides |
| Food list, food bank | Yes lists, plus the dinner bank of part lists |
| Recipes, import, cook mode, amounts | The same code, with scaling to eaters |
| Shopping list, pantry checks | The same, plus amount merging |
| Sync, `LSMerge`, accounts, billing, trial, StoreKit | Shared core. `LSMerge` gains a dinner document. |
| "Came home" | "How did dinner go", with tastes counted for kids |
| Pack days, 3pm cutoff | Cook nights, a cutoff after dinner |
| Packed checks, ice-pack and container flags | Prep-ahead reminders: defrost tonight, slow cooker by 9am |

## 14. Still to decide

1. ~~Refusal rule~~: decided. A short rest, then offered again (section 5).
2. Recipe sourcing approach (section 6): discovery and AI's role.
3. The free line and the bundle price (section 11).
4. ~~Dinner time and cutoff~~: decided, 6pm and 9pm, both settable. Kid portions at half (section 7) are still open.
5. Where this spec lives.
6. The server question from the plan's Phase 2: one sign-in server or two. This decides how section 8 works.

## 15. A first version worth shipping

The smallest Dinner Picked that proves the idea:
- the table and yes lists
- a week planned in the default mode, with adjustments
- standing nights
- the shopping list with amounts
- "How did dinner go"
- sign-in, sync, the trial and the plan

Later: the kids' and grown-ups' mode, kid's pick, the Lunch Sorted bridges, timers, and the bundle.
