/* leadership-table-say -- somebody at the classroom table says something, and
   the leaders answer the room.

   POST /.netlify/functions/leadership-table-say
   Body: { seat_token, message }
   Returns { ok: true } | { busy: true } | { error }

   ONE CASCADE AT A TIME. Thirty students in a room means two of them type at
   once, every single class. The turn lock in _ah-table.js is what stops the
   second one starting a second cascade from a transcript that is about to
   change underneath it: whoever claims it runs, and the other is told the table
   is busy and can send again in a moment. Held as a deadline, so a cascade that
   dies frees the room on its own.

   THE MESSAGE IS ONLY WRITTEN IF THE LOCK IS WON. Writing it anyway would leave
   a student's question sitting in the room with nobody ever answering it, which
   looks exactly like being ignored.

   The cascade itself runs in leadership-table-background.js, because the
   leaders take longer than a synchronous function is allowed to take. This
   endpoint returns the moment the question is in the room, so everyone sees it
   land while the answers are still being written.
*/

const {
  json, CORS, serviceKey, identify, insertMessage,
  claimTurn, releaseTurn, roomIsUsable,
} = require('./_ah-table.js');

const MAX_MESSAGE_CHARS = 2000;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });
  if (!process.env.ETL_CLASSROOMS_API_KEY) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const me = await identify(key, body.seat_token);
  if (!me) return json(401, { error: 'not_at_this_table' });
  const { seat, room } = me;

  const usable = roomIsUsable(room);
  if (!usable.ok) return json(410, { error: usable.reason });

  const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return json(400, { error: 'message_required' });

  const activeAgents = Array.isArray(room.active_agents) ? room.active_agents : [];
  if (activeAgents.length < 2) return json(409, { error: 'table_needs_two_leaders' });

  if (!await claimTurn(key, room.id)) return json(200, { busy: true });

  const speakerName = seat.display_name || 'Student';
  const written = await insertMessage(key, room.id, {
    speaker: 'visitor',
    authorId: seat.id,
    name: speakerName,
    content: message,
  });
  if (!written) {
    await releaseTurn(key, room.id);
    return json(500, { error: 'could_not_write' });
  }

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) {
    await releaseTurn(key, room.id);
    return json(500, { error: 'no_base_url' });
  }

  try {
    // Fire and forget. The background function holds the lock from here and is
    // the only thing that releases it, including on its own error path.
    await fetch(base + '/.netlify/functions/leadership-table-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat_token: body.seat_token }),
    });
  } catch (err) {
    console.error('[leadership-table-say] could not start the cascade:', err && err.message);
    await releaseTurn(key, room.id);
    return json(502, { error: 'could_not_start' });
  }

  return json(200, { ok: true, said_at: written.created_at });
};
