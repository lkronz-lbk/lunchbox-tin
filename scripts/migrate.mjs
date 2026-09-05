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
    await sql`INSERT INTO schema_migrations (name) VALUES (${f})`;
    log(`applied ${f}`);
  }
  return files.length - done.size;
}

/* migrations are plain statements separated by semicolons at line end; no
   functions or dollar-quoted bodies, by convention */
function splitStatements(body) {
  const noComments = body.replace(/--[^\n]*/g, '');
  return noComments.split(';').map(s => s.trim()).filter(Boolean);
}

if (process.argv[1] && process.argv[1].endsWith('migrate.mjs')) {
  const url = process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DB_URL || process.env.DEV_DB_URL;
  if (!url) { console.log('migrate: no database URL, skipping'); process.exit(0); }
  const { neon } = await import('@neondatabase/serverless');
  const client = neon(url);
  const sql = (strings, ...vals) => typeof strings === 'string' ? client.query(strings) : client(strings, ...vals);
  const n = await migrate(sql, console.log);
  console.log(`migrate: ${n} applied`);
}
