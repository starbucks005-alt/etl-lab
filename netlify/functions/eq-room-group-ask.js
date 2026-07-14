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
const { buildSystemPrompt, PERSONAS, ROOM_HOOKS } = require('./_eq-personas.js');
const engine = require('./_eq-engine.js');
const { ownerUser } = require('./_owner-auth.js');
const { getCreditRow, deductCredits, GROUP_MESSAGE_COST, safeToken } = require('./_ah-credits.js');

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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const activeAgents = Array.isArray(body.active_agents)
    ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter((a) => engine.AGENTS[a])
    : [];
  if (activeAgents.length < 2) return json(400, { error: 'need_at_least_two_agents' });
  if (activeAgents.length > MAX_ROOM_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_ROOM_AGENTS });

  // Ambient mode: the client checks in after a quiet pause with no new guest
  // message, giving the table a chance to add an unprompted beat on its own,
  // the way a real room doesn't go dead the second you stop talking. At most
  // one genuinely-discretionary speaker, never counts against the guest's
  // turn budget, and the client caps how many of these it asks for in a row.
  const isAmbient = body.ambient === true;
  const message = String(body.message || '').trim();
  if (!isAmbient) {
    if (!message) return json(400, { error: 'message_required' });
    if (message.length > 2000) return json(400, { error: 'message_too_long' });
  }

  const visitorName = String(body.visitor_name || '').trim().slice(0, 40) || null;
  const visitorPronoun = safePronoun(body.visitor_pronoun);
  const visitorPronounLine = visitorPronoun ? PRONOUN_LINES[visitorPronoun] : null;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const visitorId = safeVisitorId(body.visitor_id);
  const isOwner = isOwnerKey(body.owner_key);
  const canCheck = Boolean(visitorId && serviceKey) && !isOwner;

  if (canCheck) {
    const conduct = await conductStatus(visitorId, serviceKey);
    if (conduct.banned || conduct.locked) {
      return json(200, { replies: [], transcript_append: [], active_agents: activeAgents, closed: true, message: 'This conversation is closed.' });
    }
  }

  // Paywall: the group table is 100% behind the $9.99/mo tier, no free
  // access at all. Owner bypasses, same as the conduct check above.
  const accessToken = safeToken(body.access_token);
  let creditsRow = null;
  if (!isOwner && accessToken && serviceKey) {
    creditsRow = await getCreditRow(accessToken, serviceKey);
  }
  const isSubscriber = Boolean(!isOwner && creditsRow && creditsRow.subscription_active);
  const hasEnoughForGroup = isSubscriber && creditsRow.balance >= GROUP_MESSAGE_COST;

  if (!isOwner && !hasEnoughForGroup) {
    if (isAmbient) {
      // Ambient checks are a background nicety, never worth surfacing an
      // error for; just come back empty so the client quietly reschedules.
      return json(200, { replies: [], transcript_append: [], active_agents: activeAgents, closed: false });
    }
    const reason = !isSubscriber ? 'subscription_required' : 'credits_exhausted';
    return json(200, {
      replies: [], transcript_append: [], active_agents: activeAgents, closed: false,
      error: reason,
      message: reason === 'subscription_required'
        ? 'The table is a member perk. Upgrade to join.'
        : "You're out of credits for this cycle. Add more, or wait for next month's top-up.",
    });
  }

  const visitorMessageCountBefore = Number(body.visitor_message_count) || 0;
  // Ambient checks never spend any of the guest's turn budget and can never
  // trigger the turn-cap closing beat, that mechanic is about the guest's own
  // messages running out, not idle table chatter.
  const visitorMessageCountAfter = isAmbient ? visitorMessageCountBefore : visitorMessageCountBefore + 1;
  const capped = !isAmbient && visitorMessageCountAfter >= GROUP_VISITOR_TURN_CAP;

  const rawTranscript = Array.isArray(body.transcript) ? body.transcript : [];
  let transcript = rawTranscript
    .filter((e) => e && typeof e.content === 'string' && e.content.trim() && typeof e.name === 'string')
    .map((e) => ({ speaker: String(e.speaker || 'visitor'), name: e.name, content: e.content.trim() }))
    .slice(-MAX_TRANSCRIPT_ENTRIES);

  const seenAgentBefore = new Set(transcript.filter((e) => e.speaker !== 'visitor').map((e) => e.speaker));
  if (!isAmbient) {
    transcript.push({ speaker: 'visitor', name: visitorName || 'Guest', content: message });
  }

  const agentStateIn = (body.agent_state && typeof body.agent_state === 'object') ? body.agent_state : {};
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
  // for an ambient beat (that never required credits to begin with).
  if (!isOwner && isSubscriber && !isAmbient) {
    await deductCredits(accessToken, GROUP_MESSAGE_COST, serviceKey);
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
};
