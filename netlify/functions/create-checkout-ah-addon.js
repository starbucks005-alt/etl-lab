/* create-checkout-ah-addon — one-time Stripe purchase that tops up an
   existing Almost Human subscriber's credit balance by ADDON_CREDITS. Not a
   standalone way to get access: requires an existing access_token already
   issued by create-checkout-ah's subscription flow, passed through as
   Checkout metadata so verify-checkout-ah.js knows which row to credit.

   Price is defined inline (price_data), not a pre-created Stripe Dashboard
   price behind an env var — same pattern as create-checkout-ah.js and
   opsec-checkout.js on this campus.

   POST /.netlify/functions/create-checkout-ah-addon
   Body: { access_token, return_to? }
   Returns: { url }

   Success redirect: /almost-human-welcome?session_id={CHECKOUT_SESSION_ID}
   Cancel redirect:  /almost-human

   RETURN_TO: same as create-checkout-ah.js's own note — optional, whitelisted
   to a known path shape, absent behaves exactly as before. Lets a Good
   Company user topping up credits land back in their room instead of on
   Almost Human's page, since it is the same shared balance either way.
*/

const Stripe = require('stripe');
const { safeToken, ADDON_CREDITS } = require('./_ah-credits.js');

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

  const token = safeToken(body.access_token);
  if (!token) return json(400, { error: 'access_token_required' });
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
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          /* NAMED FOR WHERE THE BUYER CAME FROM, same reasoning as
             create-checkout-ah.js's own note, added 2026-08-18. */
          product_data: { name: returnTo ? `Good Company — +${ADDON_CREDITS} Credits` : `Almost Human — +${ADDON_CREDITS} Credits` },
          unit_amount: 499,
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { ah_access_token: token, source: 'almost_human_addon' },
    });
  } catch (err) {
    console.error('create-checkout-ah-addon stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
