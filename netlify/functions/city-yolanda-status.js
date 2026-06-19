/* city-yolanda-status - public polling. GET ?job_id=yf-... No auth. */

const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  const jobId = (event.queryStringParameters && event.queryStringParameters.job_id) || '';
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };

  const store = getStore('csuite_jobs');
  const job = await store.get('yolanda/' + jobId, { type: 'json' });
  if (!job) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ status: 'unknown', note: 'job not found yet; background may still be initializing' }),
    };
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
