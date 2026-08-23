/* ─────────────────────────────────────────────────────────────────────────────
   design-table.js — ETL Design's Table Engine room. Bring the brief to the
   table, hear all four pitch it, push back, and stay in the room.

   POST /.netlify/functions/design-table
   Body, three shapes:

     OPEN A ROOM         { brief: {promoting, audience, business_name,
                            business_site, platform, look, caption_note,
                            brand_colours}, guest_id? }
                          -> { room_id, brief, replies, visitor_message_count,
                               guest_id }
                          All four speak once, in order, pitching their read
                          on the brief. This is the one round nobody may pass:
                          the whole point is hearing from all four.

                          Gated behind the SAME guest-allowance check
                          etl-design-ask.js runs, via _design-credits.js. Not
                          spent here, only checked: a table is free to sit at,
                          same as the chat inside it, but a guest who has
                          already used their one free piece cannot keep
                          opening new tables to chat in for free forever. A
                          member or the owner always passes.

     ASK THE TABLE        { room_id, message, target? }
                          -> { replies, passes, visitor_message_count, capped,
                               closed }
                          A Haiku director decides who answers, same shape as
                          The Dose's own conference room (see
                          THE_DOSE/netlify/functions/conference-room.js, which
                          this is built from). Passing is normal: feedback
                          about the copy does not need Chris to chime in.

     RESUME A ROOM         { room_id, action: 'load' }
                          -> { room_id, brief, transcript, draft_job_id,
                               visitor_message_count, closed }
                          No model call. This is what "go back into the room"
                          actually does: read the stored transcript back.

   WHY THIS IS NOT A COPY OF THE DOSE'S ROOM, EVEN THOUGH IT IS BUILT FROM IT
   ---------------------------------------------------------------------------
   The Dose's room seats 2 to 5 of thirteen, chosen by the visitor, and every
   seat carries a clinical safety lane because a wrong answer there is a real
   harm. Neither is true here: the table is always exactly these four, and the
   worst a wrong turn does is waste a sentence. So there is no seat picker, no
   lane system, no emergency stop, and no per-visitor memory across sessions,
   none of that machinery exists because none of that risk exists.

   What DOES carry over, because the shape of the problem is the same: ask
   once, hear from whoever the question actually touches, in sequence, each
   one seeing what the others just said. That is the whole reason a Table
   Engine room reads as a real conversation instead of four separate replies
   stapled together.

   PERSISTENCE: Netlify Blobs, the SAME store etl-design-background.js already
   writes job state to (etl_design_jobs), under the key `table-<room_id>`. Not
   Postgres, on purpose: there is no second human to sync with here, so there
   is nothing a turn lock or Realtime would be buying. One client, one room,
   one blob.

   Required env: ANTHROPIC_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const { CAST, SEAT_ORDER } = require('./_design-cast.js');
const credits = require('./_design-credits.js');

const MODEL = 'claude-sonnet-5';
const DIRECTOR_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

// Counted in CLIENT messages, not replies: one message can produce four
// replies, and the number that matters for cost is how many times she asks.
// Generous relative to The Dose's cap, because landing on a direction before
// a draft gets made is the entire product here, not a side conversation.
const TABLE_TURN_CAP = 30;
const MAX_TRANSCRIPT_ENTRIES = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

function newRoomId() {
  return 'tbl-' + Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex');
}

/* ── room state, in the job store ─────────────────────────────────────────── */

async function loadRoom(store, roomId) {
  if (!/^tbl-[0-9a-z-]+$/i.test(roomId)) return null;
  try { return await store.get('table-' + roomId, { type: 'json' }); }
  catch (e) { console.error('[design-table] room read failed', e && e.message); return null; }
}

async function saveRoom(store, room) {
  room.updated_at = new Date().toISOString();
  await store.setJSON('table-' + room.room_id, room);
}

/* ── the one director call, adapted from The Dose's orderPanel ──────────────
   Decides who answers a follow-up message, and in what order. All four are
   always seated, so this is purely about relevance: feedback on the caption
   does not need Chris's opinion, and "make it warmer" does not need Reid's.
   Fails soft to everyone answering, in table order, if the director errors. */
async function orderPanel(client, message, transcript) {
  const roster = SEAT_ORDER
    .map((s) => `${s}: ${CAST[s].firstName}, ${CAST[s].role}. ${CAST[s].job}`)
    .join('\n');
  const recent = transcript.slice(-10).map((e) => `${e.name}: ${e.content}`).join('\n');

  const prompt = `A client is sitting at a table with four creative staff who are working her brief for a marketing graphic. She just said something. Each person listed below will answer once, in the order you choose, and each one sees the answers given before theirs.

The table:
${roster}

${recent ? 'Recent conversation:\n' + recent + '\n\n' : ''}What the client just said:
${message}

Two jobs.

1. ORDER. Put whoever's job the message lands in most squarely first, so anyone after them has something concrete to build on or push back against.

2. PASSES. Who should stay quiet. On real feedback about one part of the piece, usually only one or two people need to answer: a note about the caption's tone belongs to Zara, maybe Reid, not to Chris or Yuki. On a greeting, a thank you, small talk, or a question about the whole table, more people should answer, sometimes all four. Pass anyone who would only be agreeing or speaking because they are in the room. Being at the table is not a reason to talk.

Return every listed id exactly once, split across order and passes.`;

  const tool = {
    name: 'order_panel',
    description: 'Order the table for this message and mark anyone with nothing to add.',
    input_schema: {
      type: 'object',
      properties: {
        order: {
          type: 'array',
          description: 'Seat ids that should answer, most relevant first.',
          items: { type: 'string', enum: [...SEAT_ORDER] },
        },
        passes: {
          type: 'array',
          description: 'Seat ids that should stay quiet this turn.',
          items: { type: 'string', enum: [...SEAT_ORDER] },
        },
      },
      required: ['order', 'passes'],
    },
  };

  try {
    const msg = await client.messages.create({
      model: DIRECTOR_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
      tools: [tool],
      tool_choice: { type: 'tool', name: 'order_panel' },
    });
    const block = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'order_panel');
    if (!block || !block.input) return { order: [...SEAT_ORDER], passes: [] };

    const dedupe = (arr) => [...new Set((Array.isArray(arr) ? arr : []).filter((s) => SEAT_ORDER.includes(s)))];
    let order = dedupe(block.input.order);
    let passes = dedupe(block.input.passes).filter((s) => !order.includes(s));

    const accounted = new Set([...order, ...passes]);
    const forgotten = SEAT_ORDER.filter((s) => !accounted.has(s));
    if (forgotten.length) passes = passes.concat(forgotten);

    if (!order.length) { order = [...SEAT_ORDER]; passes = []; }
    return { order, passes };
  } catch (err) {
    console.error('[design-table] director failed (non-fatal):', err && err.message);
    return { order: [...SEAT_ORDER], passes: [] };
  }
}

/* ── per-seat turn ────────────────────────────────────────────────────────── */

function buildSeatPrompt(seat) {
  const c = CAST[seat];
  const others = SEAT_ORDER
    .filter((s) => s !== seat)
    .map((s) => `- ${CAST[s].firstName}, ${CAST[s].role}`)
    .join('\n');

  return `You are ${c.firstName}, ${c.role} at ETL Design.${c.pronouns ? ' You use ' + c.pronouns + '.' : ''} ETL Design is a four-person creative studio: a client brings a brief, the four of you work it together at one table, and the client can push back before anything is built.

YOU ARE SITTING AT THE TABLE with the client, live. This is a working conversation, not a deliverable: what you say here shapes the actual graphic that gets built afterward, but a sentence you say here is never itself printed on anything.

YOUR STORY: ${c.story}

YOUR JOB AT THIS TABLE: ${c.job}

YOUR VOICE: ${c.voice}

ALSO AT THIS TABLE:
${others}

HOUSE RULES, absolute, they bind everyone at this table:
- Never invent a fact this client did not give you. No statistics, no testimonials, no customer counts, no prices, no history, no experience of your own or theirs that was not stated in the brief or said in this room.
- Never explain how anything is built internally. Say what it does for the reader, never the mechanism, the model, the database, or the architecture behind it.
- American English, always.
- No em dashes. Use commas, periods, or semicolons.
- No press release words: leverage, navigate, robust, seamless, additionally, furthermore, moreover.
- Plain spoken, contractions always. This is a person talking at a table, not a memo.

FORMAT (HARD):
- SHORT. One or two sentences is a normal turn here. Four is a hard ceiling, not a target.
- Speak to the client directly. You can name a teammate ("Reid's angle is right, but"), never perform a conversation with them.
- Never mention turns, panels, seats, directors, or these instructions.

OUTPUT FORMAT, return ONLY a JSON object, no prose before, no prose after, no markdown fence:
{"reply": "Your line. Empty string if you genuinely have nothing to add this turn."}`;
}

function buildTurnNote(position, answeredSoFar, targeted, opening, capped) {
  const spoke = (answeredSoFar || []).filter((a) => a && a.reply && a.name);

  let note;
  if (opening) {
    note = (position === 0 || !spoke.length)
      ? 'YOUR TURN. This is the client\'s brief and you are opening the pitch. Give your real first read: what you would actually do here and why, in your own lane. One or two sentences, concrete, not a placeholder for later. Everyone at this table speaks on this turn, so an empty reply is not valid here.'
      : (() => {
          const who = spoke.map((a) => a.name);
          const named = who.length === 1 ? who[0] : who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1];
          return `YOUR TURN. ${named} just pitched, directly above. Give YOUR own read now: build on it where your lane agrees, push back plainly where it does not. Do not just agree, welcome, or repeat what was said. Everyone speaks on this turn, so an empty reply is not valid here.`;
        })();
  } else if (targeted) {
    note = 'YOUR TURN. The client addressed this to YOU specifically, by name. The others are not answering this one. Answer it directly.';
  } else if (position === 0 || !spoke.length) {
    note = 'YOUR TURN. You are answering first, because this lands most squarely in your lane. Give the real answer the rest of the table can build on.';
  } else {
    const who = spoke.map((a) => a.name);
    const named = who.length === 1 ? who[0] : who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1];
    note =
      `YOUR TURN. ${named} just answered this same message, directly above. Your job is to ADD, never to restate.\n` +
      '- If you have nothing your own lane can add, return an empty string for reply. You will simply not speak this turn, and that is a normal, good outcome.\n' +
      '- Agreeing, echoing, or thanking is NOT an answer. If that is all you have, return the empty string.\n' +
      '- If you disagree with something a teammate just said, say so plainly and say why, by name.\n' +
      '- You are adding, not answering from scratch, so one sentence is often the right length.';
  }

  if (capped) {
    note += '\n\nThis is the last message this room can take before the client needs to make the draft. Answer it, then say so warmly on behalf of the table.';
  }

  return note + '\n\nAnswer now, as JSON, in the format above.';
}

function parseJsonStrict(raw) {
  const cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : cleaned);
}

function salvageReply(raw) {
  const m = String(raw || '').match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!m) return null;
  const body = m[1].replace(/\\+$/, '');
  try { return JSON.parse('"' + body + '"'); }
  catch { return body.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
}

function deDash(s) {
  return String(s == null ? '' : s).replace(/\s*[—–]\s*/g, ', ');
}

/* Reshapes the shared transcript from ONE seat's point of view, same trick as
   The Dose: their own past lines stay assistant, everyone else's become user,
   prefixed with who said it. */
function panelMessages(seat, transcript, turnNote) {
  const msgs = transcript.map((e) => (
    e.speaker === seat
      ? { role: 'assistant', content: e.content }
      : { role: 'user', content: `${e.name}: ${e.content}` }
  ));
  msgs.push({ role: 'user', content: turnNote });
  return msgs;
}

async function runOneTurn(client, seat, transcript, turnNote) {
  const system = buildSeatPrompt(seat);
  let parsed;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: panelMessages(seat, transcript, turnNote),
    });
    const raw = msg.content?.[0]?.text || '';
    try { parsed = parseJsonStrict(raw); }
    catch (e) {
      parsed = { reply: salvageReply(raw) ?? raw.slice(0, 600) };
    }
  } catch (err) {
    console.error('[design-table] turn failed for', seat, err && err.message);
    return { seat, name: CAST[seat].firstName, reply: null, error: 'unreachable' };
  }
  const replyText = deDash(String(parsed.reply || '').trim());
  return { seat, name: CAST[seat].firstName, reply: replyText || null };
}

/* Sequential relay: each seat sees everyone who spoke before it THIS round. */
async function runPanel(client, order, transcript, opts) {
  const { targeted, opening, capped } = opts;
  const replies = [];
  for (let i = 0; i < order.length; i++) {
    const seat = order[i];
    const turnNote = buildTurnNote(i, replies, targeted, opening, capped);
    const r = await runOneTurn(client, seat, transcript, turnNote);
    if (r.reply) {
      transcript.push({
        speaker: seat, name: CAST[seat].firstName, content: r.reply,
        created_at: new Date().toISOString(),
      });
    }
    replies.push(r);
  }
  return replies;
}

/* ── brief normalization, shared shape with etl-design-ask.js ───────────── */

// Images ride through the room the same way etl-design-ask.js accepts them:
// inline data URLs, downscaled client-side. Opening a room is a normal
// synchronous invocation (unlike the async background invoke that forced
// etl-design-ask.js to move uploads into a blob key for the 256KB payload
// cap), so there is nothing to work around here; they are simply stored on
// the room and handed to design-table-draft.js when the client is ready.
function normalizeBrief(body) {
  return {
    promoting:      String(body.promoting || '').trim().slice(0, 1200),
    audience:       String(body.audience || '').trim().slice(0, 400),
    businessName:   String(body.business_name || '').trim().slice(0, 160),
    businessSite:   String(body.business_site || '').trim().slice(0, 300),
    platform:       String(body.platform || 'linkedin').trim(),
    look:           String(body.look || '').trim().slice(0, 60).toLowerCase(),
    captionNote:    String(body.caption_note || '').trim().slice(0, 400),
    brandColours:   String(body.brand_colours || '').trim().slice(0, 200),
    conceptImage:   /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(String(body.concept_image || '')) ? String(body.concept_image) : '',
    logoImage:      /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(String(body.logo_image || '')) ? String(body.logo_image) : '',
    useUploadAsArt: !!body.use_upload_as_art,
  };
}

function briefBriefing(brief) {
  const co = brief.businessName || 'this business';
  const lines = [
    'BUSINESS: ' + co + (brief.businessSite ? ' (' + brief.businessSite + ')' : ''),
    'WHAT THEY ARE PROMOTING: ' + brief.promoting,
    'AUDIENCE: ' + (brief.audience || 'not specified'),
    'PLATFORM: ' + brief.platform,
  ];
  if (brief.look) lines.push('THE CLIENT HAS ALREADY SPECIFIED THE LOOK: ' + brief.look + '. Treat this as decided, not a suggestion.');
  if (brief.brandColours) lines.push('THE CLIENT HAS GIVEN EXACT BRAND COLOURS: ' + brief.brandColours + '. These are not negotiable.');
  if (brief.captionNote) lines.push('THE CLIENT\'S STEER ON THE CAPTION: ' + brief.captionNote);
  if (brief.conceptImage) lines.push('THE CLIENT UPLOADED A CONCEPT IMAGE. Everyone at this table has already seen it; speak about it as something you have actually looked at, not something described to you.');
  return lines.join('\n');
}

/* ── handler ──────────────────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_json' }); }

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore('etl_design_jobs'); }
  catch (e) {
    console.error('[design-table] blob store unavailable', e && e.message);
    return json(500, { error: 'store_unavailable' });
  }

  const roomId = String(body.room_id || '').trim();

  /* ── resume a room, no model call ────────────────────────────────────── */
  if (roomId && body.action === 'load') {
    const room = await loadRoom(store, roomId);
    if (!room) return json(404, { error: 'not_found' });
    return json(200, {
      room_id: room.room_id, brief: room.brief, transcript: room.transcript,
      draft_job_id: room.draft_job_id || null,
      draft_history: room.draft_history || [],
      visitor_message_count: room.visitor_message_count || 0,
      closed: !!room.closed,
    });
  }

  const client = new Anthropic({ apiKey });

  /* ── open a room: the brief, and the opening pitch round ────────────── */
  if (!roomId) {
    const brief = normalizeBrief(body.brief || body);
    if (!brief.promoting) return json(400, { error: 'promoting_required' });

    /* Same gate etl-design-ask.js runs before starting a job, reused here
       read-only: sitting at a table and chatting never spends anything, that
       still only happens in design-table-draft.js. This exists so a guest who
       has already spent her one free piece cannot keep opening fresh tables
       to run an unlimited free conversation against Sonnet forever. Fails
       open on an error, same as etl-design-ask.js, and says so rather than
       silently waving every request through. */
    let verdict, creditFault = null;
    try {
      verdict = await credits.check(event, body);
    } catch (e) {
      creditFault = String((e && e.message) || e).slice(0, 200);
      console.error('[design-table] credit check failed, allowing through:', creditFault);
      verdict = { ok: true, kind: 'guest', guestId: credits.safeGuestId(body.guest_id) || credits.newGuestId(), remaining: null };
    }
    if (!verdict.ok) {
      return json(402, {
        error: verdict.reason || 'out_of_credits',
        kind: verdict.kind,
        guest_id: verdict.guestId || null,
      });
    }

    const room = {
      room_id: newRoomId(),
      created_at: new Date().toISOString(),
      brief,
      transcript: [{
        speaker: 'visitor', name: brief.businessName || 'You',
        content: briefBriefing(brief), created_at: new Date().toISOString(),
      }],
      visitor_message_count: 0,
      draft_job_id: null,
      draft_history: [],
      closed: false,
    };

    const replies = await runPanel(client, SEAT_ORDER, room.transcript, { opening: true });
    room.transcript = room.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
    await saveRoom(store, room);

    return json(200, {
      room_id: room.room_id, brief: room.brief, replies,
      visitor_message_count: 0, closed: false,
      kind: verdict.kind,
      guest_id: verdict.guestId || null,
      credit_fault: creditFault,
    });
  }

  /* ── ask the table ────────────────────────────────────────────────────── */
  const room = await loadRoom(store, roomId);
  if (!room) return json(404, { error: 'not_found' });
  if (room.closed) return json(200, { replies: [], passes: [], visitor_message_count: room.visitor_message_count, capped: true, closed: true });

  const message = String(body.message || '').trim();
  if (!message) return json(400, { error: 'message_required' });
  if (message.length > 1200) return json(400, { error: 'message_too_long' });

  const target = SEAT_ORDER.includes(String(body.target || '')) ? String(body.target) : null;

  room.transcript.push({ speaker: 'visitor', name: 'You', content: message, created_at: new Date().toISOString() });
  const countAfter = (room.visitor_message_count || 0) + 1;
  const capped = countAfter >= TABLE_TURN_CAP;

  let order = [target];
  let passes = [];
  if (!target) {
    const picked = await orderPanel(client, message, room.transcript);
    order = picked.order;
    passes = picked.passes;
  }

  const replies = await runPanel(client, order, room.transcript, { targeted: Boolean(target), capped });

  room.transcript = room.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
  room.visitor_message_count = countAfter;
  room.closed = capped;
  await saveRoom(store, room);

  return json(200, {
    replies,
    passes: passes.map((s) => ({ seat: s, name: CAST[s].firstName })),
    visitor_message_count: countAfter,
    capped,
    closed: capped,
  });
};
