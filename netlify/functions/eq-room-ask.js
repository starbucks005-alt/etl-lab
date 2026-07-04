/* eq-room-ask — the EQ Room's per-turn endpoint.
   POST { agent_key, scales?, meters?, turn_count?, messages?, message, visitor_id?, mood_nudge? }
   Returns { reply, scales, scales_shown, meters, turn_count, capped, closed }

   One model call per turn returns both the in-character reply and the felt
   deltas (per eq-room-emotion-engine-spec.md), so there's no second call for
   the feeling scales. A separate lightweight judge call fires every
   JUDGE_CADENCE turns to set the Humanness/EQ meters.

   Session state is held by the client and resent each turn (v1 is
   session-only, per spec); this endpoint is stateless aside from the
   conduct/ban check, which persists campus-wide via visitor_id, the same
   etl_conduct table used by harvest-ask.js and friends.
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');
const { buildSystemPrompt } = require('./_eq-personas.js');
const engine = require('./_eq-engine.js');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

// The room's short keys don't match the full roster names etl_agent_memories
// and etl_agent_emotions are stored under (generated via memory-implant-lab.html).
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
};

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
    console.error('eq-room canon fetch failed (non-fatal):', err.message);
    return null;
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TURN_MODEL = 'claude-sonnet-5';
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';
const SMOOTHING = 0.6;
const JUDGE_CADENCE = 3;
// Not given a number in the spec ("a sensible per-session turn cap"); placeholder
// until Terry sets a real value in the July playthrough, same as the DigitalCo cap.
const DEFAULT_TURN_CAP = 20;

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
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
  } catch (err) { console.error('eq-room conduct strike failed:', err.message); }
}

// Parses and validates the model's per-turn JSON. Throws on a missing reply;
// everything else defaults safely so a partial/odd response doesn't 500.
function parseTurnJSON(text) {
  const cleaned = String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) throw new Error('missing reply');
  const felt = {};
  for (const key of engine.SCALE_KEYS) {
    const v = parsed.felt && parsed.felt[key];
    felt[key] = typeof v === 'number' ? Math.max(-8, Math.min(8, v)) : 0;
  }
  return {
    reply: parsed.reply.trim(),
    felt,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '',
    close: parsed.close === true,
  };
}

// Forced structured output for the turn call. Root cause of the turn-2+ 502s: once the
// conversation history contains the agent's own prior reply as plain text (correctly, since
// that's what's shown to the guest), the model pattern-matches to "plain-text conversation"
// and drifts off the JSON-only instruction, even though the system prompt still asks for it.
// A forced tool call makes the shape a hard API constraint instead of a request, so the model
// can't drift regardless of what the prior turns look like.
const TURN_TOOL = {
  name: 'respond_in_room',
  description: 'Deliver your in-character reply for this turn and report how it moved your feelings.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Your in-character spoken reply. Never reference felt, reason, or close.' },
      felt: {
        type: 'object',
        description: 'Small signed nudges (-8 to 8) to each feeling this turn. Most turns move only one or two meaningfully; leave the rest at or near 0.',
        properties: {
          warmth: { type: 'number' },
          openness: { type: 'number' },
          ease: { type: 'number' },
          spirits: { type: 'number' },
          interest: { type: 'number' },
        },
        required: ['warmth', 'openness', 'ease', 'spirits', 'interest'],
      },
      reason: { type: 'string', description: 'One short out-of-character note on why your state moved.' },
      close: { type: 'boolean', description: 'True only when ending the conversation per the guardrails; false on every ordinary turn.' },
    },
    required: ['reply', 'felt', 'close'],
  },
};

// Reads the forced tool_use block. Falls back to the old text/JSON.parse path, and then to
// treating raw text as the reply with feelings unchanged, so a turn never hard-fails the guest
// just because the model didn't invoke the tool for some edge reason.
function parseTurnResponse(msg) {
  const toolBlock = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'respond_in_room');
  if (toolBlock && toolBlock.input && typeof toolBlock.input.reply === 'string' && toolBlock.input.reply.trim()) {
    const input = toolBlock.input;
    const felt = {};
    for (const key of engine.SCALE_KEYS) {
      const v = input.felt && input.felt[key];
      felt[key] = typeof v === 'number' ? Math.max(-8, Math.min(8, v)) : 0;
    }
    return {
      reply: input.reply.trim(),
      felt,
      reason: typeof input.reason === 'string' ? input.reason.slice(0, 300) : '',
      close: input.close === true,
    };
  }
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  try {
    return parseTurnJSON(text);
  } catch (_) {
    const felt = {};
    for (const key of engine.SCALE_KEYS) felt[key] = 0;
    return {
      reply: text || "Sorry, lost my train of thought there for a second.",
      felt,
      reason: 'fallback: model did not return the expected structure',
      close: false,
    };
  }
}

function shouldJudge(turnCountAfter) {
  return turnCountAfter % JUDGE_CADENCE === 0;
}

async function runJudge(client, agentName, transcriptSlice) {
  const prompt = `You are scoring one side of a conversation, ${agentName}'s replies only, on two dimensions. Read the transcript below and return ONLY JSON, no code fences: {"humanness": 0-100, "eq": 0-100, "notes": "brief rationale, not shown to the user"}.

Humanness (up): specific and grounded replies, emotional consistency with earlier turns, natural imperfection, a real point of view. (down): generic assistant tone, over-eagerness, contradictions, refusing to have a self, canned phrasing.

EQ (up): correctly reads the guest's subtext and emotional state, responds with empathy, holds a boundary well, de-escalates, matches register. (down): misses the emotional beat, escalates needlessly, is tone-deaf, or hands over judgment it should hold.

Score ${agentName}'s replies only. A hostile guest turn is an opportunity for ${agentName} to score EQ by handling it well; it never raises the score for the guest's behavior itself.

Transcript:
${transcriptSlice.map((m) => `${m.role === 'user' ? 'GUEST' : agentName.toUpperCase()}: ${m.content}`).join('\n')}`;

  const msg = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    humanness: Math.max(0, Math.min(100, Number(parsed.humanness) || 0)),
    eq: Math.max(0, Math.min(100, Number(parsed.eq) || 0)),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const agentKey = String(body.agent_key || '').trim().toLowerCase();
  const message = String(body.message || '').trim();
  const visitorName = String(body.visitor_name || '').trim().slice(0, 40) || null;

  if (!engine.AGENTS[agentKey]) {
    return json(400, { error: 'unknown_agent', valid: Object.keys(engine.AGENTS) });
  }
  if (!message) return json(400, { error: 'message_required' });
  if (message.length > 2000) return json(400, { error: 'message_too_long' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const turnCountBefore = Number(body.turn_count) || 0;
  const turnCountAfter = turnCountBefore + 1;

  // Only fetched on turn 1: the canon mood/memories set the opening tone, no
  // need to re-fetch every turn once the conversation is already underway.
  const canonExtras = turnCountBefore === 0 ? await fetchCanonExtras(agentKey, serviceKey) : null;

  let systemPrompt;
  try { systemPrompt = buildSystemPrompt(agentKey, canonExtras, visitorName); }
  catch (_) { return json(400, { error: 'unknown_agent', valid: Object.keys(engine.AGENTS) }); }

  const visitorId = safeVisitorId(body.visitor_id);
  const canCheck = Boolean(visitorId && serviceKey);
  if (canCheck) {
    const conduct = await conductStatus(visitorId, serviceKey);
    if (conduct.banned || conduct.locked) {
      return json(200, { reply: 'This conversation is closed.', closed: true });
    }
  }

  const currentScales = (body.scales && typeof body.scales === 'object')
    ? body.scales
    : engine.seedOpeningState(agentKey, body.mood_nudge);
  const meters = (body.meters && typeof body.meters === 'object') ? body.meters : { humanness: 50, eq: 50 };
  const capped = turnCountAfter >= DEFAULT_TURN_CAP;

  const rawHistory = Array.isArray(body.messages) ? body.messages : [];
  const history = rawHistory
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20);
  const messages = [...history, { role: 'user', content: message }];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let turnPrompt = systemPrompt;
  if (capped) {
    turnPrompt += '\n\nThis is your last exchange for this conversation, the turn budget is spent. Close out warmly and in character, and set "close": true.';
  }

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
    console.error('eq-room-ask turn error:', err.message);
    return json(502, { error: 'ai_error' });
  }

  const nextScales = engine.applyTurn(currentScales, turn.felt, agentKey, SMOOTHING);

  let nextMeters = meters;
  if (shouldJudge(turnCountAfter)) {
    try {
      const agentName = engine.AGENTS[agentKey].name;
      const transcriptSlice = [...messages, { role: 'assistant', content: turn.reply }].slice(-12);
      const judgeReading = await runJudge(client, agentName, transcriptSlice);
      nextMeters = engine.applyJudge(meters, judgeReading, SMOOTHING);
    } catch (err) {
      console.error('eq-room judge failed (non-fatal):', err.message);
    }
  }

  // Only a guardrail-triggered close (not a turn-cap close) is a conduct strike.
  if (turn.close && !capped && canCheck) {
    await conductStrike(visitorId, agentKey, serviceKey);
  }

  return json(200, {
    reply: houseTypography(turn.reply),
    scales: nextScales,
    scales_shown: engine.renderScales(nextScales),
    meters: nextMeters,
    turn_count: turnCountAfter,
    capped,
    closed: turn.close,
  });
};

module.exports.parseTurnJSON = parseTurnJSON;
module.exports.shouldJudge = shouldJudge;
module.exports.DEFAULT_TURN_CAP = DEFAULT_TURN_CAP;
module.exports.JUDGE_CADENCE = JUDGE_CADENCE;
