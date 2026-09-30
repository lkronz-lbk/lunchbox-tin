/* Applies netlify/database/migrations/*.sql in name order, once each, recording
   them in schema_migrations. Runs on Netlify before every deploy (netlify.toml
   build command); a deploy with no database URL skips quietly, so previews
   without a database still build. Also used by the tests against PGlite. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'netlify', 'database', 'migrations');

export async function migrate(sql, log = () => {}) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map(r => r.name));
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const body = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const stmt of splitStatements(body)) await sql(stmt);
    await sql`INSERT INTO schema_migrations (name) VALUES (${f}) ON CONFLICT (name) DO NOTHING`;
    log(`applied ${f}`);
  }
  return files.length - done.size;
}

/* migrations are plain statements separated by semicolons; no functions or
   dollar-quoted bodies, and every statement is idempotent (IF NOT EXISTS), so a
   file that failed halfway or ran twice from two deploys is harmless */
function splitStatements(body) {
  const noComments = body.replace(/--[^\n]*/g, '');
  return noComments.split(';').map(s => s.trim()).filter(Boolean);
}

if (process.argv[1] && process.argv[1].endsWith('migrate.mjs')) {
  /* a Stripe key scoped to the wrong context, or a key or a database address pasted with more than
     itself, fails the deploy here, loudly, rather than at the first checkout or the first query; the
     last good deploy stays live. Each message names its variable, never what it holds, and all are
     told at once, so one failed deploy shows everything there is to fix */
  const { stripeKey } = await import('../netlify/lib/stripe.js');
  const { databaseUrl, sql } = await import('../netlify/lib/db.js');
  const refused = [stripeKey, databaseUrl].map(check => { try { check(); return ''; } catch (e) { return e.message; } }).filter(Boolean);
  if (refused.length) { for (const why of refused) console.error('deploy refused:', why); process.exit(1); }
  if (!databaseUrl()) { console.log('migrate: this context has no database URL, skipping'); process.exit(0); }
  /* through sql(), so what the driver says about the connection reaches the build log in fixed
     words, never its own, which can quote the address; a migration the database refused is told
     in the database's own words */
  let n;
  try { n = await migrate(sql(), console.log); }
  catch (e) { console.error('migrate failed:', e.message); process.exit(1); }
  console.log(`migrate: ${n} applied`);
}
