/* etl-design-status — poll one ETL Design job.
   GET ?job_id=dsn-... -> the job state, plus the image once Gamma finishes.

   Gamma generation is asynchronous and outlives the relay, so this endpoint
   chases it: when the job carries a generation id but no image yet, it asks
   Gamma once per poll and writes the URL back into the job the moment it
   lands. That keeps the page on one polling loop instead of two.

   The paid asset is NOT returned here. This is the preview: copy, brand
   direction, and the image for on-screen display. etl-design-deliver.js
   hands over the pack after checkout.
*/

const { getStore, connectLambda } = require('@netlify/blobs');

const GAMMA = 'https://public-api.gamma.app/v1.0/generations';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const jobId = (event.queryStringParameters && event.queryStringParameters.job_id) || '';
  if (!jobId) return json(400, { error: 'job_id_required' });

  try { connectLambda(event); } catch (_) {}
  let store, job;
  try {
    store = getStore('etl_design_jobs');
    job = await store.get(jobId, { type: 'json' });
  } catch (e) {
    console.error('[etl-design-status] blob read failed', e && e.message);
    return json(500, { error: 'store_unavailable' });
  }
  if (!job) return json(404, { error: 'not_found' });

  const res = job.result || {};

  // Chase the image if it is still cooking.
  if (res.gamma_generation_id && !res.image_url && !res.image_error) {
    const key = process.env.GAMMA_API_KEY || process.env.GAMMA_KEY || process.env.BUILD_YOUR_AGENT_GAMMA;
    if (key) {
      try {
        const r = await fetch(GAMMA + '/' + encodeURIComponent(res.gamma_generation_id), { headers: { 'X-API-KEY': key } });
        const d = await r.json().catch(() => ({}));
        let st = d.status;
        if (st && typeof st === 'object') st = st.status || st.state || '';
        if (d.exportUrl) {
          res.image_url = d.exportUrl;
          res.gamma_url = d.gammaUrl || '';
          job.result = res;
          try { await store.setJSON(jobId, job); } catch (_) {}
        } else if (d.error || /fail|error/i.test(String(st || ''))) {
          res.image_error = String(d.error || st);
          job.result = res;
          try { await store.setJSON(jobId, job); } catch (_) {}
        }
      } catch (e) {
        console.warn('[etl-design-status] gamma poll failed (non-fatal)', e && e.message);
      }
    }
  }

  // The image is a separate track from the text: the copy can be finished
  // and usable while Gamma is still working, so report both rather than
  // making one wait on the other.
  const imageState = res.image_url ? 'ready'
    : res.image_error ? 'failed'
    : res.gamma_generation_id ? 'working'
    : 'none';

  return json(200, {
    job_id: jobId,
    status: job.status,
    step: job.step,
    of: job.of,
    note: job.note || '',
    error: job.error || null,
    image_state: imageState,
    paid: !!job.paid,
    result: {
      brand: res.brand || null,
      angle: res.angle || null,
      copy: res.copy || null,
      platform: res.platform || '',
      image_url: res.image_url || '',
      image_error: res.image_error || null,
    },
  });
};
