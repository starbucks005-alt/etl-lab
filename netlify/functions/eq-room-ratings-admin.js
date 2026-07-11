/* eq-room-ratings-admin: read access to the EQ Room exit-survey data
   (etl_room_ratings), for the internal report page eq-room-ratings.html.

   POST { action: "list", agent_key? }   header: X-Owner-Key (or body.owner_key)
   -> { rows }

   Read-only. Nothing here writes; eq-room-rate.js is the only writer.
*/

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Owner-Key',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function ownerOk(event, body) {
  const key = process.env.OWNER_KEY;
  if (!key) return false;
  const given = ((event.headers['x-owner-key'] || event.headers['X-Owner-Key'] || (body && body.owner_key)) || '').trim();
  return given === key;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  if (!ownerOk(event, body)) return json(401, { error: 'owner_key_required' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const params = ['select=*', 'order=created_at.desc', 'limit=5000'];
  if (body.agent_key) params.push(`agent_key=eq.${encodeURIComponent(String(body.agent_key))}`);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/etl_room_ratings?${params.join('&')}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) return json(500, { error: 'db_error', detail: await r.text().catch(() => '') });
  const rows = await r.json();
  return json(200, { rows });
};
