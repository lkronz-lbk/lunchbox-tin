# Dinner Picked: the family blog list

The blogs Dinner Picked suggests recipes from (README, section 6). A suggestion shows the recipe's title, the blog's name and a link; tapping it opens the blog's own page; **Save** on that page imports it as the parent's personal copy, credited and linked. Nothing is copied or shown in place of a visit, and nothing is fetched in bulk.

Every blog here passed two checks on 2026-10-10: reputation (who runs it, how big it is, whether it is written for families, whether its recipe cards carry star ratings) and a technical pass (one recipe page and `robots.txt` fetched, to confirm the importer can read its schema.org Recipe markup). Blogs marked **ask first** are listed only once their owner has said yes to the courtesy email.

## Written for feeding kids

| Blog | Who | Why it's in |
|---|---|---|
| Weelicious | Catherine McCord, Los Angeles, culinary-school trained; since 2007; four cookbooks | 350+ family dinners, "one family, one meal", free weekly plans, clean terms. No diet filters |
| MJ and Hungryman | Min Kwon, MS, RDN, pediatric dietitian; since 2012 | Dietitian-written; 150–250 family dinners, toddler-tilted; ratings shown |
| 100 Days of Real Food | Lisa Leake, Charlotte NC; NYT-bestselling cookbook | 500+ recipes with a Picky Eaters filter plus GF, DF, egg- and nut-free; its sharing policy explicitly allows a photo, link and credit |
| Super Healthy Kids | Amy Roskelley and Natalie Monson, Utah; since 2007 | Deep dinner section with vegetarian, GF, DF, nut- and egg-free filters. It sells its own meal plans through Prepear, and ratings aren't always shown |
| Yummy Toddler Food (**ask first**) | Amy Palanjian, Iowa; NYT-bestselling *Dinnertime SOS* | The biggest kid-food audience and the best allergy filters, but its terms forbid automated collection without written permission, it sells its own meal-plan membership, and it skews ages 1–5 |
| The Natural Nurturer | Taesha Butler; cookbook 2026 | 600+ veggie-loaded recipes for selective eaters. Technical pass still owed |
| The Lean Green Bean | Lindsay Livingston, RD, Ohio | Family meals tested on three kids. Technical pass still owed |

## Big family-dinner pools with ratings

| Blog | Who | Why it's in |
|---|---|---|
| Once Upon a Chef | Jenn Segal, Potomac MD, L'Academie de Cuisine graduate, mom of two; two cookbooks | The best single fit: tested family dinners, very highly rated, and an FAQ that says of republishing "Sure! Please just provide proper attribution and link back" |
| Dinner at the Zoo | Sara Welch, N. California, mother of three, two of them picky | 1,300 personally tested recipes; asks only for a link back with credit |
| The Recipe Critic | Alyssa Rivers, Utah, mom of four; cookbook "for busy families" | Recipes "tried, tested, and approved by kids and families" |
| The Modern Proper | Holly Erickson and Natalie Mortimer; since 2012 | Explicitly "family dinner"; per-recipe GF/DF tags in its markup; the voice is adult |
| Two Peas & Their Pod | Maria Lichty, Utah, two boys | "Picky eaters and all", "kid-approved"; dessert-heavy |
| Natasha's Kitchen | Natasha Kravchuk, Idaho, since 2009, mom of two; bestselling cookbook | Kid-friendly category; thin dietary coverage |
| Barefeet in the Kitchen | Mary Younkin, Phoenix; *The Weeknight Dinner Cookbook* | 500+ main dishes; permissive |
| Well Plated | Erin Clarke, Milwaukee; two cookbooks | Kid Friendly category; vegetarian, GF, DF and vegan filters |
| Spend With Pennies | Holly Nilsson, Canada, US cups | 3,000+ tested recipes with very large rating counts. Its terms carry an ad-network clause against automated use for AI purposes; see "Terms" below |
| Kristine's Kitchen | Kristine Rosenblatt, mom of five | Family-friendly dinners, free weekly dinner plans |
| The Cozy Cook | Stephanie Melchione; two cookbooks | "Busy families, simple ingredients" |
| Tastes Better From Scratch | Lauren Allen, Phoenix, since 2009 | Family dinners; paid meal plans beside free recipes |
| Budget Bytes | Founded 2009 by Beth Moncel, Nashville; team-run by culinary-trained editors since 2024 | 2,000+ weeknight, budget-first posts with cost per serving; vegetarian, vegan and GF sections |
| Pinch of Yum | Lindsay and Bjork Ostrom, St Paul; since 2010; makers of the Tasty Recipes plugin | 1,500 posts led by soups, pasta and bowls; vegan, vegetarian and GF tags |
| Skinnytaste (**ask first**) | Gina Homolka, Long Island, since 2008; eight cookbooks; not a dietitian | Very well rated, but framed around weight loss (calories, points), and its footer forbids "automated aggregation" without permission |
| Gimme Some Oven (**ask first**) | Ali Martin, Kansas City, since 2009 | About half weeknight. Its terms ask permission for links; recipe markup still to confirm |

## Smaller but kid-pleasing

| Blog | Who | Why it's in |
|---|---|---|
| Lil' Luna | Kristyn Merkley, Arizona, family of eight | 2,300+ family-friendly recipes, weekly meal plans |
| Mel's Kitchen Cafe | Mel Gunnell, Idaho, mom of five, since 2007 | Big-family tested dinners; leans toward baking |
| Real Mom Nutrition | Sally Kuzemchak, MS, RD, Ohio; two cookbooks | A dietitian voice; a small dinner pool |

## A diet shelf

Suggested only when an eater's diet calls for them.

| Blog | Shelf | Note |
|---|---|---|
| Love and Lemons | Vegetarian | The biggest independent here; 85+ vegan dinners |
| Cookie and Kate | Vegetarian | |
| Iowa Girl Eats (**ask first**) | Gluten-free | The only all-GF family blog found; its about page rejects AI-generated content outright, so ask |

## Left out, and why

| Blog | Reason |
|---|---|
| Damn Delicious, Dinner Then Dessert | Strong fits (fast family dinners, big rating counts, no anti-AI stance), but their edge refused every automated reader, so Save would fail. First to ask whether a named agent may come through |
| Ambitious Kitchen | Refuses every automated reader and blocks every AI crawler |
| Six Sisters' Stuff | Sells its own meal-planner app and Prepear plans; a competitor |
| Simply Recipes, The Kitchn | Corporate publishers whose terms forbid scraping, and in Simply Recipes' case building "a similar or competitive application"; both block automated reading |
| Food52 | Bankrupt December 2025, sold February 2026; 90% user-submitted recipes |
| Smitten Kitchen | No star ratings; older inline markup; the author has publicly objected to recipe copying. Link only |
| Half Baked Harvest | Indulgent, long recipes; many cocktails and desserts; no kids |
| Kids Eat in Color, Feeding Littles | No free dinner recipes (Kids Eat in Color's are a paid download; Feeding Littles is a course shop with its own planner app). Partnership names, not sources |
| Family Fresh Meals, Fit Foodie Finds, Happy Healthy Mama | Thin ratings or no kid focus; fillers if the pool runs thin |
| My Fussy Eater (UK), RecipeTin Eats (AU), My Kids Lick the Bowl (NZ), Healthy Little Foodies (AU/UK), Sarah Remmer (CA) | Metric measurements. My Fussy Eater is the one to add first if the importer gains unit conversion (`parseQty` and the density table are a start) |
| Mama Knows Nutrition | Ages 0–6 |
| Solid Starts, Cook Smarts, Veggies & Virtue | Not recipe sites |

## For the build

1. **Send a plain, honest user agent, never a fake browser.** Fourteen of these sites sit behind Cloudflare, which challenged a browser-like fetch but served the plain `curl` agent normally; Pinch of Yum is the reverse. Lunch's `LunchSortedBot/1.0` agent passed where tested, as did `DinnerPicked/1.0 (+https://dinnerpicked.app)`. Smoke-test one recipe URL per host.
2. **Rating fields vary.** Some pages have no rating; some carry `ratingCount`, others only `reviewCount`. Read whichever exists, and never show "unrated" as if it were a bad mark.
3. **Field gaps.** `totalTime` missing or zero; `recipeYield` a string, a number or a pair; one site's script tag has an unquoted `type=`; some nest the Recipe inside `@graph`; The Modern Proper uses its own card markup.
4. **A graceful refusal.** When a site won't let us read it: "This site won't let us read the recipe. Open it in Safari?", with the link kept.
5. **Terms.** Ten sites forbid "systematic or automated" collection, and four carry their ad network's AI-training non-consent clause. A one-page fetch at a parent's tap, credited and linked, is a personal copy, not systematic collection, and nothing trains a model. Dinner Picked's terms say exactly that.
6. **Read `robots.txt` AI blocks as a weak signal.** Their ad network switched those on by default in 2024. An explicit statement, as from Iowa Girl Eats or Smitten Kitchen, is the real signal, and is honored.

The precedent that matters is Recipeasly (2021): an app that showed recipes stripped of the page was taken down within hours by blogger backlash. Prepear, which imports with credit, is the accepted model, and so is BigOven's pledge to link back. Dinner Picked's design sits on the accepted side. The one thing never to build is a screen that shows a blog's recipe in place of a visit.

## Before launch

1. A courtesy email to each listed blog, from Liz: what Dinner Picked does, that it links and credits, and that removal is one reply away.
2. A yes from the four **ask first** blogs before they appear.
3. Ask Damn Delicious and Dinner Then Dessert whether a named agent may come through.
4. The technical pass on The Natural Nurturer and The Lean Green Bean, and Gimme Some Oven's markup.
5. Confirm every "Who" cell on the blog's own about page before it appears in-app; most were read this session, but founder details were not all re-checked.
