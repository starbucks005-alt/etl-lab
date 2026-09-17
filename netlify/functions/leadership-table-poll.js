/* leadership-table-poll -- what has been said at this table since I last looked.

   POST /.netlify/functions/leadership-table-poll
   Body: { seat_token, since? }
   Returns { messages, roster, active_agents, agent_state, busy, closed }

   Polling rather than realtime, for the same reason Almost Human's table polls:
   nobody here has a Supabase session for Realtime to key on, and one sync path
   beats two. In a classroom a couple of seconds is invisible.

   THIS IS WHERE THE ARRIVAL-FORWARD RULE IS ENFORCED for the classroom, by the
   same readClause() in _ah-table.js that enforces it for Almost Human. A
   student who joins in week nine sees the table from the moment she sits down,
   never the conversation the room was having before. The rows never leave the
   server, but that is application code rather than the database refusing, and
   it is worth saying rather than assuming.
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

  // The seat token says who this is, and the room is read from the seat, never
  // from the request: nobody can name a table they are not sitting at.
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
    console.error('[leadership-table-poll] read failed:', err.message);
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
      // Resolved here, so no browser is handed anybody else's identifier in
      // order to work out which lines are its own.
      mine: m.speaker === 'visitor' && m.author_id === seat.id,
    })),
    roster: people.map((p) => ({ name: p.display_name || 'Student', is_host: p.is_host })),
    active_agents: room.active_agents || [],
    agent_state: room.agent_state || {},
    busy: roomIsBusy(room),
    closed: Boolean(room.closed),
    is_host: Boolean(seat.is_host),
  });
};
