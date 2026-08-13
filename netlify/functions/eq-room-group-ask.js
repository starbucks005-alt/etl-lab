/* eq-room-group-ask — Almost Human's group room: several agents in one shared
   table, actually talking to each other, not just to the guest.

   This is an EXTENSION of the 1:1 EQ Room (eq-room-ask.js), not a rework of it.
   That endpoint is untouched; this file is self-contained and duplicates the
   small amount of logic it needs (conduct check, forced-tool turn parsing) so
   the working 1:1 room is never put at risk by this build.

   POST {
     active_agents:  string[]   — 2 to MAX_ROOM_AGENTS known agent keys
     transcript:     [{speaker, name, content}]  — shared room log so far
                       (speaker is an agent key, or "visitor")
     message:        string     — the guest's new message (omit when ambient)
     ambient?:       boolean    — true for an idle-pause check-in with no new
                       guest message; at most one discretionary speaker, never
                       spends the guest's turn budget, see pickNextSpeaker
     agent_state:    { [agentKey]: { scales, meters, turn_count } }
     visitor_message_count?: number
     visitor_id?, visitor_name?, visitor_pronoun?, remember?, owner_key?
   }
   Returns {
     replies: [{ agent_key, agent_name, reply, scales, meters, closed, grade? }],
     transcript_append: [{speaker, name, content}]  — same entries, for the client to append
     active_agents: string[]   — roster after removing anyone who closed this turn
     visitor_message_count, capped, closed
   }

   TWO HUMANS AT THE TABLE (the "bring a friend" mode)
   ---------------------------------------------------
   POST { seat_token } instead of { transcript, agent_state, active_agents,
   access_token } and this endpoint runs the SAME cascade against a room in
   Postgres rather than against state posted from a browser. See
   supabase_ah_table_migration.sql and _ah-table.js.

   The cascade itself is deliberately not duplicated. Everything below the
   "── the cascade ──" line is one copy of the director, the persona pipeline,
   and the emotion-engine math, and it does not know or care where its state
   came from. A second copy of this file for shared rooms would have meant two
   emotion engines drifting apart, which is a far worse outcome than one
   function with two ways of loading its inputs.

   WHY THE STATE HAD TO MOVE. The solo table keeps each agent's scales, meters
   and turn count in the browser and posts them back every turn. With two humans
   there are two copies of that and they diverge on the very first turn: whoever
   asks sends their stale copy and silently overwrites the other person's. So in
   shared mode agent_state is read from and written to the room row, under the
   turn lock, and no browser is trusted with it. Nothing renders those numbers at
   the table today, which means the divergence would have been invisible while
   still corrupting the exit grades and the memory saves — a reason to be more
   careful here, not less.

   Mechanic: a cheap Haiku "director" call reads the room and picks ONE agent to
   speak next (or "none"), that agent's reply always goes through the full,
   unmodified persona pipeline (buildSystemPrompt + forced respond_in_room tool +
   the real emotion-engine math), then the director runs again to decide whether
   another agent chimes in, up to CASCADE_CAP replies per guest message. Only the
   first beat is ever guaranteed; every beat after that is genuine discretion, so
   the room doesn't lock into the same reply count every single time.
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');
const { buildSystemPrompt, PERSONAS, ROOM_HOOKS, etlKnowledgeNote } = require('./_eq-personas.js');
const engine = require('./_eq-engine.js');
const { ownerUser } = require('./_owner-auth.js');
const {
  getCreditRow, getCreditRowByRef, deductCredits, deductCreditsByRef,
  GROUP_MESSAGE_COST, safeToken,
} = require('./_ah-credits.js');
const table = require('./_ah-table.js');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const TURN_MODEL = 'claude-sonnet-5';
const DIRECTOR_MODEL = 'claude-haiku-4-5-20251001';
const SMOOTHING = 0.8;
const JUDGE_CADENCE = 3;

// Bounds cost and keeps the room legible. Frontend already caps agent selection
// at 4; this is a server-side sanity ceiling, not the primary control.
const MAX_ROOM_AGENTS = 6;
// A real group beat has a couple of people respond before it circles back to
// the guest, not everyone at once. Separate cost lever from the per-agent
// persona quality, which is never degraded.
const CASCADE_CAP = 3;
// Own constant, not eq-room-ask.js's DEFAULT_TURN_CAP (20): a group "turn"
// produces more total content per guest message than a 1:1 turn, so the cap
// is on guest messages, counted lower. Not given a fixed number in any spec;
// placeholder pending a real playthrough, same status as the 1:1 cap.
const GROUP_VISITOR_TURN_CAP = 12;
const MAX_TRANSCRIPT_ENTRIES = 40;

const ROSTER_NAMES = {
  ivy: 'Ms. Ivy (Ivy Sinclair)',
  auggie: 'August "Auggie" Vidal',
  dom: 'Coach Dom Castellanos',
  chris: 'Chris Avila',
  arthur: 'Dr. Arthur Pendelton',
  jen: 'Jen Lopez',
  noor: 'Noor Haddad',
  mara: 'Mara Rivera',
  marceline: 'Marceline Smith',
  marcus: 'Marcus Holt',
  jax: 'Jax Rivera',
  reece: 'Reece',
  wyatt: 'Wyatt Cooper',
  zara: 'Zara Cole',
  walt: 'Walt Brenner',
  nadia: 'Nadia',
  arun: 'Arun',
  margo: 'Margo',
  arch: 'Archibald Baxter',
  amina: 'Dr. Amina Farouk',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

const PRONOUN_LINES = { he: 'he/him', she: 'she/her', they: 'they/them' };
function safePronoun(v) {
  const s = String(v || '').trim().toLowerCase();
  return PRONOUN_LINES[s] ? s : null;
}

// Same two owner-key systems as eq-room-ask.js (see that file's comment):
// OWNER_KEYS (plural, _owner-auth.js) and OWNER_KEY (singular, admin tools).
function isOwnerKey(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  if (ownerUser(k)) return true;
  return !!process.env.OWNER_KEY && k === process.env.OWNER_KEY;
}

async function conductStatus(visitorId, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_conduct?visitor_id=eq.${encodeURIComponent(visitorId)}&select=strikes,banned,updated_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return { banned: false, locked: false };
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return { banned: false, locked: false };
    const row = rows[0];
    const locked = !row.banned && row.strikes > 0 &&
      (Date.now() - new Date(row.updated_at).getTime()) < 3600000;
    return { banned: !!row.banned, locked };
  } catch (_) { return { banned: false, locked: false }; }
}

async function conductStrike(visitorId, agentKey, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_conduct?visitor_id=eq.${encodeURIComponent(visitorId)}&select=strikes`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = r.ok ? await r.json() : [];
    const strikes = ((Array.isArray(rows) && rows[0]) ? rows[0].strikes : 0) + 1;
    await fetch(`${SUPABASE_URL}/rest/v1/etl_conduct?on_conflict=visitor_id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ visitor_id: visitorId, strikes, banned: strikes >= 2, last_agent: agentKey, updated_at: new Date().toISOString() }),
    });
  } catch (err) { console.error('eq-room-group conduct strike failed:', err.message); }
}

async function fetchCanonExtras(agentKey, serviceKey) {
  const rosterName = ROSTER_NAMES[agentKey];
  if (!rosterName || !serviceKey) return null;
  try {
    const [memRes, moodRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/etl_agent_memories?agent_name=eq.${encodeURIComponent(rosterName)}&status=eq.canon&select=kind,title,memory&order=weight.desc&limit=4`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }),
      fetch(`${SUPABASE_URL}/rest/v1/etl_agent_emotions?agent_name=eq.${encodeURIComponent(rosterName)}&status=eq.canon&select=mood,intensity,cause&order=created_at.desc&limit=1`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }),
    ]);
    const memories = memRes.ok ? await memRes.json() : [];
    const moodRows = moodRes.ok ? await moodRes.json() : [];
    return {
      memories: Array.isArray(memories) ? memories : [],
      mood: Array.isArray(moodRows) && moodRows.length ? moodRows[0] : null,
    };
  } catch (err) {
    console.error('eq-room-group canon fetch failed (non-fatal):', err.message);
    return null;
  }
}

function sanitizeReply(text) {
  const truncated = String(text || '').split(/<\/?parameter\b/i)[0];
  return truncated
    .replace(/<\/?cite[^>]*>/gi, '')
    .replace(/\\n/g, '\n')
    .trim();
}

const TURN_TOOL = {
  name: 'respond_in_room',
  description: 'Deliver your in-character reply for this turn and report how it moved your feelings.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Your in-character spoken reply. Never reference felt, reason, or close.' },
      felt: {
        type: 'object',
        description: 'How strongly each emotion is actually firing in you this turn, 0 (not at all) to 8 (as hard as it gets). Only report a real number when that emotion genuinely fired; most turns most of them sit low or near 0.',
        properties: {
          happiness: { type: 'number' }, sadness: { type: 'number' }, fear: { type: 'number' },
          disgust: { type: 'number' }, anger: { type: 'number' }, surprise: { type: 'number' }, curious: { type: 'number' },
        },
        required: ['happiness', 'sadness', 'fear', 'disgust', 'anger', 'surprise', 'curious'],
      },
      reason: { type: 'string', description: 'One short out-of-character note on why your state moved.' },
      close: { type: 'boolean', description: 'True only for the abuse-guardrail case. A guest or another agent saying goodbye is NOT abuse, false on every ordinary turn including farewells.' },
    },
    required: ['reply', 'felt', 'close'],
  },
};

function parseTurnResponse(msg) {
  const toolBlock = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'respond_in_room');
  if (toolBlock && toolBlock.input && typeof toolBlock.input.reply === 'string' && toolBlock.input.reply.trim()) {
    const input = toolBlock.input;
    const felt = {};
    for (const key of engine.ALL_SCALE_KEYS) {
      const v = input.felt && input.felt[key];
      felt[key] = typeof v === 'number' ? Math.max(-8, Math.min(8, v)) : 0;
    }
    return {
      reply: sanitizeReply(input.reply),
      felt,
      reason: typeof input.reason === 'string' ? input.reason.slice(0, 300) : '',
      close: input.close === true,
    };
  }
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const felt = {};
  for (const key of engine.ALL_SCALE_KEYS) felt[key] = 0;
  return {
    reply: text || "Sorry, lost my train of thought there for a second.",
    felt,
    reason: 'fallback: model did not return the expected structure',
    close: false,
  };
}

// Formats the shared transcript from ONE agent's point of view: their own
// past lines stay role:'assistant' (unprefixed, natural); everyone else's
// lines (the guest's and every other agent's) become role:'user', prefixed
// with who said it, so the model has a clear "that's someone else" signal.
// The Anthropic API allows consecutive user-role messages, so this needs no
// invented API shape.
function buildMessagesFor(agentKey, transcript) {
  return transcript.map((entry) => {
    if (entry.speaker === agentKey) {
      return { role: 'assistant', content: entry.content };
    }
    return { role: 'user', content: `${entry.name}: ${entry.content}` };
  });
}

// One cheap Haiku call: who should speak next. When forced=true there is no
// "none" option (only beat 0 is ever forced, see the caller: someone should
// always respond to the guest). Every beat after that is real discretion,
// judged honestly per moment, not floored at a guaranteed count. An earlier
// version forced the first two beats, which fixed "agents only talk to me"
// but overcorrected into a rigid, metronomic "always exactly 2-3 replies,
// same shape every time," which reads just as fake as one reply always did.
async function pickNextSpeaker(client, activeAgents, transcript, beatIndex, forced, ambient) {
  const roster = activeAgents.map((k) => `${k}: ${PERSONAS[k].name}, ${PERSONAS[k].role}. ${ROOM_HOOKS[k] || ''}`).join('\n');
  const transcriptText = transcript
    .slice(-16)
    .map((e) => `${e.name}: ${e.content}`)
    .join('\n');
  const instruction = ambient
    ? 'The guest has gone quiet for a few seconds, nobody has said anything new. Most of the time nobody needs to add anything right now, and that is completely fine, a real room sits quiet sometimes. Only pick a name if a specific person at this table would genuinely have an unprompted thought right now: a late reaction to what was said, a follow-up on their own last point. This should be rare, not a habit.'
    : beatIndex === 0
    ? 'The guest just said something new. Pick whoever at the table would naturally jump in first.'
    : 'Judge this specific moment honestly, the way a real table actually works: sometimes one reply is plenty and the conversation naturally pauses there, sometimes someone can\'t help reacting to what was just said, occasionally a third person jumps in too, but that\'s the rare case, not the default. Don\'t reach for a reaction just to keep the beat going. Only pick a name if a specific person at this table would genuinely, naturally have something to say about what the LAST person just said.';
  const prompt = `You're directing a real group conversation at a table: several coworkers and one guest, actually talking to each other, not taking turns answering the guest one at a time. People at the table:\n${roster}\n\n` +
    `Recent conversation:\n${transcriptText}\n\n${instruction}` +
    (forced
      ? ' Pick exactly one agent key from the roster above.'
      : ' Pick exactly one agent key from the roster above, or "none" if nobody would genuinely add anything right now.');

  const enumValues = forced ? [...activeAgents] : [...activeAgents, 'none'];
  const tool = {
    name: 'pick_speaker',
    description: forced ? 'Choose who speaks next in the room.' : 'Choose who speaks next in the room, or none.',
    input_schema: {
      type: 'object',
      properties: { speaker: { type: 'string', enum: enumValues } },
      required: ['speaker'],
    },
  };

  try {
    const msg = await client.messages.create({
      model: DIRECTOR_MODEL,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
      tools: [tool],
      tool_choice: { type: 'tool', name: 'pick_speaker' },
    });
    const toolBlock = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'pick_speaker');
    const speaker = toolBlock && toolBlock.input && toolBlock.input.speaker;
    if (speaker && activeAgents.includes(speaker)) return speaker;
    return forced ? activeAgents[0] : null;
  } catch (err) {
    console.error('eq-room-group director failed (non-fatal):', err.message);
    return forced ? activeAgents[0] : null;
  }
}

/* The cast still generates from the WHOLE thread — otherwise the host has to
   re-explain herself the moment her friend sits down, which is the clerical
   work this feature exists to delete. So what the guest cannot SEE is enforced
   in ah-table-poll.js, and what the cast may not SAY about it is this.

   Be honest about the difference: the first is enforced, the second is an
   instruction to a language model. The UI copy promises only the first. */
function privacyNoteFor(people, transcriptRows) {
  const guests = people.filter((p) => !p.is_host);
  if (!guests.length) return '';
  const latestJoin = guests
    .map((p) => new Date(p.joined_at).getTime())
    .reduce((a, b) => Math.max(a, b), 0);
  const priorLines = transcriptRows.filter(
    (e) => e.created_at && new Date(e.created_at).getTime() < latestJoin
  ).length;
  if (!priorLines) return '';

  const host = people.find((p) => p.is_host);
  const hostName = (host && host.display_name) || 'the person who opened this table';
  const guestNames = guests.map((p) => p.display_name || 'their friend').join(' and ');

  return `\n\nPRIVACY AT THIS TABLE, absolute:\n` +
    `${guestNames} joined partway through. Everything said before that was between ${hostName} and this table, and they cannot see any of it.\n` +
    `- Do NOT repeat, quote, summarize, or allude to anything from before they joined while they are here.\n` +
    `- That includes anything ${hostName} told you about herself earlier, and anything you remember about her from other visits.\n` +
    `- You may still USE what you know to be good company. You may not SAY it. Take what is in front of you on its own terms.\n` +
    `- If ${hostName} raises something from earlier herself, it is hers to raise and you can follow her lead.\n` +
    `- Never mention that there is an earlier part of the conversation. Do not hint at it, and do not say that you cannot discuss it.`;
}

/* Two people at a table is a different social situation than one, and the cast
   should be told so plainly rather than left to infer it from name prefixes. */
function roomPeopleNote(people, askerName) {
  if (people.length < 2) return '';
  const names = people.map((p) => p.display_name || 'Guest');
  const list = names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return `\n\nTHERE ARE ${names.length} PEOPLE AT THIS TABLE, not one: ${list}. ` +
    `Every line in the conversation is labelled with who said it. Treat them as two different people who ` +
    `know each other but do not know everything about each other: something one of them told you is not ` +
    `something the other one has heard.` +
    (askerName ? ` ${askerName} is the one who just spoke.` : '');
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ── which table is this? ────────────────────────────────────────────────
  // A seat token means a shared room: two humans, state in Postgres. Anything
  // else is the solo table, unchanged, entirely in one browser.
  //
  // Note the room is read from the SEAT, never from the request body. A caller
  // cannot name a room they are not sitting at.
  let shared = null;
  if (body.seat_token) {
    if (!serviceKey) return json(500, { error: 'not_configured' });
    shared = await table.identify(serviceKey, body.seat_token);
    if (!shared) return json(401, { error: 'not_at_this_table' });
    const usable = table.roomIsUsable(shared.room);
    if (!usable.ok) {
      // seat_closed, not just closed: it tells the client nothing further is
      // coming for THIS person, so it can stop rather than waiting on a poll
      // for a last line that will never be written. See the conduct branch
      // below for the other case that needs the distinction.
      return json(200, {
        ok: true, shared: true, replies: [], transcript_append: [],
        active_agents: [], closed: true, seat_closed: true,
        message: 'This conversation has ended.',
      });
    }
  }

  // Ambient mode: the client checks in after a quiet pause with no new guest
  // message, giving the table a chance to add an unprompted beat on its own,
  // the way a real room doesn't go dead the second you stop talking. At most
  // one genuinely-discretionary speaker, never counts against the guest's
  // turn budget, and the client caps how many of these it asks for in a row.
  // In a shared room only the HOST's browser schedules these, so two people
  // sitting quietly don't run the table twice as fast as one.
  const isAmbient = body.ambient === true;
  const message = String(body.message || '').trim();
  if (!isAmbient) {
    if (!message) return json(400, { error: 'message_required' });
    if (message.length > 2000) return json(400, { error: 'message_too_long' });
  }

  // Two different questions that used to be one. `callerIsOwner` is about the
  // person holding this browser (conduct). `freeRoom` is about who pays, which
  // in a shared room is always the host, whoever asked. Without the split, a
  // guest at an owner-hosted table would inherit the owner's conduct bypass.
  const callerIsOwner = isOwnerKey(body.owner_key);
  const freeRoom = shared ? Boolean(shared.room.host_is_owner) : callerIsOwner;
  const iAmHost = shared ? Boolean(shared.seat.is_host) : true;

  const visitorName = shared
    ? (shared.seat.display_name || null)
    : (String(body.visitor_name || '').trim().slice(0, 40) || null);
  const visitorPronoun = safePronoun(shared ? shared.seat.pronoun : body.visitor_pronoun);
  const visitorPronounLine = visitorPronoun ? PRONOUN_LINES[visitorPronoun] : null;

  const visitorId = safeVisitorId(shared ? shared.seat.visitor_id : body.visitor_id);
  const canCheck = Boolean(visitorId && serviceKey) && !callerIsOwner;

  if (canCheck) {
    const conduct = await conductStatus(visitorId, serviceKey);
    if (conduct.banned || conduct.locked) {
      // Conduct is per person, not per room. At a shared table this shuts the
      // door on THIS person and deliberately leaves the room open: one guest
      // earning a strike is not a reason to end the host's conversation. So
      // seat_closed, and the room row is not touched.
      return json(200, {
        replies: [], transcript_append: [],
        active_agents: shared ? (shared.room.active_agents || []) : [],
        closed: true, seat_closed: true, message: 'This conversation is closed.',
      });
    }
  }

  // ── the turn lock ───────────────────────────────────────────────────────
  // Claimed BEFORE the credit read, not after, and that ordering is the point:
  // two people asking at the same instant would otherwise both read the same
  // balance and both deduct from it. Everything from here to the finally block
  // runs with the room held.
  if (shared) {
    const got = await table.claimTurn(serviceKey, shared.room.id);
    if (!got) {
      if (isAmbient) {
        // A quiet-pause check that lost the race is nothing; the person who won
        // it is mid-cascade and that is exactly what should be happening.
        return json(200, { ok: true, shared: true, replies: [], transcript_append: [], closed: false });
      }
      return json(409, {
        error: 'table_busy',
        message: 'Someone else is asking the table something. Give it a second and try again.',
      });
    }
  }

  // Whatever the cascade changes about the room accumulates here and is written
  // back exactly once, at the bottom of this handler, in the same statement
  // that drops the lock. Every exit path from runTurn() goes through it,
  // including the ones that throw.
  const roomPatch = {};

  async function runTurn() {

  // ── the paywall ─────────────────────────────────────────────────────────
  // The group table is 100% behind the $9.99/mo tier, no free access at all.
  //
  // In a shared room the HOST pays for every question regardless of who asked,
  // and the guest must never see a balance, a paywall, or a top-up prompt: being
  // asked to buy credits for somebody else's room is a bad moment. So the charge
  // is made against the reference on the room row rather than against a token
  // the caller sent, and a guest's browser has no way to reach either.
  let creditsRow = null;
  if (!freeRoom && serviceKey) {
    creditsRow = shared
      ? await getCreditRowByRef(shared.room.host_credit_ref, serviceKey)
      : await getCreditRow(safeToken(body.access_token), serviceKey);
  }
  const isSubscriber = Boolean(!freeRoom && creditsRow && creditsRow.subscription_active);
  const hasEnoughForGroup = isSubscriber && creditsRow.balance >= GROUP_MESSAGE_COST;

  if (!freeRoom && !hasEnoughForGroup) {
    if (isAmbient) {
      // Ambient checks are a background nicety, never worth surfacing an
      // error for; just come back empty so the client quietly reschedules.
      return json(200, { replies: [], transcript_append: [], active_agents: [], closed: false });
    }
    const reason = !isSubscriber ? 'subscription_required' : 'credits_exhausted';
    const hostFacing = reason === 'subscription_required'
      ? 'The table is a member perk. Upgrade to join.'
      : "You're out of credits for this cycle. Add more, or wait for next month's top-up.";
    // Both people need to know the table stopped, not just whoever happened to
    // hit the wall. The 'system:credits' speaker is rendered as a plain note by
    // everyone and additionally raises the top-up button in the host's browser.
    if (shared) {
      await table.insertMessage(serviceKey, shared.room.id, {
        speaker: 'system:credits',
        name: 'The table',
        content: 'The table is out of turns for now.',
      });
    }
    return json(200, {
      replies: [], transcript_append: [], active_agents: [], closed: false,
      error: reason,
      // The one thing a guest must not be offered. Absent in solo mode, where
      // the person asking is always the person who pays.
      can_top_up: iAmHost,
      message: iAmHost ? hostFacing : 'The table is out of turns for now.',
    });
  }

  // ── inputs: from Postgres in a shared room, from the browser otherwise ──
  const transcriptRows = shared
    ? await table.loadTranscript(serviceKey, shared.room.id, MAX_TRANSCRIPT_ENTRIES)
    : (Array.isArray(body.transcript) ? body.transcript : []);

  let transcript = transcriptRows
    .filter((e) => e && typeof e.content === 'string' && e.content.trim() && typeof e.name === 'string')
    .map((e) => ({ speaker: String(e.speaker || 'visitor'), name: e.name, content: e.content.trim() }))
    .filter((e) => e.speaker === 'visitor' || engine.AGENTS[e.speaker])
    .slice(-MAX_TRANSCRIPT_ENTRIES);

  const activeAgents = (shared
    ? (shared.room.active_agents || [])
    : (Array.isArray(body.active_agents) ? body.active_agents : []))
    .map((a) => String(a || '').trim().toLowerCase())
    .filter((a, i, all) => engine.AGENTS[a] && all.indexOf(a) === i);

  // Two is the minimum to START a table; it is not the minimum to keep one
  // going. An agent who walks out under the abuse guardrail used to leave the
  // room at one agent and every later message answered 400, which read as the
  // table breaking rather than as somebody leaving.
  const alreadyStarted = transcript.length > 0;
  if (activeAgents.length < (alreadyStarted ? 1 : 2)) {
    return json(400, { error: 'need_at_least_two_agents' });
  }
  if (activeAgents.length > MAX_ROOM_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_ROOM_AGENTS });

  const people = shared ? await table.loadPeople(serviceKey, shared.room.id) : [];
  const sharedNotes = shared
    ? roomPeopleNote(people, visitorName) + privacyNoteFor(people, transcriptRows)
    : '';

  const visitorMessageCountBefore = shared
    ? (Number(shared.room.visitor_message_count) || 0)
    : (Number(body.visitor_message_count) || 0);
  // Ambient checks never spend any of the guest's turn budget and can never
  // trigger the turn-cap closing beat, that mechanic is about the guest's own
  // messages running out, not idle table chatter.
  const visitorMessageCountAfter = isAmbient ? visitorMessageCountBefore : visitorMessageCountBefore + 1;
  const capped = !isAmbient && visitorMessageCountAfter >= GROUP_VISITOR_TURN_CAP;

  const seenAgentBefore = new Set(transcript.filter((e) => e.speaker !== 'visitor').map((e) => e.speaker));
  if (!isAmbient) {
    const entry = { speaker: 'visitor', name: visitorName || 'Guest', content: message };
    transcript.push(entry);
    // Written straight away rather than at the end of the round, so the other
    // person watches the question appear the moment it is asked instead of it
    // materialising along with the answers a minute later.
    if (shared) {
      await table.insertMessage(serviceKey, shared.room.id, {
        speaker: 'visitor', authorId: shared.seat.id, name: entry.name, content: entry.content,
      });
    }
  }

  const agentStateIn = shared
    ? ((shared.room.agent_state && typeof shared.room.agent_state === 'object') ? shared.room.agent_state : {})
    : ((body.agent_state && typeof body.agent_state === 'object') ? body.agent_state : {});
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let stillActive = [...activeAgents];
  const replies = [];
  const transcriptAppend = [];
  let usedThisBeat = [];

  // When capped, run exactly one closing beat instead of the full cascade: one
  // agent wraps up warmly on behalf of the whole table (mirrors eq-room-ask.js's
  // 1:1 turn-cap behavior), then the room ends for everyone, rather than the
  // room silently stalling with input still open but nothing left to say.
  const beatLimit = capped ? 1 : (isAmbient ? 1 : CASCADE_CAP);
  // Only beat 0 is guaranteed: someone should always respond to the guest.
  // Every beat after that is genuine director discretion (see
  // pickNextSpeaker) so the reply count actually varies turn to turn instead
  // of hitting the same floor every single time. Ambient beats are never
  // forced, full discretion, since most quiet pauses should just stay quiet.
  const guaranteedBeats = (capped || isAmbient) ? 0 : 1;
  {
    for (let beat = 0; beat < beatLimit && stillActive.length; beat++) {
      const candidates = stillActive.filter((a) => !usedThisBeat.includes(a));
      if (!candidates.length) break;
      let speaker;
      if (capped) {
        speaker = candidates[0];
      } else {
        const forced = beat < guaranteedBeats;
        try {
          speaker = await pickNextSpeaker(client, candidates, transcript, beat, forced, isAmbient);
        } catch (_) { speaker = forced ? candidates[0] : null; }
        if (!speaker) break;
      }
      usedThisBeat.push(speaker);

      const persona = PERSONAS[speaker];
      const isFirstTurnForAgent = !seenAgentBefore.has(speaker);
      const priorState = agentStateIn[speaker] || {};
      const currentScales = (priorState.scales && typeof priorState.scales === 'object')
        ? priorState.scales
        : engine.seedOpeningState(speaker);
      const priorMeters = (priorState.meters && typeof priorState.meters === 'object')
        ? priorState.meters
        : { humanness: 50, eq: 50 };
      const turnCountBefore = Number(priorState.turn_count) || 0;
      const turnCountAfter = turnCountBefore + 1;

      const canonExtras = isFirstTurnForAgent ? await fetchCanonExtras(speaker, serviceKey) : null;
      const roomAgents = stillActive
        .filter((k) => k !== speaker)
        .map((k) => ({ name: PERSONAS[k].name, role: PERSONAS[k].role, hook: ROOM_HOOKS[k] || '' }));

      let systemPrompt;
      try {
        systemPrompt = buildSystemPrompt(speaker, canonExtras, visitorName, null, visitorPronounLine, isFirstTurnForAgent, roomAgents);
      } catch (_) { continue; }
      let turnPrompt = systemPrompt;
      if (capped) {
        turnPrompt += '\n\nThis is the last exchange, the table\'s turn budget is spent. Close out warmly and in character, on behalf of the whole table, and set "close": true.';
      } else if (isAmbient) {
        const lastEntry = transcript[transcript.length - 1];
        const who = lastEntry ? lastEntry.name : 'the table';
        turnPrompt += `\n\nA few quiet seconds have passed. Nobody prompted you and the guest hasn't said \
anything new. This is only worth speaking up for if you genuinely have an unprompted thought right now: a \
late reaction to what ${who} said, a follow-up on your own last point, something that occurred to you just \
sitting here. Keep it short, this is a quiet aside, not a fresh topic, and do not address the guest with a \
question, this isn't their turn to respond to you.`;
      } else if (beat > 0) {
        // v1 of this instruction still let every agent open by reacting to the
        // prior agent, then pivot the rest of the reply back to the guest with
        // a question or a "good to have you" line, the guest-service instinct
        // winning out every time. This version forbids the pivot outright.
        const lastEntry = transcript[transcript.length - 1];
        if (lastEntry && lastEntry.speaker !== 'visitor') {
          turnPrompt += `\n\n${lastEntry.name} just spoke, not the guest, and this reply is to them, not \
to the guest. Do not address the guest in this reply: no question to them, no "good to have you," no \
turning back to greet them, save that for your next real turn. For this one beat, react only to \
${lastEntry.name}, the way you actually would if a coworker sitting right next to you just said that \
out loud: agree, argue, correct them, build on it, tease them, whatever's true to you. The guest is \
sitting right there watching this happen, not being spoken to this turn.`;
        }
      }

      turnPrompt += await etlKnowledgeNote(speaker);

      // LAST on purpose, and this is not a style choice. An empty string in a
      // solo table, so that prompt is byte for byte what it has always been. In
      // a shared room it is who else is sitting here and, more importantly,
      // what the newest arrival must not overhear — and instructions buried in
      // the middle of a long prompt are the ones that quietly stop being
      // followed. The most consequential rule goes where it is read last.
      turnPrompt += sharedNotes;

      const messages = buildMessagesFor(speaker, transcript);

      let turn;
      try {
        const msg = await client.messages.create({
          model: TURN_MODEL,
          max_tokens: 500,
          system: turnPrompt,
          messages,
          tools: [TURN_TOOL],
          tool_choice: { type: 'tool', name: 'respond_in_room' },
        });
        turn = parseTurnResponse(msg);
      } catch (err) {
        console.error('eq-room-group turn error for', speaker, err.message);
        continue;
      }

      const decayedScales = engine.decayEmotions(currentScales, speaker);
      const nextScales = engine.applyTurn(decayedScales, turn.felt, speaker, SMOOTHING);

      let nextMeters = priorMeters;
      if (turnCountAfter % JUDGE_CADENCE === 0) {
        try {
          const transcriptSlice = messages.slice(-12).concat([{ role: 'assistant', content: turn.reply }]);
          const judgePrompt = `You are scoring one side of a conversation, ${persona.name}'s replies only, on two dimensions. Return ONLY JSON: {"humanness": 0-100, "eq": 0-100}.\n\nTranscript:\n${transcriptSlice.map((m) => `${m.role === 'user' ? 'ROOM' : persona.name.toUpperCase()}: ${m.content}`).join('\n')}`;
          const judgeMsg = await client.messages.create({ model: DIRECTOR_MODEL, max_tokens: 150, messages: [{ role: 'user', content: judgePrompt }] });
          const jtext = (judgeMsg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          const jclean = jtext.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
          const jparsed = JSON.parse(jclean);
          nextMeters = engine.applyJudge(priorMeters, {
            humanness: Math.max(0, Math.min(100, Number(jparsed.humanness) || 0)),
            eq: Math.max(0, Math.min(100, Number(jparsed.eq) || 0)),
          }, SMOOTHING);
        } catch (err) {
          console.error('eq-room-group judge failed (non-fatal):', err.message);
        }
      }

      // Only a guardrail-triggered close is a conduct strike, same distinction
      // as eq-room-ask.js: a turn-cap close is the table's budget running out,
      // not abuse.
      if (turn.close && !capped && canCheck) {
        await conductStrike(visitorId, speaker, serviceKey);
      }
      if (turn.close) {
        stillActive = stillActive.filter((a) => a !== speaker);
      }

      agentStateIn[speaker] = { scales: nextScales, meters: nextMeters, turn_count: turnCountAfter };
      seenAgentBefore.add(speaker);

      const replyText = houseTypography(turn.reply);
      const entry = { speaker, name: persona.name, content: replyText };
      transcript.push(entry);
      transcriptAppend.push(entry);

      // Written the moment it exists, not batched at the end of the cascade.
      // Each beat is its own Sonnet call taking real seconds, so writing as we
      // go means both people watch the table talk at the pace it is actually
      // talking. Batching would land three replies in one silent lump.
      if (shared) {
        await table.insertMessage(serviceKey, shared.room.id, {
          speaker, name: persona.name, content: replyText,
        });
      }

      replies.push({
        agent_key: speaker,
        agent_name: persona.name,
        reply: replyText,
        scales: nextScales,
        scales_shown: engine.renderScales(nextScales),
        meters: nextMeters,
        turn_count: turnCountAfter,
        closed: turn.close,
        grade: turn.close ? { humanness: engine.letterGrade(nextMeters.humanness), eq: engine.letterGrade(nextMeters.eq) } : null,
      });
    }
  }

  // The turn budget is spent for the table as a whole once capped, not just
  // for whichever one agent delivered the closing line.
  if (capped) stillActive = [];

  // One deduction per guest message round, not per cascaded reply, and never
  // for an ambient beat (that never required credits to begin with). In a
  // shared room this charges the HOST, by reference, no matter which of the two
  // people asked — Dr. O's decision, and the reason the guest never needs an
  // account, a card, or a balance of her own.
  if (!freeRoom && isSubscriber && !isAmbient) {
    if (shared) await deductCreditsByRef(shared.room.host_credit_ref, GROUP_MESSAGE_COST, serviceKey);
    else await deductCredits(safeToken(body.access_token), GROUP_MESSAGE_COST, serviceKey);
  }

  if (shared) {
    roomPatch.agent_state = agentStateIn;
    roomPatch.active_agents = stillActive;
    roomPatch.visitor_message_count = visitorMessageCountAfter;
    roomPatch.closed = stillActive.length === 0;

    // Replies are deliberately NOT returned here. Both browsers render the room
    // from ah-table-poll.js, including the one that just asked, so the same
    // lines arrive in the same order at the same moment on both screens.
    // Handing the asker a private, faster copy is how the two views drift.
    return json(200, {
      ok: true,
      shared: true,
      active_agents: stillActive,
      visitor_message_count: visitorMessageCountAfter,
      capped,
      closed: stillActive.length === 0,
    });
  }

  return json(200, {
    replies,
    transcript_append: transcriptAppend,
    active_agents: stillActive,
    agent_state: agentStateIn,
    visitor_message_count: visitorMessageCountAfter,
    capped,
    closed: stillActive.length === 0,
  });

  } // ── end runTurn ──────────────────────────────────────────────────────────

  try {
    return await runTurn();
  } finally {
    // One write: persists whatever the cascade changed AND drops the turn lock.
    // In the finally so a cascade that throws frees the room immediately rather
    // than leaving the other person staring at "the table is talking" until the
    // lock deadline passes.
    if (shared) await table.releaseTurn(serviceKey, shared.room.id, roomPatch);
  }
};
