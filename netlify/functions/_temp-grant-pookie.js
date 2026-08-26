/* One-off: mint a manual 1000-credit ah_credits row for Pookie, Good Company.
   Same shape build.html's real Stripe grant writes (subscription_active:
   false -- a fixed one-time balance, not a renewing subscriber row), minted
   by hand instead of paid, exactly the path _ah-credits.js/gc-friend.js's
   own ?access_token= planter was built for on 2026-08-17. Reads the service
   key at runtime, never writes it anywhere. Deleted after use. */
const crypto = require('crypto');
const SECRET = 'grant-pookie-Qx7vN2';
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 500, body: 'no_service_key' };

  const token = `AH-${crypto.randomBytes(16).toString('hex')}`;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/ah_credits`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      access_token: token,
      email: 'pookie (manual grant, good company, 2026-08-22)',
      balance: 1000,
      subscription_active: false,
    }),
  });
  const body = await r.text();
  if (!r.ok) return { statusCode: 500, body: 'insert_failed: ' + body.slice(0, 300) };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, token, link: 'https://emerging-tech-lab.com/good-company/?access_token=' + token }),
  };
};
