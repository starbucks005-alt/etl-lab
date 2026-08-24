// netlify/functions/proxy-ai.js
// Lightweight pass-through proxy for Anthropic API.
// Adds API key server-side and forwards the full request body.

const https = require('https');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Admin-only. Use PRESS_ADMIN env var as shared secret (Basic auth).
  const adminKey = process.env.PRESS_ADMIN;
  if (adminKey) {
    const authHeader = (event.headers.authorization || event.headers.Authorization || '').trim();
    const expected = 'Basic ' + Buffer.from('admin:' + adminKey).toString('base64');
    if (authHeader !== expected) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  const apiKey = process.env.ETL_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  const payload = event.body || '{}';

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: CORS_HEADERS,
          body: data,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Proxy error: ' + err.message }),
      });
    });

    req.write(payload);
    req.end();
  });
};
