/* gc-scene-order — somebody asks for a scene, and their friend's picture
   arrives with the request.
   ─────────────────────────────────────────────────────────────────────────
   POST { portrait, friend, where, from }        -> { order_id }
   GET  ?owner_key=...                           -> { orders }        owner only
   GET  ?order_id=...&owner_key=...&file=1       -> the portrait      owner only

   THE MISSING HALF OF THE ADD-ON. Scenes are made from the picture somebody
   chose, that picture lives in their browser and nowhere else, and nothing in
   this product ever sent it anywhere. So a scene could be made, and delivered,
   and there was no way for the person who wanted one to hand over the only
   thing needed to make it. Right-click and email is not a checkout.

   ORDERING SPENDS NOTHING. This writes a request and a picture into storage
   and stops. No model is called, no render starts, nothing is billed. Making
   the scene is a separate, owner-only step in gc-scene, so a stranger who
   finds this endpoint can fill a queue and cannot spend a penny. That
   separation is the whole safety property and is worth keeping if this ever
   grows a payment step: take the money, then make the thing.

   THE PICTURE LEAVES THEIR DEVICE HERE, AND ONLY HERE. Everything else in Good
   Company keeps a built friend in the browser. The room says so plainly before
   this is sent, because somebody who was told their friend lives on their own
   device deserves to be told the one moment that stops being true.
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

const STORE = 'gc_scene_orders';
const INDEX = 'index';

/* A portrait is around a megabyte once it is base64. Generous enough for the
   real thing and small enough that nobody is posting video through here. */
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
    const orderId = 'gco-' + require('crypto').randomBytes(8).toString('hex');

    /* The picture is stored on its own rather than inside the record, so the
       listing stays small enough to read in one go however many orders build
       up. */
    await store.set(orderId + '.b64', portrait, { metadata: { contentType: 'text/plain' } });

    const order = {
      order_id: orderId,
      status: 'waiting',
      friend_name: String(friend.name || '').slice(0, 60) || 'their friend',
      gender: String(friend.gender || '').slice(0, 40),
      where,
      /* However they want to be reached about it. Optional on purpose: a person
         should be able to ask for something without handing over an address. */
      from: String(body.from || '').slice(0, 120),
      asked_at: new Date().toISOString(),
      portrait_key: orderId + '.b64',
      job_id: null,
    };
    await store.setJSON(orderId, order);

    /* A list, so orders can be found without listing the whole store. Read,
       append, write: two people ordering in the same second could lose one,
       which is a queue this size not being worth a lock. */
    let index = [];
    try { index = (await store.get(INDEX, { type: 'json' })) || []; } catch (_) {}
    index.unshift(orderId);
    await store.setJSON(INDEX, index.slice(0, 500));

    return json(200, { ok: true, order_id: orderId });
  }

  /* ── everything below is owner only ────────────────────────────────────── */
  if (!isOwner) return json(403, { error: 'owner_only' });

  if (qs.order_id) {
    const order = await store.get(String(qs.order_id), { type: 'json' });
    if (!order) return json(404, { error: 'not_found' });

    if (qs.file) {
      const b64 = await store.get(order.portrait_key, { type: 'text' });
      if (!b64) return json(404, { error: 'portrait_missing' });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'image/png' },
        body: b64,
        isBase64Encoded: true,
      };
    }

    /* Marking one done, so a fulfilled order stops showing up as waiting. */
    if (event.httpMethod === 'POST' || qs.done) {
      order.status = 'made';
      order.job_id = String(qs.job_id || body.job_id || order.job_id || '') || null;
      await store.setJSON(order.order_id, order);
    }
    return json(200, { ok: true, order });
  }

  let index = [];
  try { index = (await store.get(INDEX, { type: 'json' })) || []; } catch (_) {}
  const orders = [];
  for (const id of index.slice(0, 100)) {
    const o = await store.get(id, { type: 'json' });
    if (o) orders.push(o);
  }
  return json(200, { ok: true, waiting: orders.filter(o => o.status === 'waiting').length, orders });
};
