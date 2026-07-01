/* city-yolanda-ask - sync trigger for Yolanda Ferreira (city services). Member auth required. */

const { getUser, extractToken, deductCredit } = require('./_etl-credits-util');

function newJobId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'yf-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const token = extractToken((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'no_token', message: 'Sign in at /member-login to talk to the staff.' }) };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 500, body: JSON.stringify({ error: 'config' }) };
  const user = await getUser(token);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'invalid_token', message: 'Your session has expired. Sign in again at /member-login.' }) };
  const credit = await deductCredit(user.id, serviceKey);
  if (!credit.ok) {
    const msg = credit.reason === 'no_credits'
      ? "You're out of credits for this month. Your balance tops up on your monthly renewal date."
      : 'No credit account found. Subscribe at /member-login.';
    return { statusCode: 402, body: JSON.stringify({ error: credit.reason, message: msg }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const question = String(body.question || '').trim();
  const zip = String(body.zip || '').trim().slice(0, 10);
  if (!question)              return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };
  if (question.length > 4000) return { statusCode: 400, body: JSON.stringify({ error: 'question_too_long' }) };

  const jobId = newJobId();

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return { statusCode: 500, body: JSON.stringify({ error: 'no_base_url' }) };
  const bgUrl = base + '/.netlify/functions/city-yolanda-background';

  try {
    fetch(bgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, question, zip }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, job_id: jobId, polling_endpoint: '/.netlify/functions/city-yolanda-status?job_id=' + jobId }),
  };
};
