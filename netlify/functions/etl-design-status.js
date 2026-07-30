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

  // The piece is a separate track from the words: the caption is finished and
  // usable while Chris is still drawing and Yuki is still composing, so report
  // both rather than making one wait on the other.
  const imageState = res.image_key ? 'ready'
    : res.image_error ? 'failed'
    : 'working';

  return json(200, {
    job_id: jobId,
    status: job.status,
    step: job.step,
    of: job.of,
    note: job.note || '',
    error: job.error || null,
    image_state: imageState,
    paid: !!job.paid,
    revision: job.revision || 0,
    result: {
      brand: res.brand || null,
      angle: res.angle || null,
      copy: res.copy || null,
      platform: res.platform || '',
      // res.image_url is a leftover from the Gamma era, when the picture lived
      // at a third-party URL. It has not existed since the render moved
      // in-house, so this field was silently always empty and the PAGE could
      // never show the piece: every test fetched the image endpoint directly
      // and missed it (2026-07-30).
      //
      // The revision number rides in the URL because etl-design-image caches
      // immutable. That is right for one render and wrong across a revision,
      // where the same URL would keep serving the previous picture while the
      // client was told it had changed.
      image_url: res.image_key
        ? ('/.netlify/functions/etl-design-image?job_id=' + encodeURIComponent(jobId) + '&v=' + (job.revision || 0))
        : '',
      image_error: res.image_error || null,
    },
  });
};
