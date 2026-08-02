/* sherlock-job-status -- polls for a Solve It With Sherlock job's result,
   for both kinds (the Baker Street table cascade and the case verdict).
   GET /.netlify/functions/sherlock-job-status?job_id=...
   Returns { status: 'pending'|'running'|'done'|'error', ...result fields }
   Job state read from the `sherlock_jobs` Blobs store, written by
   sherlock-job-background.js. */

const { getStore, connectLambda } = require('@netlify/blobs');

const JOB_STORE = 'sherlock_jobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const jobId = String((event.queryStringParameters || {}).job_id || '').trim();
  if (!jobId) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'job_id_required' }) };
  }

  const store = getStore(JOB_STORE);
  const job = await store.get(jobId, { type: 'json' });

  if (!job) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ status: 'pending' }),
    };
  }

  const out = { status: job.status, job_id: job.job_id, kind: job.kind };
  if (job.status === 'done' && job.result) Object.assign(out, job.result);
  if (job.status === 'error') out.error = job.error;

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(out),
  };
};
