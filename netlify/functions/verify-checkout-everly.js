/* verify-checkout-everly — turn a completed Stripe checkout into an access
   token for Everly Castle.

   POST /.netlify/functions/verify-checkout-everly
   Body: { session_id }
   Returns: { ok: true, access_token } or { ok: false, error }

   Order matters, and it is the same order verify-checkout-ah.js uses:

   1. Idempotency FIRST. A session already turned into a token returns that
      same token rather than minting a second one. A parent who reloads the
      welcome page must not end up with two subscriptions' worth of tokens for
      one payment.
   2. Fetch the session from Stripe. Authoritative: a crafted session_id gets
      nothing, because the answer comes from Stripe rather than from the body.
   3. Require payment_status === 'paid'. Nothing else counts, including
      'no_payment_required' and 'unpaid'.
*/

const Stripe = require('stripe');
const access = require('./_everly-access');

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
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'bad_json' }); }
  const session_id = String(body.session_id || '').trim();
  if (!session_id) return json(400, { ok: false, error: 'missing_session_id' });

  /* 1. Already done? Return the same token. */
  try {
    const existing = await access.tokenForSession(event, session_id);
    if (existing) return json(200, { ok: true, access_token: existing, repeat: true });
  } catch (err) {
    console.error('verify-checkout-everly idempotency check failed:', err && err.message);
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { ok: false, error: 'config', missing: 'STRIPE_SECRET_KEY' });
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  /* 2. Ask Stripe, not the caller. */
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch (err) {
    console.error('verify-checkout-everly retrieve failed:', err && err.message);
    return json(404, { ok: false, error: 'unknown_session' });
  }

  /* 3. Paid, or nothing. */
  if (session.payment_status !== 'paid') {
    return json(402, { ok: false, error: 'not_paid', payment_status: session.payment_status });
  }

  let token;
  try {
    token = await access.grant(event, {
      session_id,
      customer: session.customer || null,
      subscription: session.subscription || null,
    });
  } catch (err) {
    console.error('verify-checkout-everly grant failed:', err && err.message);
    return json(500, { ok: false, error: 'grant_failed' });
  }

  return json(200, { ok: true, access_token: token });
};
