/* _everly-access — who is allowed the paid parts of Everly Castle.
 *
 * THE PAID LINE, stated once so both functions agree on it.
 *
 * Free is anything that costs no API call: her story, her five stories, her
 * pet, her family, her country. Those are fixed text, rendered to audio once
 * and cached by content hash, so the first child in the world pays for them
 * and nobody pays again. They need no token and never will.
 *
 * Paid is anything that costs a call: live conversation with Haiku, and any
 * speech that is not one of those known lines.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until now the paywall was a flag in the browser. everly-castle-chat.js had
 * no entitlement check at all, so anyone who found the URL got the whole paid
 * product; isPaid() in the page only decided whether the child's name was
 * sent along with it. And everly-castle-voice.js accepted free-form text,
 * which made it an open ElevenLabs proxy on Dr. O's account.
 *
 * A token minted by Stripe checkout is the only thing that opens either.
 *
 * THE OWNER KEY IS NOT A BACK DOOR HERE. It is deliberately NOT accepted as
 * payment. Dr. O's own access is a real token, minted once and planted, so
 * there is exactly one way in and no code path that trusts a browser.
 */
const { connectLambda, getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const STORE = 'everly-access';

/* Netlify's Blobs client needs the lambda context in a Functions v1 handler.
   Calling this twice is harmless; forgetting it makes every read throw. */
function ready(event) {
  try { connectLambda(event); } catch (e) { /* already connected */ }
  return getStore(STORE);
}

/* An opaque token. Not a JWT: nothing about the child, the parent, or the
   subscription is encoded in it, so a leaked token reveals nothing and can be
   revoked by deleting one blob. */
function mintToken() {
  return 'evr_' + crypto.randomBytes(24).toString('base64url');
}

/* Record a paid subscription against a fresh token. */
async function grant(event, { session_id, customer, subscription }) {
  const store = ready(event);
  const token = mintToken();
  await store.setJSON('token/' + token, {
    token,
    session_id: session_id || null,
    customer: customer || null,
    subscription: subscription || null,
    granted_at: new Date().toISOString(),
    status: 'active',
  });
  /* Keyed by session as well, so a double-verify returns the same token
     instead of minting a second one for one payment. */
  if (session_id) await store.setJSON('session/' + session_id, { token });
  return token;
}

/* Has this session already been turned into a token? */
async function tokenForSession(event, session_id) {
  if (!session_id) return null;
  const rec = await ready(event).get('session/' + session_id, { type: 'json' });
  return (rec && rec.token) || null;
}

/* The only question the paid endpoints ask.

   Returns true only for a token that exists and is active. Anything else,
   including a missing token, a malformed one, or a cancelled subscription, is
   false. There is no third answer and no fallback. */
async function isPaid(event, token) {
  const t = String(token || '').trim();
  if (!t || !/^evr_[A-Za-z0-9_-]{10,}$/.test(t)) return false;
  let rec;
  try { rec = await ready(event).get('token/' + t, { type: 'json' }); }
  catch (err) { console.error('[everly-access] store read failed:', err && err.message); return false; }
  return !!(rec && rec.status === 'active');
}

/* Stop honouring a token. Used by the Stripe webhook when a subscription
   ends, and available for revoking one by hand. */
async function revoke(event, token) {
  const store = ready(event);
  const rec = await store.get('token/' + token, { type: 'json' });
  if (!rec) return false;
  await store.setJSON('token/' + token, { ...rec, status: 'cancelled', cancelled_at: new Date().toISOString() });
  return true;
}

/* Find the token belonging to a Stripe subscription, so a cancellation can be
   acted on without the browser being involved. */
async function tokenForSubscription(event, subscription) {
  if (!subscription) return null;
  const store = ready(event);
  const { blobs } = await store.list({ prefix: 'token/' });
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' });
    if (rec && rec.subscription === subscription) return rec.token;
  }
  return null;
}

/* The token as the page sends it: a header, so it never lands in a URL, a
   log line, or a referrer. */
function tokenFrom(event) {
  const h = event.headers || {};
  const raw = h['x-everly-token'] || h['X-Everly-Token'] || '';
  return String(raw).trim();
}

module.exports = { grant, isPaid, revoke, tokenFrom, tokenForSession, tokenForSubscription, STORE };
