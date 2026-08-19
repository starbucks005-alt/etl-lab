/* ONE-OFF, DELETED RIGHT AFTER USE. Polls the test-prompt render's raw
   operation directly (no order/job record involved, since this one was
   started standalone by _temp-test-scene-prompt.js). */
const https = require('https');

const TEMP_SECRET = 'veo-diag2-2026-08-19-p3z6';
const OPERATION = 'models/veo-3.1-lite-generate-preview/operations/se3uybhfhcp5';
const HOST = 'generativelanguage.googleapis.com';

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ||
         process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_KEY || process.env.VEO_API_KEY || null;
}

function rawGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: HOST, path, method: 'GET', headers: { 'x-goog-api-key': apiKey() } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });
  if (!apiKey()) return json(500, { error: 'no_key' });

  const res = await rawGet('/v1beta/' + OPERATION);
  return json(200, res);
};
