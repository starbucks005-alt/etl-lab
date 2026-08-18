/* ONE-OFF, DELETED RIGHT AFTER USE. Tops up Pookie's existing comped token
   (minted 2026-08-17) rather than minting a second one, so she keeps one
   consistent identity instead of accumulating throwaway tokens each time
   she runs out mid-test. */
const { connectLambda } = require('@netlify/blobs');
const { getCreditRow, STARTER_CREDITS, SUPABASE_URL } = require('./_ah-credits.js');

const TEMP_SECRET = 'pookie-topup-2026-08-18-q9k4';
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

  const balance = row.balance + STARTER_CREDITS;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(TOKEN)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return json(502, { error: 'topup_failed', detail: await r.text().catch(() => '') });

  return json(200, { access_token: TOKEN, balance });
};
