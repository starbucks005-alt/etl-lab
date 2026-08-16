/* gc-room-open — turn a private conversation into a shared room.

   PROMOTE ON INVITE, not always-a-room. Talking to your friend on your own is
   a browser and nothing else, which is the overwhelmingly common case and
   should cost no database at all. Pressing "Bring someone with you" is what
   brings a room into existence.

   THE HOST'S PRIOR CONVERSATION COMES WITH THEM. This is the part to get
   right: without it, your daughter walks in and Arch has forgotten what you
   were telling him thirty seconds ago, which is the exact failure that makes
   the whole thing feel fake. The earlier lines are written into the room
   BEFORE the guest has a seat, so the friend has the full thread while the
   guest still only ever sees from their own arrival.

   POST { friend, scene_key?, you:{name,pronouns,avatar}, messages:[] }
     -> { room_id, seat_token, invite_token, invite_url }
*/

const R = require('./_gc-room.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return R.preflight();
  if (event.httpMethod !== 'POST') return R.json(405, { error: 'method_not_allowed' });

  const key = R.serviceKey();
  if (!key) return R.json(500, { error: 'no_service_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return R.json(400, { error: 'bad_json' }); }

  /* ── ANOTHER INVITE FOR A ROOM THAT ALREADY EXISTS ──────────────────────────
     Anyone with a seat can mint one, not only the host, because a guest
     wanting to show their mum is the product spreading on its own. The host
     can shut that off per room. */
  if (body.reuse_seat) {
    const who = await R.identify(key, body.reuse_seat);
    if (!who) return R.json(403, { error: 'no_seat' });
    const usable = R.roomIsUsable(who.room);
    if (!usable.ok) return R.json(410, { error: usable.reason });
    if (!who.seat.is_host && !who.room.guests_may_invite) {
      return R.json(403, { error: 'host_has_closed_invites' });
    }
    const people = await R.loadPeople(key, who.room.id);
    if (people.length >= R.MAX_PEOPLE) return R.json(409, { error: 'room_full' });

    const token = R.newToken('GCI');
    await R.sbInsert(key, 'gc_people', {
      room_id: who.room.id, token, is_host: false, removed: true,
    }, false);
    return R.json(200, { room_id: who.room.id, invite_token: token });
  }

  const friend = body.friend;
  if (!friend || !friend.name) return R.json(400, { error: 'no_friend' });

  const rows = await R.sbInsert(key, 'gc_rooms', {
    friend,
    scene_key: body.scene_key || null,
  }, true);
  if (!rows || !rows.length) return R.json(500, { error: 'could_not_open_room' });
  const room = rows[0];

  /* The host's seat. */
  const seatToken = R.newToken('GCS');
  const you = body.you || {};
  const seatRows = await R.sbInsert(key, 'gc_people', {
    room_id: room.id,
    token: seatToken,
    display_name: R.safeName(you.name),
    pronouns: String(you.pronouns || 'they / them').slice(0, 40),
    avatar: typeof you.avatar === 'string' ? you.avatar.slice(0, 80000) : null,
    is_host: true,
    remember_me: true,          // it is their own friend; they already decided
  }, true);
  if (!seatRows || !seatRows.length) return R.json(500, { error: 'could_not_seat_host' });

  /* CARRY THE CONVERSATION ACROSS. Written before any invite is minted, so
     these lines are all older than any guest's joined_at and no guest will
     ever be shown them. The friend gets the whole thread; the guest gets from
     hello. */
  const prior = Array.isArray(body.messages) ? body.messages.slice(-R.MAX_TRANSCRIPT) : [];
  for (const m of prior) {
    if (!m || !m.text) continue;
    await R.insertMessage(key, room.id, {
      speaker: m.mine ? 'person' : 'friend',
      authorId: m.mine ? seatRows[0].id : null,
      name: m.mine ? R.safeName(you.name) : friend.name,
      content: m.text,
    });
  }

  /* An invite is a DIFFERENT value to a seat, and gets swapped for one at the
     door, so a forwarded link cannot be replayed as somebody else's seat. */
  /* The invite lives as an UNCLAIMED seat row, which is the simplest thing
     that works and means claiming it is one atomic update rather than a second
     table. removed:true until claimed, so identify() refuses it: an invite
     link is not a seat and cannot be used as one. */
  const inviteToken = R.newToken('GCI');
  await R.sbInsert(key, 'gc_people', {
    room_id: room.id,
    token: inviteToken,
    is_host: false,
    removed: true,
  }, false);

  return R.json(200, {
    room_id: room.id,
    seat_token: seatToken,
    /* WHICH LINES ARE MINE. The browser needs this to recognise its own
       messages coming back on the poll, so they sit on the right and are not
       drawn a second time. Matching on display name was doing that job and
       failed the moment somebody arrived without one. The seat id is not a
       credential; the seat TOKEN is, and that is a different value. */
    seat_id: seatRows[0].id,
    invite_token: inviteToken,
    carried: prior.length,
  });
};
