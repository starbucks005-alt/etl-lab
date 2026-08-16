/* gc-room-join — take a seat. No sign in, no account.

   The invite token is swapped for a FRESH seat token at the door, and the
   invite is spent. A link forwarded around a family group chat therefore
   cannot be replayed as somebody else's seat, and the person who used it keeps
   a credential nobody else has.

   ARRIVAL IS STAMPED HERE, and it is the only thing standing between a guest
   and the host's earlier conversation. joined_at is set at the moment the seat
   is claimed, never supplied by the caller.

   POST { invite_token, you:{ name?, pronouns?, avatar?, remember_me? } }
     -> { seat_token, room_id, friend, scene_key, people }

   name is OPTIONAL on purpose. Somebody rushing in to see the thing will skip
   it, and then the friend gets to ask what they would like to be called, which
   is a better first thirty seconds than any onboarding copy.
*/

const R = require('./_gc-room.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return R.preflight();
  if (event.httpMethod !== 'POST') return R.json(405, { error: 'method_not_allowed' });

  const key = R.serviceKey();
  if (!key) return R.json(500, { error: 'no_service_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return R.json(400, { error: 'bad_json' }); }

  const invite = R.safeToken(body.invite_token, 'GCI');
  if (!invite) return R.json(400, { error: 'bad_invite' });

  /* Find the unclaimed seat this invite is. removed=true is what "unclaimed"
     means, and it is also why identify() refuses an invite as a credential. */
  const rows = await R.sbSelect(key,
    `gc_people?token=eq.${encodeURIComponent(invite)}&select=id,room_id,removed&limit=1`);
  if (!rows.length) return R.json(404, { error: 'invite_not_found' });
  if (!rows[0].removed) return R.json(409, { error: 'invite_already_used' });

  const room = await R.loadRoom(key, rows[0].room_id);
  const usable = R.roomIsUsable(room);
  if (!usable.ok) return R.json(410, { error: usable.reason });

  /* Humans are cheap and are the point, but not unbounded. */
  const already = await R.loadPeople(key, room.id);
  if (already.length >= R.MAX_PEOPLE) return R.json(409, { error: 'room_full' });

  const you = body.you || {};
  const seatToken = R.newToken('GCS');

  /* One atomic update: claim the seat, mint the credential, stamp the arrival.
     Conditional on removed still being true, so two people racing the same
     link cannot both get in on it. */
  const claimed = await R.sbPatch(key, 'gc_people',
    `id=eq.${encodeURIComponent(rows[0].id)}&removed=eq.true&select=id,joined_at`,
    {
      token: seatToken,
      removed: false,
      joined_at: new Date().toISOString(),
      display_name: R.safeName(you.name),          // null is fine, the friend will ask
      pronouns: String(you.pronouns || 'they / them').slice(0, 40),
      avatar: typeof you.avatar === 'string' ? you.avatar.slice(0, 80000) : null,
      remember_me: !!you.remember_me,              // their own answer, not the host's
    }, true);

  if (!claimed || !claimed.length) return R.json(409, { error: 'invite_already_used' });

  const people = await R.loadPeople(key, room.id);

  return R.json(200, {
    seat_token: seatToken,
    /* See gc-room-open: this is how the browser knows its own lines. */
    seat_id: claimed[0].id,
    room_id: room.id,
    friend: room.friend,
    scene_key: room.scene_key,
    people: people.map(p => ({ name: p.display_name, avatar: p.avatar, is_host: p.is_host })),
  });
};
