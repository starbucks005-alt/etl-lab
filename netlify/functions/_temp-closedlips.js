// Tests whether a positive physical instruction ("lips stay closed and
// still") stops Veo from generating a talking-head clip, instead of the
// negation ("no talking") that kept failing. Uses the loosened crop-v2
// image (already visually approved) as the source, Lite tier. One-off,
// secret-gated, deleted after use.
const { getStore, connectLambda } = require('@netlify/blobs');
const sharp = require('sharp');
const veo = require('./_veo-video.js');
const SECRET = 'closedlips-Rt5vNq';

const PROMPT = 'A seamless infinite loop of this woman at her kitchen table, present and ' +
  'listening, looking at the camera. Her lips stay closed and still the entire time -- she ' +
  'expresses everything through her eyes and a soft, closed-mouth smile, never through her ' +
  'mouth. No speaking, no parting of the lips, ever. Static camera, fixed framing, consistent ' +
  'soft lighting throughout. Minimal body movement, fluid and natural repetition where the ' +
  'ending seamlessly matches the starting frame, no jump cuts.';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  try { connectLambda(event); } catch (_) {}

  if (q.action === 'start') {
    const orders = getStore('gc_scene_orders');
    const order = await orders.get('gco-50d7788a514ba05b', { type: 'json' });
    const b64 = String(await orders.get(order.portrait_key, { type: 'text' }) || '');
    const buf = Buffer.from(b64, 'base64');
    const meta = await sharp(buf).metadata();

    const targetW = 1280, targetH = 720;
    const cropH = Math.min(meta.height, Math.round(meta.height * 0.65));
    const cropped = await sharp(buf)
      .extract({ left: 0, top: Math.max(0, Math.round((meta.height - cropH) * 0.35)), width: meta.width, height: cropH })
      .toBuffer();
    const croppedMeta = await sharp(cropped).metadata();
    const scale = targetH / croppedMeta.height;
    const fgWidth = Math.min(targetW, Math.round(croppedMeta.width * scale));
    const fg = await sharp(cropped).resize(fgWidth, targetH).toBuffer();
    const bg = await sharp(cropped).resize(targetW, targetH, { fit: 'cover' }).blur(50).toBuffer();
    const composed = await sharp(bg)
      .composite([{ input: fg, left: Math.round((targetW - fgWidth) / 2), top: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
    const portrait = composed.toString('base64');

    let started;
    try {
      started = await veo.start({
        prompt: PROMPT, firstFrameB64: portrait, seconds: 4,
        models: [veo.MODEL_LITE], aspect: '16:9', resolution: '720p',
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

  return { statusCode: 400, body: 'action required: start | check | save' };
};
