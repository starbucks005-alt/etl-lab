// Tests a real Veo render using a properly-composed, already-16:9 source
// photo Dr. O supplied directly (not the tight portrait), to see whether
// starting from correctly-shaped source material solves the framing
// problem at the root instead of compensating for it downstream. One-off,
// secret-gated, deleted after use.
const veo = require('./_veo-video.js');
const SECRET = 'newsrc-Jp94Vt';

const PROMPT = 'A seamless infinite loop of this woman working at her desk, glancing up and ' +
  'looking at the camera, present with the person watching. Static camera, fixed framing, ' +
  'consistent soft lighting throughout. Minimal body movement, fluid and natural repetition ' +
  'where the ending seamlessly matches the starting frame, no jump cuts. She is not talking ' +
  'and there is no speech.';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  if (event.httpMethod === 'POST') {
    const portrait = String(event.body || '').trim();
    if (!portrait) return { statusCode: 400, body: 'no image body' };

    let started;
    try {
      started = await veo.start({
        prompt: PROMPT, firstFrameB64: portrait, lastFrameB64: portrait,
        seconds: 4, models: [veo.MODEL_LITE], aspect: '16:9', resolution: '720p',
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

  if (q.action === 'save') {
    const { getStore, connectLambda } = require('@netlify/blobs');
    try { connectLambda(event); } catch (_) {}
    const res = await veo.check(decodeURIComponent(q.op));
    if (!res.done || !res.uri) return { statusCode: 200, body: 'NOT_READY: ' + JSON.stringify(res) };
    const mp4 = await veo.download(res.uri);
    const store = getStore('gc_scene_jobs');
    const jobId = 'gcs-' + require('crypto').randomBytes(9).toString('hex');
    await store.set(jobId + '.mp4', mp4, { metadata: { contentType: 'video/mp4' } });
    await store.setJSON(jobId, {
      job_id: jobId, status: 'ready', note: 'Ready.', operation: q.op,
      seconds: 4, model: veo.MODEL_LITE, prompt: PROMPT,
      video_key: jobId + '.mp4', bytes: mp4.length, error: null,
      started_at: new Date().toISOString(), order_id: null,
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, bytes: mp4.length }) };
  }

  return { statusCode: 400, body: 'GET action=check|save, or POST the base64 image body to start' };
};
