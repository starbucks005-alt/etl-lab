/* create-checkout-ah — create a $9.99/mo Stripe subscription checkout for
   Almost Human's paid tier (removes the free daily-message cap and unlocks
   group chat). Separate product from the $19.99/mo Lab membership, no shared
   code.

   Price is defined inline (price_data), not a pre-created Stripe Dashboard
   price behind an env var — same pattern as opsec-checkout.js and
   create-checkout-session.js on this campus. Nothing to set up in the
   Stripe dashboard for this to work, just STRIPE_SECRET_KEY (already set).

   POST /.netlify/functions/create-checkout-ah
   Body: {}
   Returns: { url }

   Success redirect: /almost-human-welcome?session_id={CHECKOUT_SESSION_ID}
   Cancel redirect:  /almost-human
*/

const Stripe = require('stripe');

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

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          recurring: { interval: 'month' },
          product_data: { name: 'Almost Human — Monthly Access' },
          unit_amount: 999,
        },
        quantity: 1,
      }],
      success_url: 'https://emerging-tech-lab.com/almost-human-welcome?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://emerging-tech-lab.com/almost-human',
      subscription_data: { metadata: { source: 'almost_human' } },
    });
  } catch (err) {
    console.error('create-checkout-ah stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
