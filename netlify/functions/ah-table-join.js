/* ah-table-join — accept an invite and take a seat at somebody's table.
   No sign-in, no account, nothing to install.

   POST /.netlify/functions/ah-table-join
   Body: { token, peek?: true, display_name?, pronoun?, visitor_id? }
   Returns { room_id, seat_token, agent_keys, active_agents, host_name, joined_at }
          | { peek: true, host_name, agent_keys }
          | { error: 'claimed' | 'expired' | 'closed' | 'not_found' }

   THE INVITE TOKEN IS THE CREDENTIAL. There is no auth here at all, which on
   Almost Human is not a compromise: nobody on this site has ever had an
   account, host included.

   The Dose's v1 of this invited the guest with a Supabase magic link and it
   failed in real use on 2026-08-12 — she tapped it and landed at an empty table
   of her own. Magic links are single use, mail scanners prefetch and burn them
   before the human ever taps, and a link minted for one person opened in
   another browser on another device is the case they handle worst. None of that
   is fixable with configuration.

   CLAIMED ON A TAP, NEVER ON PAGE LOAD. This is a POST and the landing screen
   does not fire it automatically: the guest reads who invited her, says what to
   call her, agrees to the terms, and taps. That deliberate tap is what stops a
   mail scanner's prefetch from spending the invite before she sees it.

   `peek` is the same endpoint with nothing claimed, so the landing screen can
   say "Terry invited you to sit down with Ivy, Auggie and Arthur" without
   costing her the invite.
*/

const {
  json, CORS, serviceKey, sbSelect, sbInsert, sbPatch,
  loadRoom, loadPeople, roomIsUsable, newToken, safeName, safeTableToken,
} = require('./_ah-table.js');

const PRONOUNS = { he: true, she: true, they: true };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = serviceKey();
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const token = safeTableToken(body.token);
  if (!token) return json(400, { error: 'not_found' });

  const invites = await sbSelect(
    key,
    `etl_table_invites?token=eq.${encodeURIComponent(token)}&select=token,room_id,expires_at,claimed_at&limit=1`
  );
  if (!invites.length) return json(404, { error: 'not_found' });
  const invite = invites[0];

  if (invite.claimed_at) return json(409, { error: 'claimed' });
  if (new Date(invite.expires_at).getTime() < Date.now()) return json(410, { error: 'expired' });

  const room = await loadRoom(key, invite.room_id);
  const usable = roomIsUsable(room);
  if (!usable.ok) return json(410, { error: usable.reason });

  const people = await loadPeople(key, room.id);
  const host = people.find((p) => p.is_host);
  const hostName = (host && host.display_name) || 'Someone';

  // Peek: what the landing screen shows BEFORE she taps. Claims nothing.
  if (body.peek === true) {
    return json(200, {
      peek: true,
      host_name: hostName,
      agent_keys: room.agent_keys || [],
    });
  }

  // Atomic claim. Whoever gets a row back is the one person who joins; a
  // forwarded link finds claimed_at already set and is told so.
  const claimed = await sbPatch(
    key,
    'etl_table_invites',
    `token=eq.${encodeURIComponent(token)}&claimed_at=is.null&select=token`,
    { claimed_at: new Date().toISOString() },
    true
  );
  if (!Array.isArray(claimed) || !claimed.length) return json(409, { error: 'claimed' });

  // A NEW secret, deliberately not the invite token. The invite is spent now;
  // this is the session credential her browser holds from here on. Keeping them
  // separate means a link sitting in a message thread can never be replayed as
  // a session by whoever scrolls back to it later.
  const seatToken = newToken();

  // joined_at is left to default, and it IS the privacy boundary: every read
  // that builds this guest's view is bounded by it. See readClause() in
  // _ah-table.js.
  const seats = await sbInsert(key, 'etl_table_people', {
    room_id: room.id,
    token: seatToken,
    display_name: safeName(body.display_name, 'Guest'),
    pronoun: PRONOUNS[String(body.pronoun || '').toLowerCase()] ? String(body.pronoun).toLowerCase() : null,
    visitor_id: String(body.visitor_id || '').trim().slice(0, 64) || null,
    is_host: false,
  }, true);

  if (!Array.isArray(seats) || !seats.length) {
    console.error('[ah-table-join] seat insert failed after claiming invite', token);
    return json(500, { error: 'could_not_join' });
  }

  return json(200, {
    room_id: room.id,
    seat_token: seatToken,
    agent_keys: room.agent_keys || [],
    active_agents: room.active_agents || room.agent_keys || [],
    host_name: hostName,
    joined_at: seats[0].joined_at,
  });
};
