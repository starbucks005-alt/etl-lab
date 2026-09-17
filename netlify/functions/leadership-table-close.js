/* leadership-table-close -- the host ends the class.

   POST /.netlify/functions/leadership-table-close
   Body: { seat_token }
   Returns { ok: true } | { error }

   ONLY THE HOST. A student closing the room out from under a seminar is not a
   thing this should be able to do, so the seat has to be the host's own.

   Closing is a flag rather than a delete: everybody still polling is told the
   table has closed instead of their browser quietly failing, and the code stops
   working for anybody who tries it afterwards.
*/

const { json, CORS, serviceKey, identify, sbPatch } = require('./_ah-table.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const me = await identify(key, body.seat_token);
  if (!me) return json(401, { error: 'not_at_this_table' });
  if (!me.seat.is_host) return json(403, { error: 'host_only' });

  const done = await sbPatch(key, 'etl_table_rooms', `id=eq.${encodeURIComponent(me.room.id)}`, { closed: true }, false);
  return done ? json(200, { ok: true }) : json(500, { error: 'could_not_close' });
};
