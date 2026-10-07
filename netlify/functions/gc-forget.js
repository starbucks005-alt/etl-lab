/* gc-forget: "Forget me", for a house character's memory of one visitor, 2026-10-07.

   POST { agent_name, visitor_id?, access_token? } -> { ok: true }

   Deletes what a house character (Alice and the others, see _gc-demo-memory.js) remembers about THIS visitor, and
   nothing else: the same identity gc-chat.js remembers by (the account token if there is one, else the browser's
   visitor id), and only keys that begin "gcd:", so it cannot touch a built friend's memory or anybody else's.
   The privacy statement promises "You can ask us to delete what an agent remembers about you"; this is that for
   the characters that remember a browser. */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-lab-key',
};
const json = (code, body) => ({
  statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const { safeToken } = require('./_ah-credits.js');
const { demoMemoryKey } = require('./_gc-demo-memory.js');

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const identity = safeToken(body.access_token) || safeVisitorId(body.visitor_id);
  const agentKey = demoMemoryKey({ name: String(body.agent_name || '') }, true);
  if (!identity || !agentKey) return json(400, { error: 'nothing_to_forget' });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_visitor_memories?visitor_id=eq.${encodeURIComponent(identity)}&agent_key=eq.${encodeURIComponent(agentKey)}`,
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' } }
    );
    if (!r.ok) {
      console.error('gc-forget non-ok:', r.status, await r.text().catch(() => ''));
      return json(502, { error: 'forget_failed' });
    }
  } catch (err) {
    console.error('gc-forget failed:', err.message);
    return json(502, { error: 'forget_unreachable' });
  }
  return json(200, { ok: true });
};
