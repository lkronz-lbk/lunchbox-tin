# bluehourventuresllc.com

The one-page site of Blue Hour Ventures LLC, the company that makes Lunch Sorted. It exists so
Apple (the organization developer account), Stripe and the bank can see a public website on a
domain that belongs to the LLC, and so the LLC has a contact address apart from Liz's own.

Static files only: `index.html`, `style.css`, `favicon.svg`. No scripts, no fonts or images
fetched from anywhere, nothing collected, so it needs no privacy page of its own; it links to
Lunch Sorted's. `netlify.toml` here sets the headers and skips a build when nothing in this
folder changed. Text colors are WCAG AAA in light and dark, and every link is a 44px target.

## Setting it up (once)

1. **Netlify**: Add new project → Import from GitHub → `lkronz-lbk/lunchbox-tin`, branch `main`,
   **Base directory** `sites/bluehourventuresllc`, publish directory `.`, no build command. It
   is a second project beside `lunchsorted`; the Lunch Sorted project publishes `public/` only,
   so this folder never appears on lunchsorted.app.
2. **Domain**: in the new project, Domain management → Add `bluehourventuresllc.com` (and
   `www.`). At the registrar, point DNS where Netlify says (its nameservers, or an A record and
   a `www` CNAME). Netlify issues the HTTPS certificate on its own.
3. **Email** (Google Workspace, the one Lunch Sorted already has): Admin console → Account →
   Domains → Add a domain → `bluehourventuresllc.com` as a **secondary** domain; verify with
   the TXT record; add Google's MX record at the registrar; then add
   `hello@bluehourventuresllc.com` as an alias on Liz's user (or a Google Group). No new paid
   user is needed. If Netlify holds the DNS, the TXT and MX records go in Netlify's DNS panel.

## Changing it

Edit the files here, open a pull request into `dev` like any other, and the release owner's
merge to `main` deploys it. Keep the voice of the Lunch Sorted site: quiet, exact, American
English, no exclamation marks.
