/* get-credits-etl — ETL membership credit balance, seed, and monthly rollover.

   GET /.netlify/functions/get-credits-etl
   Header: Authorization: Bearer <supabase-access-token>
   Returns: { balance, subscription_active, seeded?, topped_up? }

   Seed: 20 credits on first call (no existing row).
   Rollover: if subscription_active and last top-up >= 30 days ago, adds 20 (never replaces).
   Pending migration: if no etl_credits row, checks etl_membership_pending blob by email
   and migrates Stripe subscription info if found.
*/

const { connectLambda, getStore } = require('@netlify/blobs');
const { getUser, extractToken, SUPABASE_URL } = require('./_etl-credits-util');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });

  try { connectLambda(event); } catch (_) {}

  const token = extractToken(event.headers.authorization);
  if (!token) return json(401, { error: 'no_token' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const user = await getUser(token);
  if (!user) return json(401, { error: 'invalid_token' });

  const { id: userId, email } = user;

  // Fetch existing credit row
  const selRes = await fetch(
    `${SUPABASE_URL}/rest/v1/etl_credits?user_id=eq.${userId}&select=balance,last_topped_up_at,subscription_active,stripe_customer_id,stripe_subscription_id`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
  );
  const rows = await selRes.json();

  // No row yet — first login
  if (!Array.isArray(rows) || rows.length === 0) {
    // Check for a pending membership blob from verify-checkout-etl
    let stripeCustomer = null;
    let stripeSubscription = null;
    let subscriptionActive = false;

    try {
      const store = getStore('etl_membership_pending');
      const pending = await store.get(email.toLowerCase(), { type: 'json' });
      if (pending) {
        stripeCustomer = pending.stripe_customer || null;
        stripeSubscription = pending.stripe_subscription || null;
        subscriptionActive = true;
        await store.delete(email.toLowerCase());
      }
    } catch (_) {}

    await fetch(`${SUPABASE_URL}/rest/v1/etl_credits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        balance: 20,
        last_topped_up_at: new Date().toISOString(),
        stripe_customer_id: stripeCustomer,
        stripe_subscription_id: stripeSubscription,
        subscription_active: subscriptionActive,
      }),
    });

    return json(200, { balance: 20, subscription_active: subscriptionActive, seeded: true });
  }

  const row = rows[0];
  let { balance, last_topped_up_at, subscription_active, stripe_subscription_id } = row;

  // Monthly rollover: subscription active + 30+ days since last top-up
  const daysSince = (Date.now() - new Date(last_topped_up_at).getTime()) / (1000 * 60 * 60 * 24);
  if (subscription_active && daysSince >= 30) {
    balance = balance + 20;
    await fetch(`${SUPABASE_URL}/rest/v1/etl_credits?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ balance, last_topped_up_at: new Date().toISOString() }),
    });
    return json(200, { balance, subscription_active, topped_up: true });
  }

  return json(200, { balance, subscription_active });
};
