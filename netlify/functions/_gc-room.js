/* ═══════════════════════════════════════════════════════════════════════════
   _gc-room — shared plumbing for a Good Company room with more than one human
   in it. Underscore prefix means utility module, not an endpoint.

   SCHEMA: supabase/good_company_rooms.sql. Read that first, the reasoning
   lives there.

   RAW POSTGREST, NOT THE SUPABASE SDK, matching how every other function on
   this campus talks to this project (_ah-table.js, eq-room-ask.js). Adding a
   dependency for three tables would be a worse trade than fifty lines of
   fetch.

   THE SERVICE KEY BYPASSES RLS, and those tables are deny-all with no policies
   anyway, so NOTHING here is protected by the database. Every guarantee this
   feature makes is made by this file and its callers:

     * identify() is the only door. A caller is whoever their seat token says
       they are, or nobody.
     * A room id is NEVER taken from a request body. It comes from the seat.
     * readClause() is the arrival-forward rule. If it is wrong, a guest reads
       what was said before they walked in.
     * claimTurn() is what stops two people's replies interleaving.

   Kept deliberately close to _ah-table.js, which is the same design already
   proven once. Where this differs, it is on purpose and it is commented.
   ═══════════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

/* Long enough for a model turn plus a slow network, short enough that a
   function which dies mid-reply frees the room on its own. */
const LOCK_SECONDS   = 90;
const MAX_MESSAGES   = 80;
const MAX_TRANSCRIPT = 40;

/* Humans, not friends. One friend per room, settled 2026-08-16: past one it
   stops being a conversation and starts being a demo. People are cheap and are
   the point, so this is generous. */
const MAX_PEOPLE = 6;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
const preflight = () => ({ statusCode: 204, headers: CORS, body: '' });

function serviceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY || null; }

function headers(key, extra) {
  return Object.assign({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, extra || {});
}

async function sbSelect(key, path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers(key) });
    if (!r.ok) { console.error('[gc-room] select failed', r.status, path); return []; }
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) { console.error('[gc-room] select threw:', err.message); return []; }
}

async function sbInsert(key, table, body, returning) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers(key, { Prefer: returning ? 'return=representation' : 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error('[gc-room] insert failed', r.status, table, await r.text().catch(() => '')); return null; }
    if (!returning) return true;
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) { console.error('[gc-room] insert threw:', err.message); return null; }
}

/* PATCH with filters, which PostgREST issues as one UPDATE ... WHERE. That
   single-statement atomicity is what makes claimTurn() a real lock rather than
   a check-then-set race. */
async function sbPatch(key, table, filter, body, returning) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: headers(key, { Prefer: returning ? 'return=representation' : 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error('[gc-room] patch failed', r.status, table, await r.text().catch(() => '')); return null; }
    if (!returning) return true;
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) { console.error('[gc-room] patch threw:', err.message); return null; }
}

/* ── credentials ─────────────────────────────────────────────────────────────
   An invite token and a seat token are the same shape and deliberately NOT the
   same value. The invite is swapped for a fresh seat at the door, so a link
   forwarded around a family group chat cannot be replayed as somebody else's
   seat. */
function newToken(prefix) {
  return (prefix || 'GC') + '-' + crypto.randomBytes(24).toString('base64url');
}
function safeToken(v, prefix) {
  const s = String(v || '').trim();
  return new RegExp('^' + (prefix || 'GC') + '-[A-Za-z0-9_-]{16,128}$').test(s) ? s : null;
}

/* ── reads ─────────────────────────────────────────────────────────────────── */
const ROOM_COLUMNS = 'id,friend,scene_key,busy_until,closed,created_at,expires_at,guests_may_invite';

async function loadRoom(key, roomId) {
  const rows = await sbSelect(key, `gc_rooms?id=eq.${encodeURIComponent(roomId)}&select=${ROOM_COLUMNS}&limit=1`);
  return rows.length ? rows[0] : null;
}

/* WHO THE CALLER IS. The seat token is the credential: nobody here has an
   account, so there is no JWT to verify and no auth.uid() to key on.
   Everything downstream is gated on this one lookup, and nothing downstream
   may take a room id from the request body. */
async function identify(key, seatToken) {
  const t = safeToken(seatToken, 'GCS');
  if (!t) return null;
  const rows = await sbSelect(key,
    `gc_people?token=eq.${encodeURIComponent(t)}` +
    `&select=id,room_id,display_name,pronouns,avatar,is_host,joined_at,removed,remember_me&limit=1`);
  if (!rows.length || rows[0].removed) return null;
  const seat = rows[0];
  const room = await loadRoom(key, seat.room_id);
  if (!room) return null;
  return { seat, room };
}

async function loadPeople(key, roomId) {
  return sbSelect(key,
    `gc_people?room_id=eq.${encodeURIComponent(roomId)}&removed=eq.false` +
    `&select=id,display_name,pronouns,avatar,is_host,joined_at&order=joined_at.asc`);
}

/* THE FULL THREAD, no arrival cut. The one place the rule is deliberately not
   applied: the FRIEND needs the whole conversation or the host has to
   re-explain herself the moment somebody joins. What a guest may SEE is
   loadVisible() and it never passes through here. */
async function loadTranscript(key, roomId, limit) {
  const rows = await sbSelect(key,
    `gc_messages?room_id=eq.${encodeURIComponent(roomId)}` +
    `&select=speaker,name,content,created_at&order=created_at.desc&limit=${limit || MAX_TRANSCRIPT}`);
  return rows.reverse();
}

/* ── THE ARRIVAL-FORWARD RULE, in one function so it can be tested ───────────
   A guest sees the conversation only from the moment they arrived.

   `since` is a convenience so a browser is not re-sent what it already has. It
   is NEVER a way to ask for more: a cursor earlier than the caller's own
   arrival is ignored and the arrival is used instead. Garbage and missing
   values fall back to the arrival too, never to "no bound".

   Inclusive of the arrival, exclusive of the cursor: gte on the floor so a
   line written in the same instant somebody sat down is not lost, gt on the
   cursor so the last line already rendered is not sent twice.

   TIMESTAMPS PASS THROUGH VERBATIM, never re-serialised. Postgres keeps
   microseconds and a JavaScript Date has milliseconds, so round-tripping
   either bound through new Date(x).toISOString() silently rounds it DOWN. On
   the cursor that re-sends the last row on every poll; on the floor it would
   admit a row written microseconds before somebody sat down, which is exactly
   what this function exists to refuse. Dates are used to compare the two
   bounds and for nothing else. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:?\d{2}|Z)?$/;

function readClause(joinedAt, since) {
  const rawFloor = String(joinedAt || '');
  const floor = new Date(rawFloor);
  /* Refuse rather than fall back to an unbounded read: with no valid arrival
     there is no rule left to enforce. */
  if (!TIMESTAMP.test(rawFloor) || isNaN(floor.getTime())) throw new Error('seat has no valid joined_at');

  if (since) {
    const rawCursor = String(since);
    const cursor = new Date(rawCursor);
    if (TIMESTAMP.test(rawCursor) && !isNaN(cursor.getTime()) && cursor.getTime() > floor.getTime()) {
      return `created_at=gt.${encodeURIComponent(rawCursor)}`;
    }
  }
  return `created_at=gte.${encodeURIComponent(rawFloor)}`;
}

async function loadVisible(key, roomId, joinedAt, since) {
  return sbSelect(key,
    `gc_messages?room_id=eq.${encodeURIComponent(roomId)}&${readClause(joinedAt, since)}` +
    `&select=id,speaker,name,content,created_at,author_id&order=created_at.asc&limit=${MAX_MESSAGES}`);
}

/* ── writes ────────────────────────────────────────────────────────────────── */
async function insertMessage(key, roomId, { speaker, authorId, name, content }) {
  const rows = await sbInsert(key, 'gc_messages', {
    room_id: roomId,
    speaker,
    author_id: authorId || null,
    name: String(name || '').slice(0, 60) || null,
    content: String(content || '').slice(0, 4000),
  }, true);
  return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}

/* Conditional update, so it is atomic: whoever wins the race gets the row back
   and a second caller arriving mid-reply is told the room is busy. Held as a
   deadline so a crashed turn frees itself. */
async function claimTurn(key, roomId) {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString();
  const rows = await sbPatch(key, 'gc_rooms',
    `id=eq.${encodeURIComponent(roomId)}&closed=eq.false&or=(busy_until.is.null,busy_until.lt.${now})&select=id`,
    { busy_until: until }, true);
  return Array.isArray(rows) && rows.length > 0;
}

/* Always call this, including on the error path, or the room sits busy. */
async function releaseTurn(key, roomId, patch) {
  return sbPatch(key, 'gc_rooms', `id=eq.${encodeURIComponent(roomId)}`,
    Object.assign({ busy_until: null }, patch || {}), false);
}

async function touchSeat(key, seatId) {
  try {
    await sbPatch(key, 'gc_people', `id=eq.${encodeURIComponent(seatId)}`,
      { last_seen_at: new Date().toISOString() }, false);
  } catch (_) { /* presence is a nicety, never worth failing a request over */ }
}

function roomIsUsable(room) {
  if (!room) return { ok: false, reason: 'not_found' };
  if (room.closed) return { ok: false, reason: 'closed' };
  if (new Date(room.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true };
}
function roomIsBusy(room) {
  return Boolean(room && room.busy_until && new Date(room.busy_until).getTime() > Date.now());
}

/* ── WHO SPEAKS ──────────────────────────────────────────────────────────────
   The rule that separates this from The Dose, which seats everybody and makes
   them all answer every time. A reply has to be EARNED and silence is a valid
   outcome. Scales with the room, so no router is needed for the common cases:

     one person  -> the friend always answers. Somebody talking to you in an
                    empty room is talking to you.
     two or more -> only when named, asked something clearly theirs, when
                    somebody new has just been introduced, or after a real gap.

   Returns true when the friend should be asked for a reply at all. */
function friendShouldAnswer({ people, text, secondsSinceLast, someoneJustArrived, friendName }) {
  const humans = (people || []).length;
  if (humans <= 1) return true;

  if (someoneJustArrived) return true;               // you greet somebody who just walked in

  const said = String(text || '');
  const name = String(friendName || '').trim();
  if (name && new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(said)) return true;

  /* A question with nobody else's name in it is probably for the room, and the
     friend is in the room. */
  if (/\?\s*$/.test(said.trim())) {
    const others = (people || []).map(p => (p.display_name || '').trim()).filter(Boolean);
    const aimedAtSomebodyElse = others.some(n =>
      new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(said));
    if (!aimedAtSomebodyElse) return true;
  }

  if (Number(secondsSinceLast) > 45) return true;    // a real gap, not a pause for breath

  return false;                                      // four people catching up do not need a fifth voice
}

function safeName(v, fallback) {
  const s = String(v || '').trim().slice(0, 40);
  return s || fallback || null;
}

module.exports = {
  SUPABASE_URL, LOCK_SECONDS, MAX_MESSAGES, MAX_TRANSCRIPT, MAX_PEOPLE, CORS,
  json, preflight, serviceKey,
  sbSelect, sbInsert, sbPatch,
  newToken, safeToken,
  identify, loadRoom, loadPeople, loadTranscript, loadVisible, readClause,
  insertMessage, claimTurn, releaseTurn, touchSeat,
  roomIsUsable, roomIsBusy, friendShouldAnswer, safeName,
};
