/* ONE-OFF, DELETED RIGHT AFTER USE. Mints a comped ah_credits row (same shape
   as a real $9.99 friend purchase, STARTER_CREDITS balance,
   subscription_active false so it only depletes and never rolls over) so
   Pookie can keep testing Reggie/Tansy tonight without hitting the shared
   daily cap again.

   GATED ON A THROWAWAY SECRET GENERATED FOR THIS FILE ONLY, not the real
   OWNER_KEY: this endpoint exists for minutes, not as standing
   infrastructure, and there is no reason to touch the actual master key for
   a single mint. The secret dies with this file. */
const { connectLambda } = require('@netlify/blobs');
const { randomToken, STARTER_CREDITS, SUPABASE_URL } = require('./_ah-credits.js');

const TEMP_SECRET = 'pookie-comp-2026-08-17-x7q2';

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const token = randomToken();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ah_credits`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      access_token: token,
      email: null,
      stripe_customer_id: null,
      subscription_active: false,
      balance: STARTER_CREDITS,
      last_topped_up_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) return json(502, { error: 'mint_failed', detail: await r.text().catch(() => '') });

  return json(200, { access_token: token, balance: STARTER_CREDITS });
};
