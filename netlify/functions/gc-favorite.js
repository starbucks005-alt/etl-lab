/* gc-favorite — a visitor stars or unstars a companion on the homepage.

   ADDED 2026-08-30 per Dr. O direct: "a way for visitors to star their
   favorites that we can tally so we know the direction we should go to
   build more (younger vs older/more character vs human)." No login, no
   account -- anyone browsing the homepage can star a card, the same "no
   wall before the thing that matters" reasoning every other free action
   on this campus follows.

   ONE JSON BLOB, SAME SHAPE AS THE CATALOG. { companionId: count } as a
   single Blobs value, same "store some JSON, no relational needs" pattern
   gc-catalog-add.js already uses -- ~21 companions today, nowhere near
   the size where a single read-modify-write per star becomes a real
   contention problem.

   ONE STAR PER VISITOR PER COMPANION IS ENFORCED CLIENT-SIDE ONLY
   (localStorage on index.html), not here. This function trusts the
   action it is sent; it is a lightweight interest signal for Dr. O's own
   planning, not a security boundary, and a determined visitor could
   always inflate a count by clearing storage the same way the daily cap
   could before today's other fix. Not worth building the same dual-key
   defense for a number nobody's cost or access depends on.

   POST /.netlify/functions/gc-favorite
   Body: { companion_id, action: 'add' | 'remove' }
   Returns: { ok: true, count } or { ok: false, error }
*/

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function safeCompanionId(v) {
  const s = String(v || '').trim();
  return /^[a-zA-Z0-9_-]{1,40}$/.test(s) ? s : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const companionId = safeCompanionId(body.companion_id);
  const action = body.action === 'remove' ? 'remove' : 'add';
  if (!companionId) return json(400, { error: 'companion_id_required' });

  try { connectLambda(event); } catch (_) {}
  const store = getStore('gc_favorites');

  let tallies = {};
  try { tallies = (await store.get('index', { type: 'json' })) || {}; } catch (_) {}

  const current = tallies[companionId] || 0;
  const next = action === 'add' ? current + 1 : Math.max(0, current - 1);
  tallies[companionId] = next;

  try { await store.setJSON('index', tallies); } catch (err) {
    return json(502, { error: 'store_unreachable', detail: String(err && err.message || err).slice(0, 200) });
  }

  return json(200, { ok: true, count: next });
};
