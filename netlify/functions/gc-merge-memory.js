/* gc-merge-memory: put one browser's house-character memories onto another browser's identity, 2026-10-15, Dr. O.

   POST { from_visitor_id, into_visitor_id }   Authorization: Bearer <owner key>

   Alice and the other house characters (see _gc-demo-memory.js) remember a person by the browser's visitor id, so the same person on a laptop, a PC
   and a tablet is three strangers to her. "Can you take her memories here and combine all the memories she has onto one ALICE?" This moves every
   "gcd:" row filed under the from id to the into id. Only house characters' rows (keys that begin "gcd:"), never a built friend's, and only with
   the owner key. Nothing is deleted: rows are re-filed, so if it is run twice the second run finds nothing to move.
   NOT TRIED AGAINST THE REAL TABLE when it was written. It sends a PATCH to etl_visitor_memories and returns how many rows moved. */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (code, body) => ({
  statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const { ownerUser } = require('./_owner-auth.js');

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const auth = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!ownerUser(token)) return json(401, { error: 'owner_key_needed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  const from = safeVisitorId(body.from_visitor_id), into = safeVisitorId(body.into_visitor_id);
  if (!from || !into) return json(400, { error: 'two_ids_needed' });
  if (from === into) return json(200, { ok: true, moved: 0, note: 'same_id' });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_visitor_memories?visitor_id=eq.${encodeURIComponent(from)}&agent_key=like.${encodeURIComponent('gcd:*')}`,
      {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ visitor_id: into }),
      }
    );
    if (!r.ok) {
      console.error('gc-merge-memory non-ok:', r.status, await r.text().catch(() => ''));
      return json(502, { error: 'merge_failed' });
    }
    const rows = await r.json().catch(() => []);
    return json(200, { ok: true, moved: Array.isArray(rows) ? rows.length : 0 });
  } catch (err) {
    console.error('gc-merge-memory failed:', err.message);
    return json(502, { error: 'merge_unreachable' });
  }
};
