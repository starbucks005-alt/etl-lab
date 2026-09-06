/* gc-image-checkout — pay for a generated still, and make it the moment
   Stripe confirms.
   ─────────────────────────────────────────────────────────────────────────
   POST { order_id, return_to? } -> { url }      a Stripe Checkout session
   GET  ?session_id=...          -> { ok, paid, order_id, friend_name,
                                       ready, image_url }

   TAKE THE MONEY, THEN MAKE THE THING, same order as every other checkout
   on this campus. Different from gc-scene-checkout.js in the one way that
   actually matters: a still edit (Gemini, seconds) fits comfortably inside
   one synchronous function call, where a Veo render (minutes) never could
   -- see gc-scene.js's own header note on exactly why THAT one needs a
   job/poll shape at all. So this GET does not just confirm payment and
   auto-start a job somewhere else; it confirms payment and finishes the
   whole thing in the same request, no polling, no separate delivery step
   to wire up.

   $4.99, SAME FLAT PRICE AS A SCENE, on purpose -- Dr. O's own "simple":
   one price for anything generated, whether it renders in three seconds
   or three minutes, rather than a second number for the room to explain.
*/

const Stripe = require('stripe');
const { getStore, connectLambda } = require('@netlify/blobs');
const Anthropic = require('@anthropic-ai/sdk');
const gemini = require('./_gemini-image.js');
const { addSceneToDemo } = require('./gc-demo-scenes.js');
const { sceneRequestIsFitFor, fitErrorBody } = require('./_gc-scene-fit.js');

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

/* ── THE PRICE. One place, same as every other checkout on this campus. ── */
const IMAGE_CENTS = 499;

const ORDERS = 'gc_image_orders';

/* SAME SHAPE AS gc-scene.js's OWN scenePrompt(), deliberately simpler: a
   still has no loop to close, no camera to hold static across a seam, no
   "no talking" to say -- none of that is a real risk for one frame. What
   carries over is the one instruction that matters most for a companion
   specifically: keep them recognizable. See gc-scene.js's own note on
   "DO NOT CHANGE HIS LOOKS" for why that line exists at all. */
function imagePrompt({ where, gender }) {
  const g = String(gender || '').toLowerCase();
  const isWoman = /woman|female|she/.test(g);
  const isMan = !isWoman && /man|male|\bhe\b/.test(g);
  const subject = isWoman ? 'this woman' : isMan ? 'this man' : 'this person';
  const their = isWoman ? 'her' : isMan ? 'his' : 'their';

  return 'A real photograph of ' + subject + ' ' + String(where).trim().replace(/\.$/, '') + '. ' +
    'Natural lighting, candid and present, not a studio portrait. ' +
    'Do not change ' + their + ' looks -- same face, same person, exactly as shown.';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });

  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore(ORDERS); } catch (e) { return json(500, { error: 'store_unavailable' }); }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  /* ── coming back from Stripe ───────────────────────────────────────────── */
  if (event.httpMethod === 'GET') {
    const sessionId = String(qs.session_id || '').trim();
    if (!sessionId) return json(400, { error: 'session_id_required' });

    let session;
    try { session = await stripe.checkout.sessions.retrieve(sessionId); }
    catch (err) { return json(502, { error: 'stripe_error', detail: err.message }); }

    const paid = session && session.payment_status === 'paid';
    const orderId = session && session.metadata && session.metadata.gi_order_id;
    if (!paid || !orderId) return json(200, { ok: true, paid: false });

    const order = await store.get(orderId, { type: 'json' });
    if (!order) return json(404, { error: 'order_not_found' });

    if (order.status === 'waiting') {
      order.status = 'paid';
      order.paid_at = new Date().toISOString();
      order.paid_cents = session.amount_total || IMAGE_CENTS;
      order.session_id = sessionId;
      await store.setJSON(orderId, order);
    }

    /* MADE HERE, NOW, ONCE -- guarded on image_key so a page reload after
       paying cannot generate (and get billed toward the Gemini key) a
       second time for the same order. */
    if (!order.image_key) {
      /* NOT A ROMANCE SITE, checked here, after payment, same timing this
         file already used for every other reason generation can fail --
         see _gc-scene-fit.js's own note on the rule itself. WORTH KNOWING:
         this runs after Stripe has already been charged, same as a
         technical generation failure below already does, and neither path
         issues a refund automatically. A content refusal is a different
         kind of failure than an unreachable model, and whether it should
         auto-refund is a real open question, not something decided here. */
      const fit = await sceneRequestIsFitFor(Anthropic, order.where, !!order.demo_id);
      if (!fit.ok) {
        order.status = 'refused';
        order.refused_reason = fit.reason;
        await store.setJSON(orderId, order);
        return json(200, { ok: true, paid: true, order_id: orderId, ready: false, ...fitErrorBody(fit.reason) });
      }

      let portrait = '';
      try { portrait = String(await store.get(order.portrait_key, { type: 'text' }) || '').trim(); } catch (_) {}
      if (!portrait) return json(500, { error: 'portrait_missing' });

      const prompt = imagePrompt({ where: order.where, gender: order.gender });
      let resultB64;
      try {
        resultB64 = await gemini.edit(portrait, prompt, 'image/jpeg');
      } catch (err) {
        console.error('gc-image-checkout: generation failed:', err.message);
        return json(502, { ok: true, paid: true, order_id: orderId, ready: false,
          error: 'Could not make it just now. Nothing extra was charged -- try again in a moment.' });
      }

      await store.set(orderId + '.png', Buffer.from(resultB64, 'base64'), { metadata: { contentType: 'image/png' } });
      order.image_key = orderId + '.png';
      order.status = 'made';
      order.made_at = new Date().toISOString();
      await store.setJSON(orderId, order);
    }

    const imageUrl = '/.netlify/functions/gc-image?order_id=' + orderId + '&file=1';
    /* SHARED COMPANION: goes straight into gc-demo-scenes.js, same reasoning
       as gc-scene.js's own identical branch -- every visitor's next page
       load should find it, not just the buyer's own browser. */
    if (order.demo_id) {
      await addSceneToDemo(order.demo_id, { label: 'A new image', still: imageUrl });
    }

    return json(200, {
      ok: true, paid: true, order_id: orderId, friend_name: order.friend_name,
      ready: true, image_url: imageUrl, shared: !!order.demo_id,
    });
  }

  /* ── starting a payment ────────────────────────────────────────────────── */
  const orderId = String(body.order_id || '').trim();
  if (!/^gci-[0-9a-f]+$/i.test(orderId)) return json(400, { error: 'order_id_required' });

  const order = await store.get(orderId, { type: 'json' });
  if (!order) return json(404, { error: 'order_not_found' });
  if (order.status !== 'waiting') return json(409, { error: 'already_' + order.status });

  const room = 'https://emerging-tech-lab.com/good-company/room.html';

  /* A RECEIPT, IF THEY GAVE US SOMEWHERE TO SEND IT -- same reasoning and
     same shape as gc-scene-checkout.js's own identical note: Stripe's own
     receipt, forced to this specific address via payment_intent_data
     regardless of the account-wide dashboard setting, separate from
     notify.sceneReady's delivery email. */
  const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const receiptEmail = EMAIL_SHAPE.test(order.from) ? order.from : null;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Good Company — one image' },
          unit_amount: IMAGE_CENTS,
        },
        quantity: 1,
      }],
      success_url: room + '?image-paid={CHECKOUT_SESSION_ID}&who=mine',
      cancel_url: room + '?who=mine',
      metadata: { gi_order_id: orderId, source: 'good_company_image' },
      ...(receiptEmail ? { payment_intent_data: { receipt_email: receiptEmail } } : {}),
    });
  } catch (err) {
    console.error('gc-image-checkout stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
