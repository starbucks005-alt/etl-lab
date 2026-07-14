/* ─────────────────────────────────────────────────────────────────────────────
   staffing-checkout

   Carol's "Finish the paperwork" rail. The proposal page POSTs the chosen
   tier + a count of specialist seats by category; this builds a Stripe
   Checkout Session (subscription mode) for exactly that team and returns
   the hosted checkout URL. Named staff live in the proposal/Studio config;
   the paperwork bills the seats.

   The "full" tier's first BUNDLE_SPECIALIST_SEATS specialist picks (mcp or
   addon, any mix, customer's choice — no restriction between backpack and
   standard) are billed as one flat $250/mo bundle price rather than
   itemized separately — added 2026-07-14 so the marketing "$250/mo, pick
   any 2 specialists" claim is the actual charge, not just a round number
   sitting next to itemized math that didn't match it. Specialists beyond
   that count, and C-Suite/C-Suite MCP/Premium seats (Ivy's SLR Method
   tier included), are always itemized separately at real price — those
   are deliberately excluded from the flat bundle regardless of specialist
   count, confirmed 2026-07-14.

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
  bundle:    'price_1TtD1IBpqKA2T6wFC2u8XVvl', // Full Build: PA + Six-Pack + any 2 specialists (mcp or addon, any mix), flat $250/mo
};

// The flat bundle covers this many specialist seats, picked from either
// specialist tier (backpack or standard, customer's choice, no restriction).
// Anything beyond this count is billed as an individual add-on at its real
// price, same as before. C-Suite / C-Suite MCP / Premium are never part of
// the flat bundle, always itemized separately regardless of specialist count.
const BUNDLE_SPECIALIST_SEATS = 2;
const SPECIALIST_CATS = ['mcp', 'addon'];
const ALWAYS_ITEMIZED_CATS = ['board', 'board_mcp', 'premium'];

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

  if (tier === 'full') {
    // Flatten the two specialist categories into individual seats (e.g.
    // { mcp: 2, addon: 1 } -> ['mcp','mcp','addon']) so the first
    // BUNDLE_SPECIALIST_SEATS picks, in whatever mix the customer chose,
    // are covered by the flat bundle price.
    const specialistPicks = [];
    for (const cat of SPECIALIST_CATS) {
      const qty = parseInt(counts[cat], 10) || 0;
      if (qty > 0 && qty <= 9) for (let n = 0; n < qty; n++) specialistPicks.push(cat);
    }

    if (specialistPicks.length >= BUNDLE_SPECIALIST_SEATS) {
      add(PRICE.bundle, 1);
      const extraCounts = {};
      specialistPicks.slice(BUNDLE_SPECIALIST_SEATS).forEach((cat) => {
        extraCounts[cat] = (extraCounts[cat] || 0) + 1;
      });
      for (const cat of Object.keys(extraCounts)) add(PRICE[cat], extraCounts[cat]);
    } else {
      // Fewer than the bundle's specialist seats picked: the flat price
      // doesn't apply to a partial build, itemize as before.
      add(PRICE.starter, 1);
      add(PRICE.sixpack, 1);
      const fallbackCounts = {};
      specialistPicks.forEach((cat) => { fallbackCounts[cat] = (fallbackCounts[cat] || 0) + 1; });
      for (const cat of Object.keys(fallbackCounts)) add(PRICE[cat], fallbackCounts[cat]);
    }

    // C-Suite / C-Suite MCP / Premium seats are always itemized on top,
    // never absorbed into the flat bundle.
    for (const cat of ALWAYS_ITEMIZED_CATS) {
      const qty = parseInt(counts[cat], 10) || 0;
      if (qty > 0 && qty <= 9) add(PRICE[cat], qty);
    }
  } else {
    // 'found' tier: the foundation only, no specialists.
    add(PRICE.starter, 1);
    add(PRICE.sixpack, 1);
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
