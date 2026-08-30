/* gc-favorites-list — Dr. O's own view of which companions get starred.

   ADDED 2026-08-30, the read side of gc-favorite.js. Owner-only: a raw
   popularity count per companion is not something a stranger needs to
   see, and showing it publicly would turn a lightweight planning signal
   into a leaderboard people could game. Same GC_OWNER_KEY / campus
   owner-key check every other admin-only Good Company function already
   uses (see gc-chat.js's own identical comment on why a second,
   dedicated key exists alongside the shared campus one).

   POST /.netlify/functions/gc-favorites-list
   Body: { owner_key }
   Returns: { ok: true, favorites: [{ id, count }, ...] } sorted highest
   first, or { ok: false, error }
*/

const { getStore, connectLambda } = require('@netlify/blobs');
const { ownerUser } = require('./_owner-auth.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const rawOwnerKey = String(body.owner_key || '').trim();
  const gcOwnerKey = String(process.env.GC_OWNER_KEY || '').trim();
  const isOwner = !!ownerUser(rawOwnerKey) || (!!gcOwnerKey && rawOwnerKey === gcOwnerKey);
  if (!isOwner) return json(403, { error: 'owner_only' });

  try { connectLambda(event); } catch (_) {}
  let tallies = {};
  try { tallies = (await getStore('gc_favorites').get('index', { type: 'json' })) || {}; } catch (_) {}

  /* ZERO-COUNT ENTRIES DROPPED, added 2026-08-30. Unfavoriting sets a
     count to 0, it never removes the key -- a spam-tested id (or a real
     one everyone later unstarred) stayed listed forever, just reading
     "0", since nothing here ever filtered it back out. */
  const favorites = Object.keys(tallies)
    .map((id) => ({ id, count: tallies[id] || 0 }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);

  return json(200, { ok: true, favorites });
};
