/* ah-table-open — turn a table into a shared room and mint an invite, so the
   host can bring a friend to sit down with her.

   POST /.netlify/functions/ah-table-open
   Body: {
     agent_keys:    string[]   — 2..MAX, the agents already at this table
     display_name?, pronoun?, visitor_id?
     access_token?, owner_key?
     seed?:         [{speaker, name, content}]  — a table already in progress
     agent_state?:  { [agentKey]: {scales, meters, turn_count} }
     visitor_message_count?: number
   }
   Returns { room_id, seat_token, invite_token, join_url, cursor, expires_at }

   THE SOLO TABLE NEVER CALLS THIS. A table with one human in it stays entirely
   in the browser, exactly as it shipped: no room row, no polling, no database
   at all. All of this comes alive only when somebody is actually invited, which
   is why the common case costs nothing and carries none of this risk.

   WHY IT ACCEPTS A CONVERSATION ALREADY IN PROGRESS
   ------------------------------------------------
   The moment a host wants a friend is usually not before she sits down, it is
   twenty minutes in, when something is worth showing someone. So `seed` carries
   the transcript and `agent_state` carries where the agents' feelings had got
   to, and the room picks up mid-sentence instead of starting over.

   Those seeded lines are written BEFORE any invite is claimed, so they land
   before a guest's joined_at and are therefore invisible to her under the
   arrival-forward rule, while still being visible to the cast. The two things
   stay compatible without either one weakening the other.

   WHY THE PAYWALL IS CHECKED HERE AND NOT ONLY AT ASK TIME
   -------------------------------------------------------
   The friend spends the host's credits (Dr. O's decision), so a host with no
   subscription would mint a room, send a link, and have her friend arrive at a
   table that cannot answer anything. Refusing at the door is the kinder failure,
   and it is the only place the host is definitely the one holding the browser.
*/

const engine = require('./_eq-engine.js');
const { ownerUser } = require('./_owner-auth.js');
const {
  json, CORS, serviceKey, sbInsert, newToken, safeName,
} = require('./_ah-table.js');
const {
  getCreditRow, linkTokenRef, safeToken, GROUP_MESSAGE_COST,
} = require('./_ah-credits.js');

const MIN_AGENTS = 2;
const MAX_AGENTS = 6;   // matches MAX_ROOM_AGENTS in eq-room-group-ask.js
const MAX_SEED = 24;

const PRONOUNS = { he: true, she: true, they: true };

// The same two owner-key systems as eq-room-ask.js and eq-room-group-ask.js
// (see the comment in either): OWNER_KEYS (plural, _owner-auth.js) and
// OWNER_KEY (singular, admin tools).
function isOwnerKey(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  if (ownerUser(k)) return true;
  return !!process.env.OWNER_KEY && k === process.env.OWNER_KEY;
}

/* The client's own agent emotion state, carried in when a solo table converts
   to a shared one. Sanitized rather than trusted wholesale: unknown agent keys
   dropped, non-objects dropped. The stakes are low (it is her own table's
   feelings, and the solo table already posts this back every turn) but there is
   no reason to write arbitrary shapes into a jsonb column the cascade reads. */
function safeAgentState(raw, agentKeys) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  agentKeys.forEach((key) => {
    const v = raw[key];
    if (!v || typeof v !== 'object') return;
    out[key] = {
      scales: (v.scales && typeof v.scales === 'object') ? v.scales : null,
      meters: (v.meters && typeof v.meters === 'object') ? v.meters : { humanness: 50, eq: 50 },
      turn_count: Number(v.turn_count) || 0,
    };
    if (!out[key].scales) delete out[key].scales;
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

  const agentKeys = Array.isArray(body.agent_keys)
    ? [...new Set(body.agent_keys.map((a) => String(a || '').trim().toLowerCase()))].filter((a) => engine.AGENTS[a])
    : [];
  if (agentKeys.length < MIN_AGENTS) return json(400, { error: 'need_at_least_two_agents' });
  if (agentKeys.length > MAX_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_AGENTS });

  const isOwner = isOwnerKey(body.owner_key);
  const accessToken = safeToken(body.access_token);

  // Who pays, resolved before anything is written. A reference rather than the
  // token itself, so no live credential ends up at rest on the room row; see
  // tokenRef() in _ah-credits.js.
  let hostCreditRef = null;
  if (!isOwner) {
    const row = accessToken ? await getCreditRow(accessToken, key) : null;
    if (!row || !row.subscription_active) {
      return json(200, {
        error: 'subscription_required',
        message: 'The table is a member perk. Upgrade to open one and bring someone with you.',
      });
    }
    if (row.balance < GROUP_MESSAGE_COST) {
      return json(200, {
        error: 'credits_exhausted',
        message: "You're out of credits for this cycle. Add more, then you can bring someone in.",
      });
    }
    hostCreditRef = await linkTokenRef(accessToken, key);
    if (!hostCreditRef) return json(500, { error: 'could_not_open_room' });
  }

  const rooms = await sbInsert(key, 'etl_table_rooms', {
    host_credit_ref: hostCreditRef,
    host_is_owner: isOwner,
    agent_keys: agentKeys,
    active_agents: agentKeys,
    agent_state: safeAgentState(body.agent_state, agentKeys),
    visitor_message_count: Math.max(0, Number(body.visitor_message_count) || 0),
  }, true);
  if (!Array.isArray(rooms) || !rooms.length) return json(500, { error: 'could_not_open_room' });
  const room = rooms[0];

  const seatToken = newToken();
  const hostName = safeName(body.display_name, 'Friend');
  const seats = await sbInsert(key, 'etl_table_people', {
    room_id: room.id,
    token: seatToken,
    display_name: hostName,
    pronoun: PRONOUNS[String(body.pronoun || '').toLowerCase()] ? String(body.pronoun).toLowerCase() : null,
    visitor_id: String(body.visitor_id || '').trim().slice(0, 64) || null,
    is_host: true,
  }, true);
  if (!Array.isArray(seats) || !seats.length) return json(500, { error: 'could_not_open_room' });

  // The conversation so far. Written after the host's own seat exists so the
  // ordering is unambiguous, and its last timestamp is handed back as `cursor`
  // so her browser does not re-render lines it is already showing.
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
      .filter((r) => r.speaker === 'visitor' || engine.AGENTS[r.speaker]);
    if (rows.length) {
      const written = await sbInsert(key, 'etl_table_messages', rows, true);
      if (Array.isArray(written) && written.length) {
        cursor = written
          .map((m) => m.created_at)
          .sort()
          .pop();
      }
    }
  }

  const inviteToken = newToken();
  const invited = await sbInsert(key, 'etl_table_invites', {
    token: inviteToken,
    room_id: room.id,
  }, false);

  const base = (process.env.URL || 'https://emerging-tech-lab.com').replace(/\/+$/, '');

  return json(200, {
    room_id: room.id,
    seat_token: seatToken,
    // Null if the invite row failed to write. The room still works; she just
    // has nobody to send. Better to say so than to hand back a dead link.
    invite_token: invited ? inviteToken : null,
    join_url: invited ? `${base}/almost-human?table=${encodeURIComponent(inviteToken)}` : null,
    cursor,
    expires_at: room.expires_at,
  });
};
