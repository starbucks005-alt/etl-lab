// Verifies the ACTUAL cropTo169() output from production gc-scene.js is a
// valid, correctly-shaped JPEG -- ruling out a real bug before assuming
// two identical Veo failures are purely bad luck on Google's side. Zero
// API cost. One-off, secret-gated, deleted after use.
const { getStore, connectLambda } = require('@netlify/blobs');
const sharp = require('sharp');
const SECRET = 'verifyout-Zc4Tqp';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  try { connectLambda(event); } catch (_) {}

  const orders = getStore('gc_scene_orders');
  const order = await orders.get('gco-50d7788a514ba05b', { type: 'json' });
  const b64 = String(await orders.get(order.portrait_key, { type: 'text' }) || '');
  const buf = Buffer.from(b64, 'base64');
  const meta = await sharp(buf).metadata();

  // Exact same logic as production's cropTo169(), copied here to inspect
  // the output rather than trusting it.
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
    .jpeg({ quality: 92 })
    .toBuffer();

  const finalMeta = await sharp(composed).metadata();

  return {
    statusCode: 200, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      original: { w: meta.width, h: meta.height },
      intermediate_crop: { w: croppedMeta.width, h: croppedMeta.height },
      final: { w: finalMeta.width, h: finalMeta.height, format: finalMeta.format, valid: !!(finalMeta.width && finalMeta.height) },
      final_bytes: composed.length,
      final_base64_length: composed.toString('base64').length,
    }, null, 2),
  };
};
