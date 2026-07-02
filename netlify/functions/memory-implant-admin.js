/* memory-implant-admin: editorial control over memory and emotion drafts.

   POST { action, target?, ... }  header: X-Owner-Key (or body.owner_key)
   target: "memories" (default) or "emotions"

   Actions:
   - list    { agent_name?, status? }          -> { rows }
   - approve { id }                            -> { ok }   (draft -> canon)
   - retire  { id }                            -> { ok }   (any -> retired, kept for history)
   - delete  { id }                            -> { ok }   (hard delete)
   - edit    { id, ...fields }                 -> { ok }
     memories fields: memory, title, kind, weight, happened_at
     emotions fields: mood, intensity, cause, lasts

   Nothing here is public; every action requires the owner key.
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

function sb(path, opts, serviceKey) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(opts && opts.headers),
    },
  });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  if (!ownerOk(event, body)) return json(401, { error: 'owner_key_required' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });

  const action = String(body.action || '').trim();
  const TABLES = { memories: 'etl_agent_memories', emotions: 'etl_agent_emotions' };
  const table = TABLES[String(body.target || 'memories')] || TABLES.memories;

  if (action === 'list') {
    const params = ['select=*', 'order=agent_name.asc,created_at.desc', 'limit=1000'];
    if (body.agent_name) params.push(`agent_name=eq.${encodeURIComponent(String(body.agent_name))}`);
    if (body.status) params.push(`status=eq.${encodeURIComponent(String(body.status))}`);
    const r = await sb(`${table}?${params.join('&')}`, { headers: { Prefer: '' } }, serviceKey);
    if (!r.ok) return json(500, { error: 'db_error' });
    const rows = await r.json();
    return json(200, { rows });
  }

  const id = String(body.id || '').trim();
  if (!UUID_RE.test(id)) return json(400, { error: 'id_required' });
  const target = `${table}?id=eq.${id}`;

  if (action === 'approve' || action === 'retire') {
    const status = action === 'approve' ? 'canon' : 'retired';
    const r = await sb(target, { method: 'PATCH', body: JSON.stringify({ status }) }, serviceKey);
    return r.ok ? json(200, { ok: true }) : json(500, { error: 'db_error' });
  }

  if (action === 'delete') {
    const r = await sb(target, { method: 'DELETE' }, serviceKey);
    return r.ok ? json(200, { ok: true }) : json(500, { error: 'db_error' });
  }

  if (action === 'edit') {
    const patch = {};
    if (table === TABLES.memories) {
      if (typeof body.memory === 'string' && body.memory.trim()) patch.memory = body.memory.trim();
      if (typeof body.title === 'string') patch.title = body.title.slice(0, 120);
      if (typeof body.happened_at === 'string') patch.happened_at = body.happened_at.slice(0, 80);
      if (['family', 'sensory', 'formative', 'relationship', 'event', 'daily'].includes(body.kind)) patch.kind = body.kind;
      if (body.weight) patch.weight = Math.min(Math.max(parseInt(body.weight, 10) || 3, 1), 5);
    } else {
      if (typeof body.mood === 'string' && body.mood.trim()) patch.mood = body.mood.trim().slice(0, 40);
      if (typeof body.cause === 'string' && body.cause.trim()) patch.cause = body.cause.trim();
      if (typeof body.lasts === 'string') patch.lasts = body.lasts.slice(0, 80);
      if (body.intensity) patch.intensity = Math.min(Math.max(parseInt(body.intensity, 10) || 2, 1), 5);
    }
    if (Object.keys(patch).length === 0) return json(400, { error: 'nothing_to_edit' });
    const r = await sb(target, { method: 'PATCH', body: JSON.stringify(patch) }, serviceKey);
    return r.ok ? json(200, { ok: true }) : json(500, { error: 'db_error' });
  }

  return json(400, { error: 'unknown_action' });
};
