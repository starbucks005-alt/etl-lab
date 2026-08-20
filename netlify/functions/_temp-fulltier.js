// One real test at the full-price Veo tier ($1.60 for 4s), explicitly
// authorized by Dr. O ("test the 1.60 once"), to confirm whether a real
// last-frame request actually produces a genuine loop when it isn't
// silently rejected the way Lite rejected it. Uses the already-cropped
// (1280x720) portrait from the crop-fix test job, and her own updated
// prompt wording. One-off, secret-gated, deleted after use.
const { getStore, connectLambda } = require('@netlify/blobs');
const sharp = require('sharp');
const veo = require('./_veo-video.js');
const SECRET = 'fulltier-Zx8vQ2m';

const PROMPT = 'A seamless infinite loop of a person active listening, looking at the camera. ' +
  'no talking. Static camera, fixed framing, consistent soft lighting throughout. Minimal body ' +
  'movement, fluid and natural repetition where the ending seamlessly matches the starting frame, ' +
  'no jump cuts.';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  try { connectLambda(event); } catch (_) {}

  if (q.action === 'start') {
    // A different image, per Dr. O -- Sofia's real live portrait, not
    // Isabelle's again, to rule out anything specific to that one photo.
    const imgRes = await fetch('https://emerging-tech-lab.com/good-company/photos/sofia.jpg');
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const cropped = await sharp(imgBuf)
      .resize(1280, 720, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 92 })
      .toBuffer();
    const portrait = cropped.toString('base64');

    let started;
    try {
      started = await veo.start({
        prompt: PROMPT, firstFrameB64: portrait, lastFrameB64: portrait,
        seconds: 4, models: [veo.MODEL_FULL], aspect: '16:9', resolution: '720p',
      });
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_failed: true, error: String(e && e.message || e) }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(started) };
  }

  if (q.action === 'check') {
    const res = await veo.check(decodeURIComponent(q.op));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res, null, 2) };
  }

  // Saves the finished render into a real gc_scene_jobs entry so the
  // normal add-scene delivery link works, without re-running gc-scene.js's
  // own Lite-only POST path.
  if (q.action === 'save') {
    const res = await veo.check(decodeURIComponent(q.op));
    if (!res.done || !res.uri) return { statusCode: 200, body: 'NOT_READY: ' + JSON.stringify(res) };
    const mp4 = await veo.download(res.uri);
    const store = getStore('gc_scene_jobs');
    const jobId = 'gcs-' + require('crypto').randomBytes(9).toString('hex');
    await store.set(jobId + '.mp4', mp4, { metadata: { contentType: 'video/mp4' } });
    await store.setJSON(jobId, {
      job_id: jobId, status: 'ready', note: 'Ready.', operation: q.op,
      seconds: 4, model: veo.MODEL_FULL, prompt: PROMPT,
      video_key: jobId + '.mp4', bytes: mp4.length, error: null,
      started_at: new Date().toISOString(), order_id: null,
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, bytes: mp4.length }) };
  }

  return { statusCode: 400, body: 'action required: start | check | save' };
};
