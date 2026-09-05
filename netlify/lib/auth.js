import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db.js';

export const COOKIE = 'ls_session';
const SESSION_DAYS = 180;
const LINK_MINUTES = 15;

const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

export function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i.test(e) && e.length <= 320 ? e : null;
}

/* ---- magic links ---- */
export async function createMagicLink(email, ip) {
  const token = secret();
  const expires = new Date(Date.now() + LINK_MINUTES * 60 * 1000).toISOString();
  await sql()`INSERT INTO magic_links (token_hash, email, ip, expires_at) VALUES (${hash(token)}, ${email}, ${ip || null}, ${expires})`;
  return token;
}

/* peek without consuming: the verify page shows a button, so a mail scanner
   that follows the link cannot burn it */
export async function peekMagicLink(token) {
  const rows = await sql()`SELECT email FROM magic_links WHERE token_hash = ${hash(token)} AND used_at IS NULL AND expires_at > now()`;
  return rows[0] ? rows[0].email : null;
}

export async function consumeMagicLink(token) {
  const rows = await sql()`
    UPDATE magic_links SET used_at = now()
    WHERE token_hash = ${hash(token)} AND used_at IS NULL AND expires_at > now()
    RETURNING email`;
  return rows[0] ? rows[0].email : null;
}

/* ---- users ---- */
export async function findOrCreateUser(email) {
  const rows = await sql()`
    INSERT INTO users (email, last_seen_at) VALUES (${email}, now())
    ON CONFLICT (email) DO UPDATE SET last_seen_at = now()
    RETURNING id, email, name`;
  return rows[0];
}

/* ---- sessions ---- */
export async function createSession(userId, kind = 'web') {
  const token = secret();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await sql()`INSERT INTO sessions (token_hash, user_id, kind, expires_at, last_used_at) VALUES (${hash(token)}, ${userId}, ${kind}, ${expires}, now())`;
  return token;
}

export function sessionCookie(token, clear = false) {
  const maxAge = clear ? 0 : SESSION_DAYS * 86400;
  return { 'set-cookie': `${COOKIE}=${clear ? '' : token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}` };
}

function tokenFrom(req) {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/);
  if (m) return m[1];
  const c = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return c ? c[1] : null;
}

export async function currentUser(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const rows = await sql()`
    SELECT u.id, u.email, u.name, s.token_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash(token)} AND s.expires_at > now()`;
  if (!rows[0]) return null;
  await sql()`UPDATE sessions SET last_used_at = now() WHERE token_hash = ${rows[0].token_hash}`;
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name };
}

export async function destroySession(req) {
  const token = tokenFrom(req);
  if (token) await sql()`DELETE FROM sessions WHERE token_hash = ${hash(token)}`;
}

export async function destroyAllSessions(userId) {
  await sql()`DELETE FROM sessions WHERE user_id = ${userId}`;
}

/* ---- invites ---- */
export async function createInvite(householdId, userId, role = 'adult') {
  const code = secret();
  const expires = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  await sql()`INSERT INTO invites (code_hash, household_id, role, created_by, expires_at) VALUES (${hash(code)}, ${householdId}, ${role}, ${userId}, ${expires})`;
  return code;
}

export async function consumeInvite(code, userId) {
  const rows = await sql()`
    UPDATE invites SET used_by = ${userId}, used_at = now()
    WHERE code_hash = ${hash(code)} AND used_at IS NULL AND expires_at > now()
    RETURNING household_id, role`;
  return rows[0] || null;
}

export async function peekInvite(code) {
  const rows = await sql()`
    SELECT i.household_id, i.role, h.name
    FROM invites i JOIN households h ON h.id = i.household_id
    WHERE i.code_hash = ${hash(code)} AND i.used_at IS NULL AND i.expires_at > now()`;
  return rows[0] || null;
}
