/* admin-comp-etl: grant a permanent, no-card comped ETL membership to a real
   person Dr. O wants to thank, by hand, not a promo code system.

   POST { email }  header: X-Owner-Key (or body.owner_key)

   Mirrors verify-checkout-etl.js's real-purchase flow exactly, minus Stripe:
   sends the person a real Supabase magic-link invite, and drops a pending
   membership blob keyed by their email. get-credits-etl.js already picks
   this blob up on their first login and sets subscription_active = true,
   seeded with 20 credits, no card ever involved, and nothing in the codebase
   ever re-checks Stripe for a row with no stripe_subscription_id, so this
   does not expire.

   Nothing here is public; every call requires the owner key.
*/

const { connectLambda, getStore } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Owner-Key',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function ownerOk(event, body) {
  const key = process.env.OWNER_KEY;
  if (!key) return false;
  const given = ((event.headers['x-owner-key'] || event.headers['X-Owner-Key'] || (body && body.owner_key)) || '').trim();
  return given === key;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  try { connectLambda(event); } catch (_) {}

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  if (!ownerOk(event, body)) return json(401, { error: 'owner_key_required' });

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'valid_email_required' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  // Invite into Supabase — she gets a real magic-link email (no-op if already registered)
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
      data: { source: 'etl_membership_comp', comped_by: 'owner' },
    }),
  });
  if (ir.ok) {
    inviteStatus = 'sent';
  } else {
    const it = await ir.text();
    inviteStatus = /already.*(registered|exists)/i.test(it) ? 'already_registered' : 'invite_failed';
  }

  // Store pending membership — get-credits-etl picks this up and activates on first login
  try {
    const store = getStore('etl_membership_pending');
    await store.setJSON(email, {
      email,
      stripe_customer: null,
      stripe_subscription: null,
      comped: true,
      subscribed_at: new Date().toISOString(),
    });
  } catch (e) {
    return json(500, { error: 'blob_write_failed', message: e.message });
  }

  return json(200, { ok: true, email, invite: inviteStatus });
};
