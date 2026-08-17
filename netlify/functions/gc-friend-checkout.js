/* gc-friend-checkout — pay to activate a built friend.
   ─────────────────────────────────────────────────────────────────────────
   POST { friend_id, friend_name } -> { url }              a Stripe Checkout session
   GET  ?session_id=...            -> { paid, friend_id }  called when they come back

   Dr. O: "we need to set the price per 'friend'." A friend lives entirely on
   the device that built them, in localStorage, with nothing server-side to
   mark paid the way a scene order is: no queue, no generation job, nothing
   this function owns. So there is no store here at all, unlike
   gc-scene-checkout. Stripe is asked whether the session paid, the friend's
   own id comes back in the metadata, and build.html is the one that writes
   paid:true onto that friend's own record, the same way it already writes
   everything else about them.

   PRICE IS INLINE, NOT AN ENV VAR, matching every other checkout on this
   campus: a price hidden behind an environment variable is a price nobody
   can find when it needs changing, set in the one place that does not get
   reviewed.

   $9.99, A PLACEHOLDER, NOT YET CONFIRMED. Following the scene price's own
   history on purpose: $4.99 started as a guess ("consistent rather than
   reasoned, it is what the Almost Human add-on charges") and Dr. O corrected
   it after weighing it against the real cost. This number is a first guess
   the same way: building a friend spends real money before this paywall is
   ever reached (up to three sets of four face draws, roughly sixty to eighty
   cents at five to seven cents a face), and unlike a scene, a friend keeps
   costing money in chat for as long as they are talked to, which a flat
   one-time price cannot really cover the way a subscription would. $9.99
   mirrors Almost Human's own $9.99/mo shape as a familiar number, not a
   worked-out figure. React to it, do not trust it.

   NO WEBHOOK, for the same reason gc-scene-checkout has none: verifying the
   session on the way back needs no new secret and no new endpoint. */

const Stripe = require('stripe');

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

/* ── THE PRICE. One place. See the note at the top before trusting it. ── */
const FRIEND_CENTS = 999;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });

  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  /* ── coming back from Stripe ───────────────────────────────────────────── */
  if (event.httpMethod === 'GET') {
    const sessionId = String(qs.session_id || '').trim();
    if (!sessionId) return json(400, { error: 'session_id_required' });

    let session;
    try { session = await stripe.checkout.sessions.retrieve(sessionId); }
    catch (err) { return json(502, { error: 'stripe_error', detail: err.message }); }

    /* STRIPE IS ASKED, NOT THE BROWSER TOLD. The only thing that comes back
       from the redirect is a session id, and whether it was paid is a
       question for Stripe. Trusting a query parameter would make this
       free. */
    const paid = session && session.payment_status === 'paid';
    const friendId = session && session.metadata && session.metadata.gc_friend_id;
    if (!friendId) return json(200, { ok: true, paid: false });
    return json(200, { ok: true, paid: !!paid, friend_id: friendId });
  }

  /* ── starting a payment ────────────────────────────────────────────────── */
  const friendId = String(body.friend_id || '').trim();
  const friendName = String(body.friend_name || '').trim().slice(0, 80);
  if (!friendId) return json(400, { error: 'friend_id_required' });

  const build = 'https://emerging-tech-lab.com/good-company/build.html';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          /* Named for what it is, without the friend's name in it: this line
             shows up on a card statement. */
          product_data: { name: 'Good Company — one friend' },
          unit_amount: FRIEND_CENTS,
        },
        quantity: 1,
      }],
      success_url: build + '?friend-paid={CHECKOUT_SESSION_ID}',
      cancel_url: build,
      /* The friend's id travels with the payment, so coming back means
         something even if they finish on a different device. */
      metadata: { gc_friend_id: friendId, gc_friend_name: friendName, source: 'good_company_friend' },
    });
  } catch (err) {
    console.error('gc-friend-checkout stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
