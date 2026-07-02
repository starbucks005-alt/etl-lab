/* stripe-supporter-webhook: records supporters (donors and members) at payment time.

   Stripe sends checkout.session.completed here for every completed checkout.
   We only act on sessions that carry the "public_name" custom field, which
   exists on exactly two surfaces: the donation payment link and the ETL
   membership checkout (create-checkout-etl). Everything else is ignored.

   Filled-in name  = row with opt_in_public true, shown on /join by name.
   Left blank      = row with opt_in_public false, counted as anonymous.
   Real name and email are stored either way, for private records only.

   Setup (Stripe dashboard):
   1. Add a custom text field to the donation payment link:
      key "public_name", label "Public name (blank = stay anonymous)", optional.
   2. Developers > Webhooks > Add endpoint:
      https://emerging-tech-lab.com/.netlify/functions/stripe-supporter-webhook
      Event: checkout.session.completed
   3. Copy the endpoint's signing secret into Netlify env as STRIPE_WEBHOOK_SECRET.
*/

const crypto = require('crypto');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of sigHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === 't') timestamp = val;
    if (key === 'v1') signatures.push(val);
  }
  if (!timestamp || signatures.length === 0) return false;

  // Reject events older than 10 minutes (replay protection)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 600) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch (_) {
      return false;
    }
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !serviceKey) return { statusCode: 500, body: 'config' };

  const payload = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const sigHeader = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!verifyStripeSignature(payload, sigHeader, webhookSecret)) {
    return { statusCode: 400, body: 'bad signature' };
  }

  let evt;
  try {
    evt = JSON.parse(payload);
  } catch (_) {
    return { statusCode: 400, body: 'bad payload' };
  }

  if (evt.type !== 'checkout.session.completed') return { statusCode: 200, body: 'ignored' };

  const session = evt.data && evt.data.object;
  if (!session || session.payment_status !== 'paid') return { statusCode: 200, body: 'ignored' };

  // Only sessions carrying our recognition question are supporters
  const fields = Array.isArray(session.custom_fields) ? session.custom_fields : [];
  const nameField = fields.find((f) => f.key === 'public_name');
  if (!nameField) return { statusCode: 200, body: 'ignored' };

  const publicName = ((nameField.text && nameField.text.value) || '').trim();
  const details = session.customer_details || {};

  const row = {
    display_name: publicName || null,
    real_name: details.name || null,
    email: details.email || null,
    kind: session.mode === 'subscription' ? 'member' : 'donor',
    opt_in_public: publicName.length > 0,
    stripe_session_id: session.id,
  };

  // Insert, ignoring retries of the same session (Stripe redelivers on timeouts)
  const r = await fetch(`${SUPABASE_URL}/rest/v1/etl_supporters?on_conflict=stripe_session_id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!r.ok) {
    const t = await r.text();
    console.error('supporter insert failed:', r.status, t);
    return { statusCode: 500, body: 'db error' };
  }

  return { statusCode: 200, body: 'ok' };
};
