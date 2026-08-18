/* TEMP, removed after use. One-off scene videos for new Good Company demos.
   POST { action: 'start', who: 'reggie'|'tansy' } -> { operation, model, cost_cents }
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

const SCENES = {
  reggie: {
    portrait: 'https://emerging-tech-lab.com/good-company/photos/reggie.png',
    prompt: 'A scrappy terrier mix dog sitting in a warm, sunlit living room, looking ' +
      'directly at the camera with alert, delighted energy, panting happily. Subtle ' +
      'natural motion only: he blinks, his ears twitch slightly, his chest rises and ' +
      'falls with breathing, maybe a small head tilt. Nothing dramatic, no camera ' +
      'movement, just a real dog breathing and being alive in the room.',
  },
  tansy: {
    portrait: 'https://emerging-tech-lab.com/good-company/photos/tansy.jpg',
    prompt: 'An adult woman with delicate dragonfly-like fairy wings, sitting on a mossy ' +
      'branch in a misty forest, looking at the camera with a haughty, faintly amused ' +
      'expression. Subtle natural motion only: her wings flutter slightly, she blinks, a ' +
      'small breeze moves loose strands of her hair and the leaves around her, maybe a ' +
      'small proud tilt of her chin. Nothing dramatic, no camera movement, just a real ' +
      'person breathing and being alive in the scene.',
  },
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  if (body.action === 'start') {
    const scene = SCENES[body.who];
    if (!scene) return json(400, { error: 'who must be reggie or tansy' });
    const firstFrameB64 = await fetchImageB64(scene.portrait);
    try {
      const res = await veo.start({
        prompt: scene.prompt,
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
