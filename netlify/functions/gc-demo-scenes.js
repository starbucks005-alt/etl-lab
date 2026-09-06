/* gc-demo-scenes — a shared companion's world, grown by the people who talk
   to them.
   ─────────────────────────────────────────────────────────────────────────
   GET  ?id=<demo id>          -> { scenes: [...] }                 PUBLIC
   POST { id, scene }          -> { ok, count }                     PUBLIC

   Dr. O, direct: "if a user gets attached to a GC companion they may want
   to make a scene for them, and all the users benefit." A house companion
   (Arch, Reggie, A.L.I.C.E., anyone in GC_DEMO_IDS) is the same person for
   every visitor, so a scene somebody pays to have made of them is not a
   private add-on the way it is for a built friend -- it belongs to the
   companion, and every future visitor should find it already there.

   PUBLIC ON PURPOSE, both directions. GET has to be: every visitor's page
   reads this before anyone has paid anything. POST matches the trust level
   every other scene-delivery link on this campus already has (see
   room.html's own ?add-scene= handler for a built friend) -- nothing here
   is cryptographically tied to a real Stripe charge, the same way a built
   friend's delivery link is not. What actually gates real cost is upstream
   of this file entirely: gc-scene.js does not call Veo until gc-scene-order.js
   has confirmed the order the caller names as paid, so a spoofed direct call
   to THIS endpoint can only submit something not actually generated (a bad
   URL, an unplayable scene) -- annoying, not costly.

   NO REVIEW STEP, same as a built friend's own scenes. Veo's own content
   filtering is the only backstop that exists anywhere on this pipeline
   already; this does not add or remove one. */

const { getStore, connectLambda } = require('@netlify/blobs');

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

const STORE = 'gc_demo_scenes';
/* A sane ceiling on one companion's crowd-grown world, not a business
   decision about how many scenes are "enough" -- just a floor under
   unbounded growth, matching the spirit of gc-face.js's own draw cap. */
const MAX_SCENES = 60;
const ID_RE = /^[a-z0-9_-]{1,40}$/;

/* THE ACTUAL INSERT, PULLED OUT SO GC-SCENE.JS CAN CALL IT DIRECTLY. A
   finished Veo render lands there, in the same Netlify Functions runtime
   with the same Blobs access -- routing that through an HTTP call to this
   file's own handler would be a self-call for no reason. This is that
   shared logic; the POST branch of the handler below is now a thin wrapper
   around it for the browser-facing case (a bring-your-own Vimeo delivery
   for a shared companion, say). */
async function addSceneToDemo(id, scene) {
  id = String(id || '').trim().toLowerCase();
  if (!ID_RE.test(id)) return { ok: false, error: 'bad_id' };
  if (!scene || typeof scene !== 'object' || !scene.label) return { ok: false, error: 'bad_scene' };
  if (!scene.src && !scene.vimeoId && !scene.still) return { ok: false, error: 'no_source' };

  const clean = {
    key: 'added-' + String(scene.key || Date.now()).replace(/[^a-z0-9]+/gi, '-').slice(-40),
    label: String(scene.label).slice(0, 60),
  };
  /* THREE SHAPES, matching room.html's own ?add-scene= handler exactly (see
     its note on "A STILL, NOT A VIDEO"): a Vimeo scene, a real video file,
     or a still image -- src stays absent/null for a still, the picture
     lives in .still instead, same convention a built friend's own scenes
     already use so play()/showStill() need no separate branch for a shared
     companion's version of the same three things. */
  if (scene.vimeoId) { clean.vimeoId = String(scene.vimeoId).slice(0, 20); if (scene.thumb) clean.thumb = String(scene.thumb).slice(0, 500); }
  else if (scene.still) { clean.src = null; clean.still = String(scene.still).slice(0, 500); }
  else { clean.src = String(scene.src).slice(0, 500); }

  let store;
  try { store = getStore(STORE); } catch (e) { return { ok: false, error: 'store_unavailable' }; }

  const existing = (await store.get(id, { type: 'json' })) || [];
  const already = existing.some((s) =>
    (clean.vimeoId && s.vimeoId === clean.vimeoId) ||
    (clean.still && s.still === clean.still) ||
    (clean.src && s.src === clean.src));
  if (already) return { ok: true, count: existing.length, already: true };
  if (existing.length >= MAX_SCENES) return { ok: false, error: 'scene_ceiling' };

  const updated = existing.concat([clean]);
  await store.setJSON(id, updated);
  return { ok: true, count: updated.length };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};
  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore(STORE); } catch (e) { return json(500, { error: 'store_unavailable' }); }

  if (event.httpMethod === 'GET') {
    const id = String(qs.id || '').trim().toLowerCase();
    if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
    const scenes = (await store.get(id, { type: 'json' })) || [];
    return json(200, { scenes });
  }

  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const result = await addSceneToDemo(body.id, body.scene);
    if (!result.ok) {
      const status = result.error === 'scene_ceiling' ? 429 : result.error === 'store_unavailable' ? 500 : 400;
      return json(status, { error: result.error });
    }
    return json(200, { ok: true, count: result.count });
  }

  return json(405, { error: 'method_not_allowed' });
};

module.exports.addSceneToDemo = addSceneToDemo;
