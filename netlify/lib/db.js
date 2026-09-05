import { neon } from '@neondatabase/serverless';

/* One tagged-template query function. Neon in production; the test suite
   injects an in-process Postgres through the global hook. Call as
   sql`SELECT ...` or, for a statement built as a string, sql(text). */
let _client;
export function sql() {
  if (globalThis.__LS_SQL) return globalThis.__LS_SQL;
  if (!_client) {
    const url = process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DB_URL || process.env.DEV_DB_URL;
    if (!url) throw new Error('No database URL configured');
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
     magic link always comes back to the deploy that issued it */
  const env = process.env.SITE_ENV || 'production';
  if (env === 'production' && process.env.URL) return process.env.URL.replace(/\/$/, '');
  if (process.env.DEPLOY_PRIME_URL) return process.env.DEPLOY_PRIME_URL.replace(/\/$/, '');
  if (process.env.URL) return process.env.URL.replace(/\/$/, '');
  return new URL(req.url).origin;
}

export function clientIp(req, context) {
  return (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '';
}

/* sliding-window throttle backed by the database */
export async function throttled(key, limit, windowSeconds) {
  const q = sql();
  await q`DELETE FROM rate_events WHERE at < now() - interval '1 day'`;
  const [{ n }] = await q`SELECT count(*)::int AS n FROM rate_events WHERE key = ${key} AND at > now() - make_interval(secs => ${windowSeconds})`;
  if (n >= limit) return true;
  await q`INSERT INTO rate_events (key) VALUES (${key})`;
  return false;
}
