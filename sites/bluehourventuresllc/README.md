# bluehourventuresllc.com

The one-page site of Blue Hour Ventures LLC, the company that makes Lunch Sorted. It exists so
Apple (the organization developer account), Stripe and the bank can see a public website on a
domain that belongs to the LLC, with a business contact address.

`public/` is the whole site: `index.html`, `404.html`, `style.css`, `favicon.svg`,
`apple-touch-icon.png`. No scripts, nothing fetched from anywhere, nothing collected, so it needs
no privacy page of its own; it links to Lunch Sorted's. `netlify.toml` here publishes `public/`
only, sets the headers, and skips a build when nothing in this folder changed. Text colors are
WCAG AAA in light and dark (checked by hand: `npm run contrast` serves Lunch Sorted's `public/`
only), and every link is a 44px target. The App Store link is the one in Apple's approval email
of 2026-10-21 (Apple ID 6810858256).

It names Blue Hour Ventures LLC as the maker of Lunch Sorted, as Lunch Sorted's terms, footer,
home-page data and email sign-off do (the same pull request), so the two sites agree.

## Setting it up (once)

1. **Netlify**: Add new project → Import from GitHub → `lkronz-lbk/lunchbox-tin`, branch `main`,
   **Base directory** `sites/bluehourventuresllc`; the publish directory and the (empty) build
   come from `netlify.toml`. Then Build & deploy → Branches and deploy contexts: **Deploy
   previews: None**, **Branch deploys: None**, so a pull request never publishes a page under the
   LLC's project. The Lunch Sorted project publishes the repository's own `public/`, so nothing
   here ever appears on lunchsorted.app.
2. **Domain**: in the new project, Domain management → add `bluehourventuresllc.com` and
   `www.bluehourventuresllc.com`. At the registrar, point DNS where Netlify says (its nameservers,
   or an A record and a `www` CNAME); Netlify issues the HTTPS certificate itself. Turn on the
   registrar lock and two-factor sign-in at the registrar. After the first deploy, check that
   `/README.md` and `/netlify.toml` answer "Nothing here".
3. **Email**, in the Google Workspace Lunch Sorted already has (Admin console):
   - Account → Domains → Manage domains → Add a domain → `bluehourventuresllc.com` as a
     **secondary domain** (not a user alias domain, which would copy every existing address onto
     it). Verify it with the TXT record Google gives, and add Google's MX record.
   - **SPF**: a TXT record on the bare domain, `v=spf1 include:_spf.google.com ~all`.
   - **DKIM**: Apps → Google Workspace → Gmail → Authenticate email → pick
     `bluehourventuresllc.com` → Generate new record → publish the `google._domainkey` TXT →
     Start authentication.
   - **DMARC**: a TXT record at `_dmarc`, `v=DMARC1; p=none; rua=mailto:hello@bluehourventuresllc.com`;
     move `p=none` to `p=quarantine` once a few weeks of reports look clean.
   - Add `hello@bluehourventuresllc.com` as an alias on Liz's user (Directory → Users → the user →
     Alternate email addresses), then in Gmail → Settings → Accounts → "Send mail as" so replies
     go out from it. No new paid user is needed. If a Google Group is used instead, set who can
     view conversations to members only.
   - If Netlify holds the DNS, every one of these records goes in Netlify's DNS panel. None of
     them touches lunchsorted.app's own mail records.

Stripe's account keeps **lunchsorted.app** as its business website: that is where the prices,
the refund and cancellation terms and the support address are. This site is the LLC's domain,
not a shop.

## Changing it

Edit the files in `public/`, open a pull request into `dev` like any other, and the release
owner's merge to `main` deploys it. Keep the voice of the Lunch Sorted site: quiet, exact,
American English, no exclamation marks.
