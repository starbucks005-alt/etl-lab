/* etl-design-animate — start an animation, and report on one.
   ─────────────────────────────────────────────────────────────────────────
   POST { job_id, action }  -> { ok, status }        starts the render
   GET  ?job_id=...         -> { ok, animation }     progress and result

   NO BACKGROUND FUNCTION. Starting a Veo render is a sub-second call that
   returns an operation name, so POST does it directly. GET then polls that
   operation and, when it is done, downloads the file and stores it. The page
   already polls, so the thing that finishes the job is the thing that was
   already asking about it.

   It used to hand off to a background function, and six runs in a row said
   'running' and then sat on 'queued' until the worker was POSTed by hand.
   Netlify answered the invocation with 202 and never executed it. Three
   theories were wrong before I stopped debugging it and removed the
   dependency instead.

   Animation is an ADD-ON, not part of the $4.90 piece. Veo 3.1 Lite takes an
   input frame at 5 cents a second, so four seconds is 20 cents.

   ONE THING GOOGLE DOES NOT OFFER HERE: lastFrame. Proven by trying it, six
   combinations of model and field. So this is one frame plus an action, not
   frame A to frame B.
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

  /* Progress, AND the thing that finishes the job.
     ─────────────────────────────────────────────────────────────────────
     This used to only report. Now it also drives: if Veo is still working it
     polls, and the moment the operation is done it downloads the file and
     stores it. Veo's URI sits behind the API key so it can never be handed
     to a browser, and a four second clip is under two megabytes, which is
     comfortably inside a synchronous handler.

     Doing the work here rather than in a background function means the thing
     that completes the job is the thing already asking about it, so there is
     no invocation left to fail silently. */
  if (event.httpMethod === 'GET') {
    let a = job.animation || null;
    if (a && a.status === 'running' && a.operation) {
      try {
        const res = await veo.check(a.operation);
        if (res.done && res.error) {
          a = Object.assign(a, { status: 'error', error: String(res.error).slice(0, 1200) });
          await store.setJSON(jobId, job);
        } else if (res.done && res.uri) {
          // Claim it first, so two overlapping polls cannot both download.
          if (a.step !== 'saving') {
            a = Object.assign(a, { step: 'saving', note: 'Saving your clip.' });
            await store.setJSON(jobId, job);
            const mp4 = await veo.download(res.uri);
            await store.set(jobId + '.mp4', mp4, { metadata: { contentType: 'video/mp4' } });
            a = Object.assign(a, {
              status: 'ready', step: 'done', note: 'Your animation is ready.',
              video_key: jobId + '.mp4', bytes: mp4.length, error: null,
            });
            await store.setJSON(jobId, job);
          }
        }
      } catch (e) {
        // A poll failure is not a job failure: Veo can be briefly unreachable
        // and the next poll will pick it up. Only recorded.
        console.warn('[etl-design-animate] poll/save failed (will retry)', e && e.message);
      }
    }
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

  /* THE INVOKE WAS NEVER CHECKED, WHICH IS WHY IT FAILED SILENTLY.
     ─────────────────────────────────────────────────────────────────────
     Three consecutive runs reported "running" and then sat on this
     function's own "queued" for ever. Each one came alive the moment I
     POSTed the worker by hand. The old code awaited the invoke, logged
     r.status, and returned success whatever that status was, so a 405, a
     redirect that turned POST into GET, or a 404 on the wrong host looked
     exactly like the 202 we want.

     Two changes. The status is now VERIFIED, and the base URL is tried
     rather than assumed: process.env.URL is the site's primary address,
     which is not necessarily the host this request arrived on, and a
     cross-host redirect on a POST is silently downgraded to GET, which the
     worker answers with "POST only".

     The invoke status is also returned to the caller, so a failure to start
     is visible from outside without log access. That is the same lesson the
     credit gate taught: a silent fail-open is indistinguishable from
     working (2026-08-01). */
  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || 'https')) || 'https';
  const bases = [];
  if (host) bases.push(proto + '://' + host);          // the host we were actually called on
  if (process.env.URL && bases.indexOf(process.env.URL) < 0) bases.push(process.env.URL);
  if (!bases.length) return json(500, { error: 'no_base_url' });

  /* NO BACKGROUND FUNCTION ON THE CRITICAL PATH.
     ─────────────────────────────────────────────────────────────────────
     Six runs in a row reported "running" and then sat on "queued" until I
     POSTed the worker by hand. Netlify accepts the background invocation
     with a 202 and does not execute it, and after three wrong theories
     (eventual consistency, an unchecked status, a redirect losing the POST)
     I stopped debugging it and deleted the dependency instead.

     Starting a Veo render is a sub-second call that returns an operation
     name. It never needed a background function. So this handler starts it
     directly, and the GET below finishes the job: it polls the operation and,
     when Veo is done, downloads the file and stores it. The page already
     polls, so the thing that drives the work to completion is the thing that
     was already asking about it (2026-08-01). */
  let frameA = null, frameB = null;
  try {
    const readDataUrl = async (key) => {
      const txt = await store.get(key, { type: 'text' });
      const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(txt || ''));
      return m ? m[1] : null;
    };
    if (job.result.frame_a_key) {
      frameA = await readDataUrl(job.result.frame_a_key);
      if (job.result.frame_b_key) frameB = await readDataUrl(job.result.frame_b_key);
    }
    if (!frameA && job.result.plate_key) {
      const buf = await store.get(job.result.plate_key, { type: 'arrayBuffer' });
      if (buf) frameA = Buffer.from(buf).toString('base64');
    }
  } catch (e) {
    console.error('[etl-design-animate] frames unreadable', e && e.message);
  }
  if (!frameA) return json(409, { error: 'no_frames', message: 'The starting frame could not be read.' });

  const prompt = action
    ? action + '. Slow, cinematic, one continuous take, no camera cuts, no text on screen.'
    : 'A slow cinematic move through the scene, one continuous take, no camera cuts, no text on screen.';

  let startedVeo;
  try {
    startedVeo = await veo.start({ prompt, firstFrameB64: frameA, lastFrameB64: frameB, seconds: 4, resolution: '720p' });
  } catch (e) {
    job.animation = { status: 'error', step: 'render', error: String((e && e.message) || e).slice(0, 1200) };
    try { await store.setJSON(jobId, job); } catch (_) {}
    return json(502, { error: 'veo_refused', message: String((e && e.message) || e).slice(0, 600) });
  }

  job.animation = {
    status: 'running', step: 'render', note: 'Veo is rendering.',
    operation: startedVeo.operation, model: startedVeo.model,
    image_field: startedVeo.image_field, frames: startedVeo.frames_used || 1,
    cost_cents: startedVeo.cost_cents, started_at: new Date().toISOString(),
  };
  try { await store.setJSON(jobId, job); } catch (_) {}

  return json(200, {
    ok: true, status: 'running',
    model: startedVeo.model, image_field: startedVeo.image_field,
    frames: startedVeo.frames_used || 1, cost_cents: startedVeo.cost_cents,
  });
};
