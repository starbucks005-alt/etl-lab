/* leadership-table-open -- turn the classroom's group table into a room other
   people can walk into, and mint the code they walk in with.

   POST /.netlify/functions/leadership-table-open
   Body: {
     active_agents: string[]   -- 2..10 leaders already at the table
     display_name?, visitor_id?
     seed?: [{speaker, name, content}]   -- a table already in progress
     agent_state?: { [agentKey]: { scales } }
   }
   Returns { room_id, seat_token, code, code_display, join_url, cursor, expires_at }

   THE SOLO TABLE NEVER CALLS THIS. One person at the table is still entirely a
   browser and a background job, exactly as it was: no room row, no polling, no
   database. All of this wakes up only when she actually wants somebody else in
   the room, so the ordinary case carries none of it.

   IT TAKES THE CONVERSATION SHE IS ALREADY HAVING. The moment a teacher wants
   the class in the room is rarely before she sits down. It is twenty minutes
   in, when Perkins has said something worth the whole seminar hearing. The seed
   carries those lines in, and because they are written before anybody claims
   the code, they sit before every student's arrival and stay invisible to them
   under the arrival-forward rule, while the leaders still have the full thread.

   NOBODY PAYS AND NOBODY SIGNS IN. This classroom is free, the students have no
   accounts here, and the code is the whole of the credential.
*/

const { AGENTS } = require('./leadership-chat.js');
const {
  json, CORS, serviceKey, sbInsert, newToken, safeName,
} = require('./_ah-table.js');
const {
  newClassCode, inviteTokenFor, displayCode,
} = require('./_leadership-table.js');

const MIN_AGENTS = 2;
const MAX_ROOM_AGENTS = 10;  // matches leadership-room.js: the whole table may sit
const MAX_SEED = 24;

/* The leaders' feelings, carried in when a solo table becomes a shared one.
   Sanitized rather than trusted whole: unknown keys dropped, non-objects
   dropped. Low stakes, since it is her own table's meters, but there is no
   reason to write an arbitrary shape into a column the cascade reads back. */
function safeAgentState(raw, agentKeys) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  agentKeys.forEach((key) => {
    const v = raw[key];
    if (!v || typeof v !== 'object') return;
    if (v.scales && typeof v.scales === 'object') out[key] = { scales: v.scales };
  });
  return out;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const agentKeys = Array.isArray(body.active_agents)
    ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter((a) => AGENTS[a])
    : [];
  if (agentKeys.length < MIN_AGENTS) return json(400, { error: 'need_at_least_two_agents' });
  if (agentKeys.length > MAX_ROOM_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_ROOM_AGENTS });

  const rooms = await sbInsert(key, 'etl_table_rooms', {
    host_credit_ref: null,
    host_is_owner: false,
    agent_keys: agentKeys,
    active_agents: agentKeys,
    agent_state: safeAgentState(body.agent_state, agentKeys),
    visitor_message_count: 0,
  }, true);
  if (!Array.isArray(rooms) || !rooms.length) return json(500, { error: 'could_not_open_table' });
  const room = rooms[0];

  const seatToken = newToken();
  const hostName = safeName(body.display_name, 'Dr. O');
  const seats = await sbInsert(key, 'etl_table_people', {
    room_id: room.id,
    token: seatToken,
    display_name: hostName,
    visitor_id: String(body.visitor_id || '').trim().slice(0, 64) || null,
    is_host: true,
  }, true);
  if (!Array.isArray(seats) || !seats.length) return json(500, { error: 'could_not_open_table' });

  // The conversation so far, written after her own seat exists so the ordering
  // is unambiguous. Its last timestamp comes back as the cursor, so her browser
  // does not render again what it is already showing.
  let cursor = null;
  const seed = Array.isArray(body.seed) ? body.seed.slice(-MAX_SEED) : [];
  if (seed.length) {
    const rows = seed
      .filter((e) => e && typeof e.content === 'string' && e.content.trim())
      .map((e) => {
        const speaker = String(e.speaker || 'visitor');
        const isVisitor = speaker === 'visitor';
        return {
          room_id: room.id,
          speaker: isVisitor ? 'visitor' : speaker,
          author_id: isVisitor ? seats[0].id : null,
          name: String(e.name || (isVisitor ? hostName : 'Someone')).slice(0, 60),
          content: String(e.content).slice(0, 4000),
        };
      })
      .filter((r) => r.speaker === 'visitor' || AGENTS[r.speaker]);
    if (rows.length) {
      const written = await sbInsert(key, 'etl_table_messages', rows, true);
      if (Array.isArray(written) && written.length) {
        cursor = written.map((m) => m.created_at).sort().pop();
      }
    }
  }

  const code = newClassCode();
  const invited = await sbInsert(key, 'etl_table_invites', {
    token: inviteTokenFor(code),
    room_id: room.id,
  }, false);

  const base = (process.env.URL || 'https://emerging-tech-lab.com').replace(/\/+$/, '');

  return json(200, {
    room_id: room.id,
    seat_token: seatToken,
    // Null if the invite row did not write. The table still works; she simply
    // has nothing to hand out, and being told that beats a dead code.
    code: invited ? code : null,
    code_display: invited ? displayCode(code) : null,
    join_url: invited ? `${base}/leadership-room.html?table=${code}` : null,
    cursor,
    expires_at: room.expires_at,
  });
};
