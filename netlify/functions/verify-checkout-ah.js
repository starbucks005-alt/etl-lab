/* verify-checkout-ah — verify a completed Stripe checkout for Almost Human
   and provision credits. Handles both flows:
     - subscription (create-checkout-ah): mints a new opaque access token,
       seeds the tier-2 monthly credit allotment.
     - one-time addon (create-checkout-ah-addon): tops up the balance for the
       access_token already stored in the session's metadata.

   POST /.netlify/functions/verify-checkout-ah
   Body: { session_id }
   Returns: { ok, access_token, balance } or { ok: false, error }

   Flow:
   1. Idempotency check first (see below) — a session already processed just
      returns the same outcome instead of crediting twice.
   2. Fetch the session from Stripe (authoritative — cannot be faked with a
      crafted session_id).
   3. Confirm payment_status === 'paid'.
   4. Branch on session.mode: 'subscription' mints a new token, 'payment'
      tops up the token in metadata.
*/

const { connectLambda, getStore } = require('@netlify/blobs');
const { randomToken, safeToken, getCreditRow, TIER2_MONTHLY_CREDITS, ADDON_CREDITS, SUPABASE_URL } = require('./_ah-credits.js');

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

  try { connectLambda(event); } catch (_) {}

  const stripeKey  = process.env.STRIPE_SECRET_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !serviceKey) return json(500, { error: 'config' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const { session_id } = body;
  if (!session_id || !/^cs_/.test(session_id)) return json(400, { error: 'invalid_session_id' });

  // Idempotency: the welcome page can re-run this (reload, double-fire) for
  // the same completed checkout. Hand back the already-provisioned outcome
  // rather than crediting a subscription or addon twice.
  const processedStore = getStore('ah_processed_sessions');
  try {
    const already = await processedStore.get(session_id, { type: 'json' });
    if (already) return json(already.ok ? 200 : 400, already);
  } catch (_) {}

  const sr = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const session = await sr.json();
  if (!sr.ok) return json(502, { error: 'stripe_error' });
  if (session.payment_status !== 'paid') return json(402, { error: 'not_paid' });

  const email = (session.customer_details && session.customer_details.email) || session.customer_email || null;
  let outcome;

  if (session.mode === 'payment') {
    // Addon top-up for an existing token, OR a fresh mint if the buyer had
    // none — added 2026-08-18 so a first-time demo visitor can buy credits
    // without first committing to a $9.99/mo subscription. Same
    // subscription_active:false, fixed-balance, only-depletes shape
    // gc-friend-checkout.js already uses for exactly this situation.
    const token = safeToken(session.metadata && session.metadata.ah_access_token);
    if (token) {
      const row = await getCreditRow(token, serviceKey);
      if (!row) {
        outcome = { ok: false, error: 'unknown_access_token' };
      } else {
        const balance = row.balance + ADDON_CREDITS;
        await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(token)}`, {
          method: 'PATCH',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
        });
        outcome = { ok: true, access_token: token, balance };
      }
    } else {
      const fresh = randomToken();
      await fetch(`${SUPABASE_URL}/rest/v1/ah_credits`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          access_token: fresh,
          email,
          stripe_customer_id: session.customer || null,
          subscription_active: false,
          balance: ADDON_CREDITS,
          last_topped_up_at: new Date().toISOString(),
        }),
      });
      outcome = { ok: true, access_token: fresh, balance: ADDON_CREDITS };
    }
  } else {
    // New subscription: mint a fresh token and seed the tier-2 allotment.
    const token = randomToken();
    await fetch(`${SUPABASE_URL}/rest/v1/ah_credits`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        access_token: token,
        email,
        stripe_customer_id: session.customer || null,
        stripe_subscription_id: session.subscription || null,
        subscription_active: true,
        balance: TIER2_MONTHLY_CREDITS,
        last_topped_up_at: new Date().toISOString(),
      }),
    });
    outcome = { ok: true, access_token: token, balance: TIER2_MONTHLY_CREDITS };
  }

  try { await processedStore.setJSON(session_id, outcome); } catch (err) {
    console.error('verify-checkout-ah: idempotency write failed (non-fatal):', err.message);
  }

  return json(outcome.ok ? 200 : 400, outcome);
};
