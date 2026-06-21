/* check-agent-box — is the delivery ZIP ready?
   GET ?ref=<build_requests blob key>
   Returns { ready: boolean, box_ref: string|null }
*/

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const ref = ((event.queryStringParameters || {}).ref || '').trim();
  if (!ref) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ref_required' })
    };
  }

  let record;
  try {
    const store = getStore('build_requests');
    record = await store.get(ref, { type: 'json' });
  } catch (_) {
    record = null;
  }

  if (!record) {
    return {
      statusCode: 404,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: false, box_ref: null })
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ready:   !!record.box_ready,
      box_ref: record.box_ref || null
    })
  };
};
