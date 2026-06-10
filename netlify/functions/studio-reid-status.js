/* studio-reid-status — Reid Callum marketing-backpack polling. GET ?job_id=rd-... */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

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

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  const jobId = (event.queryStringParameters && event.queryStringParameters.job_id) || '';
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };

  const store = getStore('studio_jobs');
  const job = await store.get('reid/' + jobId, { type: 'json' });
  if (!job) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ status: 'unknown', note: 'job not found yet; background may still be initializing' }),
    };
  }

  if (job.owner_id && job.owner_id !== auth.user.id) {
    return { statusCode: 403, body: JSON.stringify({ error: 'not_your_job' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      status: job.status,
      job_id: job.job_id,
      agent: job.agent,
      role: job.role,
      question: job.question,
      response: job.response || null,
      error: job.error || null,
      created_at: job.created_at,
      finished_at: job.finished_at,
    }),
  };
};
