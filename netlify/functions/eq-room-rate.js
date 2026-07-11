/* eq-room-rate — records the exit survey shown when a visitor presses
   "End Conversation" in the EQ Room (Almost Human).

   POST { agent_key, agent_name, visitor_id, visitor_name?, visitor_pronoun?,
          humanness_rating (1-5), turn_count?, scales?, messages? }
   Returns { ok: true }

   Captures two numbers side by side, on purpose:
   - humanness_rating: the VISITOR's own 1-5 read on the conversation.
   - model_reported_humanness / model_reported_eq: a fresh score the model
     generates about its own replies across the FULL conversation, run at
     the moment the visitor leaves (not whatever mid-chat judge tick from
     eq-room-ask.js happened to land last, which could be several turns
     stale or based on only a slice of the transcript).

   NAMING, on purpose: this is stored in the agent_self_humanness /
   agent_self_eq columns for continuity with the original schema, but do
   not read "self" as introspection. It is a generated number shaped like
   a self-assessment, produced by the same architecture and prompting as
   every other reply, not a report of something the model looked inward
   and found. The value in this dataset is the GAP between the visitor's
   rating and this generated number, not either number alone. If this
   data reaches a conference reviewer, describe the column as "model-
   reported humanness/EQ", not "the agent's self-assessment".

   Falls back to a client-supplied agent_self_grade (the old mid-chat
   cache) only if the fresh full-transcript call fails or no messages
   were sent. Fails soft throughout: nothing here ever blocks the visitor
   from leaving the room, and the frontend does not wait on this call.
*/

const Anthropic = require('@anthropic-ai/sdk');
const engine = require('./_eq-engine.js');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';

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

const EMOTION_KEYS = ['happiness', 'sadness', 'fear', 'disgust', 'anger', 'surprise', 'curious'];

function clampEmotion(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

// Scores the WHOLE conversation (not a recent slice), run once at exit
// rather than on eq-room-ask's periodic mid-chat cadence, so the model's
// number and the visitor's rating are computed over the identical
// transcript at the identical moment.
async function runExitJudge(client, agentName, messages) {
  const transcript = messages
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => `${m.role === 'user' ? 'GUEST' : agentName.toUpperCase()}: ${m.content}`)
    .join('\n');
  if (!transcript) return null;

  const prompt = `You are scoring one side of a finished conversation, ${agentName}'s replies only, on two dimensions. Read the full transcript below and return ONLY JSON, no code fences: {"humanness": 0-100, "eq": 0-100}.

Humanness (up): specific and grounded replies, emotional consistency across the conversation, natural imperfection, a real point of view. (down): generic assistant tone, over-eagerness, contradictions, refusing to have a self, canned phrasing.

EQ (up): correctly reads the guest's subtext and emotional state, responds with empathy, holds a boundary well, de-escalates, matches register. (down): misses the emotional beat, escalates needlessly, is tone-deaf, or hands over judgment it should hold.

Score ${agentName}'s replies only, across the entire conversation below.

Transcript:
${transcript}`;

  const msg = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    humanness: clampEmotion(parsed.humanness),
    eq: clampEmotion(parsed.eq),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const agentKey = String(body.agent_key || '').trim().toLowerCase();
  const agentName = String(body.agent_name || '').trim().slice(0, 80);
  const visitorId = safeVisitorId(body.visitor_id);
  const visitorName = String(body.visitor_name || '').trim().slice(0, 40) || null;
  const visitorPronoun = String(body.visitor_pronoun || '').trim().slice(0, 10) || null;
  const rating = Number(body.humanness_rating);
  const turnCount = Number.isFinite(Number(body.turn_count)) ? Number(body.turn_count) : null;

  if (!agentKey) return json(400, { error: 'agent_key_required' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json(400, { error: 'humanness_rating_must_be_1_to_5' });
  }

  const scales = body.scales && typeof body.scales === 'object' ? body.scales : {};
  const row = {
    visitor_id: visitorId,
    visitor_name: visitorName,
    visitor_pronoun: visitorPronoun,
    agent_key: agentKey,
    agent_name: agentName || null,
    humanness_rating: rating,
    turn_count: turnCount,
  };
  EMOTION_KEYS.forEach((k) => { row[k] = clampEmotion(scales[k]); });

  // Fresh whole-conversation score, preferred. Falls back to whatever
  // mid-chat cache the frontend sent if the live call fails or there is
  // no transcript (e.g. the visitor left before any judge tick fired).
  const fallbackGrade = body.agent_self_grade && typeof body.agent_self_grade === 'object' ? body.agent_self_grade : null;
  row.agent_self_humanness = fallbackGrade ? clampEmotion(fallbackGrade.humanness) : null;
  row.agent_self_eq = fallbackGrade ? clampEmotion(fallbackGrade.eq) : null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const rosterName = (engine.AGENTS[agentKey] && engine.AGENTS[agentKey].name) || agentName;
  if (apiKey && messages.length && rosterName) {
    try {
      const client = new Anthropic({ apiKey });
      const fresh = await runExitJudge(client, rosterName, messages);
      if (fresh && (fresh.humanness !== null || fresh.eq !== null)) {
        row.agent_self_humanness = fresh.humanness;
        row.agent_self_eq = fresh.eq;
      }
    } catch (err) {
      console.error('eq-room-rate exit judge failed (falling back to cached grade):', err.message);
    }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('eq-room-rate: SUPABASE_SERVICE_ROLE_KEY not set, rating dropped');
    return json(200, { ok: false, stored: false });
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/etl_room_ratings`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([row]),
    });
    if (!res.ok) {
      console.error('eq-room-rate insert non-ok:', res.status, await res.text().catch(() => ''));
      return json(200, { ok: false, stored: false });
    }
  } catch (err) {
    console.error('eq-room-rate insert failed:', err.message);
    return json(200, { ok: false, stored: false });
  }

  return json(200, { ok: true, stored: true });
};
