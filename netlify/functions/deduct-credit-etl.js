/* deduct-credit-etl — deduct 1 credit from an ETL member's account.

   POST /.netlify/functions/deduct-credit-etl
   Header: Authorization: Bearer <supabase-access-token>
   Returns: { balance_remaining } or 402 { error: 'no_credits' }

   Also exports deductCredit(userId, serviceKey) for direct require() by gated ask functions.
*/

const { getUser, extractToken, deductCredit, SUPABASE_URL } = require('./_etl-credits-util');

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

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const user = await getUser(token);
  if (!user) return json(401, { error: 'invalid_token' });

  const result = await deductCredit(user.id, serviceKey);
  if (!result.ok) {
    if (result.reason === 'no_credits') {
      return json(402, { error: 'no_credits', message: "You're out of credits for this month. Your balance tops up on your monthly renewal date." });
    }
    return json(402, { error: result.reason, message: 'No credit account found. Subscribe at /member-login to get started.' });
  }

  return json(200, { balance_remaining: result.balance_remaining });
};
