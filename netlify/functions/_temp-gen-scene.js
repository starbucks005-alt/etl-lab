/* TEMP, removed after use. One-off scene video for Reggie.
   POST { action: 'start' } -> { operation, model, cost_cents }
   POST { action: 'check', operation } -> { done, uri?, error? }
   POST { action: 'download', uri } -> { video } base64 mp4

   LITE-TIER CEILING ONLY, matching Good Company's own established policy in
   _veo-video.js ("$12.80 per customer, no"): models: [MODEL_LITE], so a
   refusal comes back as a refusal rather than silently stepping up to the
   tier that costs eight times as much. */
const veo = require('./_veo-video.js');
const https = require('https');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (c, b) => ({ statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

function fetchImageB64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  if (body.action === 'start') {
    const firstFrameB64 = await fetchImageB64('https://emerging-tech-lab.com/good-company/photos/reggie.png');
    try {
      const res = await veo.start({
        prompt: 'A scrappy terrier mix dog sitting in a warm, sunlit living room, looking ' +
          'directly at the camera with alert, delighted energy, panting happily. Subtle ' +
          'natural motion only: he blinks, his ears twitch slightly, his chest rises and ' +
          'falls with breathing, maybe a small head tilt. Nothing dramatic, no camera ' +
          'movement, just a real dog breathing and being alive in the room.',
        firstFrameB64,
        seconds: 4,
        resolution: '720p', // Lite tier's actual supported resolution; 1080p (the file's own
                             // default) errored live as "not supported for a duration of 4 seconds"
        models: [veo.MODEL_LITE],
      });
      return json(200, res);
    } catch (err) {
      return json(502, { error: err.message, tried: err.tried || null });
    }
  }

  if (body.action === 'check') {
    try {
      const res = await veo.check(body.operation);
      return json(200, res);
    } catch (err) {
      return json(502, { error: err.message });
    }
  }

  if (body.action === 'download') {
    try {
      const buf = await veo.download(body.uri);
      return json(200, { video: buf.toString('base64') });
    } catch (err) {
      return json(502, { error: err.message });
    }
  }

  return json(400, { error: 'action must be start, check, or download' });
};
