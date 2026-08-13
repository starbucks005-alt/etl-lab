/* _ah-table — shared plumbing for Almost Human's group table when there is a
   second human in it. Underscore prefix = utility module, not an endpoint.

   Used by ah-table-open.js (make a room, mint an invite), ah-table-join.js
   (claim one), ah-table-poll.js (what has been said since I last looked), and
   the shared branch of eq-room-group-ask.js (run a cascade against a room).

   SCHEMA: supabase_ah_table_migration.sql. Read the header there first; it is
   where the design reasoning lives.

   RAW POSTGREST, NOT @supabase/supabase-js, ON PURPOSE. Every Almost Human
   function already talks to this project with fetch and the service-role key
   (see _ah-credits.js, eq-room-ask.js, eq-room-group-ask.js) and the SDK is not
   in package.json. Adding a dependency to this campus for four tables would be
   a worse trade than fifty lines of fetch.

   THE SERVICE KEY BYPASSES RLS, and those tables have deny-all RLS anyway, so
   NOTHING here is protected by the database. Every guarantee this feature makes
   is made by this file and its callers:
     * identify() is the only door. A caller is whoever their seat token says
       they are, or nobody.
     * readClause() is the arrival-forward privacy rule. If that function is
       wrong, an invited guest can read the host's conversation from before she
       arrived.
     * claimTurn() is what stops two people's cascades from interleaving.
*/

const crypto = require('crypto');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

// How long one cascade may hold a room's turn lock. Long enough for the worst
// case (a director call plus CASCADE_CAP sequential Sonnet turns plus a judge),
// short enough that a function that dies mid-cascade frees the room on its own
// rather than wedging it until it expires.
const LOCK_SECONDS = 120;

const MAX_MESSAGES = 60;
const MAX_TRANSCRIPT = 40;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function headers(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }, extra || {});
}

async function sbSelect(key, path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers(key) });
    if (!r.ok) {
      console.error('[ah-table] select failed', r.status, path);
      return [];
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('[ah-table] select threw:', err.message);
    return [];
  }
}

async function sbInsert(key, table, body, returning) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers(key, { Prefer: returning ? 'return=representation' : 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[ah-table] insert failed', r.status, table, await r.text().catch(() => ''));
      return null;
    }
    if (!returning) return true;
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('[ah-table] insert threw:', err.message);
    return null;
  }
}

/* PATCH with filters, which PostgREST issues as one UPDATE ... WHERE. That
   single-statement atomicity is what makes claimTurn() below a real lock and
   not a check-then-set race. Returns the updated rows when `returning`. */
async function sbPatch(key, table, filter, body, returning) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: headers(key, { Prefer: returning ? 'return=representation' : 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[ah-table] patch failed', r.status, table, await r.text().catch(() => ''));
      return null;
    }
    if (!returning) return true;
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('[ah-table] patch threw:', err.message);
    return null;
  }
}

/* ── credentials ─────────────────────────────────────────────────────────── */

// An invite token and a seat token are the same shape and deliberately NOT the
// same value: see ah-table-join.js for why the invite is swapped for a fresh
// one at the door rather than being kept as the session credential.
function newToken() {
  return 'AHT-' + crypto.randomBytes(24).toString('base64url');
}

function safeTableToken(v) {
  const s = String(v || '').trim();
  return /^AHT-[A-Za-z0-9_-]{16,128}$/.test(s) ? s : null;
}

/* ── reads ───────────────────────────────────────────────────────────────── */

const ROOM_COLUMNS = 'id,host_credit_ref,host_is_owner,agent_keys,active_agents,' +
  'agent_state,visitor_message_count,closed,busy_until,created_at,expires_at';

async function loadRoom(key, roomId) {
  const rows = await sbSelect(key, `etl_table_rooms?id=eq.${encodeURIComponent(roomId)}&select=${ROOM_COLUMNS}&limit=1`);
  return rows.length ? rows[0] : null;
}

/* Who the caller is. The seat token IS the credential: nobody at this table has
   a Supabase session, so there is no JWT to verify and no auth.uid() to key
   anything on. Returns the seat row plus its room, or null.

   Everything a caller can reach is gated on this one lookup. Nothing downstream
   may take a room id from the request body. */
async function identify(key, seatToken) {
  const t = safeTableToken(seatToken);
  if (!t) return null;
  const rows = await sbSelect(
    key,
    `etl_table_people?token=eq.${encodeURIComponent(t)}&select=id,room_id,display_name,pronoun,visitor_id,is_host,joined_at,removed&limit=1`
  );
  if (!rows.length || rows[0].removed) return null;
  const seat = rows[0];
  const room = await loadRoom(key, seat.room_id);
  if (!room) return null;
  return { seat, room };
}

async function loadPeople(key, roomId) {
  return sbSelect(
    key,
    `etl_table_people?room_id=eq.${encodeURIComponent(roomId)}&removed=eq.false&select=id,display_name,is_host,joined_at&order=joined_at.asc`
  );
}

/* The FULL transcript, no arrival cut. This is the one place the rule is
   deliberately not applied: the cast needs the whole thread or the host has to
   re-explain herself the moment somebody joins. What a GUEST may see is
   readClause() below, and it never passes through here. What the cast may SAY
   about the earlier part is a prompt rule, applied in eq-room-group-ask.js. */
async function loadTranscript(key, roomId, limit = MAX_TRANSCRIPT) {
  const rows = await sbSelect(
    key,
    `etl_table_messages?room_id=eq.${encodeURIComponent(roomId)}&select=speaker,name,content,created_at&order=created_at.desc&limit=${limit}`
  );
  return rows.reverse();
}

/* THE ARRIVAL-FORWARD RULE, in one function so it can be reasoned about and
   tested. Dr. O's decision: an invited guest sees the conversation only from
   the moment she arrives.

   `since` is a convenience so a browser is not resent what it already has. It
   is NEVER a way to ask for more: a cursor earlier than the caller's own
   arrival is ignored and the arrival is used instead. Garbage and missing
   values fall back to the arrival too, never to "no bound".

   Inclusive of the arrival, exclusive of the cursor: `gte` on the floor so a
   line written in the same instant someone sat down is not lost, `gt` on the
   cursor so the last line already rendered is not sent twice.

   On The Dose this was a Postgres read policy. It cannot be here — there is no
   session for a policy to key on — so it is application code, and that is a
   weaker guarantee honestly stated rather than quietly assumed. If this
   function is wrong, a guest reads the host's private conversation.

   TIMESTAMPS ARE PASSED THROUGH VERBATIM, never re-serialised. Postgres keeps
   microseconds and a JavaScript Date only has milliseconds, so round-tripping
   either bound through `new Date(x).toISOString()` silently rounds it DOWN.
   On the cursor that hands back the last row again on every poll; on the floor
   it would admit a row written microseconds before somebody sat down, which is
   exactly the thing this function exists to refuse. Dates are used to compare
   the two bounds and for nothing else. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:?\d{2}|Z)?$/;

function readClause(joinedAt, since) {
  const rawFloor = String(joinedAt || '');
  const floor = new Date(rawFloor);
  // Refuse rather than fall back to an unbounded read: with no valid arrival
  // there is no rule left to enforce.
  if (!TIMESTAMP.test(rawFloor) || isNaN(floor.getTime())) {
    throw new Error('seat has no valid joined_at');
  }
  if (since) {
    const rawCursor = String(since);
    const cursor = new Date(rawCursor);
    // Strictly later, by at least the millisecond a Date can actually see. A
    // cursor inside the same millisecond as the arrival falls back to the
    // arrival, which at worst re-sends a row the browser already has and
    // discards by id.
    if (TIMESTAMP.test(rawCursor) && !isNaN(cursor.getTime()) && cursor.getTime() > floor.getTime()) {
      return `created_at=gt.${encodeURIComponent(rawCursor)}`;
    }
  }
  return `created_at=gte.${encodeURIComponent(rawFloor)}`;
}

async function loadVisible(key, roomId, joinedAt, since) {
  return sbSelect(
    key,
    `etl_table_messages?room_id=eq.${encodeURIComponent(roomId)}&${readClause(joinedAt, since)}` +
    `&select=id,speaker,name,content,created_at,author_id&order=created_at.asc&limit=${MAX_MESSAGES}`
  );
}

/* ── writes ──────────────────────────────────────────────────────────────── */

/* One line at the table. Cast replies are inserted the moment each one is
   generated rather than in a batch at the end, so both browsers watch the
   conversation arrive at the pace it is actually written. */
async function insertMessage(key, roomId, { speaker, authorId, name, content }) {
  const rows = await sbInsert(key, 'etl_table_messages', {
    room_id: roomId,
    speaker,
    author_id: authorId || null,
    name: String(name || 'Guest').slice(0, 60),
    content: String(content || '').slice(0, 4000),
  }, true);
  return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}

/* Claims the room's turn lock.

   Conditional update, so it is atomic: whoever wins the race gets the row back,
   and a second caller arriving mid-cascade gets nothing and is told the table
   is busy. Held as a deadline rather than a boolean so a crashed cascade frees
   itself after LOCK_SECONDS instead of jamming the room. */
async function claimTurn(key, roomId) {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString();
  const rows = await sbPatch(
    key,
    'etl_table_rooms',
    `id=eq.${encodeURIComponent(roomId)}&closed=eq.false&or=(busy_until.is.null,busy_until.lt.${now})&select=id`,
    { busy_until: until },
    true
  );
  return Array.isArray(rows) && rows.length > 0;
}

/* Releases the lock, and writes back whatever the cascade changed in the same
   statement. Always call this, including on the error path, or the room sits
   busy for LOCK_SECONDS. */
async function releaseTurn(key, roomId, patch) {
  return sbPatch(
    key,
    'etl_table_rooms',
    `id=eq.${encodeURIComponent(roomId)}`,
    Object.assign({ busy_until: null }, patch || {}),
    false
  );
}

async function touchSeat(key, seatId) {
  // Presence is a nicety; never worth failing a request over.
  try {
    await sbPatch(key, 'etl_table_people', `id=eq.${encodeURIComponent(seatId)}`,
      { last_seen_at: new Date().toISOString() }, false);
  } catch (_) { /* ignore */ }
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

/* The name shown next to somebody's questions, and the name the cast calls
   them. Falls back to "Guest" rather than to anything derived: on The Dose an
   email-derived fallback had the cast addressing Dr. O by her mail handle all
   session, and a neutral name is better than a wrong one. */
function safeName(v, fallback) {
  const s = String(v || '').trim().slice(0, 40);
  return s || fallback || 'Guest';
}

module.exports = {
  SUPABASE_URL,
  LOCK_SECONDS,
  MAX_MESSAGES,
  CORS,
  json,
  serviceKey,
  sbSelect,
  sbInsert,
  sbPatch,
  newToken,
  safeTableToken,
  identify,
  loadRoom,
  loadPeople,
  loadTranscript,
  loadVisible,
  readClause,
  insertMessage,
  claimTurn,
  releaseTurn,
  touchSeat,
  roomIsUsable,
  roomIsBusy,
  safeName,
};
