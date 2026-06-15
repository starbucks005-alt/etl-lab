const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  const store = getStore('etl_map');

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'GET') {
    const data = await store.get('snapshot', { type: 'json' }).catch(() => null);
    return { statusCode: 200, headers, body: JSON.stringify(data || { agents: [], ts: 0 }) };
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    await store.set('snapshot', body);
    return { statusCode: 200, headers, body: '{"ok":true}' };
  }

  return { statusCode: 405, headers, body: '{"error":"method not allowed"}' };
};
