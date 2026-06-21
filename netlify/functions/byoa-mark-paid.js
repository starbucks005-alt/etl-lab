/* byoa-mark-paid — called from the browser the moment Stripe's success URL lands.
   POST { ref }
   1. Reads the spec blob from build_requests.
   2. Marks it paid (idempotent — safe to call twice).
   3. Fires package-agent-background (returns 202; we don't wait).
   Returns { ok: true }.
*/

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method_not_allowed' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const ref = (body.ref || '').trim();
  if (!ref) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ref_required' }) };

  const store = getStore('build_requests');
  let record;
  try { record = await store.get(ref, { type: 'json' }); } catch (_) { record = null; }

  if (!record) {
    return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'not_found' }) };
  }

  // Idempotent — if already paid, just trigger packaging again in case it didn't run
  if (record.status !== 'paid') {
    await store.setJSON(ref, { ...record, status: 'paid', paid_at: new Date().toISOString() });
  }

  // Kick off packaging (background function — fire and forget, returns 202)
  const proto = (event.headers['x-forwarded-proto'] || 'https');
  const host  = (event.headers['host'] || 'emerging-tech-lab.com');
  fetch(proto + '://' + host + '/.netlify/functions/package-agent-background', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ref }),
  }).catch(() => {});

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
