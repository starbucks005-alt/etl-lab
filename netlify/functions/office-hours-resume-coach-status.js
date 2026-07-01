/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-resume-coach-status

   Polled by the frontend to check on a Résumé Coach job (brief / rewrite /
   polish). Returns the blob stored under the job_id by
   office-hours-resume-coach-background.

   GET /.netlify/functions/office-hours-resume-coach-status?job_id=<id>
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const { getUser, extractToken } = require('./_etl-credits-util');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  // Auth gate -- Lab Member required (no credit deduction; auth only)
  const token = extractToken(event.headers.authorization);
  if (!token) return json(401, { error: 'no_token', message: 'Sign in at /member-login to use Office Hours.' });
  const user = await getUser(token);
  if (!user) return json(401, { error: 'invalid_token', message: 'Your session has expired. Sign in again at /member-login.' });


  const job_id = String((event.queryStringParameters || {}).job_id || '').trim();
  if (!job_id || !/^[a-zA-Z0-9_-]{8,64}$/.test(job_id)) return json(400, { error: 'invalid job_id' });

  try { connectLambda(event); } catch (err) {
    console.error('[resume-coach-status] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  try {
    const store = getStore('resume_coach_jobs');
    const record = await store.get(job_id, { type: 'json' });
    if (!record) return json(200, { status: 'pending', job_id });
    return json(200, { ...record, job_id });
  } catch (err) {
    console.error('[resume-coach-status] read failed', err && err.message);
    return json(500, { error: 'status read failed', detail: err && err.message });
  }
};
