/* gc-friend-sync — the same companion, on a second device.
   ─────────────────────────────────────────────────────────────────────────
   POST { friend }              -> { code }
   GET  ?code=...                -> { friend }          single use, then gone

   A companion lives in one browser's localStorage and nowhere else (see
   gc-scene-order.js's own note on the same fact). That was never a bug for
   the common case of one person on one device, and became a real, GENERIC
   gap the moment anybody wanted their own friend on their phone AND their
   laptop -- nothing to do with being the owner of this site, just an
   ordinary person with two devices. This is a short-lived hop for the exact
   same JSON gc-friend.js already writes to localStorage on save, not a
   second source of truth: nothing here is ever read except at the one
   moment it moves from one device to another.

   SINGLE USE, same reasoning as gc-room-open.js's invite tokens. A code that
   still worked after being read once could sit in an old text thread or a
   screenshot indefinitely, able to plant somebody's companion on a device
   that was never meant to have it. Redeeming deletes it in the same request
   that reads it, so a code is worth exactly one trip. */

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

const STORE = 'gc_friend_sync';

/* A friend brings a portrait and however many scenes along with it, all of it
   base64 by the time it is JSON. Generous, matching the same ceiling
   gc-scene-order.js already uses for one picture, since a friend record here
   can run several times that. */
const MAX_FRIEND = 8 * 1024 * 1024;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore(STORE); } catch (e) { return json(500, { error: 'store_unavailable' }); }

  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const friend = body.friend;
    /* Same !friend.id heuristic used everywhere else this distinction is
       made (gc-chat.js, gc-room-open.js): a house demo has no id and
       nothing to carry -- it already exists, identically, on every device. */
    if (!friend || !friend.name || !friend.id) return json(400, { error: 'no_friend' });

    const raw = JSON.stringify(friend);
    if (raw.length > MAX_FRIEND) return json(413, { error: 'friend_too_big' });

    const code = require('crypto').randomBytes(12).toString('hex');
    await store.set(code, raw, { metadata: { contentType: 'application/json' } });
    return json(200, { ok: true, code });
  }

  if (event.httpMethod === 'GET') {
    const code = String(qs.code || '').trim();
    if (!/^[a-f0-9]{24}$/.test(code)) return json(400, { error: 'bad_code' });

    const raw = await store.get(code, { type: 'text' });
    if (!raw) return json(404, { error: 'not_found_or_already_used' });
    /* Deleted in the same request that reads it, so a retried or duplicated
       GET after this point sees the same 404 a stranger with an old link
       would, rather than a second live copy. */
    await store.delete(code);

    let friend;
    try { friend = JSON.parse(raw); } catch (e) { return json(500, { error: 'corrupt_record' }); }
    return json(200, { ok: true, friend });
  }

  return json(405, { error: 'method_not_allowed' });
};
