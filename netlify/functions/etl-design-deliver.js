/* etl-design-deliver — verify payment, then release the pack.

   POST { job_id, session_id } -> { ok, paid, pack }

   Payment is confirmed by asking Stripe directly, never by trusting a query
   string. The session's own metadata must name the same job, so a paid
   session cannot be replayed against a different job.

   Marks the job paid in the blob so a returning visitor with the same link
   keeps access without paying twice.
*/

const Stripe = require('stripe');
const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

/* The deliverable. Everything the buyer paid for, in one object the page can
   render and download: the copy, the brand sheet, and the image. */
function buildPack(job) {
  const r = job.result || {};
  const c = r.copy || {};
  const b = r.brand || {};
  const a = r.angle || {};
  return {
    business:  job.brief && job.brief.businessName || '',
    platform:  r.platform || '',
    post:      c.post || '',
    hashtags:  c.hashtags || '',
    why:       c.notes || '',
    positioning: a.positioning || '',
    hook:      a.hook || '',
    proof_points: Array.isArray(a.proof_points) ? a.proof_points : [],
    brand: {
      wordmark: b.wordmark || '',
      palette:  Array.isArray(b.palette) ? b.palette : [],
      fonts:    b.fonts || {},
      look:     b.look || '',
    },
    image_url: r.image_key ? ('/.netlify/functions/etl-design-image?job_id=' + encodeURIComponent(job.job_id) + '&v=' + (job.revision || 0)) : '',
    credits: 'Brand direction by Yuki Mendel. Positioning by Reid Callum. Copy by Zara Cole. Visual by Chris Avila, drawn with gpt-image-1 and composed by Yuki. ETL Design, Emerging Technologies Laboratory.',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = String(body.job_id || '').trim();
  const sessionId = String(body.session_id || '').trim();
  if (!jobId) return json(400, { error: 'job_id_required' });

  try { connectLambda(event); } catch (_) {}
  let store, job;
  try {
    store = getStore('etl_design_jobs');
    job = await store.get(jobId, { type: 'json' });
  } catch (e) {
    console.error('[etl-design-deliver] blob read failed', e && e.message);
    return json(500, { error: 'store_unavailable' });
  }
  if (!job) return json(404, { error: 'not_found' });

  // Already paid for on a previous visit.
  if (job.paid) return json(200, { ok: true, paid: true, pack: buildPack(job) });

  if (!sessionId) return json(402, { ok: false, paid: false, error: 'payment_required' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(500, { error: 'config', missing: 'STRIPE_SECRET_KEY' });
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error('[etl-design-deliver] stripe retrieve failed', err.message);
    return json(502, { error: 'stripe_error' });
  }

  const paid = session && session.payment_status === 'paid';
  // The session must name THIS job. Without this check a single paid session
  // could be replayed against any job id.
  const namesThisJob = session && session.metadata && session.metadata.etl_design_job === jobId;
  if (!paid || !namesThisJob) {
    return json(402, { ok: false, paid: false, error: 'payment_not_confirmed' });
  }

  job.paid = true;
  job.paid_at = new Date().toISOString();
  job.stripe_session = sessionId;
  try { await store.setJSON(jobId, job); } catch (e) { console.error('[etl-design-deliver] save failed', e && e.message); }

  return json(200, { ok: true, paid: true, pack: buildPack(job) });
};
