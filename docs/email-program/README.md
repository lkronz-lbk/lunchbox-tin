# The email program

What the planner sends, why, when, and in which words. `report.md` is the research and the plan
(2026-10-24); `research-notes/` holds every source behind it. `copy.json` is the copy itself, one
entry per email, and the only place the words live: the mock-up page, the spec blocks in the
report and, once built, the senders in `netlify/lib/mail.js` all read from it.

## Editing the copy

1. Open the mock-up page (the Claude artifact "Lunch Sorted email mock-ups"). Tap **Edit copy** on
   a card, change the subject, preheader, headline, lines, small print or button label. The phone
   redraws as you type. **Save** keeps the change in the page's own store; **Back to the plan's
   copy** drops it.
2. Say "pull the email edits" to Claude. It reads the store (collection `copy`, one document per
   email id, changed fields only), writes them into `copy.json`, runs the build and publishes the
   page again. The report's spec blocks follow.
3. The build, from the repository root:

   ```
   node docs/email-program/build.mjs            # mockups.html beside this file, and report.md's blocks
   node docs/email-program/build.mjs out.html   # the page somewhere else
   ```

Lines may carry `**bold**` and `[a link](https://…)`; nothing else. Hrefs that start with `/` are
rooted at the site. A visual with a `crop` is a stand-in: the whole marketing screen seen through a
window, until `scripts/mail-shots.mjs` cuts the real file.

## Rules the copy keeps

HANDBOOK.md, The voice: "we" for the product, "I" and a signature where Liz writes, never both in one
email; American English; one subject under 37 characters; no exclamation marks, no selling openers;
nothing about a child in any email. Every email ends with the closing line in `mail-parts.js`.
