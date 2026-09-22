import { sql, fail, throttled, clientIp, ipKey, siteUrl } from '../lib/db.js';
import { sameOrigin } from '../lib/auth.js';

/* The planner reports its own breakages here: what the error said, where in the code, which
   build, and the browser type. Nothing about the household travels with it, no session is
   read, and the row is gone in thirty days (the sweep in db.js). Anyone can post, so what
   is kept is capped in size, in rate per address and in rows per hour, and nothing shaped
   like an email address survives into the row. The answer is always 204: a report is
   best-effort, and an error about an error helps nobody. */
const KINDS = new Set(['error', 'rejection']);
const BUILD = /^lunchsorted-v\d{1,5}$/;
const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g;
const clean = (v, n, lines) => String(v == null ? '' : v)
  .replace(lines ? /[^\S\n]+/g : /\s+/g, ' ')
  .replace(EMAIL, '[email]')
  .slice(0, n).trim();
const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export default async function handler(req, context) {
  if (req.method !== 'POST') return fail('Not found', 404);
  try {
    if (!sameOrigin(req, siteUrl(req))) return fail('Not allowed', 403);
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 8192) return fail('That is more than an error should say', 413);
    let b; try { b = JSON.parse(raw); } catch { return fail('Bad request'); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail('Bad request');
    if (await throttled('err:' + ipKey(clientIp(req, context)), 20, 3600)) return done();
    const kind = KINDS.has(b.kind) ? b.kind : 'error';
    const build = BUILD.test(String(b.build || '')) ? String(b.build) : 'unknown';
    const message = clean(b.message, 300) || '(no message)';
    const place = clean(b.place, 200) || null;
    const stack = clean(b.stack, 2000, true) || null;
    const agent = clean(req.headers.get('user-agent'), 200) || null;
    /* a broken deploy on every phone at once is one problem, not ten thousand rows */
    await sql()`INSERT INTO app_errors (build, kind, message, place, stack, agent)
      SELECT ${build}, ${kind}, ${message}, ${place}, ${stack}, ${agent}
      WHERE (SELECT count(*) FROM app_errors WHERE at > now() - interval '1 hour') < 1000`;
    return done();
  } catch (e) {
    console.error('api-errors', e);
    return done();
  }
}

export const config = { path: '/api/errors' };
