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

const { getStore, connectLambda } = require('@netlify/blobs');
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
  /* notTheTherapist, added 2026-08-29 for Aaron: the first catalog entry
     whose profession is safety-sensitive. Every other notThe* safety-limit
     field (notTheVet, notTheEngineer) has the same gap -- silently
     stripped by this allowlist, so a companion with one of those limits
     loses it the moment it goes into the catalog. Not backfilled for the
     others here since none of today's other catalog entries carry one;
     flagging the general gap rather than fixing it everywhere blind. */
  'notTheTherapist',
  /* turnOrder, companions, added 2026-08-29 for the Grimms/puppet-family
     entries -- same reasoning as catalog.html's own startWith() copy-list,
     which needed the identical fix: a shared multi-companion room has
     nothing real at the top level, only inside .companions, addressed by
     .turnOrder, so stripping these here would silently produce a catalog
     entry with no working voice at all. */
  'turnOrder', 'companions',
  /* premise, added the same day for the same two entries -- the doorstep
     blurb room.html shows before anyone sits down (FRIEND.premise). Not a
     functional gap the way turnOrder/companions was, just a real one: a
     catalog-started copy would open to a blank doorstep instead of the
     scene-setting text every direct ?who= link already gets. */
  'premise',
  /* newsFeed, added 2026-08-29 for Marcus Reyes -- a catalog-started copy
     would silently lose the flag that wires him into real, live ETL
     Newswire headlines (see fetchLiveHeadlines()/headlinesNote() in
     gc-chat.js), and go back to being just another companion bluffing
     about current events. Same functional-gap class as turnOrder and
     companions, not a cosmetic miss like premise. */
  'newsFeed',
];

function catalogEntryFrom(friend) {
  const entry = {};
  CATALOG_FIELDS.forEach((k) => { if (friend[k] !== undefined) entry[k] = friend[k]; });
  return entry;
}

/* CAP, added 2026-08-29 after the incident this same night that took the
   whole catalog offline: one entry's uncompressed 4.5MB base64 portrait,
   duplicated three times by a retry loop, pushed gc-catalog-list.js's own
   response past Netlify's 6MB function payload limit -- for every visitor,
   not just that one entry. gc-scene-order.js already caps a portrait at
   3MB for the same reason; this is stricter, because every catalog entry
   is read into ONE combined response, so the whole catalog is only ever
   as safe as its worst single portrait. 2MB is generous for a properly
   compressed photo and still leaves real room to grow past today's four
   entries before the ceiling is anywhere close again. */
const MAX_CATALOG_PORTRAIT = 2 * 1024 * 1024;

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
  if (friend.portrait.length > MAX_CATALOG_PORTRAIT) {
    return json(413, { error: 'portrait_too_big', detail: 'Compress the portrait before publishing.' });
  }

  /* NEEDED FOR getStore() TO WORK AT ALL, found 2026-08-27 debugging why
     catalog.html showed empty: without this, getStore() throws
     MissingBlobsEnvironmentError even though the site's Blobs setup is
     fine -- see newswire-latest.js's own identical call. This means every
     "Add to catalog" click before this fix, including the one meant to
     seed Isabelle as a real example, silently failed with a 502. Nothing
     was ever actually written. */
  try { connectLambda(event); } catch (_) {}

  const catalogStore = getStore('gc_catalog');
  const claimedStore = getStore('gc_catalog_bonus_claimed');

  let list = [];
  try { list = (await catalogStore.get('index', { type: 'json' })) || []; } catch (_) {}
  if (!Array.isArray(list)) list = [];

  /* UPDATE, OWNER ONLY, added 2026-08-29. The only way to fix an entry
     already in the catalog used to be publishing a duplicate -- Marion's
     own first publish went out with vimeoId-only scenes, no thumb, before
     the real chosen stills existed, and there was no way to correct that
     in place. Gated on GC_OWNER_KEY, Good Company's own dedicated owner
     secret -- NOT the campus-wide OWNER_KEY gc-scene-order.js checks,
     which is a real, separate variable and cost real time to find: this
     was first written against OWNER_KEY by copying that file's pattern
     without checking whether Good Company had its own. It does. */
  const isOwner = !!process.env.GC_OWNER_KEY && String(body.owner_key || '') === process.env.GC_OWNER_KEY;

  /* DELETE, OWNER ONLY, added 2026-08-29 during the same incident that added
     the update path above -- three accidental duplicate Marion entries (each
     carrying its own multi-MB base64 portrait) pushed gc-catalog-list.js's
     own response past Netlify's 6MB function payload limit, breaking the
     catalog for every visitor, not just Marion's own entry. Deletes by id
     rather than by name/index, so a mistaken call can only ever remove the
     one entry actually meant. */
  if (isOwner && body.delete_id) {
    const before = list.length;
    list = list.filter((e) => !(e && e.id === body.delete_id));
    if (list.length === before) return json(404, { error: 'catalog_entry_not_found' });
    try {
      await catalogStore.setJSON('index', list);
    } catch (err) {
      console.error('gc-catalog-add: delete write failed:', err.message);
      return json(502, { error: 'write_failed' });
    }
    return json(200, { ok: true, deleted_id: body.delete_id, remaining: list.length });
  }

  if (isOwner && body.update_id) {
    const i = list.findIndex((e) => e && e.id === body.update_id);
    if (i === -1) return json(404, { error: 'catalog_entry_not_found' });
    const updated = catalogEntryFrom(friend);
    updated.id = list[i].id;
    updated.addedAt = list[i].addedAt;
    const creditName = String(body.credit_name || '').trim().slice(0, 60);
    if (creditName) updated.creditName = creditName;
    else if (list[i].creditName) updated.creditName = list[i].creditName;
    list[i] = updated;
    try {
      await catalogStore.setJSON('index', list);
    } catch (err) {
      console.error('gc-catalog-add: update write failed:', err.message);
      return json(502, { error: 'write_failed' });
    }
    return json(200, { ok: true, catalog_id: updated.id, updated: true });
  }

  const entry = catalogEntryFrom(friend);
  entry.id = 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  entry.addedAt = new Date().toISOString();
  /* CREDIT, OPTIONAL, added 2026-08-29. Blank/absent means anonymous, same
     as every catalog entry before this existed -- only set the field at
     all when there is a real name, so an old entry and a "no thanks"
     entry look identical rather than one carrying a visible empty string. */
  const creditName = String(body.credit_name || '').trim().slice(0, 60);
  if (creditName) entry.creditName = creditName;
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
