/* ah-table-poll — what has been said at this table since I last looked.

   POST /.netlify/functions/ah-table-poll
   Body: { seat_token, since? }
   Returns { messages, roster, active_agents, busy, closed }

   POLLING, NOT REALTIME, and not by preference. Supabase Realtime needs a real
   session, and nobody at this table has one: Almost Human has no browser
   Supabase client and no anon key on the page at all. Both sides poll the same
   endpoint instead, which also means one sync path rather than two. For two
   people a couple of seconds is invisible.

   THIS IS WHERE THE ARRIVAL-FORWARD RULE IS ENFORCED. The clamp itself is
   readClause() in _ah-table.js; this function is its only real caller. On The
   Dose the host's half of that rule was a Postgres read policy. Here it cannot
   be — no session, nothing for a policy to key on — so the rule is entirely
   application code. If readClause() is wrong, an invited guest reads the host's
   conversation from before she arrived. The rows still never leave the server,
   but that is a weaker guarantee than the database enforcing it and it is worth
   saying rather than assuming.
*/

const {
  json, CORS, serviceKey, identify, loadPeople, loadVisible,
  touchSeat, roomIsUsable, roomIsBusy,
} = require('./_ah-table.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  // The seat token is the only thing that says who this is. Note that the room
  // is read from the seat, never from the request body: a caller cannot name a
  // room they are not sitting at.
  const me = await identify(key, body.seat_token);
  if (!me) return json(401, { error: 'not_at_this_table' });

  const { seat, room } = me;
  const usable = roomIsUsable(room);
  if (!usable.ok) {
    return json(200, { messages: [], roster: [], active_agents: [], busy: false, closed: true, reason: usable.reason });
  }

  let rows;
  try {
    rows = await loadVisible(key, room.id, seat.joined_at, body.since);
  } catch (err) {
    console.error('[ah-table-poll] read failed:', err.message);
    return json(500, { error: 'read_failed' });
  }

  await touchSeat(key, seat.id);
  const people = await loadPeople(key, room.id);

  return json(200, {
    messages: rows.map((m) => ({
      id: m.id,
      speaker: m.speaker,
      name: m.name,
      content: m.content,
      created_at: m.created_at,
      // Whether this line is the caller's own, resolved server-side so no
      // browser is ever handed anyone else's identifier in order to compare.
      mine: m.speaker === 'visitor' && m.author_id === seat.id,
    })),
    roster: people.map((p) => ({ name: p.display_name || 'Guest', is_host: p.is_host })),
    active_agents: room.active_agents || [],
    // The agents' feelings, read-only. The room is the only writer (see
    // eq-room-group-ask.js); this copy exists so that "End Conversation" and
    // the silent memory save on the way out can still file each agent's scales
    // and turn count, the way they always have in a solo table. Sent on every
    // poll rather than only when it changed: it is a few hundred bytes, and the
    // alternative is a client holding a stale copy after a quiet round, which
    // is the exact class of bug this whole change exists to remove.
    agent_state: room.agent_state || {},
    // Shown as "the table is talking" so the person who did not ask isn't left
    // wondering whether their own send silently failed.
    busy: roomIsBusy(room),
    closed: Boolean(room.closed),
  });
};
