import { sql, json, fail, siteUrl } from '../lib/db.js';
import { currentUser, createInvite, consumeInvite, peekInvite } from '../lib/auth.js';

/* The household is the unit: one document, one version, everyone signed in
   reads and writes the same one.
   GET  /api/household                -> {household, members, doc, version, entitlement, me}
   PUT  /api/household {doc, version} -> {version}  or 409 {doc, version} when the phone is behind
   POST /api/household/invite         -> {url}  (owner or adult)
   GET  /api/household/invite?code=   -> {name, role}  what the link is for, before joining
   POST /api/household/join {code}    -> joins; a person's own empty household is dropped
   POST /api/household/leave          -> leave a household you do not own
   POST /api/household/remove {userId}-> owner removes a member                      */

const MAX_DOC_BYTES = 2 * 1024 * 1024;
const now = () => new Date().toISOString();

async function membership(userId) {
  const rows = await sql()`
    SELECT h.id, h.name, h.owner_user_id, h.doc, h.version, m.role, m.member_id
    FROM household_members m JOIN households h ON h.id = m.household_id
    WHERE m.user_id = ${userId}`;
  return rows[0] || null;
}

async function ensureHousehold(user) {
  const have = await membership(user.id);
  if (have) return have;
  const q = sql();
  const [h] = await q`INSERT INTO households (owner_user_id) VALUES (${user.id}) RETURNING id, name, owner_user_id, doc, version`;
  const memberId = 'mem_' + Math.random().toString(36).slice(2, 10);
  await q`INSERT INTO household_members (household_id, user_id, role, member_id) VALUES (${h.id}, ${user.id}, 'owner', ${memberId})`;
  await q`INSERT INTO entitlements (household_id) VALUES (${h.id})`;
  return { ...h, role: 'owner', member_id: memberId };
}

async function state(user) {
  const h = await ensureHousehold(user);
  const members = await sql()`
    SELECT m.user_id AS "userId", m.role, m.member_id AS "memberId", u.email, u.name
    FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ${h.id} ORDER BY m.joined_at`;
  const [ent] = await sql()`SELECT plan, source, status, current_period_end AS "currentPeriodEnd" FROM entitlements WHERE household_id = ${h.id}`;
  return {
    household: { id: h.id, name: h.name },
    me: { userId: user.id, email: user.email, role: h.role, memberId: h.member_id },
    members, doc: h.doc, version: h.version,
    entitlement: ent || { plan: 'free', source: 'none', status: 'none', currentPeriodEnd: null }
  };
}

function docLooksRight(doc) {
  return doc && typeof doc === 'object' && !Array.isArray(doc) && doc.schema === 2 && Array.isArray(doc.kids) && Array.isArray(doc.members);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const action = parts[parts.length - 1] === 'household' ? '' : parts[parts.length - 1];
  try {
    /* what an invite is for can be read before signing in: the invited phone shows it on the sign-in card */
    if (req.method === 'GET' && action === 'invite') {
      const inv = await peekInvite(url.searchParams.get('code') || '');
      if (!inv) return fail('That invite has expired or was already used', 410);
      return json({ name: inv.name, role: inv.role });
    }
    const user = await currentUser(req);
    if (!user) return fail('Not signed in', 401);
    const q = sql();

    if (req.method === 'GET' && !action) return json(await state(user));

    if (req.method === 'PUT' && !action) {
      const h = await ensureHousehold(user);
      if (h.role === 'helper') return fail('Helpers can tick the pack list but not change the plan', 403);
      const raw = await req.text();
      if (raw.length > MAX_DOC_BYTES) return fail('That is more than a household should hold', 413);
      let body; try { body = JSON.parse(raw); } catch { return fail('Bad request'); }
      if (!docLooksRight(body.doc)) return fail('That is not a household document');
      const base = Number(body.version);
      /* the first push names which member in the document is this person */
      if (h.doc === null && typeof body.memberId === 'string' && /^mem_[a-z0-9]{1,40}$/.test(body.memberId))
        await q`UPDATE household_members SET member_id = ${body.memberId} WHERE household_id = ${h.id} AND user_id = ${user.id}`;
      const rows = await q`
        UPDATE households SET doc = ${JSON.stringify(body.doc)}::jsonb, version = version + 1, updated_at = now()
        WHERE id = ${h.id} AND version = ${Number.isFinite(base) ? base : -1}
        RETURNING version`;
      if (rows[0]) return json({ version: rows[0].version, at: now() });
      const [cur] = await q`SELECT doc, version FROM households WHERE id = ${h.id}`;
      return json({ conflict: true, doc: cur.doc, version: cur.version }, 409);
    }

    if (req.method === 'POST' && action === 'invite') {
      const h = await ensureHousehold(user);
      if (h.role === 'helper') return fail('Only an adult can invite', 403);
      const body = await req.json().catch(() => ({}));
      const role = body.role === 'helper' ? 'helper' : 'adult';
      const code = await createInvite(h.id, user.id, role);
      return json({ url: `${siteUrl(req)}/app/?join=${code}`, role, expiresInDays: 7 });
    }

    if (req.method === 'POST' && action === 'join') {
      const body = await req.json().catch(() => ({}));
      const inv = await peekInvite(String(body.code || ''));
      if (!inv) return fail('That invite has expired or was already used', 410);
      const have = await membership(user.id);
      if (have && have.id === inv.household_id) return json(await state(user));
      if (have) {
        const owned = have.owner_user_id === user.id;
        const hasData = !!(have.doc && (have.doc.kids || []).some(k => !k.deletedAt && (k.foods || []).some(f => !f.deletedAt)));
        if (owned && hasData) return fail('This account already has a household with lunches in it. Leave it first, or ask for the invite on a fresh sign-in.', 409);
        await q`DELETE FROM household_members WHERE user_id = ${user.id}`;
        if (owned) await q`DELETE FROM households WHERE id = ${have.id}`;
      }
      const used = await consumeInvite(String(body.code), user.id);
      if (!used) return fail('That invite has expired or was already used', 410);
      const memberId = 'mem_' + Math.random().toString(36).slice(2, 10);
      await q`INSERT INTO household_members (household_id, user_id, role, member_id) VALUES (${used.household_id}, ${user.id}, ${used.role}, ${memberId})`;
      return json(await state(user));
    }

    if (req.method === 'POST' && action === 'leave') {
      const have = await membership(user.id);
      if (!have) return fail('Not in a household', 404);
      if (have.owner_user_id === user.id) return fail('The owner cannot leave; delete the account instead', 409);
      await q`DELETE FROM household_members WHERE user_id = ${user.id}`;
      return json(await state(user));
    }

    if (req.method === 'POST' && action === 'remove') {
      const have = await membership(user.id);
      const body = await req.json().catch(() => ({}));
      if (!have || have.owner_user_id !== user.id) return fail('Only the owner can remove someone', 403);
      const target = Number(body.userId);
      if (target === user.id) return fail('The owner cannot remove themselves', 409);
      await q`DELETE FROM household_members WHERE household_id = ${have.id} AND user_id = ${target}`;
      await q`DELETE FROM sessions WHERE user_id = ${target}`;   /* their phones sign out */
      return json(await state(user));
    }

    return fail('Not found', 404);
  } catch (e) {
    console.error('api-household', e);
    return fail('Something went wrong on our side', 500);
  }
}

export const config = { path: ['/api/household', '/api/household/*'] };
