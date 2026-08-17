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

  const usable = R.roomIsUsable(who.room);
  if (!usable.ok) return R.json(410, { error: usable.reason });

  const said = String(body.message || '').trim().slice(0, 4000);
  if (!said) return R.json(400, { error: 'nothing_said' });

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
       which never passes through here. */
    const messages = full.map(m => ({
      who: m.name || (m.speaker === 'friend' ? who.room.friend.name : 'Someone'),
      text: m.content,
      mine: m.speaker === 'person',
    }));

    const friend = who.room.friend || {};
    const scene = (friend.scenes || []).find(s => s.key === who.room.scene_key) || null;

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
      }),
    });
    out = await res.json();
  } catch (err) {
    console.error('[gc-room-say] friend unreachable:', err.message);
  } finally {
    await R.releaseTurn(key, who.room.id);
  }

  if (out && out.reply) {
    await R.insertMessage(key, who.room.id, {
      speaker: 'friend',
      authorId: null,
      name: (who.room.friend && who.room.friend.name) || 'Friend',
      content: out.reply,
    });
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
