/* gc-image-order — somebody asks for a generated still image of their
   friend, and their friend's portrait arrives with the request.
   ─────────────────────────────────────────────────────────────────────────
   POST { portrait, friend, where, from } -> { order_id }
   GET  ?owner_key=...                    -> { orders }        owner only
   GET  ?order_id=...&owner_key=...&file=1 -> the source portrait  owner only

   THE IMAGES HALF OF ADD A SCENE, added 2026-08-30. Dr. O direct: "images
   and scenes are separated" -- a still is its own kind of thing, not a
   video that happens to be short. Deliberately the plainest possible copy
   of gc-scene-order.js's own shape (place an order, spend nothing, store
   the picture separately from the record) rather than reusing that file
   with a kind flag threaded through it: Images has exactly one path in
   (describe where, pay, get a still), none of Scenes' own modes (Vimeo,
   bring-your-own-photo-to-animate), so bolting it onto that file would
   have meant a mode value every existing scene branch had to keep
   ignoring correctly forever.

   ORDERING SPENDS NOTHING, same reasoning as gc-scene-order.js's own note:
   generating the image is a separate step in gc-image-checkout's own GET,
   gated on Stripe actually reporting paid, so filling this queue costs a
   stranger nothing.
*/

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

const STORE = 'gc_image_orders';

/* Same ceiling as gc-scene-order.js's own portrait cap, same reasoning:
   generous for a real photo, small enough nobody is posting a video
   through here by mistake. */
const MAX_PORTRAIT = 3 * 1024 * 1024;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore(STORE); } catch (e) { return json(500, { error: 'store_unavailable' }); }

  const isOwner = !!process.env.OWNER_KEY &&
    String(qs.owner_key || body.owner_key || '') === process.env.OWNER_KEY;

  /* ── place an order ────────────────────────────────────────────────────── */
  if (event.httpMethod === 'POST') {
    let portrait = String(body.portrait || '').replace(/^data:image\/[a-z+]+;base64,/i, '').trim();
    if (!portrait) return json(400, { error: 'portrait_required' });
    if (portrait.length > MAX_PORTRAIT) return json(413, { error: 'portrait_too_big' });

    const where = String(body.where || '').trim().slice(0, 400);
    if (!where) return json(400, { error: 'where_required' });

    const friend = body.friend || {};
    const orderId = 'gci-' + require('crypto').randomBytes(8).toString('hex');

    await store.set(orderId + '.b64', portrait, { metadata: { contentType: 'text/plain' } });

    const order = {
      order_id: orderId,
      status: 'waiting',
      friend_name: String(friend.name || '').slice(0, 60) || 'their friend',
      gender: String(friend.gender || '').slice(0, 40),
      where,
      from: String(body.from || '').slice(0, 120),
      asked_at: new Date().toISOString(),
      portrait_key: orderId + '.b64',
      image_key: null,
    };
    await store.setJSON(orderId, order);

    return json(200, { order_id: orderId });
  }

  /* ── list / read, owner only ───────────────────────────────────────────── */
  if (event.httpMethod === 'GET') {
    if (!isOwner) return json(403, { error: 'owner_only' });

    const orderId = String(qs.order_id || '').trim();
    if (orderId && qs.file) {
      const order = await store.get(orderId, { type: 'json' });
      if (!order) return json(404, { error: 'order_not_found' });
      const data = await store.get(order.portrait_key, { type: 'text' });
      if (!data) return json(404, { error: 'file_missing' });
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'image/jpeg' }, body: data, isBase64Encoded: true };
    }

    let ids = [];
    try { ids = (await store.list()).blobs.map((b) => b.key).filter((k) => /^gci-[0-9a-f]+$/.test(k)); } catch (_) {}
    const orders = [];
    for (const id of ids) {
      const o = await store.get(id, { type: 'json' });
      if (o) orders.push(o);
    }
    orders.sort((a, b) => String(b.asked_at || '').localeCompare(String(a.asked_at || '')));
    return json(200, { orders });
  }

  return json(405, { error: 'method_not_allowed' });
};
