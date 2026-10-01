import { sql, fail, clientIp, ipKey, siteUrl, ERRORS_KEPT } from '../lib/db.js';
import { sameOrigin } from '../lib/auth.js';

/* The planner reports its own breakages here: what the error said, where in the code, which
   build, and the browser type. Nothing about the household travels with it, no session is
   read, and the row is gone in thirty days (the sweep in db.js). Anyone can post, so what is
   kept is capped: in rows an hour for everyone, in reports an hour from one address (a whole
   /64 counting as one on IPv6), in rows in all, and in size a field, all in the one statement
   that writes the row, so a flood past the cap grows nothing. Nothing shaped like an email address survives into the row, and
   a link loses its query and fragment, because a page opened from an invite or the beta link
   carries its code in the address the browser stamps on every stack frame. The answer is
   always 204: a report is best-effort, and an error about an error helps nobody. */
const KINDS = new Set(['error', 'rejection']);
const BUILD = /^lunchsorted-v\d{1,5}$/;
/* an address, not a stack frame: Safari and Firefox write a frame as name@https://…, so what
   follows the @ may hold no slash and no colon, or every iPhone's stack would be kept as [email] */
const EMAIL = /[^\s@<>]+@[^\s@<>\/:]+\.[^\s@<>\/:]+/g;
const LINK_TAIL = /(https?:\/\/[^\s)?#]*)[?#][^\s):]*/g;       /* keeps the :line:column a stack frame puts after the address */
/* Exported for the smoke suite. Two hundred an hour for everyone is first come, first kept: a
   flood from ten addresses spends an hour's worth, real reports that hour with it, and needs fifty
   hours at that rate to reach the table's ceiling (ERRORS_KEPT, sized and costed in db.js). */
export const ROWS_AN_HOUR = 200, EACH_AN_HOUR = 20;
/* what Postgres text cannot hold: a NUL, or half of an emoji (a cut can land between its two
   halves, and a phone can send one alone) */
const UNSTORABLE = /\x00|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/* cut before the two patterns run and again after: they are slow on a long run with no space in
   it, and the User-Agent arrives outside the 8 KB the body is held to. Last, what Postgres cannot
   hold becomes U+FFFD, since the database would refuse the whole report for it */
const clean = (v, n, lines) => String(v == null ? '' : v)
  .replace(lines ? /[^\S\n]+/g : /\s+/g, ' ')
  .slice(0, n * 4)
  .replace(LINK_TAIL, '$1')
  .replace(EMAIL, '[email]')
  .slice(0, n).trim()
  .replace(UNSTORABLE, '\uFFFD');
const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export default async function handler(req, context) {
  if (req.method !== 'POST') return fail('Not found', 404);
  try {
    if (!sameOrigin(req, siteUrl(req))) return fail('Not allowed', 403);
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 8192) return fail('That is more than an error should say', 413);
    let b; try { b = JSON.parse(raw); } catch { return fail('Bad request'); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail('Bad request');
    const key = 'err:' + ipKey(clientIp(req, context));   /* a /64 is one address on IPv6 (db.js) */
    const kind = KINDS.has(b.kind) ? b.kind : 'error';
    const build = BUILD.test(String(b.build || '')) ? String(b.build) : 'unknown';
    const message = clean(b.message, 300) || '(no message)';
    const place = clean(b.place, 200) || null;
    const stack = clean(b.stack, 2000, true) || null;
    const agent = clean(String(req.headers.get('user-agent') || '').slice(0, 2000), 200) || null;
    /* One statement: the row is written only under the hourly cap for everyone, the hourly count
       for this address and the table's ceiling; the throttle row is written only then (so a flood
       past any of them grows nothing); and the stack rides on the first copy of a distinct error
       an hour, since a broken deploy throws the same thing on every phone and the numbers page
       counts, never reads, it. `total` stays last in FROM: the three counts tie on cost, so the
       planner joins them in the order written, and a report an hourly cap refuses never counts the
       whole table (measured: written first, it did). No housekeeping here: the sweep rides one
       throttled call in twenty-five and runs daily, and a flood of reports should cost one
       statement each, not five deletes. */
    await sql()`
      WITH cap AS (SELECT count(*) < ${ROWS_AN_HOUR} AS ok FROM app_errors WHERE at > now() - interval '1 hour'),
           mine AS (SELECT count(*) < ${EACH_AN_HOUR} AS ok FROM rate_events WHERE key = ${key} AND at > now() - interval '1 hour'),
           total AS (SELECT count(*) < ${ERRORS_KEPT} AS ok FROM app_errors),
           tick AS (INSERT INTO rate_events (key) SELECT ${key} FROM cap, mine, total WHERE cap.ok AND mine.ok AND total.ok RETURNING key)
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
