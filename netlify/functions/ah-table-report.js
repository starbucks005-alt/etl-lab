/* ah-table-report — flag a shared Almost Human table for review.

   The report half of Apple's "content reporting and blocking" pairing for
   the invite-a-friend table, the one place two real people's text becomes
   visible to each other. Block has no separate mechanism to build: there is
   no persistent identity here (no accounts, seat tokens die with the room),
   so ah-table-close.js's leave/end already IS the block-equivalent. This
   endpoint is the other half, flagging content for review without forcing
   an exit.

   Netlify Blobs rather than a new Supabase table on purpose: no migration
   to run before this can ship, and reports are read by Dr. O directly
   (ah-table-report-list.js or a Blobs browse), not queried by app code.

   POST /.netlify/functions/ah-table-report
   Body: { seat_token }
   Returns { ok: true }
*/

const { connectLambda, getStore } = require('@netlify/blobs');
const crypto = require('crypto');
const { CORS, json, serviceKey, identify, loadTranscript } = require('./_ah-table.js');

const STORE = 'ah_table_reports';

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const me = await identify(key, body.seat_token);
  if (!me) return json(401, { error: 'unknown_seat' });

  const transcript = await loadTranscript(key, me.room.id);

  const report = {
    room_id: me.room.id,
    reported_by: me.seat.is_host ? 'host' : 'guest',
    reporter_name: me.seat.display_name || null,
    transcript,
    created_at: new Date().toISOString(),
  };

  try {
    const store = getStore(STORE);
    await store.setJSON(`${me.room.id}/${crypto.randomUUID()}`, report);
  } catch (err) {
    console.error('[ah-table-report] write failed:', err && err.message);
    return json(500, { error: 'report_failed' });
  }

  return json(200, { ok: true });
};
