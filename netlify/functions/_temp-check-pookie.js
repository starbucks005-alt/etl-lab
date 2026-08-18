/* ONE-OFF, DELETED RIGHT AFTER USE. Read-only balance check for Pookie's
   token, to answer "how many credits did I use" right now while the real
   check-your-balance feature gets built. */
const { connectLambda } = require('@netlify/blobs');
const { getCreditRow, TIER2_MONTHLY_CREDITS } = require('./_ah-credits.js');

const TEMP_SECRET = 'pookie-check-2026-08-18-m3x8';
const TOKEN = 'AH-7baebcd372d0cf2c30e1e7f79f4d2a71';

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const row = await getCreditRow(TOKEN, serviceKey);
  if (!row) return json(404, { error: 'row_not_found' });

  return json(200, {
    balance: row.balance,
    subscription_active: row.subscription_active,
    granted_per_cycle: TIER2_MONTHLY_CREDITS,
    used_since_last_grant: TIER2_MONTHLY_CREDITS - row.balance,
  });
};
