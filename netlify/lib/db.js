import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

/* One tagged-template query function. Neon in production; the test suite
   injects an in-process Postgres through the global hook. Call as
   sql`SELECT ...` or, for a statement built as a string, sql(text). */
let _client;
/* Which deploy this is. SITE_ENV is set per context in the Netlify UI; the values in
   netlify.toml reach the build only, never a running function, so Netlify's own CONTEXT
   is the fallback, and a branch deploy can never mistake itself for production. */
const CONTEXTS = { production: 'production', 'branch-deploy': 'staging', 'deploy-preview': 'preview', dev: 'dev' };
export function siteEnv() {
  return process.env.SITE_ENV || CONTEXTS[process.env.CONTEXT] || 'production';
}
export function databaseUrl() {
  /* production uses the site database; every other context must be given its own,
     so a branch deploy or a preview can never read or migrate production data */
  const env = siteEnv();
  if (env === 'production') return process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DB_URL || '';
  return process.env.STAGING_DATABASE_URL || process.env.DEV_DB_URL || '';
}
export function sql() {
  if (globalThis.__LS_SQL) return globalThis.__LS_SQL;
  if (!_client) {
    const url = databaseUrl();
    if (!url) throw new Error(siteEnv() === 'production' ? 'No database URL configured' : 'This deploy context has no database of its own (set STAGING_DATABASE_URL)');
    const client = neon(url);
    _client = (strings, ...vals) => typeof strings === 'string' ? client.query(strings) : client(strings, ...vals);
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

/* housekeeping that rides along with the throttle: nothing personal outlives its use */
export async function sweep() {
  const q = sql();
  await q`DELETE FROM rate_events WHERE at < now() - interval '1 day'`;
  await q`DELETE FROM magic_links WHERE expires_at < now() - interval '1 day'`;
  await q`DELETE FROM sessions WHERE expires_at < now()`;
  await q`DELETE FROM invites WHERE expires_at < now() - interval '30 days' OR used_at < now() - interval '30 days'`;
}

/* sliding-window throttle backed by the database */
export async function throttled(key, limit, windowSeconds) {
  const q = sql();
  if (Math.random() < 0.04) await sweep();               /* about one request in twenty-five pays for housekeeping */
  const [{ n }] = await q`SELECT count(*)::int AS n FROM rate_events WHERE key = ${key} AND at > now() - make_interval(secs => ${windowSeconds})`;
  if (n >= limit) return true;
  await q`INSERT INTO rate_events (key) VALUES (${key})`;
  return false;
}
