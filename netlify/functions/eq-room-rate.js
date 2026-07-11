/* eq-room-rate — records the exit survey shown when a visitor presses
   "End Conversation" in the EQ Room (Almost Human).

   POST { agent_key, agent_name, visitor_id, visitor_name?, visitor_pronoun?,
          humanness_rating (1-5), turn_count?, scales?, agent_self_grade? }
   Returns { ok: true }

   Captures the visitor's own 1-5 humanness rating alongside the final
   per-turn emotion scales (happiness..curious, set during the chat by
   eq-room-ask) and the agent's own self-graded humanness/eq (if a grade
   ever fired). This is the research dataset: visitor perception vs. the
   agent's own emotional trajectory, for external presentation.

   Requires the etl_room_ratings table (see supabase-schema.sql). Fails
   soft: a storage error never blocks the visitor from leaving the room,
   the frontend does not wait on this call before returning to the picker.
*/

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

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

  const grade = body.agent_self_grade && typeof body.agent_self_grade === 'object' ? body.agent_self_grade : null;
  row.agent_self_humanness = grade ? clampEmotion(grade.humanness) : null;
  row.agent_self_eq = grade ? clampEmotion(grade.eq) : null;

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
