/* agent-status — polls for a generic agent job result.
   GET /.netlify/functions/agent-status?job_id=...&agent=<slug>
   Authorization: Bearer <export_key>  (same key as agent-ask)
   Key validated against EXPORT_KEYS env var (comma-separated list).
   Returns { status, job_id, agent, role, question, response, error, ... }
*/

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function isValidKey(key) {
  const list = (process.env.EXPORT_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  return list.includes(key);
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'bearer_required' }) };
  }
  const exportKey = authHeader.slice(7).trim();

  const params    = event.queryStringParameters || {};
  const jobId     = String(params.job_id || '').trim();
  const agentSlug = String(params.agent  || '').trim().toLowerCase();

  if (!jobId)      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'job_id_required' }) };
  if (!agentSlug)  return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'agent_required' }) };

  if (!isValidKey(exportKey)) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const store = getStore('export_jobs');
  const job   = await store.get(agentSlug + '/' + jobId, { type: 'json' });

  if (!job) {
    return {
      statusCode: 200,
      headers:    { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body:       JSON.stringify({ status: 'pending', note: 'job initializing; retry in a few seconds' }),
    };
  }

  return {
    statusCode: 200,
    headers:    { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body:       JSON.stringify({
      status:      job.status,
      job_id:      job.job_id,
      agent:       job.agent_name || job.agent,
      role:        job.role       || null,
      question:    job.question,
      response:    job.response   || null,
      error:       job.error      || null,
      created_at:  job.created_at,
      finished_at: job.finished_at,
    }),
  };
};
