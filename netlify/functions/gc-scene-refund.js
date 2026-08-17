/* gc-scene-refund — give somebody their money back for a scene.
   ─────────────────────────────────────────────────────────────────────────
   POST { owner_key, order_id, why? }   -> { refunded, cents }

   A scene will come back wrong. Today proved it: the first one ever made was a
   faithful animation of a portrait that had quietly become somebody else, and
   the buyer would have paid for a stranger in their room. Selling something
   generated with no way to undo the sale is the part that would have hurt a
   real customer rather than a beta tester.

   OWNER ONLY, and deliberately not automatic. Whether a scene is wrong is a
   judgement somebody makes by looking at it, and the failure that matters here
   is subtle: not a broken file, a face that is not quite theirs. No rule
   catches that.

   IT TELLS THEM, because a refund nobody mentions reads like a mistake. If
   they left no address the money still goes back and the note says it could
   not be sent, rather than the refund being held up for want of an email.

   THE ORDER IS KEPT, marked refunded. Deleting the record would take the
   evidence of what went wrong with it, and what went wrong is the thing worth
   keeping: the picture, the words they asked for, the clip that came out.
*/

const Stripe = require('stripe');
const { getStore, connectLambda } = require('@netlify/blobs');
const notify = require('./_gc-notify.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  if (!process.env.OWNER_KEY || String(body.owner_key || '') !== process.env.OWNER_KEY) {
    return json(403, { error: 'owner_only' });
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });

  const orderId = String(body.order_id || '').trim();
  if (!/^gco-[0-9a-f-]+$/i.test(orderId)) return json(400, { error: 'order_id_required' });

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore('gc_scene_orders'); } catch (e) { return json(500, { error: 'store_unavailable' }); }

  const order = await store.get(orderId, { type: 'json' });
  if (!order) return json(404, { error: 'order_not_found' });
  if (order.status === 'refunded') return json(409, { error: 'already_refunded' });
  if (!order.session_id) {
    return json(409, { error: 'never_paid', detail: 'Nothing was charged for that order.' });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  /* The session holds the payment intent, which is what a refund is actually
     against. Asked for rather than stored, so this works on orders taken
     before anybody thought about refunds. */
  let refund;
  try {
    const session = await stripe.checkout.sessions.retrieve(order.session_id);
    if (!session || !session.payment_intent) {
      return json(409, { error: 'no_payment_intent', detail: 'Stripe has no payment on that session.' });
    }
    refund = await stripe.refunds.create({
      payment_intent: typeof session.payment_intent === 'string'
        ? session.payment_intent : session.payment_intent.id,
      reason: 'requested_by_customer',
      metadata: { gc_order_id: orderId, why: String(body.why || '').slice(0, 200) },
    });
  } catch (err) {
    console.error('[gc-scene-refund] stripe refused:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  /* Recorded before telling them, so a refund can never be invisible. */
  order.status = 'refunded';
  order.refunded_at = new Date().toISOString();
  order.refund_id = refund.id;
  order.refund_cents = refund.amount;
  order.refund_why = String(body.why || '').slice(0, 200);
  await store.setJSON(orderId, order);

  const told = await notify.refunded(order, body.why);

  return json(200, {
    ok: true,
    refunded: true,
    cents: refund.amount,
    order_id: orderId,
    told: told.sent ? told.to : null,
    told_why_not: told.sent ? null : told.reason,
  });
};
