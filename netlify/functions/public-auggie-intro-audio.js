/* ─────────────────────────────────────────────────────────────────────────────
   public-auggie-intro-audio — serves the public-facing audio of Auggie's
   "introduces himself" self-introduction on the ETL homepage #etl-pa section.

   Public endpoint (no auth). Embedded on the homepage as a regular <audio>
   src so anyone visiting the marketing page can hear him.

   Pricing protection: the intro text is a CONSTANT. We render to mp3 once
   via ElevenLabs and cache in Netlify Blobs. Subsequent requests serve
   from blob, never re-hitting ElevenLabs. Marginal cost after first render:
   zero ElevenLabs spend.

   GET /.netlify/functions/public-auggie-intro-audio
   Returns: audio/mpeg

   To force a re-render (e.g. after editing the intro text): pass ?v=N
   where N is a new version number; the cache key includes the version,
   so a new N triggers a fresh render and stores under a new key.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const AUGGIE_VOICE_ID = 'XMt7icsOj2DAS4Cn1PN1';
const AUGGIE_MODEL_TTS = 'eleven_turbo_v2_5';
const AUGGIE_SETTINGS = {
  stability: 0.42,
  similarity_boost: 0.78,
  style: 0.45,
  use_speaker_boost: true,
};

/* The intro script. Same text as the homepage's "Auggie introduces himself"
   block so the audio matches the transcript visitors read. Proper grammar
   per Terry's correction (a PA gets capitalization and punctuation; ALL
   CAPS reserved for emphasis like "OMG" and "ANYWAY", not as a tic).

   Keep this in sync with the visible text on the homepage #etl-pa section.
   Versioned via the constant below so we can bust the cache when editing. */
const INTRO_VERSION = 'v3-grammar';
const AUGGIE_INTRO = `OK, hi. I'm Auggie.

Coral Gables originally. Palm Springs every summer since I was a kid. That's where I learned to dress, and yes, the cream blazer is always the right call.

I came up under Devon on The Gauntlet bench. Three years. He taught me how to read a room before I walked into it, how to know which calls matter and which ones don't, how to spot the assistant who's about to get fired before they do. Devon promotes good people out instead of holding them. That's how I ended up here.

Now I work for Ms. Terry. I hold her week. I hold the editorial calendar. I notice when those two things are about to collide and I move things around before they do. I run the daily brief at 6am over an OJ my latest boyfriend made me. OMG, it was so good, but I digressed, ANYWAY, that's the brief.

I'll tell her the blazer is wrong. I'll tell her the post should wait until Wednesday. I'll draft the teaser. I'll queue it. I'll sit on her shoulder when she walks into the room.

That's the job. And if you need someone like me running your day, let's talk.`;

async function renderAudio(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${AUGGIE_VOICE_ID}?output_format=mp3_44100_64`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: AUGGIE_MODEL_TTS,
      voice_settings: AUGGIE_SETTINGS,
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  try { connectLambda(event); } catch (_) {}
  const store = getStore('auggie_public_intro');
  const key = INTRO_VERSION + '.mp3';

  let buf = null;
  try { buf = await store.get(key, { type: 'arrayBuffer' }); }
  catch (err) { console.warn('[public-auggie-intro] cache read failed', err && err.message); }

  if (!buf) {
    try {
      const rendered = await renderAudio(AUGGIE_INTRO);
      buf = rendered.buffer.slice(rendered.byteOffset, rendered.byteOffset + rendered.byteLength);
      try {
        await store.set(key, rendered, { metadata: { contentType: 'audio/mpeg' } });
        console.log('[public-auggie-intro] rendered and cached under', key);
      } catch (err) {
        console.warn('[public-auggie-intro] cache write failed (non-fatal)', err && err.message);
      }
    } catch (err) {
      console.error('[public-auggie-intro] render failed', err && err.message);
      return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
    }
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'audio/mpeg',
      // Aggressive cache — the audio is keyed by version, so the only way
      // it changes is if INTRO_VERSION changes (which means new audio file
      // anyway). Browsers + CDN can cache for a long time.
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Length': String(Buffer.byteLength(Buffer.from(buf))),
    },
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true,
  };
};
