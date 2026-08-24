/* city-yolanda-ask - public, no auth. Sync trigger for Yolanda Ferreira (city services). */

const { connectLambda } = require('@netlify/blobs');
const { TEXT_COST, chargeDailyCap } = require('./_city-daily-cap');

function newJobId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'yf-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const question = String(body.question || '').trim();
  const zip = String(body.zip || '').trim().slice(0, 10);
  if (!question)              return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };
  if (question.length > 4000) return { statusCode: 400, body: JSON.stringify({ error: 'question_too_long' }) };

  const cap = await chargeDailyCap(body.visitor_id, TEXT_COST);
  if (!cap.ok) {
    return { statusCode: 429, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      error: cap.reason, used: cap.used, limit: cap.limit,
      message: cap.reason === 'daily_capped'
        ? "You've reached today's free question limit. It resets tomorrow."
        : 'Could not verify your session; refresh the page and try again.',
    }) };
  }

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
