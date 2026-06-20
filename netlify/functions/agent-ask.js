/* agent-ask — public CORS trigger for the generic agent runner.
   POST { agent, question, context?, history? }
   Authorization: Bearer <export_key>
   Validates the key in Supabase export_keys, mints a job_id,
   fires agent-background (fire-and-forget), returns { ok, job_id, polling_endpoint }.
*/

const SUPABASE_URL      = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
}

async function validateKey(key, agentSlug, origin) {
  try {
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/export_keys?key=eq.' + encodeURIComponent(key) + '&active=eq.true&select=*',
      { headers: { 'Authorization': 'Bearer ' + serviceKey(), 'apikey': serviceKey() } }
    );
    if (!r.ok) return { ok: false, reason: 'supabase_' + r.status };
    const rows = await r.json();
    if (!rows || !rows.length) return { ok: false, reason: 'key_not_found' };
    const row = rows[0];

    const allowed = row.allowed_agents || ['*'];
    if (!allowed.includes('*') && !allowed.includes(agentSlug)) {
      return { ok: false, reason: 'agent_not_allowed' };
    }

    const origins = row.allowed_origins || [];
    if (origins.length && origin) {
      const originHost = origin.replace(/^https?:\/\//, '').split('/')[0];
      const allowed_origin = origins.some(o => {
        const h = o.replace(/^https?:\/\//, '').split('/')[0];
        return h === originHost || originHost.endsWith('.' + h.replace(/^\*\./, ''));
      });
      if (!allowed_origin) return { ok: false, reason: 'origin_not_allowed' };
    }

    return { ok: true, row };
  } catch (e) {
    return { ok: false, reason: 'lookup_failed: ' + (e && e.message) };
  }
}

function incrementUsage(key) {
  fetch(SUPABASE_URL + '/rest/v1/rpc/increment_export_key_usage', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + serviceKey(),
      'apikey':        serviceKey(),
    },
    body: JSON.stringify({ p_key: key }),
  }).catch(() => {});
}

function newJobId(slug) {
  const d     = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return slug.slice(0, 8) + '-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'bearer_required' }) };
  }
  const exportKey = authHeader.slice(7).trim();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const agentSlug = String(body.agent    || '').trim().toLowerCase();
  const question  = String(body.question || '').trim();

  if (!agentSlug) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'agent_required' }) };
  if (!question)  return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'question_required' }) };
  if (question.length > 4000) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'question_too_long' }) };

  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const auth   = await validateKey(exportKey, agentSlug, origin);
  if (!auth.ok) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  const jobId = newJobId(agentSlug);

  const host  = (event.headers && (event.headers.host  || event.headers.Host))  || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base  = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'no_base_url' }) };

  const bgUrl = base + '/.netlify/functions/agent-background';
  try {
    fetch(bgUrl, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify({ job_id: jobId, agent: agentSlug, question, context: body.context || null }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}

  incrementUsage(exportKey);

  const pollingUrl = '/.netlify/functions/agent-status?job_id=' + jobId + '&agent=' + encodeURIComponent(agentSlug);

  return {
    statusCode: 200,
    headers:    { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body:       JSON.stringify({ ok: true, job_id: jobId, polling_endpoint: pollingUrl }),
  };
};
