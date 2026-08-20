// Verifies cropTo169's real behavior against Isabelle's actual stored
// portrait: input dims, output dims, and that sharp itself loads correctly
// in this runtime. Zero API cost, pure image processing. One-off,
// secret-gated, deleted after use.
const { getStore, connectLambda } = require('@netlify/blobs');
const sharp = require('sharp');
const SECRET = 'cropcheck-9vY2mN';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  try { connectLambda(event); } catch (_) {}

  const store = getStore('gc_scene_jobs');
  const jobId = q.job_id || 'gcs-04b10090cf580bb08b';
  const b64 = String(await store.get(jobId + '.portrait', { type: 'text' }) || '');
  if (!b64) return { statusCode: 200, body: 'NO_PORTRAIT_STORED' };

  const buf = Buffer.from(b64, 'base64');
  const before = await sharp(buf).metadata();

  const cropped = await sharp(buf)
    .resize(1280, 720, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 92 })
    .toBuffer();
  const after = await sharp(cropped).metadata();

  return {
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      before: { w: before.width, h: before.height, ratio: (before.width / before.height).toFixed(3) },
      after: { w: after.width, h: after.height, ratio: (after.width / after.height).toFixed(3) },
      cropped_bytes: cropped.length,
    }, null, 2),
  };
};
