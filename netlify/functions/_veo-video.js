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

// Redeploy marker: Netlify functions read env vars at deploy time, so a
// changed GEMINI_API_KEY needs a build to take effect (2026-08-01).
const HOST = 'generativelanguage.googleapis.com';
const MODEL_FAST = 'veo-3.1-fast-generate-preview';
const MODEL_FULL = 'veo-3.1-generate-preview';
/* Veo 3.1 Lite, 5 cents a second at 720p, half of Fast and an eighth of
   standard. Found on Google's pricing page 2026-08-01 while checking the
   per-second figure, and it changes the whole economics IF it takes an input
   frame: 4 seconds becomes 20 cents rather than $1.60. Fast quietly does not
   take one, so this is not assumed, it is tried and fallen back from. */
const MODEL_LITE = 'veo-3.1-lite-generate-preview';

const PER_SECOND = {                 // cents, 720p
  [MODEL_LITE]: 5,
  [MODEL_FAST]: 10,
  [MODEL_FULL]: 40,
};

/* A model that will not do the job, as opposed to a real failure. Both look
   like an HTTP 400, and only one of them is worth retrying on.

   Matched too narrowly at first: the pattern wanted "is not supported" and
   Google returned "Your use case is currently not supported", so the ladder
   stopped on Lite and never tried standard. One adverb. The test is now the
   phrase "not supported" wherever it appears, which cannot collide with the
   two errors that must NOT retry, since those say "quota" and
   "authentication" (2026-08-01). */
function isUnsupported(msg) {
  var m = String(msg || '');
  if (/quota|billing|credit|authentication|permission|api key/i.test(m)) return false;
  return /not supported|isn't supported|unsupported|not found|invalid.*model|does not exist|use case/i.test(m);
}

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
async function start({ prompt, firstFrameB64, lastFrameB64, seconds, fast, aspect, resolution, models }) {
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
  /* CHEAPEST FIRST, THEN FALL BACK.
     Lite at 5 cents a second is the whole reason animation is affordable, and
     Fast has already proved that a tier's price says nothing about whether it
     accepts a frame. So try them in ascending cost and step up only on a
     refusal, which costs nothing: an unsupported model is rejected before any
     video is generated. Fast is skipped for image work, having already told
     us it will not do it. */
  /* A CALLER MAY SET ITS OWN CEILING. Passing models: [MODEL_LITE] means Lite
     or nothing, so a refusal comes back as a refusal instead of quietly
     stepping up to the tier that costs eight times as much. Good Company uses
     that: Dr. O on the worst case, "$12.80 per customer, no." Nobody should
     discover the expensive tier from a bill. Every existing caller passes
     nothing and keeps the old ladder exactly. */
  const ladder = Array.isArray(models) && models.length
    ? models
    : ((fast === false) ? [MODEL_FULL] : [MODEL_LITE, MODEL_FULL]);

  /* THE IMAGE FIELD NAME, TRIED RATHER THAN ASSUMED.
     ─────────────────────────────────────────────────────────────────────
     Two live runs came back with "`inlineData` isn't supported by this
     model", first on Fast and then on BOTH Lite and standard. Three models
     refusing the same key means the key is wrong, not the model, and my
     first diagnosis (that Fast could not take a frame) was wrong.

     predictLongRunning is a predict-family endpoint, and those carry image
     bytes under their own names rather than the generateContent-style
     inlineData. Rather than guess a fourth time, try the candidates in
     order. A rejected request costs NOTHING, because it is refused before
     any video is generated, so this is free to get wrong and expensive only
     to keep guessing about (2026-08-01). */
  /* THE FIELD IS bytesBase64Encoded, AND THE ERRORS PROVED IT.
     Running all three against both tiers gave two distinct messages, and the
     difference is the whole answer:
       imageBytes   -> "`imageBytes` isn't supported by this model"
       inlineData   -> "`inlineData` isn't supported by this model"
       bytesBase64Encoded -> "Your use case is currently not supported"
     The first two are rejected at the FIELD. The third got past parsing and
     was refused on what we asked for, which means the key is right and
     something about the request is not offered.

     The likeliest candidate is lastFrame, so the ladder now varies the
     REQUEST as well as the field: both ends first, because that is what Dr.
     O asked for, then first frame only. Still free to be wrong, since a
     refusal never generates (2026-08-01). */
  const SHAPES = [
    { name: 'bytesBase64Encoded',  wrap: (b) => ({ bytesBase64Encoded: b, mimeType: 'image/png' }) },
    { name: 'imageBytes',          wrap: (b) => ({ imageBytes: b, mimeType: 'image/png' }) },
    { name: 'inlineData',          wrap: (b) => ({ inlineData: { mimeType: 'image/png', data: b } }) },
  ];
  // Both ends is the goal. First frame only is the fallback that tells us
  // whether lastFrame is the unsupported part.
  const VARIANTS = lastFrameB64 ? ['both', 'first-only'] : ['first-only'];

  const secs = Math.min(8, Math.max(4, Number(seconds) || 8));
  const parameters = {
    durationSeconds: secs,
    aspectRatio: aspect || '16:9',
    resolution: resolution || '1080p',
    personGeneration: 'allow_adult',
  };

  let lastErr = null;
  const tried = [];
  /* Shape is the OUTER loop and model the inner one, deliberately. The wrong
     field name is refused by every tier, so iterating models first would burn
     through the ladder three times over on a fault that has nothing to do
     with the model, and could land on the expensive tier for the wrong
     reason. */
  for (const shape of SHAPES) {
   for (const variant of VARIANTS) {
    const instance = {
      prompt: String(prompt || '').slice(0, 2000),
      image: shape.wrap(firstFrameB64),
    };
    // The second half of Dr. O's ask. Dropped in the 'first-only' variant so
    // we can tell whether lastFrame is the thing being refused; without it
    // Veo animates from one frame and invents the destination, which is the
    // unreliable mode and the reason it is tried second.
    if (lastFrameB64 && variant === 'both') instance.lastFrame = shape.wrap(lastFrameB64);

    for (const model of ladder) {
      try {
        const res = await request('POST', '/v1beta/models/' + model + ':predictLongRunning', {
          instances: [instance], parameters,
        });
        if (!res.name) throw new Error('Veo did not return an operation name');
        const cents = Math.round((PER_SECOND[model] || 40) * secs);
        console.log('[veo] started on', model, 'via', shape.name, variant, '~' + cents + 'c for ' + secs + 's');
        return { operation: res.name, model, image_field: shape.name, frames_used: variant === 'both' ? 2 : 1, cost_cents: cents };
      } catch (e) {
        lastErr = e;
        tried.push(model + '/' + shape.name + '/' + variant + ': ' + (e && e.message));
        /* Only keep going when the API is telling us this combination is not
           supported. A quota error, an auth failure or a malformed payload
           must NOT silently escalate to the tier that costs eight times as
           much, nor churn through every shape. */
        if (!isUnsupported(e && e.message)) throw e;
      }
    }
   }
  }
  const err = new Error('Veo refused every model and image field. Tried: ' + tried.join(' | '));
  err.tried = tried;
  throw lastErr && !tried.length ? lastErr : err;
}

/* Poll. Returns { done, uri, error }. The caller owns the waiting: this is
   deliberately a single check so it can live inside an existing job loop
   rather than blocking a function for six minutes. */
async function check(operation) {
  if (!apiKey()) throw new Error('no Gemini API key in the environment');
  const res = await request('GET', '/v1beta/' + String(operation).replace(/^\/+/, ''), null);
  if (!res.done) return { done: false };
  /* error_detail ADDED 2026-08-20. Every failed render before this only ever
     kept res.error.message ("issue with the audio for your prompt" and
     nothing else) -- the operation's error object can carry a code and a
     details array (Google's safety classifiers use this for WHICH filter
     fired and on what), and all of it was being thrown away at this line
     before anyone downstream ever saw it. This is the actual raw artifact,
     not a guess about what it might contain. */
  if (res.error) return { done: true, error: res.error.message || 'generation failed', error_detail: res.error };
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

/* MODEL_LITE is exported so a caller can set it as its own ceiling, which is
   the only way to be sure a render cannot silently cost eight times more. */
module.exports = { start, check, download, estimateCents, apiKey, keyName, MODEL_FAST, MODEL_FULL, MODEL_LITE };
