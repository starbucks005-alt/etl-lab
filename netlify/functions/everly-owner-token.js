/* everly-owner-token — mint an Everly Castle access token for the owner.
 *
 * Dr. O needs to be able to use her own product without paying herself through
 * Stripe, and the old way of doing that was a browser flag: presence of
 * etl_owner_key in localStorage turned the paid side on. That was removed with
 * the paywall, because a check a browser can pass is not a check.
 *
 * This is the replacement, and the difference matters: the key is verified
 * SERVER-side against OWNER_KEY in Netlify env, which is already set and is
 * the same key every other ETL owner endpoint checks. The browser proves it
 * knows the key; it does not simply claim to.
 *
 * The token minted here is an ordinary token. There is no owner branch inside
 * _everly-access.js and no special case in the chat or voice functions: they
 * see one kind of token and cannot tell hers from a paying family's. One code
 * path, so there is only one thing to get right.
 *
 * USE, once, from the browser console on emerging-tech-lab.com:
 *
 *   await fetch('/.netlify/functions/everly-owner-token', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ owner_key: 'THE KEY' })
 *   }).then(r => r.json()).then(d => localStorage.setItem('everly_token', d.access_token));
 *
 * Then reload. It is idempotent: calling it again returns the same token
 * rather than littering the store with new ones.
 */
const access = require('./_everly-access');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

/* A fixed session id, so the owner has one token rather than a new one per
   call. grant() already keys by session for idempotency, which is the same
   guarantee a reloaded welcome page relies on. */
const OWNER_SESSION = 'owner';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const expected = process.env.OWNER_KEY;
  if (!expected) {
    console.error('[everly-owner-token] OWNER_KEY is not set');
    return json(500, { ok: false, error: 'not configured' });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'bad_json' }); }

  const given = String(body.owner_key || '').trim();
  /* Length first, then compare. Not constant time, and it does not need to be:
     the key is high entropy and this endpoint is not a login form somebody can
     grind. It is refused loudly in the log either way. */
  if (!given || given !== expected) {
    console.warn('[everly-owner-token] refused a request with the wrong key');
    return json(403, { ok: false, error: 'no' });
  }

  try {
    const existing = await access.tokenForSession(event, OWNER_SESSION);
    if (existing) return json(200, { ok: true, access_token: existing, repeat: true });

    const token = await access.grant(event, {
      session_id: OWNER_SESSION,
      customer: null,
      subscription: null,
    });
    console.log('[everly-owner-token] minted the owner token');
    return json(200, { ok: true, access_token: token });
  } catch (err) {
    console.error('[everly-owner-token] failed:', err && err.message);
    return json(500, { ok: false, error: 'mint_failed' });
  }
};
