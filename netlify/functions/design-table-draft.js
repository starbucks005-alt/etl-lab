/* ─────────────────────────────────────────────────────────────────────────────
   design-table-draft.js — "make the draft," from inside a Table Engine room.

   POST { room_id, guest_id? } -> { ok, job_id, room_id, kind, remaining,
                                     credit_fault? }

   Deliberately a THIN proxy in front of etl-design-ask.js rather than a
   reimplementation. Credits, the guest allowance, the owner bypass, the
   concept-image blob-key handoff to the background relay: all of that already
   exists, is already correct, and a second copy of it here is a second place
   for the gate to quietly rot. So this function does exactly two things
   neither of it duplicates:

     1. Turns the room's transcript into ROOM_CONTEXT, a plain readout of what
        the client and the four actually pitched and settled on.
     2. Calls etl-design-ask.js's own handler IN PROCESS (a function call, not
        an HTTP round trip) with the room's brief fields plus that context,
        forwarding whatever Authorization header the caller sent so a signed-in
        member still spends from their own membership rather than the guest
        pool.

   The job this returns is a completely normal ETL Design job from here on:
   poll it with etl-design-status.js, revise it with etl-design-revise.js, pay
   for it with etl-design-checkout.js, exactly as if it had come from the plain
   form. The room only had to hand off a job id and get out of the way.

   Required env: whatever etl-design-ask.js and etl-design-background.js
   already require (ANTHROPIC_API_KEY, etc). Nothing new.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const { handler: askHandler } = require('./etl-design-ask.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

/* A plain readout of the room, most recent first isn't useful here; the four
   built on each other in order, so keep it chronological. Trimmed to the last
   N entries rather than the first: if the conversation ran long, the direction
   that actually stuck is the recent end of it, not the opening pitch (which
   the relay's own prompts re-derive from the brief fields anyway). */
function roomContextFrom(transcript) {
  const lines = (Array.isArray(transcript) ? transcript : [])
    .slice(1)   // entry 0 is the synthetic brief briefing, already covered by the brief fields sent below
    .slice(-40)
    .map((e) => `${e.name}: ${e.content}`);
  let text = lines.join('\n');
  if (text.length > 4000) text = text.slice(-4000);
  return text;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_json' }); }

  const roomId = String(body.room_id || '').trim();
  if (!/^tbl-[0-9a-z-]+$/i.test(roomId)) return json(400, { error: 'room_id_required' });

  try { connectLambda(event); } catch (_) {}
  let store, room;
  try {
    store = getStore('etl_design_jobs');
    room = await store.get('table-' + roomId, { type: 'json' });
  } catch (e) {
    console.error('[design-table-draft] room read failed', e && e.message);
    return json(500, { error: 'store_unavailable' });
  }
  if (!room) return json(404, { error: 'not_found' });
  if (!room.brief || !room.brief.promoting) return json(409, { error: 'no_brief' });

  const roomContext = roomContextFrom(room.transcript);

  const innerBody = {
    promoting:      room.brief.promoting,
    audience:       room.brief.audience,
    business_name:  room.brief.businessName,
    business_site:  room.brief.businessSite,
    platform:       room.brief.platform,
    look:           room.brief.look,
    caption_note:   room.brief.captionNote,
    brand_colours:  room.brief.brandColours,
    concept_image:  room.brief.conceptImage || '',
    logo_image:     room.brief.logoImage || '',
    use_upload_as_art: !!room.brief.useUploadAsArt,
    room_context:   roomContext,
    guest_id:       body.guest_id || null,
  };

  // A function call, not a fetch: etl-design-ask.js only ever reads
  // event.httpMethod, event.headers and event.body, so it runs unmodified.
  // Headers are forwarded whole (Authorization included) so a signed-in
  // member spends from their own membership rather than the guest pool.
  const innerEvent = {
    httpMethod: 'POST',
    headers: event.headers || {},
    body: JSON.stringify(innerBody),
  };

  let askResult;
  try {
    askResult = await askHandler(innerEvent);
  } catch (e) {
    console.error('[design-table-draft] etl-design-ask call failed', e && e.message);
    return json(502, { error: 'could_not_start' });
  }

  let askBody = {};
  try { askBody = JSON.parse(askResult.body || '{}'); } catch (_) {}

  if (askResult.statusCode !== 200 || !askBody.ok) {
    return json(askResult.statusCode || 502, Object.assign({ room_id: roomId }, askBody));
  }

  room.draft_job_id = askBody.job_id;
  room.draft_history = (room.draft_history || []).concat([askBody.job_id]).slice(-10);
  room.updated_at = new Date().toISOString();
  try { await store.setJSON('table-' + roomId, room); }
  catch (e) { console.error('[design-table-draft] room save failed (job already started)', e && e.message); }

  return json(200, {
    ok: true,
    room_id: roomId,
    job_id: askBody.job_id,
    kind: askBody.kind,
    guest_id: askBody.guest_id || null,
    remaining: askBody.remaining,
    credit_fault: askBody.credit_fault || null,
  });
};
