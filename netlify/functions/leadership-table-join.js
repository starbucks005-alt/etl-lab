/* leadership-table-join -- take a seat at the classroom table with a code.

   POST /.netlify/functions/leadership-table-join
   Body: { code, peek?: true, display_name?, visitor_id? }
   Returns { room_id, seat_token, active_agents, leaders, host_name, joined_at }
          | { peek: true, host_name, leaders, seats_taken }
          | { error: 'not_found' | 'expired' | 'closed' | 'full' | 'name_required' }

   THE CODE IS THE WHOLE CREDENTIAL, and for a classroom that is the point: a
   student taps a link or types eight characters off the board and is sitting at
   the table. No account, no install, nothing to reset at 9pm the night before a
   presentation.

   IT IS NOT BURNED ON FIRST USE. Almost Human's invite is single use, because
   it invites one friend. A class is thirty people claiming the same code in the
   same minute, so this one is never marked claimed. What bounds it instead is
   SEAT_CAP, the room's own expiry, and the host closing the table.

   EVERY PERSON GETS THEIR OWN SEAT TOKEN, minted here and never the code they
   arrived with. A code read out in a room is about as public as a thing can be,
   and it must never be replayable as somebody's session afterwards.

   A NAME IS REQUIRED, and it is the one thing asked for. The leaders address
   people by it and the room shows who said what, so "Guest" nine times over is
   useless to everybody. Nothing else about a student is collected, here or
   anywhere downstream.
*/

const { AGENTS } = require('./leadership-chat.js');
const {
  json, CORS, serviceKey, sbSelect, sbInsert,
  loadRoom, loadPeople, roomIsUsable, newToken, safeName,
} = require('./_ah-table.js');
const {
  normalizeClassCode, inviteTokenFor, SEAT_CAP, seatCount,
} = require('./_leadership-table.js');

function leaderNames(keys) {
  return (keys || []).map((k) => (AGENTS[k] ? AGENTS[k].name : null)).filter(Boolean);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const code = normalizeClassCode(body.code);
  if (!code) return json(404, { error: 'not_found' });

  const invites = await sbSelect(
    key,
    `etl_table_invites?token=eq.${encodeURIComponent(inviteTokenFor(code))}&select=token,room_id,expires_at&limit=1`
  );
  if (!invites.length) return json(404, { error: 'not_found' });
  const invite = invites[0];
  if (new Date(invite.expires_at).getTime() < Date.now()) return json(410, { error: 'expired' });

  const room = await loadRoom(key, invite.room_id);
  const usable = roomIsUsable(room);
  if (!usable.ok) return json(410, { error: usable.reason });

  const people = await loadPeople(key, room.id);
  const host = people.find((p) => p.is_host);
  const hostName = (host && host.display_name) || 'Your instructor';

  // What the landing panel shows before anybody types anything. Takes no seat.
  if (body.peek === true) {
    return json(200, {
      peek: true,
      host_name: hostName,
      leaders: leaderNames(room.active_agents || room.agent_keys),
      seats_taken: people.length,
    });
  }

  const name = String(body.display_name || '').trim();
  if (!name) return json(400, { error: 'name_required' });

  if (await seatCount(key, room.id) >= SEAT_CAP) return json(409, { error: 'full', cap: SEAT_CAP });

  const seatToken = newToken();
  // joined_at defaults, and it IS the privacy boundary: everything this student
  // can read is bounded by it. See readClause() in _ah-table.js.
  const seats = await sbInsert(key, 'etl_table_people', {
    room_id: room.id,
    token: seatToken,
    display_name: safeName(name, 'Student'),
    visitor_id: String(body.visitor_id || '').trim().slice(0, 64) || null,
    is_host: false,
  }, true);
  if (!Array.isArray(seats) || !seats.length) {
    console.error('[leadership-table-join] seat insert failed for room', room.id);
    return json(500, { error: 'could_not_join' });
  }

  return json(200, {
    room_id: room.id,
    seat_token: seatToken,
    active_agents: room.active_agents || room.agent_keys || [],
    leaders: leaderNames(room.active_agents || room.agent_keys),
    host_name: hostName,
    joined_at: seats[0].joined_at,
  });
};
