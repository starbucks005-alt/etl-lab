/* gc-companion-addon — one-time credit top-up for ONE companion.
   ─────────────────────────────────────────────────────────────────────────
   POST { friend_id, friend_name, size, access_token? } -> { url }
     size: 'small' ($4.99, 150 credits) or 'xl' ($60, 2000 credits)
   GET  ?session_id=...  -> { paid, friend_id, access_token?, balance? }

   ADDED 2026-08-28, alongside gc-companion-checkout.js: per-companion
   credits mean a top-up has to land on THAT companion's own row
   (gc_companion_credits), not the old pooled ah_credits table its credit
   check no longer reads at all -- without this, buying credits here would
   charge real money for a balance nothing could ever spend. ONE FILE FOR
   BOTH SIZES rather than two, unlike create-checkout-ah-addon.js/-xl.js's
   own split: same price reasoning either way (see _ah-credits.js's
   ADDON_CREDITS/XL_ADDON_CREDITS comments for where $4.99/150 and $60/2000
   came from), and a size param keeps both prices in the one place that
   gets reviewed rather than doubling the file for the same logic. */

const Stripe = require('stripe');
const { connectLambda, getStore } = require('@netlify/blobs');
const { safeToken, topUpCompanion } = require('./_gc-companion-credits.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

/* ── THE SIZES. Same figures _ah-credits.js's own ADDON_CREDITS/
   XL_ADDON_CREDITS already justify in real detail; not re-derived here. ── */
const SIZES = {
  small: { cents: 499, credits: 150, label: 'Good Company — companion top-up' },
  xl:    { cents: 6000, credits: 2000, label: 'Good Company — companion top-up, large' },
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });

  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  /* ── coming back from Stripe ───────────────────────────────────────────── */
  if (event.httpMethod === 'GET') {
    const sessionId = String(qs.session_id || '').trim();
    if (!sessionId) return json(400, { error: 'session_id_required' });

    try { connectLambda(event); } catch (_) {}

    let session;
    try { session = await stripe.checkout.sessions.retrieve(sessionId); }
    catch (err) { return json(502, { error: 'stripe_error', detail: err.message }); }

    const paid = session && session.payment_status === 'paid';
    const friendId = session && session.metadata && session.metadata.gc_friend_id;
    const size = session && session.metadata && session.metadata.gc_size;
    if (!friendId || !SIZES[size]) return json(200, { ok: true, paid: false });
    if (!paid) return json(200, { ok: true, paid: false, friend_id: friendId });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const processedStore = getStore('gc_processed_companion_addon_sessions');
    let grant = null;
    try { grant = await processedStore.get(sessionId, { type: 'json' }); } catch (_) {}

    if (!grant && serviceKey) {
      const friendName = session.metadata && session.metadata.gc_friend_name;
      const existingToken = safeToken(session.metadata && session.metadata.gc_access_token);
      grant = await topUpCompanion(
        existingToken, friendId, friendName, SIZES[size].credits,
        session.customer || null, serviceKey
      );
      if (grant) {
        try { await processedStore.setJSON(sessionId, grant); } catch (err) {
          console.error('gc-companion-addon: idempotency write failed (non-fatal):', err.message);
        }
      }
    }

    return json(200, Object.assign(
      { ok: true, paid: true, friend_id: friendId },
      grant ? { access_token: grant.access_token, balance: grant.balance } : {}
    ));
  }

  /* ── starting a payment ────────────────────────────────────────────────── */
  const friendId = String(body.friend_id || '').trim();
  const friendName = String(body.friend_name || '').trim().slice(0, 80);
  const accessToken = safeToken(body.access_token);
  const size = SIZES[body.size] ? body.size : 'small';
  if (!friendId) return json(400, { error: 'friend_id_required' });

  /* SENT BACK INTO THE SAME ROOM -- see gc-companion-checkout.js's own
     identical comment for the reasoning. */
  const returnTo = /^\/good-company\/[a-zA-Z0-9\-_./?&=]*$/.test(String(body.return_to || ''))
    ? 'https://emerging-tech-lab.com' + body.return_to
    : null;
  const build = returnTo || 'https://emerging-tech-lab.com/good-company/build.html';
  const joiner = build.indexOf('?') > -1 ? '&' : '?';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: SIZES[size].label },
          unit_amount: SIZES[size].cents,
        },
        quantity: 1,
      }],
      success_url: build + joiner + 'companion-addon-paid={CHECKOUT_SESSION_ID}',
      cancel_url: build,
      metadata: {
        gc_friend_id: friendId,
        gc_friend_name: friendName,
        gc_access_token: accessToken || '',
        gc_size: size,
        source: 'good_company_companion_addon',
      },
    });
  } catch (err) {
    console.error('gc-companion-addon stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
