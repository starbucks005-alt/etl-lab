/* create-checkout-everly — a $4.99/mo Stripe subscription for Everly Castle's
   paid side.

   Same shape as create-checkout-ah.js, deliberately: price defined inline with
   price_data rather than a pre-created Dashboard price behind an env var. That
   is the pattern on this campus and it is the one that has not broken. There
   is nothing to set up in the Stripe dashboard for this to work; STRIPE_SECRET_KEY
   is already set.

   WHAT IS BEING SOLD, in the words that decide it: free is anything that costs
   no API call. Her story, her five stories, her pet, her family, her country
   are recorded once and cached by content hash, so they cost nothing to serve
   and stay free forever. This buys the part that costs a call every time: the
   princess talking to one particular child, by name, remembering them.

   POST /.netlify/functions/create-checkout-everly
   Body: {}
   Returns: { url }

   Success: /everly-castle-welcome?session_id={CHECKOUT_SESSION_ID}
   Cancel:  /everly-castle
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
          product_data: {
            name: 'Everly Castle — Monthly Access',
            description: 'The princesses talk with your child by name and remember them. The stories, pets, families and countries stay free.',
          },
          unit_amount: 499,
        },
        quantity: 1,
      }],
      success_url: 'https://emerging-tech-lab.com/everly-castle-welcome?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://emerging-tech-lab.com/everly-castle',
      subscription_data: { metadata: { source: 'everly_castle' } },
    });
  } catch (err) {
    console.error('create-checkout-everly stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
