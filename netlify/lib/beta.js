import { timingSafeEqual } from 'node:crypto';
import { sql } from './db.js';

/* The beta: a link that switches on Lunch Sorted forever for the first BETA_CAP households
   to open it while signed in. BETA_CODE is the token in the link (Netlify env, per context);
   with no code set, the page is not found and the claim always fails. BETA_CAP defaults to 25;
   0 closes the beta while keeping the page up to say so. Every household that came in this way,
   or on a 100%-off Stripe code, carries source = 'code', which is what the cap counts. */
export function betaCode() { const c = process.env.BETA_CODE || ''; return /^[A-Za-z0-9-]{8,64}$/.test(c) ? c : ''; }
export function betaCap() { const n = Number(process.env.BETA_CAP); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 25; }
export async function betaCount() { const [r] = await sql()`SELECT count(*)::int AS n FROM entitlements WHERE source = 'code'`; return r.n; }
export function codeMatches(given) {
  const want = betaCode(); if (!want || typeof given !== 'string' || given.length > 64) return false;
  const a = Buffer.from(want.padEnd(64, ' ')), b = Buffer.from(given.padEnd(64, ' '));
  return a.length === b.length && timingSafeEqual(a, b);
}
