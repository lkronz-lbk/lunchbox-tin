# The iPhone app

A Capacitor shell around the web app. It does not bundle the app: it opens
`https://lunchsorted.app/app/` in a WKWebView (see `capacitor.config.json`,
`server.url`), so every web deploy is an app update and the App Store build
only changes when this folder does. The web app knows it is inside the shell
by the `LunchSortedApp/1` user-agent suffix (`native()` in `public/app/index.html`)
and by `window.Capacitor`.

What the shell adds, and where:

- **Sign-in.** A tapped email link opens Safari, not the app, so inside the app the
  email step leads with the code. Universal links fix that later (below).
- **Stripe.** Checkout and the billing portal open in Safari (`Browser` plugin).
  The server sends the parent back to `/back.html`, which hands off to the app
  through the `lunchsorted://` URL scheme (`Info.plist`, `CFBundleURLTypes`); the
  app's `appUrlOpen` listener closes Safari and polls for the paid row. Payments
  never touch StoreKit.
- **Icon and launch screen.** `App/App/Assets.xcassets`: the 1024 icon from
  `public/icons`, and a light and a dark launch image on the app's ground colours.
- **The room the clock needs.** `contentInset: never` keeps the web view full height, which
  is what lets the page paint its own strip behind the status bar in its own colours. WebKit
  then reports `env(safe-area-inset-*)` as zero, so `App/SafeAreaViewController.swift` sets
  `--sat` and `--sab` on `<html>` from UIKit instead. The stylesheet defines those two from
  `env()` for Safari and for a home-screen web app, so one set of rules covers all three.
  The storyboard points at that subclass; changing it back to `CAPBridgeViewController`
  would put the top bar under the clock again.
- **Offline.** `WKAppBoundDomains` in `Info.plist` and `limitsNavigationsToAppBoundDomains`
  in the config: that is what lets a remote page register its service worker in a
  WKWebView, so the app opens without a network once it has loaded once. Verify on a
  phone in airplane mode.
- iPhone only, portrait only, no export-compliance prompt (`ITSAppUsesNonExemptEncryption`).
- The shell always loads production. To point a build at staging, change `server.url`
  in `capacitor.config.json` locally and never commit it.

## Building

Without a Mac: `.github/workflows/ios.yml` builds an unsigned simulator binary on
every change to this folder, so the project is proven to compile.

On a Mac with Xcode:

```
npm ci
npm run ios:sync      # writes Package.swift and App/App/capacitor.config.json
npm run ios:open      # opens App/App.xcodeproj
```

Xcode → the App target → Signing & Capabilities → tick "Automatically manage
signing" and pick the team. Run on a simulator or a plugged-in phone. Swift
packages resolve on first open (Capacitor and the two plugins, from
`node_modules`, so `npm ci` first).

`ios/App/App/public` and `capacitor.config.json` inside the app are generated
by `cap sync` and not committed.

## TestFlight

1. App Store Connect → Apps → New app: bundle id `app.lunchsorted`, name
   Lunch Sorted, primary language English (U.S.), SKU `lunchsorted`. Then
   Pricing and Availability → United States only: linking out to Stripe is what
   the US storefront permits, and the product rule depends on it.
2. Xcode → Product → Archive → Distribute App → App Store Connect → Upload.
3. App Store Connect → TestFlight → the build → add internal testers (yourself),
   then an external group once the build clears beta review.

## TestFlight from CI

`.github/workflows/testflight.yml` archives, signs and uploads a build with no Mac,
no certificate file and no provisioning profile: Xcode's cloud-managed signing makes
and keeps those against an App Store Connect API key. Run it from GitHub → Actions →
TestFlight → Run workflow, or push a tag such as `ios-v1.0.1`. The build number is the
run number; the version is `package.json`'s.

It needs four repository secrets (GitHub → Settings → Secrets and variables →
Actions → New repository secret). Never put any of them in the repository, a chat,
or a document.

| Secret | Where it comes from |
|---|---|
| `APPLE_TEAM_ID` | developer.apple.com → Account → Membership details → Team ID (ten characters) |
| `APPSTORE_KEY_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → Generate API Key, name it "GitHub TestFlight", access **Admin** (cloud signing needs Admin to create the certificate). The Key ID is shown in the list. |
| `APPSTORE_ISSUER_ID` | the Issuer ID at the top of that same page |
| `APPSTORE_KEY_P8` | the contents of the `AuthKey_<KEY_ID>.p8` file that page lets you download once: open it in a text editor and paste the whole thing, `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----` |

The app record must exist first (step 1 above). The first run registers the bundle id
and creates the distribution certificate; if it fails on signing, the key's role is
the first thing to check. Each run leaves its logs as a workflow artifact and deletes
the key from the runner.

## Universal links

So the sign-in link in the email opens the app rather than Safari. **All of this is
already in the repository** — the pieces are listed here because when a tapped link
lands in Safari anyway, one of them is what to check.

1. `App.entitlements` carries `com.apple.developer.associated-domains` =
   `applinks:lunchsorted.app`, and both build configurations point at that file.
2. `public/.well-known/apple-app-site-association` (no extension) is served as
   `application/json` by a `[[headers]]` block in `netlify.toml`:

   ```json
   {"applinks":{"details":[{"appIDs":["TNF9FG2U7G.app.lunchsorted"],"components":[{"/":"/api/auth/verify","?":{"t":"?*"}}]}]}}
   ```

   Only the sign-in link is claimed: claiming `/app/*` too would pull every
   `/app/?join=`, `?upgrade=1` and Stripe return on a phone with the app installed
   out of Safari and the home-screen web app. `tests/smoke.mjs` asserts both halves.
3. Nothing to change in the app: `appUrlOpen` already loads any
   `https://lunchsorted.app/...` URL it is handed.

**When a link opens Safari instead of the app**, in the order worth checking:

- Is the association file actually live? It was written long before it first reached
  production, and until it did, every tapped link went to Safari.

  ```
  curl -s -D- https://lunchsorted.app/.well-known/apple-app-site-association
  ```

  Expect `200` and `content-type: application/json`. A `404` is the whole answer.
- Was the file live *before* the build on the phone was installed? iOS fetches the
  association at install and update time, not at tap time. A phone that installed a
  build while the file was missing keeps failing until the app is reinstalled or
  replaced by a newer build.
- Does the App ID have the Associated Domains capability in the developer portal?
  `testflight.yml` passes `-allowProvisioningUpdates`, which registers it only if the
  App Store Connect API key holds the **Admin** role.
- Is the link still a raw `lunchsorted.app` URL? If Resend click tracking is ever
  switched on, the link becomes a tracker URL on another host and the claim stops
  matching. `api-auth.js` builds it raw today.

The claim names the production host only, so a sign-in link from a branch deploy
stays in Safari. That is expected; test universal links against production.

## App Review notes

The app is the web app in a shell, which Apple's guideline 4.2 can object to.
What answers it: it works offline, it installs, the kid's-pick screen and the
morning review are app-shaped, and version 1.1 adds the night-before reminder,
the share sheet and a Home Screen widget. Payments happen on the web; the app
links out to Stripe, which the US storefront permits. Do not add StoreKit to
"be safe": the product rule is that Stripe only ever flips the entitlement row.
