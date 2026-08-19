/* ONE-OFF, DELETED RIGHT AFTER USE. Two Veo Lite attempts at Isabelle's
   scene both failed with the generic "finished with no video uri" --
   _veo-video.js's check() discards the rest of the operation response when
   there is no uri, which is exactly the detail needed to tell a content
   filter apart from a format problem apart from something else. This
   re-polls the raw operation directly and returns the full response instead
   of the narrowed shape, for the second (still fresh) job specifically. */
const { getStore, connectLambda } = require('@netlify/blobs');
const https = require('https');

const TEMP_SECRET = 'veo-diag-2026-08-19-c8n4';
const JOB_ID = 'gcs-07dbaf3d8a0709f53a';
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
  try { connectLambda(event); } catch (_) {}
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });
  if (!apiKey()) return json(500, { error: 'no_key' });

  const store = getStore('gc_scene_jobs');
  const job = await store.get(JOB_ID, { type: 'json' });
  if (!job) return json(404, { error: 'job_not_found' });
  if (!job.operation) return json(200, { job_status: job.status, note: 'no operation string stored' });

  const res = await rawGet('/v1beta/' + String(job.operation).replace(/^\/+/, ''));
  return json(200, { job_operation: job.operation, raw: res });
};
