/* create-checkout-etl — create a $19.99/mo Stripe subscription checkout for ETL membership.

   POST /.netlify/functions/create-checkout-etl
   Body: { email? }
   Returns: { url }

   Env required:
   - STRIPE_SECRET_KEY        (already set)
   - ETL_MEMBERSHIP_PRICE_ID  (create in Stripe dashboard: $19.99/mo recurring, add to Netlify env)

   Success redirect: /member-welcome?session_id={CHECKOUT_SESSION_ID}
   Cancel redirect:  /member-login
*/

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
  const priceId   = process.env.ETL_MEMBERSHIP_PRICE_ID;
  if (!stripeKey || !priceId) return json(500, { error: 'config', missing: !priceId ? 'ETL_MEMBERSHIP_PRICE_ID' : 'STRIPE_SECRET_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: 'https://emerging-tech-lab.com/member-welcome?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://emerging-tech-lab.com/member-login',
    'subscription_data[metadata][source]': 'etl_membership',
    // Founding-roll recognition question; stripe-supporter-webhook records the answer
    'custom_fields[0][key]': 'public_name',
    'custom_fields[0][label][type]': 'custom',
    'custom_fields[0][label][custom]': 'Public name (blank = stay anonymous)',
    'custom_fields[0][type]': 'text',
    'custom_fields[0][optional]': 'true',
  });

  if (body.email) params.set('customer_email', body.email);

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await r.json();
  if (!r.ok) return json(502, { error: session.error && session.error.message || 'stripe_error' });

  return json(200, { url: session.url });
};
