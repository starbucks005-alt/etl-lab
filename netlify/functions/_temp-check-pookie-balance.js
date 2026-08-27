const SECRET = 'check-pookie-bal-8f3k';
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 500, body: 'no_service_key' };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.AH-4ecb1058f3ca86a27540104a14bc0db4&select=access_token,balance,subscription_active,email`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const rows = await r.json();
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) };
};
