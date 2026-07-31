/* etl-design-checkout — one-time Stripe purchase for a finished ETL Design piece.

   POST { job_id } -> { url }

   Price is defined inline with price_data rather than a Dashboard price id
   behind an env var, matching create-checkout-ah.js, create-checkout-ah-addon.js
   and opsec-checkout.js on this campus. An env-var price is the pattern that
   silently breaks a checkout when the variable is missing in one environment.

   The job_id rides along in metadata so the webhook/verify step can mark that
   specific job paid and release the pack.
*/

const Stripe = require('stripe');

// ── The one number to change. Cents. ────────────────────────────────────────
// Kept as a single named constant, not sprinkled through copy, because a
// price written into prose rots the moment it changes.
/* $4.90, set 2026-07-31. It was $49 for one day and Dr. O: "the price,
   $49, not even close. maybe $4.90", then "4.90 per product".

   That is a different business, not just a smaller number. At $49 a buyer
   deliberates; at $4.90 nobody does, so volume carries it and the free
   preview matters less than the funnel does. Worth knowing: Stripe takes
   2.9% + $0.30, and that fixed 30 cents was 0.6% of a $49 sale but is 6% of
   this one. Compute is about 12 cents a piece, so the margin is still near
   88%. PER PRODUCT, not per set: a multi-size set is priced as a set. */
const PRICE_CENTS = 490;
const PRODUCT_NAME = 'ETL Design — finished marketing piece';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function priceLabel(cents) {
  return cents % 100 === 0 ? ('$' + (cents / 100)) : ('$' + (cents / 100).toFixed(2));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // GET returns the price so the page can display it without a number being
  // typed into copy. A price written into prose rots the moment it changes,
  // and then the page and the checkout disagree, which is worse than either.
  if (event.httpMethod === 'GET') {
    return json(200, { price_cents: PRICE_CENTS, price_label: priceLabel(PRICE_CENTS), product: PRODUCT_NAME });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const jobId = String(body.job_id || '').trim();
  if (!/^dsn-[0-9a-z-]+$/i.test(jobId)) return json(400, { error: 'job_id_required' });

  const base = process.env.URL || 'https://emerging-tech-lab.com';
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: PRODUCT_NAME },
          unit_amount: PRICE_CENTS,
        },
        quantity: 1,
      }],
      success_url: base + '/etl-design?job=' + encodeURIComponent(jobId) + '&paid=1&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  base + '/etl-design?job=' + encodeURIComponent(jobId),
      metadata: { etl_design_job: jobId, source: 'etl_design' },
    });
  } catch (err) {
    console.error('[etl-design-checkout] stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
