/* agent-build-request — receives a BYOA spec and queues it for ETL provisioning.
   POST (the agent spec JSON from buildSpec())
   Returns { ok: true, ref: '<key>' } on success.
   Writes to the 'build_requests' Blob store so Terry can pull and provision later.
*/

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'bad_json' }) }; }

  // Accept both {spec, items, total} (invoice format) and a bare spec object
  const spec  = payload.spec  || payload;
  const items = payload.items || [];
  const total = payload.total || 5;

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const key = ts + '--' + (spec.id || 'agent');

  try {
    const store = getStore('build_requests');
    await store.setJSON(key, { spec, items, total, submitted_at: new Date().toISOString() });
  } catch (err) {
    // Log but don't fail the user -- the request is captured in the function log
    console.error('agent-build-request blob write:', err.message);
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, ref: key }),
  };
};
