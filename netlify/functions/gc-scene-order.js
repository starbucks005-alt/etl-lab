/* gc-scene-order — somebody asks for a scene, and their friend's picture
   arrives with the request.
   ─────────────────────────────────────────────────────────────────────────
   POST { portrait, friend, where, from }                    -> { order_id }
   POST { portrait, friend, mode:'own', own_vimeo_id, own_thumb?, from }
   POST { portrait, friend, mode:'own', own_photo, where?, from }
   GET  ?owner_key=...                           -> { orders }        owner only
   GET  ?order_id=...&owner_key=...&file=1       -> the portrait      owner only
   GET  ?order_id=...&owner_key=...&file=ownphoto -> their own photo  owner only
   GET  ?order_id=...&thumb=1                    -> their own thumb   PUBLIC

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

   "I ALREADY HAVE MY OWN," added 2026-08-20. Dr. O, after a real Veo scene
   came out good but with an action ("holding a small bottle up") that read
   as repetitive on a loop, and after uploading her own already-made video by
   hand for Isabelle three separate times this same day, each requiring me to
   do it for her: "did you make the change where they can add an image or a
   video?" Real, correct gap -- the only path was ever "describe it, Veo
   makes it." mode:'own' is the second path: either a Vimeo id (their own
   video, hosted already, no Veo involved at all) or their own photo (used as
   the Veo source in place of their friend's stored portrait, the same thing
   the crafting-photo test proved works). where stays required for the
   generate path and becomes optional context for the own path -- there is
   nothing to describe when the thing already exists. */

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

/* A numeric Vimeo id only -- same shape room.html's own add-scene handler
   already requires (vimeo:<digits>), checked again here so a malformed id
   never even reaches an order record. */
const VIMEO_ID = /^\d{4,12}$/;

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

    /* mode:'own' means they already have the thing -- a Vimeo video, their
       own photo, or both. where is what they are actually asking for in
       every other mode, and stays required there; it is just context here,
       since there is nothing left to describe. */
    const mode = body.mode === 'own' ? 'own' : 'generate';
    const where = String(body.where || '').trim().slice(0, 400);
    if (mode === 'generate' && !where) return json(400, { error: 'where_required' });

    /* LANDSCAPE OR PORTRAIT, added 2026-08-30, Dr. O direct: "there has to
       be an option for landscape or portrait image/scene." Same two-value
       shape as gc-scene.js's own aspect handling; anything else collapses
       to null so gc-scene.js's own default (16:9) applies rather than
       storing something it would not recognize. */
    const aspect = /^9:16$/.test(String(body.aspect || '')) ? '9:16' : null;

    let ownVimeoId = null, ownPhoto = null, ownThumb = null;
    if (mode === 'own') {
      const rawVimeo = String(body.own_vimeo_id || '').trim();
      if (rawVimeo) {
        if (!VIMEO_ID.test(rawVimeo)) return json(400, { error: 'own_vimeo_id_invalid' });
        ownVimeoId = rawVimeo;
      }
      ownPhoto = String(body.own_photo || '').replace(/^data:image\/[a-z+]+;base64,/i, '').trim() || null;
      if (ownPhoto && ownPhoto.length > MAX_PORTRAIT) return json(413, { error: 'own_photo_too_big' });
      ownThumb = String(body.own_thumb || '').replace(/^data:image\/[a-z+]+;base64,/i, '').trim() || null;
      if (ownThumb && ownThumb.length > MAX_PORTRAIT) return json(413, { error: 'own_thumb_too_big' });
      if (!ownVimeoId && !ownPhoto) return json(400, { error: 'own_vimeo_id_or_own_photo_required' });
    }

    const friend = body.friend || {};
    const orderId = 'gco-' + require('crypto').randomBytes(8).toString('hex');

    /* The picture is stored on its own rather than inside the record, so the
       listing stays small enough to read in one go however many orders build
       up. */
    await store.set(orderId + '.b64', portrait, { metadata: { contentType: 'text/plain' } });
    if (ownPhoto) await store.set(orderId + '.ownphoto', ownPhoto, { metadata: { contentType: 'text/plain' } });
    if (ownThumb) await store.set(orderId + '.ownthumb', ownThumb, { metadata: { contentType: 'text/plain' } });

    const order = {
      order_id: orderId,
      status: 'waiting',
      friend_name: String(friend.name || '').slice(0, 60) || 'their friend',
      gender: String(friend.gender || '').slice(0, 40),
      where,
      aspect,
      mode,
      own_vimeo_id: ownVimeoId,
      own_photo_key: ownPhoto ? orderId + '.ownphoto' : null,
      own_thumb_key: ownThumb ? orderId + '.ownthumb' : null,
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

  /* ── THE THUMBNAIL, PUBLIC ─────────────────────────────────────────────────
     Deliberately outside the owner gate below, same reasoning gc-scene.js's
     own file-serving already uses for a finished video: this is a picture
     already paid for, on its way into somebody's room, and every visitor to
     that room needs to load it, not just the owner. No secret in this link
     for the same reason -- an order id is not a credential, it is a lookup
     key for a public image. */
  if (qs.order_id && qs.thumb) {
    const order = await store.get(String(qs.order_id), { type: 'json' });
    if (!order || !order.own_thumb_key) return json(404, { error: 'not_found' });
    const b64 = await store.get(order.own_thumb_key, { type: 'text' });
    if (!b64) return json(404, { error: 'thumb_missing' });
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: b64,
      isBase64Encoded: true,
    };
  }

  /* ── everything below is owner only ────────────────────────────────────── */
  if (!isOwner) return json(403, { error: 'owner_only' });

  if (qs.order_id) {
    const order = await store.get(String(qs.order_id), { type: 'json' });
    if (!order) return json(404, { error: 'not_found' });

    if (qs.file === 'ownphoto') {
      if (!order.own_photo_key) return json(404, { error: 'no_own_photo_on_this_order' });
      const b64 = await store.get(order.own_photo_key, { type: 'text' });
      if (!b64) return json(404, { error: 'own_photo_missing' });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'image/jpeg' },
        body: b64,
        isBase64Encoded: true,
      };
    }

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
