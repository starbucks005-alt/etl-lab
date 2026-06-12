/* ─────────────────────────────────────────────────────────────────────────────
   carols-office-checkout

   Creates a Stripe Checkout Session for a Carol's Office desk rental.
   $199/mo recurring subscription. Returns the hosted checkout URL.

   POST { company_name?, contact_name? }
   Returns { url }

   Env: STRIPE_SECRET_KEY, CAROLS_OFFICE_PRICE_ID
   (Create a $199/mo recurring price in Stripe, paste the price_xxx ID as
   CAROLS_OFFICE_PRICE_ID in Netlify site settings.)
   ───────────────────────────────────────────────────────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'POST only' };

  const key = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.CAROLS_OFFICE_PRICE_ID;
  if (!key) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'stripe_key_not_configured' }) };
  if (!priceId) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'CAROLS_OFFICE_PRICE_ID not set in Netlify env — create a $199/mo price in Stripe and paste the ID' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const company = String(body.company_name || '').slice(0, 100).trim();
  const contact = String(body.contact_name || '').slice(0, 100).trim();

  const origin = 'https://emerging-tech-lab.com';
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('allow_promotion_codes', 'true');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', origin + '/carols-office-desk.html?session_id={CHECKOUT_SESSION_ID}');
  params.set('cancel_url', origin + '/carols-office.html?canceled=1');
  if (company) params.set('metadata[company_name]', company);
  if (contact) params.set('metadata[contact_name]', contact);
  params.set('custom_text[submit][message]',
    'Your desk is ready the moment this clears. Carol will be at the front desk when you arrive.');

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const session = await r.json();
    if (!r.ok) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: (session.error && session.error.message) || 'stripe error' }) };
    }
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e && e.message }) };
  }
};
