/* verify-checkout-etl — verify a completed Stripe checkout and provision ETL membership.

   POST /.netlify/functions/verify-checkout-etl
   Body: { session_id }
   Returns: { ok, email, invite }

   Flow:
   1. Fetch the session from Stripe (authoritative — cannot be faked with a crafted session_id)
   2. Confirm payment_status === 'paid'
   3. Invite the buyer into Supabase (they receive a magic-link email from Supabase)
   4. Store pending membership blob by email (get-credits-etl migrates it on first login)
*/

const { connectLambda, getStore } = require('@netlify/blobs');

const SUPABASE_URL  = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  try { connectLambda(event); } catch (_) {}

  const stripeKey  = process.env.STRIPE_SECRET_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !serviceKey) return json(500, { error: 'config' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const { session_id } = body;
  if (!session_id || !/^cs_/.test(session_id)) return json(400, { error: 'invalid_session_id' });

  // Fetch authoritative session from Stripe
  const sr = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const session = await sr.json();
  if (!sr.ok) return json(502, { error: 'stripe_error' });
  if (session.payment_status !== 'paid') return json(402, { error: 'not_paid' });

  const email = (session.customer_details && session.customer_details.email) || session.customer_email || '';
  if (!email) return json(400, { error: 'no_email' });

  const stripeCustomer     = session.customer || null;
  const stripeSubscription = session.subscription || null;

  // Invite into Supabase — they get a magic-link email (no-op if already registered)
  let inviteStatus = 'skipped';
  const ir = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      data: { source: 'etl_membership', stripe_session: session_id },
    }),
  });
  if (ir.ok) {
    inviteStatus = 'sent';
  } else {
    const it = await ir.text();
    inviteStatus = /already.*(registered|exists)/i.test(it) ? 'already_registered' : 'invite_failed';
  }

  // Store pending membership — get-credits-etl picks this up on first login
  try {
    const store = getStore('etl_membership_pending');
    await store.setJSON(email.toLowerCase(), {
      email: email.toLowerCase(),
      stripe_customer: stripeCustomer,
      stripe_subscription: stripeSubscription,
      stripe_session: session_id,
      subscribed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('blob write failed:', e.message);
  }

  return json(200, { ok: true, email, invite: inviteStatus });
};
