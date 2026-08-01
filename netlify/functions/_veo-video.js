/* _veo-video — Google Veo 3.1, first frame to last frame.
   ─────────────────────────────────────────────────────────────────────────
   WHY THIS EXISTS (2026-07-31)

   Dr. O's ask, in her own words: "Build the original ask - image 1 and image
   2 and ETL generates the animation video." She had already proved the shape
   works by hand in Claude Design: two stills of the same room, one with a
   mug and one with a book, plus a sentence describing the movement between
   them, and the tool filled in the middle.

   Veo 3.1 is the only documented API that takes BOTH ends. Frame-to-frame is
   also a far more controllable problem than text-to-video: given two fixed
   points the model interpolates and cannot wander, whereas a paragraph makes
   it invent everything. That is very likely why her Claude Design attempt
   came out right while prompt-driven Gemini kept ignoring her.

   COST, CONFIRMED FROM GOOGLE'S PRICING PAGE, NOT REMEMBERED:
     Veo 3.1 Fast   720p $0.10/s   1080p $0.12/s   4k $0.30/s
     Veo 3.1        720p/1080p $0.40/s             4k $0.60/s
   There is NO free tier and it requires a paid Gemini API key.

   Fast at 1080p is the only tier that survives a $4.90 piece: an 8 second
   clip is 96 cents, so a piece goes from about 12 cents to roughly $1.14 and
   still clears two thirds margin. Standard would cost $3.20 and leave a
   dollar, which is why FAST IS THE DEFAULT HERE. Do not change it without
   redoing that arithmetic.

   Generation takes 11 seconds to 6 minutes, so this is a start-then-poll
   API. It must never be called from a synchronous handler.
*/

const https = require('https');

const HOST = 'generativelanguage.googleapis.com';
const MODEL_FAST = 'veo-3.1-fast-generate-preview';
const MODEL_FULL = 'veo-3.1-generate-preview';

/* Accepts the names a key is plausibly stored under, because the variable is
   set in the Netlify dashboard and this file cannot see it. Reports which one
   it found so a missing key is diagnosable rather than a silent 401. */
function apiKey() {
  return process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || process.env.GOOGLE_GEMINI_API_KEY
      || process.env.GEMINI_KEY
      || process.env.VEO_API_KEY
      || null;
}

function keyName() {
  for (const n of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GEMINI_KEY', 'VEO_API_KEY']) {
    if (process.env[n]) return n;
  }
  return null;
}

function request(method, path, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST, path, method,
      headers: Object.assign(
        { 'x-goog-api-key': apiKey() },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      ),
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) {}
        if (res.statusCode >= 400) {
          const msg = (parsed && parsed.error && parsed.error.message) || ('HTTP ' + res.statusCode);
          return reject(new Error('Veo: ' + msg));
        }
        resolve(parsed || {});
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* Kick off a generation. Returns the long-running operation name, which is
   the only handle to the result; store it before doing anything else. */
async function start({ prompt, firstFrameB64, lastFrameB64, seconds, fast, aspect, resolution }) {
  if (!apiKey()) throw new Error('no Gemini API key in the environment');
  if (!firstFrameB64) throw new Error('a first frame is required');

  /* FAST CANNOT TAKE AN IMAGE.
     ─────────────────────────────────────────────────────────────────────
     The first live call ever made returned: "`inlineData` isn't supported by
     this model." The field is right, the docs use exactly that shape, but
     they use veo-3.1-generate-preview and we were calling the fast variant.
     Fast appears to be text-to-video only.

     Image-to-video is the entire point here, so a frame forces the standard
     model. That is 40 cents a second against 12, and the cost note at the
     top of this file was written on the wrong number: an 8 second clip from
     a frame is $3.20, not 96 cents. Duration is where that gets managed, not
     the tier, because the tier is no longer a choice (2026-08-01). */
  const needsImage = !!firstFrameB64;
  const model = (needsImage || fast === false) ? MODEL_FULL : MODEL_FAST;
  const instance = {
    prompt: String(prompt || '').slice(0, 2000),
    image: { inlineData: { mimeType: 'image/png', data: firstFrameB64 } },
  };
  // The second half of Dr. O's ask. Optional: without it Veo animates from
  // one frame and invents the destination, which is the unreliable mode.
  if (lastFrameB64) instance.lastFrame = { inlineData: { mimeType: 'image/png', data: lastFrameB64 } };

  const res = await request('POST', '/v1beta/models/' + model + ':predictLongRunning', {
    instances: [instance],
    parameters: {
      durationSeconds: Math.min(8, Math.max(4, Number(seconds) || 8)),
      aspectRatio: aspect || '16:9',
      resolution: resolution || '1080p',
      personGeneration: 'allow_adult',
    },
  });
  if (!res.name) throw new Error('Veo did not return an operation name');
  return { operation: res.name, model };
}

/* Poll. Returns { done, uri, error }. The caller owns the waiting: this is
   deliberately a single check so it can live inside an existing job loop
   rather than blocking a function for six minutes. */
async function check(operation) {
  if (!apiKey()) throw new Error('no Gemini API key in the environment');
  const res = await request('GET', '/v1beta/' + String(operation).replace(/^\/+/, ''), null);
  if (!res.done) return { done: false };
  if (res.error) return { done: true, error: res.error.message || 'generation failed' };
  const r = res.response || {};
  const vids = r.generatedVideos || r.generateVideoResponse && r.generateVideoResponse.generatedSamples || [];
  const first = Array.isArray(vids) ? vids[0] : null;
  const uri = first && (first.video && first.video.uri || first.uri || first.video);
  if (!uri) return { done: true, error: 'finished with no video uri' };
  return { done: true, uri };
}

/* The file lives behind the same API key, so it cannot be handed to a browser
   as a URL. Pull it server-side and store it ourselves. */
function download(uri) {
  return new Promise((resolve, reject) => {
    const u = new URL(uri);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'x-goog-api-key': apiKey() },
    }, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        res.resume();
        return download(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode >= 400) { res.resume(); return reject(new Error('video download HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/* What a clip actually costs, so the caller can record it rather than guess.
   Fast 1080p is 12 cents a second. */
function estimateCents(seconds, fast, hasImage) {
  // Fast is 12 cents a second and cannot take a frame. Anything driven by an
  // image is the standard model at 40, whatever the caller asked for.
  const perSec = (hasImage || fast === false) ? 40 : 12;
  return Math.round(perSec * (Number(seconds) || 8));
}

module.exports = { start, check, download, estimateCents, apiKey, keyName, MODEL_FAST, MODEL_FULL };
