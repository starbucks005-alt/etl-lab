/* etl-design-animate-background — turn a finished piece into a short film.
   ─────────────────────────────────────────────────────────────────────────
   Dr. O's ask, unchanged through several rounds: "image 1 and image 2 and
   ETL generates the animation video." She had already proved the shape by
   hand: two stills of the same room, one holding a mug and one holding a
   book, plus a sentence for the movement between them.

   THE PIPELINE
     1. Frame A is Chris's artwork, already generated and stored with the job.
     2. Frame B is an EDIT of frame A, so the room and the person survive.
        A fresh generation would give a different room, which is what makes a
        two-frame animation fall apart.
     3. Veo 3.1 Fast interpolates between them, guided by the action line.

   WHY THIS IS A BACKGROUND FUNCTION. Veo takes 11 seconds to 6 minutes. A
   synchronous handler dies at 10. The page polls the job the same way it
   already polls a brief.

   COST. Veo 3.1 Fast at 1080p is 12 cents a second, so 8 seconds is 96
   cents, plus a few cents for the frame B edit. That is why animation is an
   ADD-ON and not part of the $4.90 piece: bundling it would take a twelve
   cent product to well over a dollar and gut the margin.
*/

const { getStore, connectLambda } = require('@netlify/blobs');
const veo = require('./_veo-video.js');
const gem = require('./_gemini-image.js');

const POLL_MS = 10000;
const MAX_WAIT_MS = 8 * 60 * 1000;   // Veo's documented ceiling is 6 minutes

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = String(body.job_id || '').trim();
  const action = String(body.action || '').trim().slice(0, 600);
  if (!jobId) return { statusCode: 400, body: 'job_id required' };

  try { connectLambda(event); } catch (_) {}
  let store, job;
  try {
    store = getStore('etl_design_jobs');
    job = await store.get(jobId, { type: 'json' });
  } catch (e) {
    console.error('[etl-design-animate] store unavailable', e && e.message);
    return { statusCode: 500, body: 'no store' };
  }
  if (!job) return { statusCode: 404, body: 'not found' };

  const save = async (patch) => {
    job.animation = Object.assign({}, job.animation, patch, { updated_at: new Date().toISOString() });
    try { await store.setJSON(jobId, job); } catch (e) { console.error('[etl-design-animate] save failed', e && e.message); }
  };

  try {
    /* FRAME A. Stored during the brief precisely so this is possible without
       paying to draw the scene twice. */
    const plateKey = (job.result && job.result.plate_key) || (jobId + '-plate.png');
    let frameA;
    try {
      const buf = await store.get(plateKey, { type: 'arrayBuffer' });
      frameA = Buffer.from(buf).toString('base64');
    } catch (_) { frameA = null; }
    if (!frameA) {
      await save({ status: 'error', error: 'this piece has no stored artwork to animate; run a new brief' });
      return { statusCode: 200, body: 'no plate' };
    }

    /* FRAME B. An edit, not a generation. The prompt says what to change and,
       just as importantly, what to leave alone. */
    await save({ status: 'running', step: 'frame_b', note: 'Chris is drawing the second frame.' });
    const editPrompt =
      'Keep this exact scene, the same room, the same lighting, the same people, the same framing and the same style. ' +
      'Change only this: ' + (action || 'the subject completes the action they had begun, a moment later in time') + '. ' +
      'This is the SECOND frame of a two frame animation and the first frame is the image supplied, so everything ' +
      'other than the described change must match it precisely.';
    let frameB = null;
    try {
      frameB = await gem.edit(frameA, editPrompt, 'image/png');
    } catch (e) {
      // Survivable: Veo will animate from one frame, it is just less
      // controlled. Recorded so the client is told which mode ran.
      console.warn('[etl-design-animate] frame B failed, single-frame fallback', e && e.message);
      await save({ frame_b_error: String(e && e.message).slice(0, 200) });
    }
    if (frameB) {
      try { await store.set(jobId + '-plate-b.png', Buffer.from(frameB, 'base64'), { metadata: { contentType: 'image/png' } }); }
      catch (_) {}
    }

    /* THE FILM. */
    await save({ status: 'running', step: 'render', note: 'Rendering the animation.', frames: frameB ? 2 : 1 });
    const prompt = action
      ? action + '. Slow, cinematic, one continuous take, no camera cuts, no text on screen.'
      : 'A slow cinematic move through the scene, one continuous take, no camera cuts, no text on screen.';
    /* FOUR SECONDS, 720p, and both are cost decisions rather than taste.
       Image-to-video forces the standard model at 40 cents a second, so 8
       seconds is .20 and 4 is .60. Dr. O is cost-cutting in demo mode
       and a clip nobody has approved yet is the wrong place to spend triple
       (2026-08-01). */
    const SECONDS = 4;
    const started = await veo.start({ prompt, firstFrameB64: frameA, lastFrameB64: frameB, seconds: SECONDS, resolution: '720p' });
    // The real cost comes back from start(), because which tier accepted the
    // request is only known after it accepted it. An estimate made before the
    // call would be a guess between 20 cents and $1.60.
    await save({ operation: started.operation, model: started.model, cost_cents: started.cost_cents });

    const deadline = Date.now() + MAX_WAIT_MS;
    let uri = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_MS));
      let res;
      try { res = await veo.check(started.operation); }
      catch (e) { console.warn('[etl-design-animate] poll error (retrying)', e && e.message); continue; }
      if (!res.done) continue;
      if (res.error) { await save({ status: 'error', error: res.error }); return { statusCode: 200, body: 'veo error' }; }
      uri = res.uri;
      break;
    }
    if (!uri) { await save({ status: 'error', error: 'the render did not finish in time' }); return { statusCode: 200, body: 'timeout' }; }

    /* The file sits behind the same API key, so it cannot be handed to a
       browser as a link. Pull it and store it ourselves. */
    const mp4 = await veo.download(uri);
    const videoKey = jobId + '.mp4';
    await store.set(videoKey, mp4, { metadata: { contentType: 'video/mp4' } });
    await save({
      status: 'ready', step: 'done', note: 'Your animation is ready.',
      video_key: videoKey, bytes: mp4.length, error: null,
    });
    console.log('[etl-design-animate] done', jobId, (mp4.length / 1024 / 1024).toFixed(1) + 'MB');
    return { statusCode: 200, body: 'ok' };

  } catch (e) {
    console.error('[etl-design-animate] failed', e && e.message);
    await save({ status: 'error', error: String(e && e.message).slice(0, 240) });
    return { statusCode: 200, body: 'error recorded' };
  }
};
