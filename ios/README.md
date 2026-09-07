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

To upload from CI instead of a Mac, add these repository secrets and a signing
job to `ios.yml`: `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_P8`
(an App Store Connect API key with the App Manager role),
`IOS_CERT_P12_BASE64` and `IOS_CERT_PASSWORD` (an Apple Distribution
certificate), and `IOS_PROFILE_BASE64` (an App Store provisioning profile for
`app.lunchsorted`). Never put any of these in the repository or in a chat.

## Universal links (after the Team ID exists)

So the sign-in link in the email opens the app rather than Safari:

1. Xcode → Signing & Capabilities → + Capability → Associated Domains →
   `applinks:lunchsorted.app`.
2. Serve `public/.well-known/apple-app-site-association` (no extension) as
   `application/json`:

   ```json
   {"applinks":{"details":[{"appIDs":["TEAMID.app.lunchsorted"],"components":[{"/":"/api/auth/verify*"}]}]}}
   ```

   with the real Team ID, plus a `[[headers]]` block in `netlify.toml` for that
   path with `Content-Type = "application/json"`. Only the sign-in link: claiming
   `/app/*` too would pull every `/app/?join=`, `?upgrade=1` and Stripe return on a
   phone with the app installed out of Safari and the home-screen web app.
3. Nothing to change in the app: `appUrlOpen` already loads any
   `https://lunchsorted.app/...` URL it is handed.

## App Review notes

The app is the web app in a shell, which Apple's guideline 4.2 can object to.
What answers it: it works offline, it installs, the kid's-pick screen and the
morning review are app-shaped, and version 1.1 adds the night-before reminder,
the share sheet and a Home Screen widget. Payments happen on the web; the app
links out to Stripe, which the US storefront permits. Do not add StoreKit to
"be safe": the product rule is that Stripe only ever flips the entitlement row.
