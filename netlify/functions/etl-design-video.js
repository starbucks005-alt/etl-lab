/* etl-design-video — serve a finished animation.
   ─────────────────────────────────────────────────────────────────────────
   GET ?job_id=dsn-... -> the mp4

   Veo hands back a URI that sits behind the API key, so it can never go to a
   browser. The background worker downloads the file and stores it; this
   hands over our copy.

   Same posture as etl-design-image: no auth. The ids are random and nothing
   links to them, and the thing worth protecting is the paid deliverable
   rather than the render itself.
*/

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'GET only' };

  const jobId = String((event.queryStringParameters || {}).job_id || '').trim();
  if (!/^dsn-[0-9a-z-]+$/i.test(jobId)) return { statusCode: 400, headers: CORS, body: 'job_id required' };

  try { connectLambda(event); } catch (_) {}
  try {
    const store = getStore('etl_design_jobs');
    const buf = await store.get(jobId + '.mp4', { type: 'arrayBuffer' });
    if (!buf) return { statusCode: 404, headers: CORS, body: 'not found' };
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'video/mp4',
        // Immutable per job: a re-render writes a new job, never a new file
        // under the same id.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    console.error('[etl-design-video] read failed', e && e.message);
    return { statusCode: 500, headers: CORS, body: 'store unavailable' };
  }
};
