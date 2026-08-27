/* gc-catalog-add — publish a built companion to the public catalog, and
   grant CATALOG_BONUS_CREDITS the first time any given visitor does this.

   ADDED 2026-08-27 per Dr. O direct: "include a way for the user to 'add
   their companion to the user catalog' and they get an extra 200 credits."
   See faq.html's own new entry for what this means to the person opting in:
   images, scenes, and personality all travel; the visitor's own name/
   pronouns/about (the `user` field on a built friend, which describes the
   BUILDER, not the companion) and any memories (never part of the friend
   object to begin with -- see room.html's memKey(), a wholly separate
   localStorage key) do not.

   NO NEW SUPABASE TABLE. The catalog itself is a single Netlify Blobs JSON
   list, same lightweight pattern verify-checkout-ah.js already uses for
   idempotency (ah_processed_sessions) -- a browsable catalog is exactly the
   "store some JSON, no relational needs" shape that pattern fits, and it
   ships today with no migration for Dr. O to run.

   PORTRAIT STORED AS THE SAME data: URI IT ALREADY IS. A built friend's
   portrait never leaves the browser as a hosted file (see chooseFace() in
   build.html -- gc-face.js hands back base64, not a URL), so there is
   nothing to upload here; the data URI is simply the value an <img src>
   needs, wherever it is read from later. Makes each catalog entry a few
   hundred KB in the Blobs store, which is a fine trade for shipping without
   a second function just to serve images.

   POST /.netlify/functions/gc-catalog-add
   Body: { friend, access_token }
   Returns: { ok, catalog_id, access_token, balance, bonus_granted } or
            { ok: false, error }
*/

const { getStore } = require('@netlify/blobs');
const {
  SUPABASE_URL, randomToken, safeToken, getCreditRow, CATALOG_BONUS_CREDITS,
} = require('./_ah-credits.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

/* Only what a stranger meeting this companion should ever see. Deliberately
   an allowlist, not "everything except a blocklist" -- a new field added to
   the friend shape later stays private by default instead of leaking into
   the catalog the day someone adds it. */
const CATALOG_FIELDS = [
  'name', 'kind', 'age', 'gender', 'from', 'work', 'into', 'knows', 'been',
  'voice', 'voiceId', 'portrait', 'portraitWide', 'scenes',
];

function catalogEntryFrom(friend) {
  const entry = {};
  CATALOG_FIELDS.forEach((k) => { if (friend[k] !== undefined) entry[k] = friend[k]; });
  return entry;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config', missing: 'SUPABASE_SERVICE_ROLE_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const friend = body.friend;
  if (!friend || !friend.name || !friend.portrait || !Array.isArray(friend.scenes) || !friend.scenes.length) {
    return json(400, { error: 'incomplete_friend' });
  }

  const catalogStore = getStore('gc_catalog');
  const claimedStore = getStore('gc_catalog_bonus_claimed');

  let list = [];
  try { list = (await catalogStore.get('index', { type: 'json' })) || []; } catch (_) {}
  if (!Array.isArray(list)) list = [];

  const entry = catalogEntryFrom(friend);
  entry.id = 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  entry.addedAt = new Date().toISOString();
  list.push(entry);

  try {
    await catalogStore.setJSON('index', list);
  } catch (err) {
    console.error('gc-catalog-add: write failed:', err.message);
    return json(502, { error: 'write_failed' });
  }

  /* THE BONUS, ONCE EVER PER TOKEN, tracked in its own Blobs store rather
     than a new ah_credits column -- a claim record here is a single small
     write, the same shape ah_processed_sessions already uses to answer
     "has this happened before." A token with no row yet cannot have claimed
     it, so a fresh mint below always proceeds to grant. */
  let token = safeToken(body.access_token);
  let bonusGranted = false;

  if (token) {
    let alreadyClaimed = false;
    try { alreadyClaimed = !!(await claimedStore.get(token)); } catch (_) {}

    if (!alreadyClaimed) {
      const row = await getCreditRow(token, serviceKey);
      if (row) {
        const balance = row.balance + CATALOG_BONUS_CREDITS;
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(token)}`, {
            method: 'PATCH',
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
          });
          await claimedStore.set(token, '1');
          bonusGranted = true;
        } catch (err) {
          console.error('gc-catalog-add: bonus grant failed (non-fatal):', err.message);
        }
      }
    }
  } else {
    /* NO TOKEN YET: this is a free/demo visitor's first paid-adjacent
       action, same situation create-checkout-ah-addon.js already handles
       for a first-time buyer with no prior identity -- mint one, seed it
       with just the bonus, non-renewing, only-depletes. */
    token = randomToken();
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/ah_credits`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          access_token: token,
          subscription_active: false,
          balance: CATALOG_BONUS_CREDITS,
          last_topped_up_at: new Date().toISOString(),
        }),
      });
      await claimedStore.set(token, '1');
      bonusGranted = true;
    } catch (err) {
      console.error('gc-catalog-add: fresh-token grant failed (non-fatal):', err.message);
    }
  }

  const finalRow = await getCreditRow(token, serviceKey);

  return json(200, {
    ok: true,
    catalog_id: entry.id,
    access_token: token,
    balance: finalRow ? finalRow.balance : null,
    bonus_granted: bonusGranted,
  });
};
