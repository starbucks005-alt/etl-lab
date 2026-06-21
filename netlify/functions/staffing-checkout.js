/* ─────────────────────────────────────────────────────────────────────────────
   staffing-checkout

   Carol's "Finish the paperwork" rail. The proposal page POSTs the chosen
   tier + a count of specialist seats by category; this builds a Stripe
   Checkout Session (subscription mode) for exactly that team and returns
   the hosted checkout URL. Named staff live in the proposal/Studio config;
   the paperwork bills the seats.

   POST { tier: "found"|"full", counts: { mcp: 2, addon: 1, board_mcp: 1, ... } }
   -> { url }

   Uses STRIPE_SECRET_KEY from Netlify env (Founders Studio account).
   ───────────────────────────────────────────────────────────────────────── */

const PRICE = {
  starter:   'price_1Tkq8rBpqKA2T6wFQRq015eg', // Your PA + Founder Studio $99/mo
  sixpack:   'price_1Tkq9GBpqKA2T6wF6KDWOeVX', // Essential Six-Pack $99/mo
  mcp:       'price_1Tkq9zBpqKA2T6wFjIXrQp5V', // Specialist MCP (backpack) $35/mo
  addon:     'price_1Tkq9yBpqKA2T6wFA1YCZ5lZ', // Specialist Standard $25/mo
  board:     'price_1Tkq9zBpqKA2T6wFt4sxlco4', // C-Suite $45/mo
  board_mcp: 'price_1TgviyBpqKA2T6wFlKmbEegY', // C-Suite MCP $119/mo (unchanged)
  premium:   'price_1TgviyBpqKA2T6wFM7taYrQn', // Premium SLR Method $549/mo (unchanged)
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: 'stripe_key_not_configured' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const tier = body.tier === 'found' ? 'found' : 'full';
  const counts = (body.counts && typeof body.counts === 'object') ? body.counts : {};

  const origin = 'https://emerging-tech-lab.com';
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('allow_promotion_codes', 'true');
  params.set('success_url', origin + '/etl-staffing.html?paid=1');
  params.set('cancel_url', origin + '/etl-staffing.html?canceled=1');
  params.set('allow_promotion_codes', 'true');
  params.set('custom_text[submit][message]',
    'You are not checking out. You are finishing the paperwork on your staff. The moment it clears, your Studio is set up and your PA walks you in.');

  let i = 0;
  const add = (price, qty) => {
    params.set('line_items[' + i + '][price]', price);
    params.set('line_items[' + i + '][quantity]', String(qty));
    i++;
  };

  // The foundation is always the base of the paperwork.
  add(PRICE.starter, 1);
  add(PRICE.sixpack, 1);

  // Full team adds the proposed specialist seats by category.
  if (tier === 'full') {
    for (const cat of Object.keys(counts)) {
      const price = PRICE[cat];
      const qty = parseInt(counts[cat], 10) || 0;
      if (price && qty > 0 && qty <= 9) add(price, qty);
    }
  }

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const d = await r.json();
  if (!r.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: (d.error && d.error.message) || 'stripe_error' }) };
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: d.url }),
  };
};
