/* gc-room-poll — what has been said since I last looked.

   Every browser in the room calls this on a timer. It is the only read path a
   guest has, and it is where the arrival-forward rule is actually enforced:
   readClause() bounds the query below by the CALLER'S OWN joined_at, and a
   cursor earlier than that is ignored rather than honoured.

   THE ROOM ID IS NEVER TAKEN FROM THE BODY. It comes from the seat token. A
   caller is whoever their seat says they are, or nobody.

   POST { seat_token, since? }
     -> { messages, people, scene_key, closed, busy }
*/

const R = require('./_gc-room.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return R.preflight();
  if (event.httpMethod !== 'POST') return R.json(405, { error: 'method_not_allowed' });

  const key = R.serviceKey();
  if (!key) return R.json(500, { error: 'no_service_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return R.json(400, { error: 'bad_json' }); }

  const who = await R.identify(key, body.seat_token);
  if (!who) return R.json(403, { error: 'no_seat' });

  const usable = R.roomIsUsable(who.room);
  if (!usable.ok) return R.json(200, { messages: [], people: [], closed: true, reason: usable.reason });

  let messages;
  try {
    messages = await R.loadVisible(key, who.room.id, who.seat.joined_at, body.since);
  } catch (err) {
    /* readClause refuses rather than falling back to an unbounded read. If a
       seat somehow has no valid arrival, the honest answer is nothing at all,
       not the host's private conversation. */
    console.error('[gc-room-poll] read refused:', err.message);
    return R.json(500, { error: 'bad_seat_arrival' });
  }

  R.touchSeat(key, who.seat.id);

  const people = await R.loadPeople(key, who.room.id);

  return R.json(200, {
    messages,
    people: people.map(p => ({ name: p.display_name, avatar: p.avatar, is_host: p.is_host })),
    scene_key: who.room.scene_key,       // the scene is shared: the host moves and everyone follows
    closed: false,
    busy: R.roomIsBusy(who.room),        // somebody's turn is in flight
    you: { name: who.seat.display_name, is_host: who.seat.is_host },
    guests_may_invite: who.room.guests_may_invite,
  });
};
