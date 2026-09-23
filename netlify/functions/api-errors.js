import { sql, fail, sweep, clientIp, ipKey, siteUrl } from '../lib/db.js';
import { sameOrigin } from '../lib/auth.js';

/* The planner reports its own breakages here: what the error said, where in the code, which
   build, and the browser type. Nothing about the household travels with it, no session is
   read, and the row is gone in thirty days (the sweep in db.js). Anyone can post, so what is
   kept is capped: in rows an hour for everyone, in reports an hour from one address (a whole
   /64 counting as one on IPv6), and in size a field, all in the one statement that writes the
   row, so a flood past the cap grows nothing. Nothing shaped like an email address survives into the row, and
   a link loses its query and fragment, because a page opened from an invite or the beta link
   carries its code in the address the browser stamps on every stack frame. The answer is
   always 204: a report is best-effort, and an error about an error helps nobody. */
const KINDS = new Set(['error', 'rejection']);
const BUILD = /^lunchsorted-v\d{1,5}$/;
const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g;
const LINK_TAIL = /(https?:\/\/[^\s)?#]*)[?#][^\s):]*/g;       /* keeps the :line:column a stack frame puts after the address */
const ROWS_AN_HOUR = 1000, EACH_AN_HOUR = 20;
const clean = (v, n, lines) => String(v == null ? '' : v)
  .replace(lines ? /[^\S\n]+/g : /\s+/g, ' ')
  .replace(LINK_TAIL, '$1')
  .replace(EMAIL, '[email]')
  .slice(0, n).trim();
const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

/* one key an address; on IPv6 one key a /64, the block a home connection is given whole */
export function ipBucket(ip) {
  ip = String(ip || '').trim();
  const v4 = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill('0'), t);
  return groups.slice(0, 4).map(g => g.toLowerCase().padStart(4, '0')).join(':') + '::/64';
}

export default async function handler(req, context) {
  if (req.method !== 'POST') return fail('Not found', 404);
  try {
    if (!sameOrigin(req, siteUrl(req))) return fail('Not allowed', 403);
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 8192) return fail('That is more than an error should say', 413);
    let b; try { b = JSON.parse(raw); } catch { return fail('Bad request'); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail('Bad request');
    const key = 'err:' + ipKey(ipBucket(clientIp(req, context)));
    const kind = KINDS.has(b.kind) ? b.kind : 'error';
    const build = BUILD.test(String(b.build || '')) ? String(b.build) : 'unknown';
    const message = clean(b.message, 300) || '(no message)';
    const place = clean(b.place, 200) || null;
    const stack = clean(b.stack, 2000, true) || null;
    const agent = clean(req.headers.get('user-agent'), 200) || null;
    /* One statement: the row is written only under the hourly cap for everyone and the hourly
       count for this address, the throttle row is written only then (so a flood past the cap grows
       nothing), and the stack rides on the first copy of a distinct error an hour, since a broken
       deploy throws the same thing on every phone and the numbers page counts, never reads, it. */
    if (Math.random() < 0.04) await sweep();
    await sql()`
      WITH cap AS (SELECT count(*) < ${ROWS_AN_HOUR} AS ok FROM app_errors WHERE at > now() - interval '1 hour'),
           mine AS (SELECT count(*) < ${EACH_AN_HOUR} AS ok FROM rate_events WHERE key = ${key} AND at > now() - interval '1 hour'),
           tick AS (INSERT INTO rate_events (key) SELECT ${key} FROM cap, mine WHERE cap.ok AND mine.ok RETURNING key)
      INSERT INTO app_errors (build, kind, message, place, stack, agent)
      SELECT ${build}, ${kind}, ${message}, ${place},
             CASE WHEN EXISTS (SELECT 1 FROM app_errors WHERE at > now() - interval '1 hour' AND build = ${build} AND message = ${message} AND place IS NOT DISTINCT FROM ${place})
                  THEN NULL ELSE ${stack} END,
             ${agent}
      FROM tick`;
    return done();
  } catch (e) {
    console.error('api-errors', e);
    return done();
  }
}

export const config = { path: '/api/errors' };
