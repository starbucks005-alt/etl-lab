/* ─────────────────────────────────────────────────────────────────────────────
   stripe-provision

   The self-serve delivery method. Stripe calls this webhook when a checkout
   completes. We treat the webhook payload as an untrusted pointer: we take
   the session id from it and fetch the REAL session from Stripe with our
   secret key, so forged calls can't provision anything.

   On a paid session:
   1. Invite the buyer into Supabase auth (Supabase emails them the
      sign-in invitation automatically; no manual adds).
   2. Write a per-user studio_config blob seeded from what they bought,
      keyed by email until first sign-in (studio-config-get falls back to
      provisioned-clients / defaults otherwise).

   Env needed (ETL site):
   - STRIPE_SECRET_KEY            (already set)
   - SUPABASE_SERVICE_ROLE_KEY    (one-time paste from Supabase -> Settings -> API)
   ───────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

// price id -> seat meaning (mirror of staffing-checkout.js)
const PRICE_SEATS = {
  'price_1TgvfbBpqKA2T6wFYAsKgpLU': { key: 'pa_plus_studio', label: 'Your PA + Founder Studio', amount: 199 },
  'price_1TgvfbBpqKA2T6wFakMbsvCJ': { key: 'six_pack', label: 'Essential Six-Pack', amount: 199 },
  'price_1TgvfbBpqKA2T6wFmTzs9YJI': { key: 'specialist_mcp', label: 'Specialist (backpack)', amount: 69 },
  'price_1TgvfcBpqKA2T6wFiQyVb53y': { key: 'specialist_standard', label: 'Specialist (standard)', amount: 49 },
  'price_1TgviyBpqKA2T6wFl0bXqAm3': { key: 'csuite', label: 'C-Suite seat', amount: 89 },
  'price_1TgviyBpqKA2T6wFlKmbEegY': { key: 'csuite_mcp', label: 'C-Suite seat (backpack)', amount: 119 },
  'price_1TgviyBpqKA2T6wFM7taYrQn': { key: 'premium_slr', label: 'Premium SLR Method', amount: 549 },
};

exports.handler = async function (event) {
  try { connectLambda(event); } catch (_) {}
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey) return { statusCode: 500, body: 'stripe key missing' };

  let evt = {};
  try { evt = JSON.parse(event.body || '{}'); } catch (_) {}
  if (evt.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' }; // not ours; ack so Stripe stops retrying
  }
  const sessionId = evt.data && evt.data.object && evt.data.object.id;
  if (!sessionId || !/^cs_/.test(sessionId)) return { statusCode: 400, body: 'no session id' };

  // Fetch the authoritative session + line items from Stripe.
  const sr = await fetch('https://api.stripe.com/v1/checkout/sessions/' + sessionId + '?expand[]=line_items', {
    headers: { Authorization: 'Bearer ' + stripeKey },
  });
  const session = await sr.json();
  if (!sr.ok) return { statusCode: 502, body: 'stripe fetch failed' };
  if (session.payment_status !== 'paid') return { statusCode: 200, body: 'not paid; ignored' };

  const email = (session.customer_details && session.customer_details.email) || session.customer_email || '';
  if (!email) return { statusCode: 200, body: 'no email on session' };

  // Seats bought
  const seats = {}; let total = 0;
  const lines = (session.line_items && session.line_items.data) || [];
  for (const li of lines) {
    const pid = li.price && li.price.id;
    const meta = PRICE_SEATS[pid];
    const qty = li.quantity || 1;
    if (meta) { seats[meta.key] = (seats[meta.key] || 0) + qty; total += meta.amount * qty; }
  }

  // 1. Invite into Supabase (sends the sign-in invitation email itself).
  let invite = 'skipped_no_service_key';
  if (serviceKey) {
    const ir = await fetch(SUPABASE_URL + '/auth/v1/invite', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + serviceKey,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email, data: { source: 'staffing_checkout', session: sessionId } }),
    });
    if (ir.ok) invite = 'sent';
    else {
      const it = await ir.text();
      invite = /already.*(registered|exists)/i.test(it) ? 'already_registered' : ('failed: ' + it.slice(0, 200));
    }
  }

  // 2. Seed their studio config, keyed by email (picked up on first sign-in).
  try {
    const store = getStore('studio_config_pending');
    await store.setJSON(email.toLowerCase(), {
      source: 'self_serve_checkout',
      email: email.toLowerCase(),
      stripe_session: sessionId,
      stripe_customer: session.customer || null,
      stripe_subscription: session.subscription || null,
      seats: seats,
      amount_monthly: total,
      paid: true,
      sixpack_on: !!seats.six_pack,
      provisioned_at: new Date().toISOString(),
      invite_status: invite,
    });
  } catch (e) {
    return { statusCode: 200, body: 'paid; invite ' + invite + '; blob failed: ' + (e && e.message) };
  }

  return { statusCode: 200, body: 'provisioned; invite ' + invite };
};
