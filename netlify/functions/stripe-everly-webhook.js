/* stripe-everly-webhook — stop honouring a token when the subscription ends.
 *
 * Without this, a cancelled Everly Castle subscription keeps working forever:
 * the token is minted at checkout and nothing ever takes it away. Stripe is
 * the only thing that knows a subscription has ended, so Stripe has to be the
 * one to say so.
 *
 * SETUP, in the Stripe dashboard, once:
 *   Developers > Webhooks > Add endpoint
 *     URL:    https://emerging-tech-lab.com/.netlify/functions/stripe-everly-webhook
 *     Events: customer.subscription.deleted
 *             customer.subscription.updated
 *   Then copy that endpoint's signing secret into Netlify env as
 *   STRIPE_EVERLY_WEBHOOK_SECRET.
 *
 * It is a SEPARATE secret from STRIPE_WEBHOOK_SECRET on purpose. Each endpoint
 * in Stripe has its own signing secret, and sharing one across endpoints means
 * a signature from the wrong endpoint verifies here.
 *
 * WHAT IT ACTS ON
 *   customer.subscription.deleted   the subscription is over. Revoke.
 *   customer.subscription.updated   revoke only when the new status is one
 *                                   that means "not paying": canceled, unpaid,
 *                                   incomplete_expired. A past_due card is
 *                                   still a paying family whose card bounced,
 *                                   and cutting a four-year-old off mid-story
 *                                   over a retryable failure is the wrong call.
 *
 * FAILING SAFE. If the secret is missing, this returns 500 and changes
 * nothing, rather than trusting an unverified body. An unverifiable webhook
 * that revokes access is a way for anybody to switch off a paying customer.
 */
const crypto = require('crypto');
const access = require('./_everly-access');

/* Same verifier as stripe-supporter-webhook.js: signed payload is
   "<timestamp>.<raw body>", compared in constant time, and anything older than
   ten minutes is refused so a captured event cannot be replayed later. */
function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of String(sigHeader).split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === 't') timestamp = val;
    if (key === 'v1') signatures.push(val);
  }
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 600) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return signatures.some((sig) => {
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch (_) { return false; }
  });
}

/* Statuses that mean the family is no longer paying. past_due is deliberately
   absent: that is a card that needs retrying, not a cancellation. */
const OVER = new Set(['canceled', 'unpaid', 'incomplete_expired']);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  const secret = process.env.STRIPE_EVERLY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[everly-webhook] STRIPE_EVERLY_WEBHOOK_SECRET is not set; refusing to act on an unverified event');
    return { statusCode: 500, body: 'not configured' };
  }

  const raw = event.body || '';
  const sig = (event.headers || {})['stripe-signature'] || (event.headers || {})['Stripe-Signature'];
  if (!verifyStripeSignature(raw, sig, secret)) {
    console.warn('[everly-webhook] bad signature, ignoring');
    return { statusCode: 400, body: 'bad signature' };
  }

  let evt;
  try { evt = JSON.parse(raw); } catch (e) { return { statusCode: 400, body: 'bad json' }; }

  const type = evt && evt.type;
  const sub = evt && evt.data && evt.data.object;
  if (!sub || !sub.id) return { statusCode: 200, body: 'nothing to do' };

  /* Only ours. A campus with several subscriptions on one Stripe account will
     send every one of them here, and revoking on somebody else's cancellation
     would cut off a family who never cancelled. */
  const source = (sub.metadata && sub.metadata.source) || '';
  if (source !== 'everly_castle') return { statusCode: 200, body: 'not everly' };

  const ending = type === 'customer.subscription.deleted'
    || (type === 'customer.subscription.updated' && OVER.has(sub.status));
  if (!ending) return { statusCode: 200, body: 'still active' };

  let token;
  try { token = await access.tokenForSubscription(event, sub.id); }
  catch (err) {
    console.error('[everly-webhook] lookup failed:', err && err.message);
    return { statusCode: 500, body: 'lookup failed' };
  }

  if (!token) {
    /* Nothing to revoke. Not an error: a subscription that never completed
       checkout has no token, and Stripe should not retry over it. */
    console.warn('[everly-webhook] no token for subscription ' + sub.id);
    return { statusCode: 200, body: 'no token' };
  }

  try { await access.revoke(event, token); }
  catch (err) {
    console.error('[everly-webhook] revoke failed:', err && err.message);
    return { statusCode: 500, body: 'revoke failed' };
  }

  console.log('[everly-webhook] revoked access for subscription ' + sub.id + ' (' + type + ')');
  return { statusCode: 200, body: 'revoked' };
};
