import { sql, json, fail, siteUrl, throttled } from '../lib/db.js';
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

/* the document is only fetched when the caller will use it; a push tests emptiness alone */
async function membership(userId, withDoc) {
  const rows = withDoc
    ? await sql()`SELECT h.id, h.name, h.owner_user_id, h.doc, (h.doc IS NULL) AS doc_empty, h.version, m.role, m.member_id
                  FROM household_members m JOIN households h ON h.id = m.household_id WHERE m.user_id = ${userId}`
    : await sql()`SELECT h.id, h.name, h.owner_user_id, (h.doc IS NULL) AS doc_empty, h.version, m.role, m.member_id
                  FROM household_members m JOIN households h ON h.id = m.household_id WHERE m.user_id = ${userId}`;
  return rows[0] || null;
}

async function ensureHousehold(user, withDoc) {
  const have = await membership(user.id, withDoc);
  if (have) return have;
  const q = sql();
  const [h] = await q`INSERT INTO households (owner_user_id) VALUES (${user.id}) RETURNING id, name, owner_user_id, doc, version`;
  const memberId = 'mem_' + Math.random().toString(36).slice(2, 10);
  await q`INSERT INTO household_members (household_id, user_id, role, member_id) VALUES (${h.id}, ${user.id}, 'owner', ${memberId})`;
  await q`INSERT INTO entitlements (household_id) VALUES (${h.id})`;
  return { ...h, doc_empty: true, role: 'owner', member_id: memberId };
}

/* a helper sees the pack list and nothing else: the lunchboxes' names, this week's
   plan, the foods it names, and the ticks; no rules, allergens, history or addresses */
function helperView(doc) {
  if (!doc) return doc;
  const kids = (doc.kids || []).filter(k => !k.deletedAt).map(k => {
    const used = new Set(); (k.week && k.week.days || []).forEach(d => Object.values(d.slots || {}).forEach(id => id && used.add(id)));
    return { id: k.id, name: k.name, hue: k.hue, createdAt: k.createdAt, updatedAt: k.updatedAt, deletedAt: null,
      settings: { days: (k.settings || {}).days || [1,2,3,4,5], noHeat: true, avoidAllergens: [], avoidText: '', slots: (k.settings || {}).slots || {}, updatedAt: (k.settings || {}).updatedAt },
      foods: (k.foods || []).filter(f => used.has(f.id)).map(f => ({ id: f.id, kidId: f.kidId, n: f.n, c: f.c, t: f.t, a: f.a, al: [], createdAt: f.createdAt, updatedAt: f.updatedAt, deletedAt: f.deletedAt })),
      week: k.week, packed: k.packed || {}, eaten: {}, past: [] };
  });
  return { ...doc, kids, members: (doc.members || []).map(m => ({ id: m.id, name: m.name, role: m.role, createdAt: m.createdAt, updatedAt: m.updatedAt, deletedAt: m.deletedAt })), pantry: {} };
}

async function state(user) {
  const h = await ensureHousehold(user, true);
  const helper = h.role === 'helper';
  const members = await sql()`
    SELECT m.user_id AS "userId", m.role, m.member_id AS "memberId", u.email, u.name
    FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ${h.id} ORDER BY m.joined_at`;
  const [ent] = await sql()`SELECT plan, source, status, current_period_end AS "currentPeriodEnd" FROM entitlements WHERE household_id = ${h.id}`;
  return {
    household: { id: h.id, name: h.name },
    me: { userId: user.id, email: user.email, role: h.role, memberId: h.member_id },
    members: helper ? members.map(m => ({ userId: m.userId, role: m.role, memberId: m.memberId, name: m.name || (m.userId === user.id ? m.email : 'A parent') })) : members,
    doc: helper ? helperView(h.doc) : h.doc, version: h.version,
    entitlement: ent || { plan: 'free', source: 'none', status: 'none', currentPeriodEnd: null }
  };
}

function docLooksRight(doc) {
  return doc && typeof doc === 'object' && !Array.isArray(doc) && Number.isInteger(doc.schema) && doc.schema >= 2 && Array.isArray(doc.kids) && Array.isArray(doc.members);
}
const MEMBER_ID = /^mem_[a-z0-9]{1,40}$/;

export default async function handler(req) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const action = parts[parts.length - 1] === 'household' ? '' : parts[parts.length - 1];
  try {
    /* what an invite is for can be read before signing in: the invited phone shows it on the sign-in card */
    if (req.method === 'GET' && action === 'invite') {
      const inv = await peekInvite(url.searchParams.get('code') || '');
      if (!inv) return fail('That invite has expired or was already used', 410);
      return json({ name: inv.name, role: inv.role, from: inv.inviterName || inv.inviterEmail });
    }
    const user = await currentUser(req);
    if (!user) return fail('Not signed in', 401);
    const q = sql();

    if (req.method === 'GET' && !action) return json(await state(user));

    if (req.method === 'PUT' && !action) {
      const h = await ensureHousehold(user);
      if (h.role === 'helper') return fail('Helpers can tick the pack list but not change the plan', 403);
      if (await throttled('put:' + user.id, 600, 3600)) return fail('Too many changes in an hour; try again shortly', 429);
      const raw = await req.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_DOC_BYTES) return fail('That is more than a household should hold', 413);
      let body; try { body = JSON.parse(raw); } catch { return fail('Bad request'); }
      if (!docLooksRight(body.doc)) return fail('That is not a household document');
      const base = Number(body.version);
      /* the first push names which member in the document is this person */
      if (h.doc_empty && typeof body.memberId === 'string' && MEMBER_ID.test(body.memberId))
        await q`UPDATE household_members SET member_id = ${body.memberId} WHERE household_id = ${h.id} AND user_id = ${user.id}`;
      const rows = await q`
        UPDATE households SET doc = ${JSON.stringify(body.doc)}::jsonb, version = version + 1, updated_at = now()
        WHERE id = ${h.id} AND version = ${Number.isFinite(base) ? base : -1}
        RETURNING version`;
      if (rows[0]) return json({ version: rows[0].version, at: now() });
      const [cur] = await q`SELECT doc, version FROM households WHERE id = ${h.id}`;
      return json({ conflict: true, doc: cur.doc, version: cur.version }, 409);
    }

    if (req.method === 'POST' && ['invite', 'join', 'leave', 'remove'].includes(action) && await throttled('member:' + user.id, 30, 3600))
      return fail('Too many changes in an hour; try again shortly', 429);

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
      const owned = !!(have && have.owner_user_id === user.id);
      if (have && owned) {
        /* a household with other people in it cannot be abandoned by its owner; one with only
           the caller's own lunches can: the phone carries those lunches into the join */
        const others = await q`SELECT count(*)::int AS n FROM household_members WHERE household_id = ${have.id} AND user_id <> ${user.id}`;
        if (others[0].n > 0) return fail('Other people are in your household. Remove them first, or ask for the invite from a different sign-in.', 409);
      }
      /* the invite is spent first; only then is anything of the caller's own let go */
      const used = await consumeInvite(String(body.code), user.id);
      if (!used) return fail('That invite has expired or was already used', 410);
      if (have) {
        await q`DELETE FROM household_members WHERE user_id = ${user.id}`;
        if (owned) await q`DELETE FROM households WHERE id = ${have.id}`;
      }
      /* the phone says which member it is, so the name typed there and its ticks stay its own */
      const memberId = (typeof body.memberId === 'string' && MEMBER_ID.test(body.memberId)) ? body.memberId : 'mem_' + Math.random().toString(36).slice(2, 10);
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
      if (!Number.isInteger(target) || target < 1) return fail('Bad request');
      if (target === user.id) return fail('The owner cannot remove themselves', 409);
      const gone = await q`DELETE FROM household_members WHERE household_id = ${have.id} AND user_id = ${target} RETURNING user_id`;
      if (gone.length) await q`DELETE FROM sessions WHERE user_id = ${target}`;   /* their phones sign out, and only theirs */
      return json(await state(user));
    }

    return fail('Not found', 404);
  } catch (e) {
    console.error('api-household', e);
    return fail('Something went wrong on our side', 500);
  }
}

export const config = { path: ['/api/household', '/api/household/*'] };
