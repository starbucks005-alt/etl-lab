/* etl-image — just an image, no flyer around it.
   ─────────────────────────────────────────────────────────────────────────
   POST { prompt, aspect, guest_id } -> { ok, job_id }
   GET  ?job_id=...                  -> { ok, status, image_url }

   WHY THIS EXISTS (2026-08-02)

   Dr. O, on the ETL Design page: "I did not get option to do anything but
   make the same flyer we've been making. not generate videos or images."

   She had asked twice already, "Can they generate an image? a gemini image,
   like gamma?" and "have Chris make an image", and I answered by changing
   which engine Chris draws with, which is invisible from the page. What she
   wanted was the thing Gamma does: describe an image, get the image, no
   headline and no layout wrapped around it.

   A SEPARATE ENDPOINT ON PURPOSE. The flyer relay is four agents in sequence
   and has been fragile all week. This shares its job store and its credit
   rules and touches none of its code, so an image request cannot break a
   brief and a brief cannot break this.

   ONE CREDIT, same as a brief. A generation is about five cents against a
   brief's fourteen, so if anything this is the better deal for a member, and
   a second unit of account would be worse than a generous one.

   THE BACKGROUND PATTERN, deliberately. netlify.toml records that this
   platform kills synchronous functions well before the declared timeout, and
   generation runs 10 to 30 seconds. etl-design-background has been reliable
   all day, unlike etl-design-animate-background, so this copies the one that
   works.
*/

const { getStore, connectLambda } = require('@netlify/blobs');
const credits = require('./_design-credits.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

function newJobId() {
  const d = new Date();
  return 'dsn-' + d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 8);
}

const ASPECTS = { square: '1:1', portrait: '4:5', landscape: '16:9', vertical: '9:16' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore('etl_design_jobs'); }
  catch (e) { return json(500, { error: 'store_unavailable' }); }

  /* Progress. The finished image is served by etl-design-image, which reads
     result.image_key from this same store, so there is nothing new to build
     for delivery. */
  if (event.httpMethod === 'GET') {
    const jobId = String((event.queryStringParameters || {}).job_id || '').trim();
    if (!/^dsn-[0-9a-z-]+$/i.test(jobId)) return json(400, { error: 'job_id_required' });
    let job = null;
    try { job = await store.get(jobId, { type: 'json' }); } catch (_) {}
    if (!job) return json(404, { error: 'not_found' });
    return json(200, {
      ok: true,
      status: job.status || 'running',
      note: job.note || '',
      error: job.error || null,
      engine: (job.result && job.result.art_engine) || null,
      image_url: (job.result && job.result.image_key)
        ? ('/.netlify/functions/etl-design-image?job_id=' + encodeURIComponent(jobId))
        : null,
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const prompt = String(body.prompt || '').trim();
  if (!prompt) return json(400, { error: 'prompt_required' });
  if (prompt.length > 1200) return json(400, { error: 'prompt_too_long' });
  const aspect = ASPECTS[String(body.aspect || 'square')] || '1:1';

  /* Credit check BEFORE anything is spent, same as a brief. A refusal costs
     nothing at all. */
  let verdict, creditFault = null;
  try {
    verdict = await credits.check(event, body);
  } catch (e) {
    creditFault = String((e && e.message) || e).slice(0, 200);
    console.error('[etl-image] credit check failed, allowing through:', creditFault);
    verdict = { ok: true, kind: 'guest', guestId: credits.safeGuestId(body && body.guest_id) || credits.newGuestId(), remaining: null };
  }
  if (!verdict.ok) {
    return json(402, { error: verdict.reason || 'out_of_credits', kind: verdict.kind, guest_id: verdict.guestId || null, remaining: 0 });
  }

  /* A SOURCE IMAGE MAKES THIS AN EDIT, NOT A GENERATION. Dr. O: "never do
     I have an image generated that doesn't stem from some other image." It
     rides the store rather than the invoke, like every other upload here,
     because a background call caps at 256KB (2026-08-02). */
  const sourceImage = String(body.source_image || '');
  const jobId = newJobId();
  let sourceKey = null;
  if (sourceImage && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(sourceImage) && sourceImage.length < 4000000) {
    try {
      await store.set(jobId + '-source', sourceImage, { metadata: { contentType: 'text/plain' } });
      sourceKey = jobId + '-source';
    } catch (e) {
      console.error('[etl-image] source not stored, generating instead:', e && e.message);
    }
  }
  try {
    await store.setJSON(jobId, {
      job_id: jobId, kind: 'image_only', status: 'running',
      note: 'Chris is drawing.', created_at: new Date().toISOString(),
      prompt, aspect, source_key: sourceKey, result: {},
    });
  } catch (e) {
    return json(500, { error: 'store_write_failed' });
  }

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || 'https')) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return json(500, { error: 'no_base_url' });

  try {
    // AWAIT the invoke, never the work. The runtime freezes the moment this
    // handler returns, so an un-awaited fetch is simply abandoned.
    const r = await fetch(base + '/.netlify/functions/etl-image-background', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    console.log('[etl-image] background invoke', r.status, jobId);
  } catch (e) {
    console.error('[etl-image] invoke failed', e && e.message);
    return json(502, { error: 'could_not_start' });
  }

  // Spend only once the work is genuinely running.
  let spent = { ok: true, remaining: null };
  try { spent = await credits.spend(event, verdict); }
  catch (e) { console.error('[etl-image] credit spend failed (work already started):', e && e.message); }

  return json(200, {
    ok: true, job_id: jobId, kind: verdict.kind,
    guest_id: verdict.guestId || null, remaining: spent.remaining,
    credit_fault: creditFault,
  });
};
