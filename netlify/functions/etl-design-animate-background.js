/* etl-design-animate-background — turn a finished piece into a short film.
   ─────────────────────────────────────────────────────────────────────────
   Dr. O's ask, unchanged through several rounds: "image 1 and image 2 and
   ETL generates the animation video." She had already proved the shape by
   hand: two stills of the same room, one holding a mug and one holding a
   book, plus a sentence for the movement between them.

   TWO WAYS IN
     A. The client supplies both frames. Nothing is invented and this is the
        mode she described. It is also the only one immune to the failure she
        spotted immediately in a hand-made pair: "they have on different
        clothes." Two files of the same people in the same clothes cannot
        drift, because neither end was reconstructed.
     B. A finished ETL Design job. Frame A is Chris's stored artwork and
        frame B is an EDIT of it, so the room and the people survive. A fresh
        generation would give a different room, which is exactly what makes a
        two-frame animation fall apart.

   Then Veo interpolates between the ends, guided by the action line.

   WHY THIS IS A BACKGROUND FUNCTION. Veo takes 11 seconds to 6 minutes. A
   synchronous handler dies at 10. The page polls the job the same way it
   already polls a brief.

   COST, corrected 2026-08-01 after the first live call. Veo Fast is 12 cents
   a second and REFUSES an input frame, so image-to-video cannot use it. The
   ladder in _veo-video.js tries Lite at 5 cents a second first and falls back
   to standard at 40. A 4 second clip is therefore 20 cents at best and $1.60
   at worst, which is why animation is an ADD-ON and not part of the $4.90
   piece, and why the default is 4 seconds at 720p.
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
    /* SUPPLIED FRAMES WIN. When the client hands over both ends there is
       nothing to invent, which is cheaper and strictly more faithful: the
       room, the people and the clothes are theirs in both frames rather than
       reconstructed in one of them (2026-08-01). */
    const res0 = job.result || {};
    let frameA = null, frameB = null, framesSupplied = false;

    const readDataUrl = async (key) => {
      const txt = await store.get(key, { type: 'text' });
      const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(txt || ''));
      return m ? m[1] : null;
    };

    if (res0.frame_a_key) {
      try {
        frameA = await readDataUrl(res0.frame_a_key);
        if (res0.frame_b_key) frameB = await readDataUrl(res0.frame_b_key);
        framesSupplied = !!frameA;
      } catch (e) {
        console.error('[etl-design-animate] supplied frames unreadable', e && e.message);
      }
    }

    const plateKey = res0.plate_key || (jobId + '-plate.png');
    if (!frameA) {
      try {
        const buf = await store.get(plateKey, { type: 'arrayBuffer' });
        frameA = Buffer.from(buf).toString('base64');
      } catch (_) { frameA = null; }
    }
    if (!frameA) {
      await save({ status: 'error', error: 'this piece has no stored artwork to animate; run a new brief' });
      return { statusCode: 200, body: 'no plate' };
    }

    /* FRAME B. An edit, not a generation, and ONLY when the client did not
       supply one. A supplied second frame is the client's own file: editing
       or regenerating over the top of it would throw away the exact thing
       that makes it trustworthy, and it is what she asked for in the first
       place (2026-08-01). */
    if (frameB) {
      await save({ status: 'running', step: 'frames', note: 'Using both of your frames.', frames: 2 });
    } else {
      await save({ status: 'running', step: 'frame_b', note: 'Chris is drawing the second frame.' });
      const editPrompt =
        'Keep this exact scene, the same room, the same lighting, the same people, the same framing and the same style. ' +
        'Change only this: ' + (action || 'the subject completes the action they had begun, a moment later in time') + '. ' +
        'This is the SECOND frame of a two frame animation and the first frame is the image supplied, so everything ' +
        'other than the described change must match it precisely.';
      try {
        // NOT `let frameB` here. Re-declaring shadows the outer binding, so a
        // successfully generated frame would be dropped on leaving this block
        // and every job would silently render single-frame.
        frameB = await gem.edit(frameA, editPrompt, 'image/png');
      } catch (e) {
        // Survivable: Veo will animate from one frame, it is just less
        // controlled. Recorded so the client is told which mode ran.
        console.warn('[etl-design-animate] frame B failed, single-frame fallback', e && e.message);
        await save({ frame_b_error: String(e && e.message).slice(0, 200) });
      }
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
