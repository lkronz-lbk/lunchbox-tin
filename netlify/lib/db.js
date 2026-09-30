import { createHash } from 'node:crypto';
import { neon, NeonDbError } from '@neondatabase/serverless';

/* One tagged-template query function. Neon in production; the test suite
   injects an in-process Postgres through the global hook. Call as
   sql`SELECT ...` or, for a statement built as a string, sql(text). */
let _client, _clientFor;
/* Which deploy this is. SITE_ENV is set per context in the Netlify UI; the values in
   netlify.toml reach the build only, never a running function, so Netlify's own CONTEXT
   is the fallback, and a branch deploy can never mistake itself for production. */
const CONTEXTS = { production: 'production', 'branch-deploy': 'staging', 'deploy-preview': 'preview', dev: 'dev' };
export function siteEnv() {
  return process.env.SITE_ENV || CONTEXTS[process.env.CONTEXT] || 'production';
}
/* The variable that holds this deploy's database, and the address in it. Production uses the site
   database; every other context must be given its own, so a branch deploy or a preview can never
   read or migrate production data.
   The address alone: postgres:// or postgresql://, then letters, digits and punctuation, with no
   space, quote or line break. Anything pasted with it (the DATABASE_URL= line or the psql command
   Neon's Connect dialog offers, quotes, a line break inside it, a space in the host) makes the
   driver throw words that quote it whole, password and all, and every function logs what it throws.
   So it is refused here in words that name the variable and never what it holds, and the build
   (scripts/migrate.mjs) refuses the deploy over it, the last good one staying live. A space or a
   line break around it is only dropped: the driver takes the address anyway. */
function database() {
  const names = siteEnv() === 'production' ? ['NETLIFY_DATABASE_URL', 'NETLIFY_DB_URL'] : ['STAGING_DATABASE_URL', 'DEV_DB_URL'];
  const name = names.find(n => process.env[n]) || names[0];
  const url = (process.env[name] || '').trim();
  if (process.env[name] && !url) throw new Error(`${name} holds only spaces or line breaks; paste the connection string alone`);
  if (url && (!/^postgres(ql)?:\/\/[\x21-\x7e]+$/.test(url) || /["'`]/.test(url))) throw new Error(`${name} must be postgres:// or postgresql://, then letters, digits and punctuation only, with no space, quote or line break; look for a DATABASE_URL=, a psql command or quotes pasted with it`);
  return { name, url };
}
export function databaseUrl() { return database().url; }

/* What the driver says about a connection can still quote the address, password and all: when it
   cannot read one the shape above lets by (a port past 65535, a stray %), and when fetch will not
   send it. So nothing the driver says leaves here: it is rethrown in fixed words of our own, without
   its message, its stack or itself as a cause. A query the database refused (a unique violation,
   say) is the database's own answer, and callers read its code, so it comes through as it is,
   unless its words hold the password. */
const LEFT_OUT = "the driver's own words are left out, as they can quote the address, password and all";
function told(e, secrets) {
  if (e instanceof NeonDbError && !e.sourceError && /^[0-9A-Z]{5}$/.test(e.code || '')) {
    if (!holds(e, secrets)) return e;
    return Object.assign(new Error('The database refused a query in words that hold the password, so they are left out'), { code: e.code });
  }
  if (e && e.sourceError) return new Error(`No answer from the database (${LEFT_OUT})`);
  /* a NeonDbError with no fetch error behind it is the driver's word on an answer it could not use */
  if (e instanceof NeonDbError) {
    const status = /^Server error \(HTTP status (\d{3})\)/.exec(e.message);
    return new Error(`The database answered${status ? ' ' + status[1] : ''}, but not with a result (${LEFT_OUT})`);
  }
  /* anything else failed before the query went (a value it could not send) or after (an answer it could not read) */
  return new Error(`A query could not be sent to the database, or its answer could not be read (${LEFT_OUT})`);
}
/* whether a refusal's words hold the password, in any field and whatever the field's shape, and in
   either case, as a percent escape can come back in the other; anything that cannot be read as
   words is taken to hold it */
function holds(e, secrets) {
  let words;
  try { words = `${e.message}\n${JSON.stringify(Object.values(e))}`.toLowerCase(); } catch { return true; }
  return secrets.some(s => words.includes(s.toLowerCase()) || words.includes(JSON.stringify(s).slice(1, -1).toLowerCase()));
}
/* the password as the address carries it, and as the database reads it */
function secretsOf(url) {
  let p = '';
  try { p = new URL(url).password; } catch { /* the driver read it, so this cannot fail */ }
  if (!p) return [];
  try { return [p, decodeURIComponent(p)]; } catch { return [p]; }
}

export function sql() {
  if (globalThis.__LS_SQL) return globalThis.__LS_SQL;
  const { name, url } = database();
  if (!url) throw new Error(siteEnv() === 'production' ? 'No database URL configured' : 'This deploy context has no database of its own (set STAGING_DATABASE_URL)');
  if (!_client || _clientFor !== url) {
    let client;
    try { client = neon(url); } catch { throw new Error(`${name} could not be read as a database address (${LEFT_OUT})`); }
    const secrets = secretsOf(url);
    /* the driver's query runs again each time it is awaited; this one runs once */
    _client = (strings, ...vals) => (typeof strings === 'string' ? client.query(strings) : client(strings, ...vals)).then(undefined, e => { throw told(e, secrets); });
    _clientFor = url;
  }
  return _client;
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const fail = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

export function siteUrl(req) {
  /* production keeps its canonical URL; branch and preview deploys use their own, so a
     magic link always comes back to the deploy that issued it. Production never takes
     the host from the request. */
  const env = siteEnv();
  if (env === 'production') {
    if (!process.env.URL) throw new Error('URL is not set; refusing to build a link from the request host');
    return process.env.URL.replace(/\/$/, '');
  }
  /* a branch deploy or preview answers at its own address, which is where the request came
     to; Netlify's URL variable names production even here, and DEPLOY_PRIME_URL does not
     reach a running function, so neither can be trusted for a link that must come back here */
  const self = req && req.url ? new URL(req.url).origin : '';
  if (self) return self;
  if (process.env.DEPLOY_PRIME_URL) return process.env.DEPLOY_PRIME_URL.replace(/\/$/, '');
  throw new Error('No address to build a link from');
}

export function clientIp(req, context) {
  return (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '';
}

/* the connection address is only ever used hashed, and only for a day */
export function ipKey(ip) {
  return ip ? createHash('sha256').update(String(ip)).digest('hex').slice(0, 24) : '';
}

/* housekeeping that rides along with the throttle, and runs once a day with the trial job in
   production: nothing personal outlives its use */
export async function sweep() {
  const q = sql();
  await q`DELETE FROM rate_events WHERE at < now() - interval '1 day'`;
  await q`DELETE FROM magic_links WHERE expires_at < now() - interval '1 day'`;
  await q`DELETE FROM sessions WHERE expires_at < now()`;
  await q`DELETE FROM invites WHERE expires_at < now() - interval '30 days' OR used_at < now() - interval '30 days'`;
  await q`DELETE FROM app_errors WHERE at < now() - interval '30 days'`;
}

/* The error table's ceiling: api-errors.js writes a report only under it and /admin says when it
   is reached, so no flood can fill the database. The Neon plan holds 512 MB, and a full database
   refuses sign-ins, syncs and payments. A row at its largest (every field the body carries in
   three-byte letters, which its 8 KB allows, and a stack on each, as every message in a flood can
   differ) takes about 10 KB with its TOAST and index: ten thousand measured 99 MB, and 35 MB in
   plain ASCII.
   Past it every report is dropped, a real breakage's too, until rows pass thirty days or someone
   deletes some; reports arriving together can each see room for one more, so it can be passed by
   the few in flight. The count at the ceiling, measured on Postgres 18 (PGlite): under a
   millisecond either way the planner takes it, an index-only scan of about 30 index pages once
   autovacuum has set the visibility map, or the heap (1,000 pages of ASCII rows, up to 2,500 of
   the largest) before, all in memory during a flood. */
export const ERRORS_KEPT = 10000;

/* one row a household a moment, the first time only: the funnel the numbers page reads.
   A count is never worth a failed request, so a refused write is logged and swallowed. */
export async function milestone(householdId, kind) {
  try { await sql()`INSERT INTO milestones (household_id, kind) VALUES (${householdId}, ${kind}) ON CONFLICT DO NOTHING`; }
  catch (e) { console.error('milestone', kind, e.message); }
}

/* marks under a prefix, within a window: what a household has open right now (one checkout at a time) */
export async function recentKeys(prefix, windowSeconds) {
  const rows = await sql()`SELECT key FROM rate_events WHERE key LIKE ${prefix + '%'} AND at > now() - make_interval(secs => ${windowSeconds})`;
  return rows.map(r => r.key);
}
export async function mark(key) { await sql()`INSERT INTO rate_events (key) VALUES (${key})`; }
export async function unmark(prefix) { await sql()`DELETE FROM rate_events WHERE key LIKE ${prefix + '%'} AND at > now() - interval '1 hour'`; }   /* older marks are invisible already; the window keeps the delete on the (at) index under any collation */

/* sliding-window throttle backed by the database */
export async function throttled(key, limit, windowSeconds) {
  const q = sql();
  if (Math.random() < 0.04) await sweep();               /* about one request in twenty-five pays for housekeeping */
  const [{ n }] = await q`SELECT count(*)::int AS n FROM rate_events WHERE key = ${key} AND at > now() - make_interval(secs => ${windowSeconds})`;
  if (n >= limit) return true;
  await q`INSERT INTO rate_events (key) VALUES (${key})`;
  return false;
}
