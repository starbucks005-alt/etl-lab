/* gc-companion-checkout — subscribe to ONE companion, $9.99/mo, 300 credits.
   ─────────────────────────────────────────────────────────────────────────
   POST { friend_id, friend_name, access_token? } -> { url }
   GET  ?session_id=...  -> { paid, friend_id, access_token?, balance? }

   ADDED 2026-08-28, Dr. O direct, across several turns: "each companion has
   its own $9.99/mo subscription and its own 300 credits, tracked
   separately... you are buying a product, each (companion + 300
   credits/month subscription) is a product." Same shape as
   gc-friend-checkout.js (the one-time unlock it replaces, now removed from
   every page that called it -- see that file's own header for why it is
   still here, unused), but mode:'subscription' instead of mode:'payment',
   and it writes to the new gc_companion_credits table instead of ah_credits,
   since a person can now hold several of these at once, one per companion.

   PRICE IS INLINE, NOT AN ENV VAR, matching every other checkout on this
   campus.

   LIVE STRIPE VERIFICATION on the READ side, not here. This function only
   ever runs at checkout time (or its own GET return trip); the actual
   ongoing "is this subscription still active" check lives in
   _gc-companion-credits.js's readCompanionCreditRow, asked fresh every
   time gc-chat.js or gc-voice.js needs to know, not trusted from a flag
   set once here and never revisited. */

const Stripe = require('stripe');
const { connectLambda, getStore } = require('@netlify/blobs');
const { safeToken, grantCompanionSubscription } = require('./_gc-companion-credits.js');

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

/* ── THE PRICE. One place. $9.99/mo, matching Almost Human's own tier and
   the pooled Good Company tier this replaces. ── */
const COMPANION_MONTHLY_CENTS = 999;

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

    /* STRIPE IS ASKED, NOT THE BROWSER TOLD, same reasoning as every other
       checkout return trip on this campus. */
    const paid = session && session.payment_status === 'paid';
    const friendId = session && session.metadata && session.metadata.gc_friend_id;
    if (!friendId) return json(200, { ok: true, paid: false });
    if (!paid) return json(200, { ok: true, paid: false, friend_id: friendId });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const processedStore = getStore('gc_processed_companion_sessions');
    let grant = null;
    try { grant = await processedStore.get(sessionId, { type: 'json' }); } catch (_) {}

    if (!grant && serviceKey) {
      const friendName = session.metadata && session.metadata.gc_friend_name;
      const existingToken = safeToken(session.metadata && session.metadata.gc_access_token);
      grant = await grantCompanionSubscription(
        existingToken, friendId, friendName,
        session.customer || null, session.subscription || null,
        serviceKey
      );
      if (grant) {
        try { await processedStore.setJSON(sessionId, grant); } catch (err) {
          console.error('gc-companion-checkout: idempotency write failed (non-fatal):', err.message);
        }
      }
    }

    return json(200, Object.assign(
      { ok: true, paid: true, friend_id: friendId },
      grant ? { access_token: grant.access_token, balance: grant.balance } : {}
    ));
  }

  /* ── starting a subscription ───────────────────────────────────────────── */
  const friendId = String(body.friend_id || '').trim();
  const friendName = String(body.friend_name || '').trim().slice(0, 80);
  const accessToken = safeToken(body.access_token);
  if (!friendId) return json(400, { error: 'friend_id_required' });

  /* SENT BACK INTO THE SAME ROOM, not build.html, when the caller says
     where "here" is -- the whole point of paying mid-conversation is to
     keep talking, not to land somewhere else and have to click back in.
     Falls back to build.html, same as gc-friend-checkout.js's own
     hardcoded destination, for any caller that does not send one. Only a
     same-site relative path is trusted, never an arbitrary redirect. */
  const returnTo = /^\/good-company\/[a-zA-Z0-9\-_./?&=]*$/.test(String(body.return_to || ''))
    ? 'https://emerging-tech-lab.com' + body.return_to
    : null;
  const build = returnTo || 'https://emerging-tech-lab.com/good-company/build.html';
  /* & when returnTo already carries its own query string (?who=alice),
     otherwise this would land two ?s in one URL. */
  const joiner = build.indexOf('?') > -1 ? '&' : '?';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          /* Named for what it is, without the companion's name in it: this
             line shows up on a card statement. */
          product_data: { name: 'Good Company — one companion, monthly' },
          unit_amount: COMPANION_MONTHLY_CENTS,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      success_url: build + joiner + 'companion-paid={CHECKOUT_SESSION_ID}',
      cancel_url: build,
      /* The companion's id travels with the payment, so coming back means
         something even if they finish on a different device. The buyer's
         existing access_token (if any) travels too, so a second or third
         companion's subscription lands on the same anonymous identity
         instead of minting a new one each time. */
      metadata: {
        gc_friend_id: friendId,
        gc_friend_name: friendName,
        gc_access_token: accessToken || '',
        source: 'good_company_companion_subscription',
      },
    });
  } catch (err) {
    console.error('gc-companion-checkout stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
