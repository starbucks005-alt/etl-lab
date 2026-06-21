/* get-agent-spec — returns a provisioned agent spec by blob key.
   GET ?ref=<key>
   Public, no auth — the ref is an unguessable timestamp+slug.
   Returns { spec } only; strips payment details.
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
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const ref = ((event.queryStringParameters || {}).ref || '').trim();
  if (!ref) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ref_required' }) };
  }

  let record;
  try {
    const store = getStore('build_requests');
    record = await store.get(ref, { type: 'json' });
  } catch (err) {
    console.error('get-agent-spec blob read:', err.message);
    record = null;
  }

  if (!record) {
    return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'not_found' }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: record.spec || record }),
  };
};
