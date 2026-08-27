/* create-checkout-ah-addon-xl — one-time Stripe purchase of XL_ADDON_CREDITS.

   ADDED 2026-08-26 per Dr. O direct, sized for a user at Pookie's actual
   volume (real GA data: ~10 hours/week, ~2,000 credits/week). Priced at
   $60 for 2,000 credits -- Dr. O's own math, $6/hour times 10 hours -- so
   the price is directly, visibly tied to the same per-hour figure used to
   talk about value elsewhere, not a separately invented number. See
   XL_ADDON_CREDITS's own comment in _ah-credits.js for the real cost data
   behind the $6/hour figure itself. Otherwise an exact copy of
   create-checkout-ah-addon.js's own pattern: access_token optional, price
   defined inline (price_data), same success/cancel routing.

   THE ONE REAL DIFFERENCE THAT MATTERS: metadata.source is 'almost_human_
   addon_xl', not 'almost_human_addon'. verify-checkout-ah.js reads this to
   decide which credit amount to actually grant -- ADDON_CREDITS (60) or
   XL_ADDON_CREDITS (2000). Without that distinction a buyer here would pay
   $79 and receive the same 60 credits the $4.99 button grants, which is
   the bug this file exists specifically to avoid.

   POST /.netlify/functions/create-checkout-ah-addon-xl
   Body: { access_token, return_to? }
   Returns: { url }

   Success redirect: /almost-human-welcome?session_id={CHECKOUT_SESSION_ID}
   Cancel redirect:  /almost-human
*/

const Stripe = require('stripe');
const { safeToken, XL_ADDON_CREDITS } = require('./_ah-credits.js');

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

  const token = safeToken(body.access_token); // may be '' — same as the small addon
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
          product_data: { name: returnTo ? `Good Company — +${XL_ADDON_CREDITS} Credits` : `Almost Human — +${XL_ADDON_CREDITS} Credits` },
          unit_amount: 6000,
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { ah_access_token: token, source: 'almost_human_addon_xl' },
    });
  } catch (err) {
    console.error('create-checkout-ah-addon-xl stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
