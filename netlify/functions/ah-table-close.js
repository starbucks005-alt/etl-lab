/* ah-table-close — leave a shared table, or close it.

   POST /.netlify/functions/ah-table-close
   Body: { seat_token }
   Returns { ok: true, closed: boolean }

   WHO CAN END IT. The host owns the room, because the host is paying for it: a
   guest who kept asking questions after the host got up would be spending
   somebody else's credits with nobody there to see it. So the host closing ends
   the table for both people, and the other person's next poll tells her so
   rather than leaving her typing into a room that has quietly stopped.

   A GUEST leaving only removes herself. The host may well still be sitting
   there talking, and one person walking off is not a reason to end her
   conversation.

   Deliberately not called on pagehide by either side. A closed tab is usually a
   reload or a phone locking, and the session survives that on purpose; ending
   somebody's conversation because their screen went dark would be the wrong
   read of the same event.
*/

const {
  json, CORS, serviceKey, identify, sbPatch, insertMessage,
} = require('./_ah-table.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const me = await identify(key, body.seat_token);
  // Already gone, or never here. Nothing to do, and nothing worth an error:
  // this is called on the way out, when a failure helps nobody.
  if (!me) return json(200, { ok: true, closed: false });

  const { seat, room } = me;

  // Soft removal either way, so the transcript stays coherent and the roster
  // can still explain who was here.
  await sbPatch(key, 'etl_table_people', `id=eq.${encodeURIComponent(seat.id)}`,
    { removed: true }, false);

  if (!seat.is_host) {
    if (!room.closed) {
      await insertMessage(key, room.id, {
        speaker: 'system',
        name: 'The table',
        content: `${seat.display_name || 'Your friend'} has left the table.`,
      });
    }
    return json(200, { ok: true, closed: false });
  }

  if (!room.closed) {
    await insertMessage(key, room.id, {
      speaker: 'system',
      name: 'The table',
      content: 'The table has closed.',
    });
    await sbPatch(key, 'etl_table_rooms', `id=eq.${encodeURIComponent(room.id)}`,
      { closed: true, busy_until: null }, false);
  }
  return json(200, { ok: true, closed: true });
};
