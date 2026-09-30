import { createHmac, timingSafeEqual } from 'node:crypto';
import { siteEnv } from './db.js';

/* Stripe over plain fetch: three calls (a Checkout session, a portal session, a
   price lookup) and one signature check do not need the SDK. The key comes from
   the deploy context, never from a request. Production must hold a live key and
   every other context a test key, so a mis-scoped variable fails the deploy
   instead of charging a real card from a branch. A key pasted with more than the
   key fails it too, before any of it can reach a header or the log. */
const API = 'https://api.stripe.com/v1';

export function stripeKey() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) return '';
  /* the key alone: anything pasted with it, a line break above all, can make fetch refuse the
     authorization header with a message that quotes the header whole, and every caller logs the
     message. So it fails the deploy here, as a key in the wrong context does, in words that name
     the variable and never what it holds */
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(key)) throw new Error('STRIPE_SECRET_KEY must be sk_ or rk_, then live_ or test_, then letters and digits only; look for a space or a line break pasted with it');
  const env = siteEnv();
  const live = /^(sk|rk)_live_/.test(key);
  if (env === 'production' && !live) throw new Error('STRIPE_SECRET_KEY in production is not a live key');
  if (env !== 'production' && live) throw new Error(`STRIPE_SECRET_KEY for the ${env} context is a live key; scope a test key to this context`);
  return key;
}
export function prices() {
  /* yearly is required; monthly is optional and appears when set. Forever is no longer sold, and
     its id is best left unset: all it does is quote that price on the plan line of a household that
     bought forever through Stripe (the app matches the id; a free forever is never priced), and
     production has none. A refund goes by the plan and where it was bought, not the price. */
  return { year: process.env.STRIPE_PRICE_YEAR || '', lifetime: process.env.STRIPE_PRICE_LIFETIME || '', month: process.env.STRIPE_PRICE_MONTH || '' };
}
/* read on every household request, so a key stripeKey() refuses (the wrong context, or more than
   the key) must disable billing, not sync: the build (scripts/migrate.mjs) is where it fails the deploy */
export function billingEnabled() {
  const p = prices();
  try { return !!(stripeKey() && p.year); }
  catch (e) { if (!billingEnabled.warned) { billingEnabled.warned = true; console.error('billing off:', e.message); } return false; }
}
export function isProduction() { return siteEnv() === 'production'; }

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
  /* no answer, or one that could not be read, is told in fixed words of our own. fetch's own error
     can quote a header it refused to send, and one of these headers is the key, so its message, its
     stack and the error itself (as a cause) stay here: nothing a header problem says can reach the
     log. Which of the two it was matters after a POST: once Stripe has answered, it may have acted */
  let res, text;
  try { res = await doFetch(url, { method, headers, body }); text = await res.text(); }
  catch { throw new Error(`${res ? 'Stripe answered, but the answer could not be read' : 'No answer from Stripe'} (fetch's own error is left out, as it can quote the key)`); }
  let data = {}; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Stripe ${res.status}`);
    err.status = res.status; err.code = data.error && (data.error.code || data.error.type); err.param = data.error && data.error.param;
    throw err;
  }
  return data;
}

/* what the plans cost, from Stripe, remembered per function instance for an hour so the price is
   set in one place (the dashboard) and never typed into the app. Each price is asked for on its
   own: one Stripe cannot give (an id this mode does not have, as production's forever one on
   2026-09-30) drops only its own line, and the log names its variable. The yearly price is the
   plan, so without it there is no answer at all. Only a whole answer is remembered; one with a
   price missing is asked for again next time, as no answer always was. */
let priceCache = { at: 0, value: null };
export async function priceInfo() {
  if (priceCache.value && Date.now() - priceCache.at < 3600 * 1000) return priceCache.value;
  const p = prices(), names = ['year', 'lifetime', 'month'];
  const got = await Promise.allSettled(names.map(n => n === 'year' || p[n] ? stripe('GET', `/prices/${p[n]}`) : null));
  /* the id travels so the app can say which of these the household is actually on. founding is set
     in Stripe, as metadata founding = yes on the price: the early price, kept by whoever buys it for
     as long as they stay. A new price made without it ends the founding line everywhere at once. */
  const one = (x) => ({ id: x.id, amount: x.unit_amount, currency: x.currency, interval: x.recurring ? x.recurring.interval : null, founding: /^(yes|true|1)$/i.test((x.metadata && x.metadata.founding) || '') });
  const value = {}, missing = [];
  names.forEach((n, i) => {
    const r = got[i];
    value[n] = r.status === 'fulfilled' && r.value ? one(r.value) : null;
    if (r.status === 'rejected') missing.push(`STRIPE_PRICE_${n.toUpperCase()} ${p[n]}: ${(r.reason && r.reason.message) || r.reason}`);
  });
  if (!value.year) throw new Error(missing.join('; ') || 'no yearly price');   /* the caller logs it */
  for (const m of missing) console.error('billing: prices', m);
  if (!missing.length) priceCache = { at: Date.now(), value };
  return value;
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
  if (s === 'past_due') {
    /* the first charge, when the three weeks ended, failed: nothing was ever paid, so the retries
       are not a grace period. The plan comes back on if one of them goes through. */
    const start = sub.current_period_start || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_start);
    if (sub.trial_end && start && start === sub.trial_end) return 'canceled';
    return 'past_due';                                       /* Stripe is still retrying the card: paid until it gives up */
  }
  return 'canceled';                                       /* canceled, unpaid (retries exhausted), incomplete, incomplete_expired, paused */
}
/* a household that is deleted, folded into another, or given the beta's free forever must not keep
   paying. Says whether it cannot: cancelled now, or ended before, which Stripe answers as no such
   subscription (404). After any other answer the subscription itself is read, since a cancel whose
   answer was lost may have gone through all the same */
export async function cancelSubscription(id) {
  if (!id) return true;
  try { await stripe('DELETE', `/subscriptions/${id}`); return true; }
  catch (e) {
    if (e.status === 404) return true;
    try { const s = await stripe('GET', `/subscriptions/${id}`); if (s.status === 'canceled' || s.status === 'incomplete_expired') return true; } catch {}
    console.error('billing: could not cancel', id, e.message);
    return false;
  }
}
