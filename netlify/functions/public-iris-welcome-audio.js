/* ─────────────────────────────────────────────────────────────────────────────
   public-iris-welcome-audio — Iris's spoken welcome for the ETL site
   help widget.

   Public endpoint (no auth). Plays once on a visitor's first open of the
   Iris chat panel, and again from the speaker button in the panel header.

   Same pricing protection as Auggie's intro: the script is a CONSTANT,
   rendered to mp3 once via ElevenLabs and cached in Netlify Blobs.
   Marginal cost after first render: zero ElevenLabs spend.

   The script wording is Dr. O's own (2026-06-12). The platform count is
   spoken aloud, so when platform twelve ships: update the script, bump
   WELCOME_VERSION, push. The next visitor hears the new line.

   GET /.netlify/functions/public-iris-welcome-audio
   Returns: audio/mpeg
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const IRIS_VOICE_ID = '6aDn1KB0hjpdcocrUkmq'; // assigned by Dr. O 2026-06-12
const IRIS_MODEL_TTS = 'eleven_turbo_v2_5';
// Concierge register: calm and warm, steady but not flat. Moderate
// stability so she sounds present rather than scripted; style low because
// she is a concierge, not a performer.
const IRIS_SETTINGS = {
  stability: 0.50,
  similarity_boost: 0.80,
  style: 0.25,
  use_speaker_boost: true,
};

const WELCOME_VERSION = 'v5-shell-have-your-back';
const IRIS_WELCOME = `Hi, welcome to the lab. I'm Iris, the concierge.

I know how it is. You step off the elevator and there's no sign telling you whether to go left or right, or whether you're even on the right floor. Eleven platforms, a home page, an about page... nobody finds their way around here on the first visit. So tell me, right here in the chat: are you a professor? A student? An author? An entrepreneur? Just visiting? That's okay too. I'll walk you to the right door either way.

One more thing, and it's the most important thing. If money ever stops you from enjoying anything at this lab, just let Dr. O know. She'll have your back. She's like that. It's why I work here.

Have a great day.`;

async function renderAudio(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${IRIS_VOICE_ID}?output_format=mp3_44100_64`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: IRIS_MODEL_TTS,
      voice_settings: IRIS_SETTINGS,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const ETAG = '"' + WELCOME_VERSION + '"';
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, must-revalidate',
  'ETag': ETAG,
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  const inm = (event.headers && (event.headers['if-none-match'] || event.headers['If-None-Match'])) || '';
  if (inm && inm === ETAG) {
    return { statusCode: 304, headers: { ...CORS, ...CACHE_HEADERS }, body: '' };
  }

  try { connectLambda(event); } catch (_) {}
  const store = getStore('iris_public_welcome');
  const key = WELCOME_VERSION + '.mp3';

  let buf = null;
  try { buf = await store.get(key, { type: 'arrayBuffer' }); }
  catch (err) { console.warn('[public-iris-welcome] cache read failed', err && err.message); }

  if (!buf) {
    try {
      const rendered = await renderAudio(IRIS_WELCOME);
      buf = rendered.buffer.slice(rendered.byteOffset, rendered.byteOffset + rendered.byteLength);
      try {
        await store.set(key, rendered, { metadata: { contentType: 'audio/mpeg' } });
        console.log('[public-iris-welcome] rendered and cached under', key);
      } catch (err) {
        console.warn('[public-iris-welcome] cache write failed (non-fatal)', err && err.message);
      }
    } catch (err) {
      console.error('[public-iris-welcome] render failed', err && err.message);
      return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
    }
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      ...CACHE_HEADERS,
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(Buffer.byteLength(Buffer.from(buf))),
    },
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true,
  };
};
