/* ─────────────────────────────────────────────────────────────────────────────
   founder-studio-checkout

   Creates a Stripe Checkout Session for the Founder Studio $250/mo flat build
   (PA + Six-Pack + two specialist seats to be picked after signup), started
   directly from founder-studio.html's own build flow. Founder Studio closes
   its own sale now instead of routing back to Carol's Concourse -- same
   pattern as deskworks-checkout.js. Concourse stays the connector, not the
   checkout counter, for either door.

   Reuses the existing $250 bundle price (same one staffing-checkout.js uses)
   so this is a second front door onto the same Stripe price, not a new one.

   POST { company_name, pa_persona_id, pa_display_name }
   Returns { url }

   Uses STRIPE_SECRET_KEY from Netlify env (Founders Studio account).
   ───────────────────────────────────────────────────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BUNDLE_PRICE = 'price_1TtD1IBpqKA2T6wFC2u8XVvl'; // Full Build: PA + Six-Pack + any 2 specialists, flat $250/mo

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'POST only' };

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'stripe_key_not_configured' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const companyName = String(body.company_name || '').slice(0, 100).trim();
  const paPersonaId = String(body.pa_persona_id || 'auggie_vidal').slice(0, 60).trim();
  const paDisplayName = String(body.pa_display_name || '').slice(0, 100).trim();

  const origin = 'https://emerging-tech-lab.com';
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('allow_promotion_codes', 'true');
  params.set('line_items[0][price]', BUNDLE_PRICE);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', origin + '/founder-studio.html?paid=1');
  params.set('cancel_url', origin + '/founder-studio.html?canceled=1');
  if (companyName) params.set('metadata[company_name]', companyName);
  if (paPersonaId) params.set('metadata[pa_persona_id]', paPersonaId);
  if (paDisplayName) params.set('metadata[pa_display_name]', paDisplayName);
  params.set('custom_text[submit][message]',
    'Your Studio is set up the moment this clears. Your PA walks you in from here.');

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
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e && e.message }) };
  }
};
