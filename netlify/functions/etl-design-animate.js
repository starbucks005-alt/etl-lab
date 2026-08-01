/* etl-design-animate — start an animation, and report on one.
   ─────────────────────────────────────────────────────────────────────────
   POST { job_id, action }  -> { ok, status }        starts the render
   GET  ?job_id=...         -> { ok, animation }     progress and result

   The dispatcher exists for the same reason etl-design-ask does: Veo takes
   minutes and a synchronous handler dies at ten seconds, so this validates,
   AWAITS the background invoke, and returns. Awaiting the invoke and not the
   work is the part that matters. The Lambda runtime freezes the moment a
   handler returns, so an un-awaited fetch is simply abandoned, which is how
   a job silently never starts.

   Animation is an ADD-ON, not part of the $4.90 piece. Veo 3.1 Fast at
   1080p is 12 cents a second and an 8 second clip is 96 cents, so bundling
   it would take a twelve cent product past a dollar.
*/

const { getStore, connectLambda } = require('@netlify/blobs');
const veo = require('./_veo-video.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = String(body.job_id || qs.job_id || '').trim();
  if (!/^dsn-[0-9a-z-]+$/i.test(jobId)) return json(400, { error: 'job_id_required' });

  try { connectLambda(event); } catch (_) {}
  let store, job;
  try {
    store = getStore('etl_design_jobs');
    job = await store.get(jobId, { type: 'json' });
  } catch (e) {
    return json(500, { error: 'store_unavailable' });
  }
  /* TWO FRAMES AND AN ACTION, WHICH WAS THE ASK ALL ALONG.
     ─────────────────────────────────────────────────────────────────────
     Dr. O: "Build the original ask - image 1 and image 2 and ETL generates
     the animation video." Until now this endpoint could only animate a
     finished ETL Design job, reading frame A off its stored plate and
     generating frame B. That is a useful mode and it is not the one she
     described, and it made her own material unusable: she had the two
     frames already and there was nowhere to put them.

     Supplying frames also SKIPS the generated frame B entirely, which is
     both cheaper and more faithful. Her instinct was right: the moment the
     two ends are her own files, nothing has to be invented, and the failure
     mode where frame B quietly comes back with different clothes cannot
     happen (2026-08-01).

     Frames go in via the store, never through the invoke: a background
     function is an async Lambda call and those cap at 256KB, which is how
     an upload silently killed a whole job earlier today. */
  const frameAIn = String(body.frame_a || '');
  const frameBIn = String(body.frame_b || '');
  const IMG_RE = /^data:image\/(png|jpeg|jpg|webp);base64,/;

  if (!job && frameAIn) {
    if (!IMG_RE.test(frameAIn)) return json(400, { error: 'bad_frame_a', message: 'frame_a must be an inline image data URL.' });
    if (frameBIn && !IMG_RE.test(frameBIn)) return json(400, { error: 'bad_frame_b', message: 'frame_b must be an inline image data URL.' });
    try {
      await store.set(jobId + '-frame-a', frameAIn, { metadata: { contentType: 'text/plain' } });
      if (frameBIn) await store.set(jobId + '-frame-b', frameBIn, { metadata: { contentType: 'text/plain' } });
      job = {
        job_id: jobId,
        status: 'done',
        kind: 'animation_only',
        created_at: new Date().toISOString(),
        result: { frame_a_key: jobId + '-frame-a', frame_b_key: frameBIn ? (jobId + '-frame-b') : null },
      };
      await store.setJSON(jobId, job);
    } catch (e) {
      console.error('[etl-design-animate] could not store supplied frames', e && e.message);
      return json(500, { error: 'frames_not_stored' });
    }
  }

  if (!job) return json(404, { error: 'not_found' });

  /* Progress. */
  if (event.httpMethod === 'GET') {
    const a = job.animation || null;
    return json(200, {
      ok: true,
      animation: a && {
        status: a.status || null, step: a.step || null, note: a.note || '',
        frames: a.frames || null, error: a.error || null,
        // The frame B failure used to be recorded and never returned, so a
        // silent fall back to single frame looked identical to success. The
        // first live run fell back and there was no way to see why from
        // outside (2026-08-01).
        frame_b_error: a.frame_b_error || null,
        model: a.model || null,
        cost_cents: a.cost_cents || null,
        video_url: a.video_key
          ? ('/.netlify/functions/etl-design-video?job_id=' + encodeURIComponent(jobId))
          : null,
      },
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'GET or POST only' });

  if (!veo.apiKey()) return json(503, { error: 'no_video_key', message: 'No Gemini API key is configured for video.' });
  if (job.animation && job.animation.status === 'running') return json(200, { ok: true, status: 'running', message: 'Already rendering.' });
  if (job.animation && job.animation.status === 'ready') {
    return json(200, { ok: true, status: 'ready', video_url: '/.netlify/functions/etl-design-video?job_id=' + encodeURIComponent(jobId) });
  }
  if (!(job.result && (job.result.plate_key || job.result.frame_a_key))) {
    return json(409, { error: 'no_plate', message: 'This piece was made before the artwork was kept separately, so there is nothing to animate. Run a new brief, or post frame_a and frame_b directly.' });
  }

  const action = String(body.action || '').trim().slice(0, 600);

  job.animation = { status: 'running', step: 'queued', note: 'Starting the render.', started_at: new Date().toISOString() };
  try { await store.setJSON(jobId, job); } catch (_) {}

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || 'https')) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return json(500, { error: 'no_base_url' });

  try {
    // AWAIT the invoke, never the work.
    const r = await fetch(base + '/.netlify/functions/etl-design-animate-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, action }),
    });
    console.log('[etl-design-animate] background invoke', r.status, jobId);
  } catch (e) {
    console.error('[etl-design-animate] invoke failed', e && e.message);
    return json(502, { error: 'could_not_start' });
  }

  return json(200, { ok: true, status: 'running', estimate_cents: veo.estimateCents(4, false, true) });
};
