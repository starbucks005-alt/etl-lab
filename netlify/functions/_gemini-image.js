/* _gemini-image — edit an existing image, keeping the scene.
   ─────────────────────────────────────────────────────────────────────────
   WHY GEMINI AND NOT gpt-image-1 FOR THIS ONE JOB (2026-07-31)

   Frame B has to be the SAME room, the SAME person, one thing changed. A
   fresh generation gives you a different room and a different person, which
   is exactly what makes a two-frame animation fall apart. That is an EDIT,
   not a generation.

   Two reasons this uses Gemini rather than the OpenAI path Chris draws with:
   editing an existing image while holding the scene is what this model is
   for, and Dr. O already rates the output ("Gamma uses gemini and I love
   Gamma's images"). It also means the whole animation path needs one key,
   GEMINI_API_KEY, which is already set, instead of adding a second
   dependency for one call.

   Chris still draws frame A with gpt-image-1. This is only the edit.
*/

const https = require('https');

const HOST = 'generativelanguage.googleapis.com';
const MODEL = 'gemini-3.1-flash-image';

function apiKey() {
  return process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || process.env.GOOGLE_GEMINI_API_KEY
      || null;
}

/* Walk whatever shape the response arrives in and return the first image.
   Deliberately tolerant: this is a preview API and the exact nesting is the
   most likely thing to move under us. A readable throw beats a crash. */
function findImage(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.output_image && payload.output_image.data) return payload.output_image.data;
  if (typeof payload.data === 'string' && payload.type === 'image') return payload.data;
  for (const key of Object.keys(payload)) {
    const v = payload[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        const hit = findImage(item);
        if (hit) return hit;
      }
    } else if (v && typeof v === 'object') {
      const hit = findImage(v);
      if (hit) return hit;
    }
  }
  return null;
}

/* Edit an image. Returns a base64 PNG string. */
function edit(imageB64, prompt, mimeType) {
  const key = apiKey();
  if (!key) return Promise.reject(new Error('no Gemini API key in the environment'));
  if (!imageB64) return Promise.reject(new Error('an input image is required'));

  const payload = JSON.stringify({
    model: MODEL,
    input: [
      { type: 'text', text: String(prompt || '').slice(0, 2000) },
      { type: 'image', mime_type: mimeType || 'image/png', data: imageB64 },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST,
      path: '/v1beta/interactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) {}
        if (res.statusCode >= 400) {
          const msg = (parsed && parsed.error && parsed.error.message) || ('HTTP ' + res.statusCode);
          return reject(new Error('Gemini image: ' + msg));
        }
        const img = findImage(parsed);
        if (!img) return reject(new Error('Gemini image: no image in the response'));
        resolve(img);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { edit, apiKey, MODEL };
