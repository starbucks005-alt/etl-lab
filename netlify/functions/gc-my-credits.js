/* gc-my-credits — how many credits does this token have right now.

   Dr. O, 2026-08-18: "let them see how many credits they have." No new
   login system: identity here is the same ah_access_token every other
   Good Company function already trusts, read straight out of the caller's
   own browser storage. This just answers the one question that token
   couldn't answer for itself before.

   POST { access_token } -> { balance, subscription_active }
   Read-only. No side effects, nothing to bill, nothing to gate. */

const { getCreditRow, safeToken } = require('./_ah-credits.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (code, body) => ({
  statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const token = safeToken(body.access_token);
  if (!token) return json(400, { error: 'no_access_token' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const row = await getCreditRow(token, serviceKey);
  if (!row) return json(404, { error: 'unknown_access_token' });

  return json(200, { balance: row.balance, subscription_active: !!row.subscription_active });
};
