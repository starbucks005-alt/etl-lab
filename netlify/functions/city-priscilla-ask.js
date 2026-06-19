/* city-priscilla-ask - public sync trigger for Priscilla Okeke (city services). No auth. */

function newJobId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'po-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const question = String(body.question || '').trim();
  if (!question)              return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };
  if (question.length > 4000) return { statusCode: 400, body: JSON.stringify({ error: 'question_too_long' }) };

  const jobId = newJobId();

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return { statusCode: 500, body: JSON.stringify({ error: 'no_base_url' }) };
  const bgUrl = base + '/.netlify/functions/city-priscilla-background';

  try {
    fetch(bgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, question }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, job_id: jobId, polling_endpoint: '/.netlify/functions/city-priscilla-status?job_id=' + jobId }),
  };
};
