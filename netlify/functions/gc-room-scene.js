/* gc-room-scene — move the room, for everyone in it.
   ─────────────────────────────────────────────────────────────────────────
   POST { seat_token, scene_key } -> { ok }

   THE HALF OF "THE HOST MOVES AND EVERYONE FOLLOWS" THAT WAS NEVER BUILT.
   gc-room-poll has carried that comment since the room feature shipped, and it
   was only ever true one way: a scene chosen when the room was CREATED
   broadcast fine, but nothing let anybody change it afterward. Clicking a
   scene chip only called play() in that one browser. Every poll, by anyone,
   kept re-asserting the room's original frozen scene_key, which is what Dr. O
   hit: Pookie was not on the beach, and Terry joining (which triggers a poll)
   snapped both of them onto whatever scene the room had been born with.

   ANY SEAT MAY MOVE THE ROOM, host or guest. A guest wanting to show
   everybody the porch is the same spirit as a guest being allowed to invite
   somebody else in: this is a room people are IN, not a stage one person runs.

   THE SCENE HAS TO BE ONE THE FRIEND ACTUALLY HAS. Taking an arbitrary string
   from the request would let anybody type a scene key that does not exist,
   which the friend has no where to go for; checked against the room's own
   friend object rather than trusted. */

const R = require('./_gc-room.js');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return R.preflight();
  if (event.httpMethod !== 'POST') return R.json(405, { error: 'post_only' });

  const key = R.serviceKey();
  if (!key) return R.json(500, { error: 'no_service_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return R.json(400, { error: 'bad_json' }); }

  const who = await R.identify(key, body.seat_token);
  if (!who) return R.json(403, { error: 'no_seat' });

  const usable = R.roomIsUsable(who.room);
  if (!usable.ok) return R.json(410, { error: usable.reason });

  const sceneKey = String(body.scene_key || '').trim();
  const scenes = (who.room.friend && who.room.friend.scenes) || [];
  if (sceneKey && !scenes.some(s => s && s.key === sceneKey)) {
    return R.json(400, { error: 'unknown_scene' });
  }

  await R.setSceneKey(key, who.room.id, sceneKey || null);
  return R.json(200, { ok: true, scene_key: sceneKey || null });
};
