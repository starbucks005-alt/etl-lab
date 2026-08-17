/* gc-friend-checkout — pay to activate a built friend.
   ─────────────────────────────────────────────────────────────────────────
   POST { friend_id, friend_name, access_token? } -> { url }
   GET  ?session_id=...  -> { paid, friend_id, access_token?, balance? }

   Dr. O: "we need to set the price per 'friend'." A friend lives entirely on
   the device that built them, in localStorage, with nothing server-side to
   mark paid the way a scene order is: no queue, no generation job, nothing
   this function owns for the friend itself. Stripe is asked whether the
   session paid, the friend's own id comes back in the metadata, and
   build.html is the one that writes paid:true onto that friend's own record,
   the same way it already writes everything else about them.

   PRICE IS INLINE, NOT AN ENV VAR, matching every other checkout on this
   campus: a price hidden behind an environment variable is a price nobody
   can find when it needs changing, set in the one place that does not get
   reviewed.

   $9.99, A PLACEHOLDER, NOT YET CONFIRMED. Following the scene price's own
   history on purpose: $4.99 started as a guess ("consistent rather than
   reasoned, it is what the Almost Human add-on charges") and Dr. O corrected
   it after weighing it against the real cost. This number is a first guess
   the same way: building a friend spends real money before this paywall is
   ever reached (up to three sets of four face draws, roughly sixty to eighty
   cents at five to seven cents a face). $9.99 mirrors Almost Human's own
   $9.99/mo shape as a familiar number, not a worked-out figure. React to it,
   do not trust it.

   STARTER CREDITS, ADDED 2026-08-17. Unlike a scene, a friend keeps costing
   money in chat for as long as they are talked to, which the one-time price
   above never covered on its own — that gap is what gc-chat.js's and
   gc-voice.js's credit ceiling exists to close. So paying this ALSO grants
   STARTER_CREDITS on the same shared ah_credits table those two functions
   spend from: a fresh access_token if the buyer does not have one yet, or a
   top-up if they do (already an Almost Human subscriber, or bought a second
   friend). Minted with subscription_active:false — a one-time grant that
   only depletes, never rolls over monthly the way a real $9.99/mo
   subscription does; see _ah-credits.js's own note on why that distinction
   matters and is safe to spend from.

   NO WEBHOOK, for the same reason gc-scene-checkout has none: verifying the
   session on the way back needs no new secret and no new endpoint. */

const Stripe = require('stripe');
const { connectLambda, getStore } = require('@netlify/blobs');
const { randomToken, safeToken, getCreditRow, STARTER_CREDITS, SUPABASE_URL } = require('./_ah-credits.js');

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

/* ── THE PRICE. One place. See the note at the top before trusting it. ── */
const FRIEND_CENTS = 999;

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

    /* STRIPE IS ASKED, NOT THE BROWSER TOLD. The only thing that comes back
       from the redirect is a session id, and whether it was paid is a
       question for Stripe. Trusting a query parameter would make this
       free. */
    const paid = session && session.payment_status === 'paid';
    const friendId = session && session.metadata && session.metadata.gc_friend_id;
    if (!friendId) return json(200, { ok: true, paid: false });
    if (!paid) return json(200, { ok: true, paid: false, friend_id: friendId });

    /* ── starter credits ────────────────────────────────────────────────
       Same idempotency store verify-checkout-ah.js already uses: a Stripe
       session_id is globally unique regardless of which product created
       it, so sharing the store risks nothing and avoids standing up a
       second one for the same job. Reload this page after paying and the
       friend still activates, but credits are granted exactly once. */
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const processedStore = getStore('ah_processed_sessions');
    let credit = null;
    try { credit = await processedStore.get(sessionId, { type: 'json' }); } catch (_) {}

    if (!credit && serviceKey) {
      const existingToken = safeToken(session.metadata && session.metadata.gc_access_token);
      if (existingToken) {
        const row = await getCreditRow(existingToken, serviceKey);
        if (row) {
          const balance = row.balance + STARTER_CREDITS;
          try {
            await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(existingToken)}`, {
              method: 'PATCH',
              headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
            });
            credit = { access_token: existingToken, balance };
          } catch (err) { console.error('gc-friend-checkout: credit top-up failed:', err.message); }
        }
      }
      if (!credit) {
        const token = randomToken();
        const email = (session.customer_details && session.customer_details.email) || session.customer_email || null;
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/ah_credits`, {
            method: 'POST',
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              access_token: token,
              email,
              stripe_customer_id: session.customer || null,
              subscription_active: false, // one-time grant, never rolls over — see _ah-credits.js
              balance: STARTER_CREDITS,
              last_topped_up_at: new Date().toISOString(),
            }),
          });
          credit = { access_token: token, balance: STARTER_CREDITS };
        } catch (err) { console.error('gc-friend-checkout: credit mint failed:', err.message); }
      }
      if (credit) {
        try { await processedStore.setJSON(sessionId, credit); } catch (err) {
          console.error('gc-friend-checkout: idempotency write failed (non-fatal):', err.message);
        }
      }
    }

    return json(200, Object.assign(
      { ok: true, paid: true, friend_id: friendId },
      credit ? { access_token: credit.access_token, balance: credit.balance } : {}
    ));
  }

  /* ── starting a payment ────────────────────────────────────────────────── */
  const friendId = String(body.friend_id || '').trim();
  const friendName = String(body.friend_name || '').trim().slice(0, 80);
  const accessToken = safeToken(body.access_token);
  if (!friendId) return json(400, { error: 'friend_id_required' });

  const build = 'https://emerging-tech-lab.com/good-company/build.html';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          /* Named for what it is, without the friend's name in it: this line
             shows up on a card statement. */
          product_data: { name: 'Good Company — one friend' },
          unit_amount: FRIEND_CENTS,
        },
        quantity: 1,
      }],
      success_url: build + '?friend-paid={CHECKOUT_SESSION_ID}',
      cancel_url: build,
      /* The friend's id travels with the payment, so coming back means
         something even if they finish on a different device. The buyer's
         existing access_token (if any) travels too, so the GET step above
         knows to top up their real row instead of minting an orphan one. */
      metadata: {
        gc_friend_id: friendId,
        gc_friend_name: friendName,
        gc_access_token: accessToken || '',
        source: 'good_company_friend',
      },
    });
  } catch (err) {
    console.error('gc-friend-checkout stripe error:', err.message);
    return json(502, { error: 'stripe_error', detail: err.message });
  }

  return json(200, { url: session.url });
};
