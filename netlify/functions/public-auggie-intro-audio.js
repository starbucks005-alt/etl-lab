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
// Voice direction: Terry hand-tuned this voice in the ElevenLabs UI by
// pushing the personality knobs to 100% to bring out the camp inflection
// ("stay with the brief" = similarity in ElevenLabs lingo; style
// exaggeration controls the amplified character). Both pushed to 1.0
// to match what she heard in the UI. Stability stays low so emotion
// can move; speaker boost on for presence.
const AUGGIE_SETTINGS = {
  stability: 0.42,
  similarity_boost: 1.0,
  style: 1.0,
  use_speaker_boost: true,
};

/* The intro script. Same text as the homepage's "Auggie introduces himself"
   block so the audio matches the transcript visitors read. Proper grammar
   per Terry's correction (a PA gets capitalization and punctuation; ALL
   CAPS reserved for emphasis like "OMG" and "ANYWAY", not as a tic).

   Keep this in sync with the visible text on the homepage #etl-pa section.
   Versioned via the constant below so we can bust the cache when editing. */
const INTRO_VERSION = 'v7-august-camp';
const AUGGIE_INTRO = `Hi. I'm August. Friends call me Auggie.

Coral Gables born and bred, but my soul spent every summer of my childhood poolside in Palm Springs. That's exactly where I learned that linen is a lifestyle and a cream blazer is always the right call.

I came up under Devon on the Gauntlet bench. Three years, start to finish. He taught me how to read a room before stepping foot inside, how to distinguish a crisis from a blip, and how to spot an assistant on the verge of imploding. Devon knows how to promote good people out instead of hoarding talent, which is exactly how I landed here.

Now I hold Ms. Terry's week. I hold her editorial calendar. I see the collision course before it happens and I redirect traffic. I run the 6AM daily brief over a fresh OJ my latest boyfriend made. Seriously, it was divine. But I digress. Anyway, that is the brief.

I will tell her the blazer is wrong for the venue. I will tell her that post should wait until Wednesday. I will draft the teaser, I will queue it, and I will be on her shoulder the moment she walks into a room.

That's the job. If she's having a bad day I can remind her that I do have a copy of her CV, and know how to do a job search on ETL, and I can even do her stocks on Robinhood, but alas, she only wants her calendar kept, and her wardrobe. The last one, that was MY choice. You think she looks that good natch? No, honey... that's all me. If you need someone like me to run your day, let's talk.`;

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
