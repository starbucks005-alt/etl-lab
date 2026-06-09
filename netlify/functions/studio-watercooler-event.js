/* ─────────────────────────────────────────────────────────────────────────────
   studio-watercooler-event

   Telemetry logger for the Floor channels. Front-end POSTs an event each
   time something interesting happens on the Watercooler / Workfloor tab.
   Backs the studio-watercooler-stats dashboard that answers "is this a
   feature."

   POST body:
     { type:     'tab_open' | 'tab_close' | 'episode_view' |
                 'episode_replay' | 'episode_save',
       mode:     'watercooler' | 'workfloor',
       episode_id: string  (optional; required for episode_* types),
       dwell_ms: number    (optional; required for tab_close)
     }

   Returns: { ok: true }

   Auth: same Supabase JWT gate. Telemetry is private until the Stats
   page is wired; single-tenant for now.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const VALID_TYPES = new Set(['tab_open', 'tab_close', 'episode_view', 'episode_replay', 'episode_save']);
const EVENTS_PER_DAY_CAP = 10000;  // runaway-loop backstop

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

function todayKeyET() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()).replace(/-/g, '');
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  if (!VALID_TYPES.has(body.type)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad_event_type' }) };
  }
  const mode = (body.mode === 'watercooler') ? 'watercooler' : 'workfloor';

  const evt = {
    type: body.type,
    mode,
    episode_id: body.episode_id || null,
    dwell_ms: (typeof body.dwell_ms === 'number' && body.dwell_ms >= 0) ? body.dwell_ms : null,
    timestamp: new Date().toISOString(),
  };

  const store = getStore('watercooler');
  const key = 'telemetry/' + todayKeyET();
  const existing = (await store.get(key, { type: 'json' })) || { events: [] };
  if (existing.events.length >= EVENTS_PER_DAY_CAP) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, capped: true }) };
  }
  existing.events.push(evt);
  await store.setJSON(key, existing);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, count: existing.events.length }),
  };
};
