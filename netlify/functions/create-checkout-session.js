/* create-checkout-session — BYOA work order payment gate.
   POST { spec, items, total }  +  optional Authorization: Bearer <supabase-token>

   Staff bypass: if token resolves to an email in STAFF_EMAILS env var → write blob, return {bypass:true, ref}.
   Everyone else: create Stripe Checkout session → return {url}.
   Blob is written in both paths (status 'awaiting_payment' for Stripe, 'staff_bypass' for bypasses).
*/

const Stripe = require('stripe');
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL  = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';

const PRICE_MAP = {
  portrait: { name: 'Portrait (eyes-open, AI-generated)',  unit_amount: 600  },
  blink:    { name: 'Bespoke blink (PS hand-match)',       unit_amount: 2000 },
  voice:    { name: 'Voice design',                        unit_amount: 800  },
  backpack: { name: 'Backpack wiring',                     unit_amount: 1500 },
  export:   { name: 'Export package',                      unit_amount: 2500 },
};

async function resolveEmail(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.email) ? u.email.toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

function isStaff(email) {
  if (!email) return false;
  const list = (process.env.STAFF_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email);
}

async function writeBlob(key, payload) {
  try {
    const store = getStore('build_requests');
    await store.setJSON(key, payload);
  } catch (err) {
    console.error('create-checkout-session blob write:', err.message);
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'bad_json' }) }; }

  const spec  = payload.spec  || payload;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const total = typeof payload.total === 'number' ? payload.total : 5;

  const ts  = new Date().toISOString().replace(/[:.]/g, '-');
  const key = ts + '--' + (spec.id || 'agent');

  // ── Staff bypass ──────────────────────────────────────────────────
  const authHeader = (event.headers['authorization'] || event.headers['Authorization'] || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    const email = await resolveEmail(token);
    if (isStaff(email)) {
      await writeBlob(key + '--staff', { spec, items, total, status: 'staff_bypass', email, submitted_at: new Date().toISOString() });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, bypass: true, ref: key + '--staff' }),
      };
    }
  }

  // ── Stripe Checkout ───────────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'payment_not_configured' }) };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  const lineItems = [
    { price_data: { currency: 'usd', product_data: { name: 'Agent JSON work order spec' }, unit_amount: 500 }, quantity: 1 },
  ];
  items.forEach(function(id) {
    const p = PRICE_MAP[id];
    if (p) lineItems.push({ price_data: { currency: 'usd', product_data: { name: p.name }, unit_amount: p.unit_amount }, quantity: 1 });
  });

  const proto = (event.headers['x-forwarded-proto'] || 'https');
  const host  = (event.headers['host'] || 'emerging-tech-lab.com');
  const base  = proto + '://' + host;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode:         'payment',
      line_items:   lineItems,
      success_url:  base + '/build-your-own-agent.html?paid=1&ref=' + encodeURIComponent(key),
      cancel_url:   base + '/build-your-own-agent.html',
      metadata:     { spec_id: spec.id || '', agent_name: spec.name || '' },
    });
  } catch (err) {
    console.error('Stripe session create:', err.message);
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'stripe_error', detail: err.message }) };
  }

  await writeBlob(key, { spec, items, total, status: 'awaiting_payment', stripe_session: session.id, submitted_at: new Date().toISOString() });

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
