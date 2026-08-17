/* gc-scene-checkout — pay for a scene, and prove it was paid for.
   ─────────────────────────────────────────────────────────────────────────
   POST { order_id }        -> { url }      a Stripe Checkout session
   GET  ?session_id=...     -> { paid }     called when they come back

   TAKE THE MONEY, THEN MAKE THE THING. gc-scene-order already writes the
   request and the picture without spending anything, and gc-scene will not
   render until an order is marked paid. This is the piece between them, and
   the order of those three is the point: a queue can fill up for free, and
   nothing is ever generated for somebody who did not pay for it.

   PRICE IS INLINE, NOT A DASHBOARD ID AND NOT AN ENV VAR. Same as every other
   checkout on this campus. A price hidden behind an environment variable is a
   price nobody can find when it needs changing, and it is set in the one place
   that does not get reviewed.

   THE AMOUNT BELOW IS MY GUESS AND SHOULD BE CHECKED. A four second clip costs
   about twenty cents to make on the Lite tier, and $4.99 is what the Almost
   Human add-on charges, so it is consistent rather than reasoned. Dr. O has not
   set a price for this. One constant, one place to change it.

   NO WEBHOOK. Verifying the session on the way back needs no new secret and no
   new endpoint registered with Stripe, and this is a queue somebody works
   through by hand rather than an instant unlock. If a buyer closes the tab
   before returning, the session is still there and can be checked again by id.
*/

const Stripe = require('stripe');
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

/* ── THE PRICE. One place. See the note at the top before changing it. ── */
const SCENE_CENTS = 499;

const ORDERS = 'gc_scene_orders';

/* ── TELLING SOMEBODY AN ORDER CAME IN ───────────────────────────────────────
   Moved into _gc-notify.js so gc-notify-test can send the REAL email rather
   than a copy of it. A test that duplicates the code tests the duplicate: it
   would pass with a valid key and a broken sender. One function, two callers.

   ON PAYMENT, NOT ON ORDER. Asking is free and commits nobody, so an unpaid
   order is interest. A paid one is a person waiting for a thing they bought. */
const notify = require('./_gc-notify.js');

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

    /* STRIPE IS ASKED, NOT THE BROWSER TOLD. The only thing that comes back
       from the redirect is a session id, and whether it was paid is a question
       for Stripe. Trusting a query parameter would make this free. */
    const paid = session && session.payment_status === 'paid';
    const orderId = session && session.metadata && session.metadata.gc_order_id;
    if (!paid || !orderId) return json(200, { ok: true, paid: false });

    const order = await store.get(orderId, { type: 'json' });
    if (!order) return json(404, { error: 'order_not_found' });

    if (order.status === 'waiting') {
      order.status = 'paid';
      order.paid_at = new Date().toISOString();
      order.paid_cents = session.amount_total || SCENE_CENTS;
      order.session_id = sessionId;
      await store.setJSON(orderId, order);

      /* Inside the status check on purpose, so refreshing the page they land on
         does not send the same note again. Saved first, told second: if the
         mail goes and the save does not, an order is paid for and invisible. */
      await notify.orderPaid(order);
    }
    return json(200, { ok: true, paid: true, order_id: orderId, friend_name: order.friend_name });
  }

  /* ── starting a payment ────────────────────────────────────────────────── */
  const orderId = String(body.order_id || '').trim();
  if (!/^gco-[0-9a-f]+$/i.test(orderId)) return json(400, { error: 'order_id_required' });

  const order = await store.get(orderId, { type: 'json' });
  if (!order) return json(404, { error: 'order_not_found' });
  if (order.status !== 'waiting') return json(409, { error: 'already_' + order.status });

  const room = 'https://emerging-tech-lab.com/good-company/room.html';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          /* Named for what it is, without the friend's name in it: this line
             shows up on a card statement. */
          product_data: { name: 'Good Company — one scene' },
          unit_amount: SCENE_CENTS,
        },
        quantity: 1,
      }],
      success_url: room + '?scene-paid={CHECKOUT_SESSION_ID}&who=mine',
      cancel_url: room + '?who=mine',
      /* The order id travels with the payment, so coming back means something
         even if they finish on a different device. */
      metadata: { gc_order_id: orderId, source: 'good_company_scene' },
    });
  } catch (err) {
    console.error('gc-scene-checkout stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
