/* agent-ask — public CORS trigger for the generic agent runner.
   POST { agent, question, context?, history? }
   Authorization: Bearer <export_key>
   Key validated against EXPORT_KEYS env var (comma-separated list).
   Mints a job_id, fires agent-background, returns { ok, job_id, polling_endpoint }.
*/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function isValidKey(key) {
  const list = (process.env.EXPORT_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  return list.includes(key);
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

  if (!isValidKey(exportKey)) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const agentSlug = String(body.agent    || '').trim().toLowerCase();
  const question  = String(body.question || '').trim();

  if (!agentSlug) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'agent_required' }) };
  if (!question)  return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'question_required' }) };
  if (question.length > 4000) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'question_too_long' }) };

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

  const pollingUrl = '/.netlify/functions/agent-status?job_id=' + jobId + '&agent=' + encodeURIComponent(agentSlug);

  return {
    statusCode: 200,
    headers:    { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body:       JSON.stringify({ ok: true, job_id: jobId, polling_endpoint: pollingUrl }),
  };
};
