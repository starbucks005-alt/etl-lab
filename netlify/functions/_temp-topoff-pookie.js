/* ONE-OFF, DELETED RIGHT AFTER USE. Tops Pookie's standing subscription back
   up to the full TIER2_MONTHLY_CREDITS now, rather than waiting on the
   30-day auto-refill in getCreditRow(). Resets last_topped_up_at too, so
   the next automatic refill paces correctly from this top-off instead of
   from whenever the original grant happened. */
const { connectLambda } = require('@netlify/blobs');
const { TIER2_MONTHLY_CREDITS, SUPABASE_URL } = require('./_ah-credits.js');

const TEMP_SECRET = 'pookie-topoff-2026-08-18-w4n7';
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
    body: JSON.stringify({ balance: TIER2_MONTHLY_CREDITS, last_topped_up_at: new Date().toISOString() }),
  });
  if (!r.ok) return json(502, { error: 'topoff_failed', detail: await r.text().catch(() => '') });

  return json(200, { access_token: TOKEN, balance: TIER2_MONTHLY_CREDITS });
};
