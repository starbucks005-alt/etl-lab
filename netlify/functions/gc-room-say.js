/* gc-room-say — say something at the table, and let the friend answer if a
   reply has been earned.

   NOBODY ANSWERS BY DEFAULT. The Dose seats everybody and makes them all reply
   every time, which is unnecessary and exhausting. Here a reply has to be
   earned and silence is a real outcome: see friendShouldAnswer() in
   _gc-room.js. One person in the room means the friend always answers, because
   somebody talking to you in an empty room is talking to you. Two or more and
   they answer when named, when asked, when somebody has just walked in, or
   after a real gap.

   THE TURN LOCK is what stops two people's replies interleaving. Always
   released, including on the error path.

   POST { seat_token, message }
     -> { said, reply, quiet?, feelings?, mood? }
*/

const R = require('./_gc-room.js');

const CHAT_FN = '/.netlify/functions/gc-chat';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return R.preflight();
  if (event.httpMethod !== 'POST') return R.json(405, { error: 'method_not_allowed' });

  const key = R.serviceKey();
  if (!key) return R.json(500, { error: 'no_service_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return R.json(400, { error: 'bad_json' }); }

  const who = await R.identify(key, body.seat_token);
  if (!who) return R.json(403, { error: 'no_seat' });

  /* SELF-HEALING FRIEND SNAPSHOT, added 2026-08-25. Dr. O: Cal had a voice
     in Pookie's own solo chat with him but never spoke in this shared room.
     gc-room-open.js snapshots the friend into the room ONCE, at creation --
     a voice (or any other edit) added afterward stays invisible to every
     room already open, forever, with nothing to ever refresh it. The host's
     browser sends its current copy on every message (see room.html's
     sayInRoom); patched in here so the room stops serving a stale one.
     Host only, and only onto the SAME friend (matched by id) -- a guest
     sending this could not swap the room onto somebody else's friend. */
  const refresh = body.friend_refresh;
  if (who.seat.is_host && refresh && typeof refresh === 'object' && refresh.name &&
      who.room.friend && refresh.id && refresh.id === who.room.friend.id) {
    const patched = await R.sbPatch(key, 'gc_rooms', `id=eq.${who.room.id}`, { friend: refresh });
    if (patched) who.room.friend = refresh;
  }

  const usable = R.roomIsUsable(who.room);
  if (!usable.ok) return R.json(410, { error: usable.reason });

  const said = String(body.message || '').trim().slice(0, 4000);
  if (!said) return R.json(400, { error: 'nothing_said' });

  /* THE SENDER'S OWN CREDENTIALS, added 2026-08-18. Before this, nothing
     sent to gc-chat.js from this function ever carried who was ACTUALLY
     typing — only the room's own host_credit_ref/is_demo. That meant an
     owner could never bypass anything inside a shared room (Dr. O hit
     this herself), and a guest with a real funded balance of their own
     (Pookie, 260 credits, capped anyway) had no way to spend it there
     either — only the room's shared free pool could ever be drawn from,
     for anyone, always. Raw here, validated downstream by gc-chat.js's own
     safeToken()/ownerUser(), same as every other caller of it. */
  const senderOwnerKey = String(body.owner_key || '').trim();
  const senderAccessToken = String(body.access_token || '').trim();

  /* guest_cameo, ADDED 2026-08-19: "let's wire it into shared rooms too."
     Passed through raw, same trust boundary as owner_key/access_token
     above -- gc-chat.js already validates a guest_cameo's shape itself
     (name and voiceId required, everything capped) and drops anything
     that does not qualify, so there is nothing this file needs to check
     twice. Whoever is actually typing this turn is who it is offered
     for, not the room's host specifically. */
  const senderGuestCameo = (body.guest_cameo && typeof body.guest_cameo === 'object') ? body.guest_cameo : null;

  /* The line goes in immediately, before anybody waits on a model, so both
     browsers see it arrive at the pace it was actually typed. */
  const row = await R.insertMessage(key, who.room.id, {
    speaker: 'person',
    authorId: who.seat.id,
    name: who.seat.display_name,
    content: said,
  });

  const people = await R.loadPeople(key, who.room.id);

  /* Was this person only just introduced? Somebody walking in earns a reply. */
  const arrivedRecently = people.some(p =>
    (Date.now() - new Date(p.joined_at).getTime()) < 90 * 1000 && p.id !== who.seat.id);

  const recent = await R.loadTranscript(key, who.room.id, 4);
  const lastFriendLine = [...recent].reverse().find(m => m.speaker === 'friend');
  const secondsSinceLast = lastFriendLine
    ? (Date.now() - new Date(lastFriendLine.created_at).getTime()) / 1000
    : 999;

  const shouldAnswer = R.friendShouldAnswer({
    people,
    text: said,
    secondsSinceLast,
    someoneJustArrived: arrivedRecently,
    friendName: who.room.friend && who.room.friend.name,
  });

  if (!shouldAnswer) {
    /* A real outcome, not a failure. Four people catching up do not need a
       fifth voice on every line, and the browser renders nothing at all. */
    return R.json(200, { said: row, reply: null, quiet: true });
  }

  if (!(await R.claimTurn(key, who.room.id))) {
    /* Somebody else's turn is in flight. Their line is already saved and will
       arrive by poll; this just means the friend is mid-sentence elsewhere. */
    return R.json(200, { said: row, reply: null, busy: true });
  }

  let out = null;
  try {
    const full = await R.loadTranscript(key, who.room.id);

    /* THE FRIEND GETS THE WHOLE THREAD. This is the one read that is not
       arrival-forward, and it has to be: otherwise the host re-explains
       herself the moment somebody joins. What a GUEST may see is loadVisible,
       which never passes through here.

       WAS full.slice(0, -1), added 2026-08-18 for "Reggie said he got my
       text twice": this line was just written to gc_messages a few lines
       up (insertMessage, above), so it was already the newest row in
       `full`, and it was about to get sent a SECOND time below as
       `message: said`. True at the time. NO LONGER TRUE as of 2026-08-19:
       gc-chat.js grew its OWN strip for the exact same problem on solo
       chat's behalf (its "history = idle ? rawHistory : rawHistory.slice
       (0,-1)"), applied unconditionally to whatever it is handed — and
       since it cannot tell which caller it is talking to, stripping here
       AND there dropped one real turn on every single shared-room message,
       permanently: the friend's OWN last reply fell out of its context
       before it ever got a chance to answer the NEXT thing said, so it
       looked stuck re-answering the question before the one just asked.
       Dr. O, live, in Reggie's room with Pookie: "repeating answering the
       question before and the new question." Fixed by picking ONE place
       to strip. gc-chat.js's is the right one — it already handles idle
       correctly, and solo chat depends on it — so this file now sends the
       FULL thread, current row included, exactly like solo chat's own
       transcript() does. */
    const messages = full.map(m => ({
      who: m.name || (m.speaker === 'friend' ? who.room.friend.name : 'Someone'),
      text: m.content,
      mine: m.speaker === 'person',
    }));

    const friend = who.room.friend || {};
    const scene = (friend.scenes || []).find(s => s.key === who.room.scene_key) || null;
    /* WHO IS ACTUALLY TALKING, added 2026-08-18, same reasoning and same
       shape as gc-chat.js's own activeFriend (see the comment there): a
       solo companion scene (just Poppy, just Blue) means that companion
       answers, not Tansy, and that has to hold in a shared room the same
       way it does for a single visitor, or the room would quietly revert
       to Tansy the moment a second person joined. */
    const speakerObj = (scene && scene.speaker && friend.companions && friend.companions[scene.speaker]) || null;

    /* WHO PAYS. Same !friend.id heuristic used everywhere else this
       distinction is made: a house demo never has an id, a built friend
       always does. A built friend bills the room's host_credit_ref, stamped
       once when the room opened (gc-room-open.js) — no guest's browser ever
       holds the host's live token to do this, only a one-way reference to
       it, the same trust boundary Almost Human's "bring a friend" already
       draws. A room opened before this existed, or by a host with no
       account at the time, has no ref yet: falls back to the free daily
       cap, scoped per room, rather than blocking a friend already paid for. */
    const isDemo = !friend.id;
    const creditRef = who.room.host_credit_ref || null;

    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://emerging-tech-lab.com';
    const res = await fetch(base + CHAT_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        friend,
        speaker: speakerObj,
        /* WHO IS SPEAKING, so the friend addresses the right person with the
           right pronouns. In a room with several people this is the difference
           between a conversation and a broadcast. */
        you: { name: who.seat.display_name, pronouns: who.seat.pronouns },
        room: people.map(p => ({ name: p.display_name, pronouns: p.pronouns })),
        messages,
        message: said,
        scene: scene ? { label: scene.label, where: scene.where } : null,
        is_demo: isDemo || !creditRef,
        visitor_id: 'room-' + who.room.id,
        credit_ref: (!isDemo && creditRef) ? creditRef : undefined,
        /* WHOEVER IS ACTUALLY TYPING gets first crack at paying their own
           way, same precedence gc-chat.js already gives a direct request:
           a real access_token always wins over a credit_ref. An owner key
           bypasses everything regardless of demo/credit_ref status. Either
           left blank if the sender does not have one -- gc-chat.js's own
           safeToken()/ownerUser() treat an empty string as absent, so this
           never fights with is_demo/credit_ref above, it only ever adds a
           way past them. */
        owner_key: senderOwnerKey || undefined,
        access_token: senderAccessToken || undefined,
        guest_cameo: senderGuestCameo || undefined,
      }),
    });
    out = await res.json();
  } catch (err) {
    console.error('[gc-room-say] friend unreachable:', err.message);
  } finally {
    await R.releaseTurn(key, who.room.id);
  }

  /* WAS if (out && out.reply) -- widened 2026-08-19 to out.reply OR
     out.cameo, same root cause as gc-chat.js's own fix from the same
     report: asked to summon someone directly, the model sometimes writes
     nothing of its own and the whole turn is the cameo. gc-chat.js now
     preserves that cameo instead of discarding it, but this file was
     still gating BOTH inserts on out.reply alone -- a real cameo would
     come back from gc-chat.js and still never reach gc_messages, so
     nobody's browser (host included) would ever see it. */
  if (out && (out.reply || out.cameo)) {
    if (out.reply) {
      await R.insertMessage(key, who.room.id, {
        speaker: 'friend',
        authorId: null,
        /* out.speaker_name is who actually generated this line (gc-chat.js's
           activeFriend) -- Poppy or Blue in a solo scene, Tansy otherwise.
           Falls back the same way it always did if that ever comes back
           empty. */
        name: out.speaker_name || (who.room.friend && who.room.friend.name) || 'Friend',
        content: out.reply,
      });
    }
    /* THE CAMEO, IF THERE WAS ONE, added 2026-08-18. gc-chat.js already
       returns it (Poppy/Biscuit/Mochi's rare interjection), and this used
       to just drop it on the floor: only out.reply ever got persisted, so
       a cameo line in a shared room was invisible to every browser
       including the one that triggered it. Same speaker:"friend" as the
       friend's own line, but with the cameo's own name, which is what lets
       room.html (see its "A CAMEO IS ALSO speaker:friend" note) recognise
       and re-attribute it on the way back out, and pick the right voice for
       it by matching that name against FRIEND.cameos client-side rather
       than needing the voice id to travel through the message row at all. */
    if (out.cameo && out.cameo.name && out.cameo.text) {
      await R.insertMessage(key, who.room.id, {
        speaker: 'friend',
        authorId: null,
        name: out.cameo.name,
        content: out.cameo.text,
      });
    }
  }

  return R.json(200, {
    said: row,
    reply: (out && out.reply) || null,
    quiet: !!(out && out.quiet),
    feelings: (out && out.feelings) || null,
    mood: (out && out.mood) || null,
    daily_capped: !!(out && out.daily_capped),
  });
};
