/* ONE-OFF, DELETED RIGHT AFTER USE. Adds 1000 credits to Pookie's own row,
   Dr. O directly: "give pookie 1000 credits." Adds to whatever her balance
   already is rather than overwriting it, same as every other credit grant
   on this campus (STARTER_CREDITS, ADDON_CREDITS, the monthly rollover). */
const { connectLambda } = require('@netlify/blobs');
const { getCreditRow, SUPABASE_URL } = require('./_ah-credits.js');

const TEMP_SECRET = 'pookie-grant-2026-08-19-q7f2';
const TOKEN = 'AH-7baebcd372d0cf2c30e1e7f79f4d2a71';
const GRANT = 1000;

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const before = await getCreditRow(TOKEN, serviceKey);
  if (!before) return json(404, { error: 'row_not_found' });

  const balance = before.balance + GRANT;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(TOKEN)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return json(502, { error: 'write_failed', detail: await r.text() });

  return json(200, { balance_before: before.balance, granted: GRANT, balance_after: balance });
};
