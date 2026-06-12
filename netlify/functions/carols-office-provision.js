/* ─────────────────────────────────────────────────────────────────────────────
   carols-office-provision

   Two modes:
   POST { session_id }   — verify Stripe payment, create desk, return record
   POST { access_code }  — validate existing code, return desk record

   Desk records live in the 'carols_office' Netlify Blobs store.
   Each record is keyed by access_code. A session_id index lets us look
   up the desk for a just-paid buyer before they know their code.

   Access code format: CAROL-XXXXXXX (7 random uppercase alphanumeric chars,
   no ambiguous 0/O/1/I).

   Env: STRIPE_SECRET_KEY, CAROLS_OFFICE_ADDRESS
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = 'CAROL-';
  for (let i = 0; i < 7; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function generateDeskNum() {
  return 'D' + String(Date.now()).slice(-5);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'POST only' };

  try { connectLambda(event); } catch (_) {}

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const store = getStore('carols_office');
  const address = process.env.CAROLS_OFFICE_ADDRESS || 'Dayton, Ohio';

  // ── MODE A: access_code lookup ─────────────────────────────────────────
  if (body.access_code) {
    const code = String(body.access_code).toUpperCase().trim();
    try {
      const desk = await store.get('desk:' + code, { type: 'json' });
      if (!desk) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'code_not_found' }) };
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ desk }),
      };
    } catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'lookup_failed' }) };
    }
  }

  // ── MODE B: session_id — verify Stripe, provision if new ──────────────
  const sessionId = String(body.session_id || '').trim();
  if (!sessionId || !/^cs_/.test(sessionId)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'session_id or access_code required' }) };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'stripe_key_missing' }) };

  // Check if we already provisioned this session (idempotent)
  try {
    const existing = await store.get('session:' + sessionId, { type: 'json' });
    if (existing && existing.access_code) {
      const desk = await store.get('desk:' + existing.access_code, { type: 'json' });
      if (desk) return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ desk }),
      };
    }
  } catch (_) {}

  // Fetch and verify the Stripe session
  const sr = await fetch('https://api.stripe.com/v1/checkout/sessions/' + sessionId, {
    headers: { 'Authorization': 'Bearer ' + stripeKey },
  });
  const session = await sr.json();
  if (!sr.ok) return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'stripe_fetch_failed' }) };
  if (session.payment_status !== 'paid') {
    return { statusCode: 402, headers: CORS, body: JSON.stringify({ error: 'not_paid' }) };
  }

  const email = (session.customer_details && session.customer_details.email) || '';
  const company = (session.metadata && session.metadata.company_name) || '';
  const contact = (session.metadata && session.metadata.contact_name) || '';

  // Create the desk record
  const accessCode = generateCode();
  const deskNum = generateDeskNum();
  const desk = {
    desk_id: deskNum,
    access_code: accessCode,
    company_name: company || 'Your Company',
    contact_name: contact || '',
    contact_email: email,
    address: address,
    stripe_session_id: sessionId,
    created_at: new Date().toISOString(),
    status: 'active',
  };

  try {
    await store.setJSON('desk:' + accessCode, desk);
    await store.setJSON('session:' + sessionId, { access_code: accessCode });
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'provision_failed', detail: e && e.message }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ desk }),
  };
};
