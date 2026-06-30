/* check-subscription-etl — sync Stripe subscription status at login time.

   POST /.netlify/functions/check-subscription-etl
   Header: Authorization: Bearer <supabase-access-token>
   Returns: { subscription_active, status? }

   Called by auth-callback.html after session is established. Keeps subscription_active
   in etl_credits current without relying on webhooks.
*/

const { getUser, extractToken, SUPABASE_URL } = require('./_etl-credits-util');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const token = extractToken(event.headers.authorization);
  if (!token) return json(401, { error: 'no_token' });

  const stripeKey  = process.env.STRIPE_SECRET_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !serviceKey) return json(500, { error: 'config' });

  const user = await getUser(token);
  if (!user) return json(401, { error: 'invalid_token' });

  // Get current etl_credits row
  const selRes = await fetch(
    `${SUPABASE_URL}/rest/v1/etl_credits?user_id=eq.${user.id}&select=stripe_subscription_id,subscription_active`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
  );
  const rows = await selRes.json();

  // No row yet — nothing to sync
  if (!Array.isArray(rows) || rows.length === 0) return json(200, { subscription_active: false });

  const { stripe_subscription_id, subscription_active } = rows[0];

  // No subscription ID — can't check Stripe
  if (!stripe_subscription_id) return json(200, { subscription_active });

  // Check subscription status with Stripe
  const sr = await fetch(`https://api.stripe.com/v1/subscriptions/${stripe_subscription_id}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });

  if (!sr.ok) return json(200, { subscription_active }); // Stripe down — return cached value

  const sub = await sr.json();
  const isActive = sub.status === 'active' || sub.status === 'trialing';

  // Only write if status changed
  if (isActive !== subscription_active) {
    await fetch(`${SUPABASE_URL}/rest/v1/etl_credits?user_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ subscription_active: isActive }),
    });
  }

  return json(200, { subscription_active: isActive, status: sub.status });
};
