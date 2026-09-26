# App Store test certificates

`root.pem`, `intermediate.pem`, `leaf.pem` and `rogue.pem` are a chain made for the tests,
shaped like Apple's: the intermediate carries Apple's developer-relations mark
(1.2.840.113635.100.6.2.1) and `leaf` carries the App Store receipt-signing mark
(1.2.840.113635.100.6.11.1). `rogue` is signed by the same intermediate without it, the way
any Apple developer's certificate is, and must always be refused.

`leaf.key` and `rogue.key` are private keys **for this test chain only**. They can sign
nothing production accepts: `netlify/lib/apple.js` pins Apple's own root by fingerprint, and
the suite checks that this chain is refused against that pin. The root and intermediate keys
were deleted when the chain was made.

`real-chain.json` is Apple's real production chain (public certificates), copied from the
tests of Apple's own `@apple/app-store-server-library`, to prove the check accepts what Apple
actually signs with.
