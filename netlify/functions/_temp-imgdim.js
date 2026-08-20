// Reads the stored portrait for Isabelle's job and reports its real pixel
// dimensions, to check whether Veo is inheriting aspect from the INPUT
// image rather than honoring the aspectRatio parameter. No API cost, just
// a blob read. One-off, secret-gated, deleted after use.
const { getStore, connectLambda } = require('@netlify/blobs');
const SECRET = 'imgdim-q4Rz81';

function pngDims(buf) {
  if (buf.length < 24) return null;
  if (buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), format: 'png' };
}
function jpegDims(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), format: 'jpeg' };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  try { connectLambda(event); } catch (_) {}

  const store = getStore('gc_scene_jobs');
  const jobId = q.job_id || 'gcs-04b10090cf580bb08b';
  const b64 = String(await store.get(jobId + '.portrait', { type: 'text' }) || '');
  if (!b64) return { statusCode: 200, body: 'NO_PORTRAIT_STORED' };

  const buf = Buffer.from(b64, 'base64');
  const dims = pngDims(buf) || jpegDims(buf) || { error: 'unrecognized format', first_bytes: buf.toString('hex', 0, 12) };

  return {
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, bytes: buf.length, dims, ratio: dims.w ? (dims.w / dims.h).toFixed(3) : null }),
  };
};
