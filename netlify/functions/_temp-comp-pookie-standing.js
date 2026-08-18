/* ONE-OFF, DELETED RIGHT AFTER USE. Converts Pookie's existing comped token
   (one-time grants, twice now) into a real standing comped subscriber:
   subscription_active true, TIER2_MONTHLY_CREDITS balance, matching what a
   real $9.99/mo subscriber gets. getCreditRow() already auto-refills
   TIER2_MONTHLY_CREDITS every ROLLOVER_DAYS for any row with
   subscription_active true, so from here this repeats forever on its own,
   no card, no more manual top-ups. */
const { connectLambda } = require('@netlify/blobs');
const { TIER2_MONTHLY_CREDITS, SUPABASE_URL } = require('./_ah-credits.js');

const TEMP_SECRET = 'pookie-standing-2026-08-18-r7v2';
const TOKEN = 'AH-7baebcd372d0cf2c30e1e7f79f4d2a71';

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(TOKEN)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      subscription_active: true,
      balance: TIER2_MONTHLY_CREDITS,
      last_topped_up_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) return json(502, { error: 'update_failed', detail: await r.text().catch(() => '') });

  return json(200, { access_token: TOKEN, balance: TIER2_MONTHLY_CREDITS, subscription_active: true });
};
