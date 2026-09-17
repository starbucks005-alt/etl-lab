/* leadership-table-background -- the leaders answering a room that has real
   people in it. A Netlify Background Function (the "-background" suffix is what
   grants the longer budget), fired by leadership-table-say.js.

   POST { seat_token }

   IT RE-IDENTIFIES THE CALLER RATHER THAN TAKING A ROOM ID. A background
   function is a public URL like any other, so the room is read from the seat
   token, the same way every other endpoint at this table reads it. Nothing here
   trusts a room id from a request body.

   IT RUNS THE SAME CASCADE AS THE SOLO TABLE. runCascade lives in
   leadership-room-background.js and is imported, not copied: same director,
   same beat rules, same voice guard. The only difference is onReply, which
   writes each leader's answer into the room the moment it exists, so thirty
   people watch the table talk at the pace it is actually talking rather than
   all of it appearing at once when the last leader finishes.

   IT ALWAYS RELEASES THE LOCK. Every path, including the error path. A cascade
   that dies without releasing leaves the room busy until the deadline runs out,
   which in a class is a minute of students typing into a table that ignores
   them.
*/

const {
  serviceKey, identify, loadTranscript, insertMessage, releaseTurn,
} = require('./_ah-table.js');
const { runCascade } = require('./leadership-room-background.js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };

  const key = serviceKey();
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: 'not_configured' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const me = await identify(key, body.seat_token);
  if (!me) return { statusCode: 401, body: JSON.stringify({ error: 'not_at_this_table' }) };
  const { seat, room } = me;

  const rows = await loadTranscript(key, room.id);
  const transcript = rows.map((m) => ({
    speaker: m.speaker,
    name: m.name,
    content: m.content,
  }));

  const activeAgents = Array.isArray(room.active_agents) ? room.active_agents : [];
  const speakerName = seat.display_name || 'Student';

  try {
    const { nextAgentState } = await runCascade(
      activeAgents,
      transcript,
      speakerName,
      seat.visitor_id || null,
      key,
      room.agent_state || {},
      async (reply) => {
        await insertMessage(key, room.id, {
          speaker: reply.agent_key,
          name: reply.agent_name,
          content: reply.reply,
        });
      }
    );
    await releaseTurn(key, room.id, {
      agent_state: nextAgentState || {},
      visitor_message_count: (Number(room.visitor_message_count) || 0) + 1,
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[leadership-table-background] cascade failed:', err && err.message);
    await releaseTurn(key, room.id);
    return { statusCode: 500, body: JSON.stringify({ error: 'cascade_failed' }) };
  }
};
