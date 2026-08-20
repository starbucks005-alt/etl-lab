// Renders the loosened hybrid crop (moderate zoom + blurred backdrop fill)
// against Isabelle's REAL original, uncropped portrait, and returns the
// actual JPEG bytes for a direct visual check before touching production
// code or spending anything on Veo. Zero API cost. One-off, secret-gated,
// deleted after use.
const { getStore, connectLambda } = require('@netlify/blobs');
const sharp = require('sharp');
const SECRET = 'cropv2-Fm82Qw';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  try { connectLambda(event); } catch (_) {}

  const orders = getStore('gc_scene_orders');
  const order = await orders.get('gco-50d7788a514ba05b', { type: 'json' });
  if (!order) return { statusCode: 200, body: 'ORDER_NOT_FOUND' };
  const b64 = String(await orders.get(order.portrait_key, { type: 'text' }) || '');
  if (!b64) return { statusCode: 200, body: 'NO_ORIGINAL_PORTRAIT' };

  const buf = Buffer.from(b64, 'base64');
  const meta = await sharp(buf).metadata();

  const targetW = 1280, targetH = 720;
  const zoomPct = Number(q.zoom) || 0.65;      // fraction of original height kept
  const biasPct = Number(q.bias) || 0.35;      // 0 = top-anchored, 0.5 = centered
  const cropH = Math.min(meta.height, Math.round(meta.height * zoomPct));
  const cropped = await sharp(buf)
    .extract({
      left: 0,
      top: Math.max(0, Math.round((meta.height - cropH) * biasPct)),
      width: meta.width,
      height: cropH,
    })
    .toBuffer();
  const croppedMeta = await sharp(cropped).metadata();

  const scale = targetH / croppedMeta.height;
  const fgWidth = Math.min(targetW, Math.round(croppedMeta.width * scale));
  const fg = await sharp(cropped).resize(fgWidth, targetH).toBuffer();

  const bg = await sharp(cropped)
    .resize(targetW, targetH, { fit: 'cover' })
    .blur(50)
    .toBuffer();

  const composed = await sharp(bg)
    .composite([{ input: fg, left: Math.round((targetW - fgWidth) / 2), top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
    body: composed.toString('base64'),
    isBase64Encoded: true,
  };
};
