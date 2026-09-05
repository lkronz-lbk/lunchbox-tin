import { createHmac, timingSafeEqual } from 'node:crypto';

/* Stripe over plain fetch: three calls (a Checkout session, a portal session, a
   price lookup) and one signature check do not need the SDK. The key comes from
   the deploy context, never from a request. Production must hold a live key and
   every other context a test key, so a mis-scoped variable fails the deploy
   instead of charging a real card from a branch. */
const API = 'https://api.stripe.com/v1';

export function stripeKey() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) return '';
  const env = process.env.SITE_ENV || 'production';
  const live = /^(sk|rk)_live_/.test(key);
  if (env === 'production' && !live) throw new Error('STRIPE_SECRET_KEY in production is not a live key');
  if (env !== 'production' && live) throw new Error(`STRIPE_SECRET_KEY for the ${env} context is a live key; scope a test key to this context`);
  return key;
}
export function prices() {
  return { year: process.env.STRIPE_PRICE_YEAR || '', lifetime: process.env.STRIPE_PRICE_LIFETIME || '' };
}
/* read on every household request, so a mis-scoped key must disable billing, not sync:
   the build (scripts/migrate.mjs) is where it fails the deploy */
export function billingEnabled() {
  const p = prices();
  try { return !!(stripeKey() && p.year && p.lifetime); }
  catch (e) { if (!billingEnabled.warned) { billingEnabled.warned = true; console.error('billing off:', e.message); } return false; }
}
export function isProduction() { return (process.env.SITE_ENV || 'production') === 'production'; }

/* form encoding, nested the way Stripe reads it: a[b][0][c]=v */
function encode(params, prefix = '', out = []) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => typeof item === 'object' ? encode(item, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`));
    else if (typeof v === 'object') encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

export async function stripe(method, path, params, idempotencyKey) {
  const key = stripeKey();
  if (!key) throw new Error('Stripe is not configured');
  const headers = { authorization: `Bearer ${key}` };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let url = API + path, body;
  if (method === 'GET') { const q = encode(params); if (q) url += '?' + q; }
  else { headers['content-type'] = 'application/x-www-form-urlencoded'; body = encode(params); }
  const doFetch = globalThis.__LS_STRIPE_FETCH || fetch;
  const res = await doFetch(url, { method, headers, body });
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Stripe ${res.status}`);
    err.status = res.status; err.code = data.error && (data.error.code || data.error.type); err.param = data.error && data.error.param;
    throw err;
  }
  return data;
}

/* what the two plans cost, from Stripe, remembered per function instance for an hour
   so the price is set in one place (the dashboard) and never typed into the app */
let priceCache = { at: 0, value: null };
export async function priceInfo() {
  if (priceCache.value && Date.now() - priceCache.at < 3600 * 1000) return priceCache.value;
  const p = prices();
  const [year, lifetime] = await Promise.all([stripe('GET', `/prices/${p.year}`), stripe('GET', `/prices/${p.lifetime}`)]);
  const one = (x) => ({ amount: x.unit_amount, currency: x.currency, interval: x.recurring ? x.recurring.interval : null });
  priceCache = { at: Date.now(), value: { year: one(year), lifetime: one(lifetime) } };
  return priceCache.value;
}
export function forgetPrices() { priceCache = { at: 0, value: null }; }

/* Stripe-Signature: t=<unix>,v1=<hmac>[,v1=<hmac>]; the hmac is over "<t>.<raw body>" */
export function verifyWebhook(rawBody, header, secret, toleranceSeconds = 300, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.create(null); const v1 = [];
  for (const kv of String(header).split(',')) {
    const i = kv.indexOf('='); if (i < 0) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === 'v1') v1.push(v); else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !v1.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return v1.some(sig => /^[0-9a-f]{64}$/.test(sig) && timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8')));
}

/* the period end moved from the subscription to its items in newer API versions */
export function periodEnd(sub) {
  const s = sub && (sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end));
  return s ? new Date(s * 1000).toISOString() : null;
}
export function subscriptionStatus(sub) {
  const s = sub && sub.status;
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due') return 'past_due';                 /* Stripe is still retrying the card: paid until it gives up */
  return 'canceled';                                       /* canceled, unpaid (retries exhausted), incomplete, incomplete_expired, paused */
}
/* a household that is deleted, or folded into another, must not keep paying */
export async function cancelSubscription(id) {
  if (!id) return;
  try { await stripe('DELETE', `/subscriptions/${id}`); }
  catch (e) { if (e.status !== 404) console.error('billing: could not cancel', id, e.message); }
}
