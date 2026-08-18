/* create-checkout-ah — create a $9.99/mo Stripe subscription checkout for
   Almost Human's paid tier (removes the free daily-message cap and unlocks
   group chat). Separate product from the $19.99/mo Lab membership, no shared
   code.

   Price is defined inline (price_data), not a pre-created Stripe Dashboard
   price behind an env var — same pattern as opsec-checkout.js and
   create-checkout-session.js on this campus. Nothing to set up in the
   Stripe dashboard for this to work, just STRIPE_SECRET_KEY (already set).

   POST /.netlify/functions/create-checkout-ah
   Body: { return_to? }
   Returns: { url }

   Success redirect: /almost-human-welcome?session_id={CHECKOUT_SESSION_ID}
   Cancel redirect:  /almost-human

   RETURN_TO, ADDED 2026-08-17 for Good Company. This subscription is the
   SAME membership everywhere on the campus — a person who subscribes from
   Good Company's room should land back in that room, not on Almost Human's
   page. Optional and whitelisted to a known path shape, never trusted as a
   free-form redirect: an open redirect through a Stripe-adjacent endpoint is
   exactly the kind of thing worth never building casually. Absent, this
   behaves byte-identical to before this existed. */
const Stripe = require('stripe');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

/* Path only, no protocol, no host, no protocol-relative //. */
function safeReturnTo(v) {
  const s = String(v || '').trim();
  return /^\/good-company\/(build|room)\.html(\?[^\s]*)?$/.test(s) ? s : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const returnTo = safeReturnTo(body.return_to);

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  const successUrl = returnTo
    ? `https://emerging-tech-lab.com/almost-human-welcome?session_id={CHECKOUT_SESSION_ID}&return_to=${encodeURIComponent(returnTo)}`
    : 'https://emerging-tech-lab.com/almost-human-welcome?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = returnTo
    ? `https://emerging-tech-lab.com${returnTo}`
    : 'https://emerging-tech-lab.com/almost-human';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          recurring: { interval: 'month' },
          /* NAMED FOR WHERE THE BUYER ACTUALLY CAME FROM, added 2026-08-18.
             The membership is shared, but a Good Company visitor who has
             never heard of Almost Human should not land on a checkout page
             that appears to be selling them a different, unrelated product.
             returnTo is only ever set when the checkout started from Good
             Company (see safeReturnTo above), so this is a real signal, not
             a guess. */
          product_data: { name: returnTo ? 'Good Company — Unlimited Access' : 'Almost Human — Monthly Access' },
          unit_amount: 999,
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: { metadata: { source: 'almost_human' } },
    });
  } catch (err) {
    console.error('create-checkout-ah stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
