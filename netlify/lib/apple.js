import crypto from 'node:crypto';

/* The App Store is the iPhone app's way of paying, as Stripe is the web's. Everything Apple sends
   about a purchase, from the phone or from its own servers, is a JWS: a payload signed with a key
   whose certificate chains to Apple's root. Nothing is taken on trust until that chain and that
   signature check out here, with no library between us and node:crypto.

   This follows Apple's own reference (@apple/app-store-server-library, jws_verification.js), check
   for check: three certificates in the x5c header; the root pinned, never read from the payload;
   the intermediate signed by the root and marked a CA; the leaf signed by the intermediate; Apple's
   receipt-signing mark on the leaf and its developer-relations mark on the intermediate; all three
   in date at the moment Apple signed. The leaf's mark is what matters most. The same Apple
   intermediate issues certificates to every Apple developer, so without it anyone with a developer
   account could sign a purchase that never happened. Apple's library can also ask Apple online
   whether a certificate has been revoked; it does not by default, and neither does this. */

export const BUNDLE_ID = 'app.lunchsorted';

/* the App Store products, which App Store Connect will not let us rename or reuse once made */
export const PRODUCTS = {
  'app.lunchsorted.household.annual': 'household',
  'app.lunchsorted.household.month': 'household',
  'app.lunchsorted.household.forever': 'lifetime'
};

/* SHA-256 of "Apple Root CA - G3", computed from the certificate in Apple's own library and matching
   the value other App Store libraries pin (tests/fixtures/apple/real-chain.json holds the certificate) */
const APPLE_ROOT_G3 = '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';
const LEAF_MARK = '1.2.840.113635.100.6.11.1';           /* Mac App Store and iTunes Store receipt signing */
const INTERMEDIATE_MARK = '1.2.840.113635.100.6.2.1';    /* Apple Worldwide Developer Relations */

/* App Review buys in the sandbox against the production build, and so do TestFlight testers, so a
   production deploy has to take sandbox purchases or the app fails review. A sandbox purchase is
   only possible for Apple's reviewers and for testers this team invites. Xcode's local StoreKit
   testing signs with no Apple chain and is never accepted. */
export const envOk = (e) => e === 'Production' || e === 'Sandbox';

const pinnedRoot = () => globalThis.__LS_APPLE_ROOT || APPLE_ROOT_G3;

/* An App Store plan is over once its end date has passed by more than this, whether or not Apple's
   notification about it arrived. A missed notification must neither leave a plan on for good nor
   stop the website ever selling the household the plan. The slack covers a late renewal notice. */
export const LAPSE_SLACK_MS = 3 * 86400000;
export const lapsed = (periodEnd, now = Date.now()) => !!periodEnd && new Date(periodEnd).getTime() + LAPSE_SLACK_MS < now;
/* a row the App Store holds live: paid, and not past its end */
export const appleLive = (row, now) => !!row && row.source === 'apple' && (row.status === 'active' || row.status === 'past_due') && !lapsed(row.current_period_end, now);

/* just enough DER to list a certificate's extension OIDs; Node checks the certificate's shape when
   it parses it, and anything unexpected here reads as no extensions, which fails the check */
function tlv(buf, pos) {
  let len = buf[pos + 1], off = pos + 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; }
  if (off + len > buf.length) throw new Error('truncated');
  return { tag: buf[pos], start: off, end: off + len };
}
function children(buf, node) {
  const out = [];
  for (let p = node.start; p < node.end;) { const c = tlv(buf, p); out.push(c); p = c.end; }
  return out;
}
function oid(buf, node) {
  const b = buf.subarray(node.start, node.end), arcs = [Math.floor(b[0] / 40), b[0] % 40];
  for (let i = 1, v = 0; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { arcs.push(v); v = 0; } }
  return arcs.join('.');
}
export function extensionOids(der) {
  try {
    const tbs = children(der, tlv(der, 0))[0];
    const wrapped = children(der, tbs).find(c => c.tag === 0xa3);     /* [3] Extensions */
    if (!wrapped) return new Set();
    return new Set(children(der, children(der, wrapped)[0]).map(ext => oid(der, children(der, ext)[0])));
  } catch { return new Set(); }
}

const inDate = (x, at) => new Date(x.validFrom).getTime() <= at && at <= new Date(x.validTo).getTime();

/* leaf, intermediate, root as they arrive in x5c; returns the leaf when the chain is Apple's */
export function verifyChain(certs, at) {
  if (!Array.isArray(certs) || certs.length !== 3) throw new Error('chain length');
  /* before anything is decoded: a value that is not a short string could make Buffer.from build an
     array of any length the sender chose, on an endpoint anyone can reach */
  if (!certs.every(c => c instanceof crypto.X509Certificate || (typeof c === 'string' && c.length <= 8192))) throw new Error('certificate');
  const [leaf, intermediate, root] = certs.map(c => c instanceof crypto.X509Certificate ? c : new crypto.X509Certificate(Buffer.from(c, 'base64')));
  if (root.fingerprint256 !== pinnedRoot()) throw new Error('not Apple\'s root');
  if (!(intermediate.issuer === root.subject && intermediate.verify(root.publicKey) && intermediate.ca)) throw new Error('intermediate');
  if (!(leaf.issuer === intermediate.subject && leaf.verify(intermediate.publicKey))) throw new Error('leaf');
  if (!extensionOids(leaf.raw).has(LEAF_MARK)) throw new Error('leaf is not a receipt signer');
  if (!extensionOids(intermediate.raw).has(INTERMEDIATE_MARK)) throw new Error('intermediate is not Apple\'s');
  if (!(Number.isFinite(at) && inDate(leaf, at) && inDate(intermediate, at) && inDate(root, at))) throw new Error('out of date');
  return leaf;
}

/* a JWS from Apple, checked; returns its payload, or throws */
export function verifyJws(jws) {
  if (typeof jws !== 'string' || jws.length > 32768) throw new Error('not a JWS');
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('not a JWS');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (header.alg !== 'ES256') throw new Error('alg');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const leaf = verifyChain(header.x5c, Number(payload.signedDate));
  const details = leaf.publicKey.asymmetricKeyDetails || {};
  if (leaf.publicKey.asymmetricKeyType !== 'ec' || details.namedCurve !== 'prime256v1') throw new Error('key');
  const sig = Buffer.from(parts[2], 'base64url');
  if (sig.length !== 64) throw new Error('signature');
  const ok = crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, sig);
  if (!ok) throw new Error('signature');
  return payload;
}

const iso = (ms) => new Date(Number(ms)).toISOString();

/* what a verified transaction (and, from a notification, its renewal info) means for the row.
   cancelAtPeriodEnd is null when there is no renewal info to say, so the row keeps what it had. */
export function stateOf(txn, renewal, now = Date.now()) {
  const plan = PRODUCTS[txn && txn.productId];
  if (!plan) return null;
  if (txn.revocationDate) return { plan: 'free', source: 'none', status: 'canceled', periodEnd: null, cancelAtPeriodEnd: false };
  /* forever bought in the sandbox, by a reviewer or a TestFlight tester who paid nothing, lasts a day
     and then lapses like any App Store plan; bought for real it has no end */
  if (plan === 'lifetime') return { plan: 'lifetime', source: 'apple', status: 'active', periodEnd: txn.environment === 'Sandbox' ? iso(Number(txn.purchaseDate || txn.signedDate) + 86400000) : null, cancelAtPeriodEnd: false };
  const cancelAtPeriodEnd = renewal ? renewal.autoRenewStatus === 0 : null;
  const expires = Number(txn.expiresDate) || 0;
  const grace = (renewal && Number(renewal.gracePeriodExpiresDate)) || 0;
  if (expires > now) return { plan: 'household', source: 'apple', status: 'active', periodEnd: iso(expires), cancelAtPeriodEnd };
  /* Apple's billing grace period keeps the plan while it retries the card, as Stripe's past_due does */
  if (grace > now) return { plan: 'household', source: 'apple', status: 'past_due', periodEnd: iso(grace), cancelAtPeriodEnd };
  return { plan: 'free', source: 'none', status: 'canceled', periodEnd: expires ? iso(expires) : null, cancelAtPeriodEnd: false };
}
