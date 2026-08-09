/* ─────────────────────────────────────────────────────────────────────────────
   everly-castle-voice -- ElevenLabs text-to-speech for Everly Castle.

   Kronborg voices the bio only, and keeps the back-and-forth text-only,
   because voicing every reply is where the money goes. Everly Castle cannot make
   that trade: the student is four and cannot read, so EVERY line has to be
   spoken or the product does not exist. The cost has to come out somewhere
   else, and it comes out here, in two places:

   1. SCRIPTED LINES. Pass { agent, line: "hello" } and the text is resolved
      server-side from everly-castle-chat.js's SCRIPT, exactly the way kronborg-voice
      resolves BIOS, so what is configured and what is spoken cannot drift.
      Fixed text plus a fixed voice ID is a pure function, so it is generated
      once ever, stored, and served from the store forever after. A child who
      opens Posy's garden three hundred times pays ElevenLabs for the greeting
      precisely once.

   2. LIVE LINES. Pass { agent, text } for a generated reply. These are cached
      too, keyed on a hash of the exact words. That looks pointless until you
      watch a four-year-old use it: the princesses ask "what colour shall we
      make it?" and "shall we count them?" over and over, across sessions and
      across children, and every one of those is a free repeat after the first.

   Both paths share one store, and the key is a fingerprint of the words, the
   voice and the settings. There is nothing to bump: change the words and the
   key changes with them, leave them alone and that line is never bought a
   second time. A bio that never changes is paid for exactly once, ever.

   POST { agent: <key>, line?: <SCRIPT key>, text?: string } -> audio/mpeg

   Env: ELEVENLABS_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const { AGENTS, SCRIPT, TALES } = require('./everly-castle-chat.js');
const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');

const AUDIO_STORE = 'everly_castle_audio';

/* ── What the cache is keyed on, and why there is no version number ────────
   The audio for a line is a pure function of three things: the exact words,
   the voice, and the voice settings. So the key is a fingerprint of those
   three, and nothing else.

   This replaces a hand-managed CACHE_VERSION, which was wrong in both
   directions. Forget to bump it and children keep hearing words that were
   rewritten days ago, which happened. Bump it for any reason and every line
   in the castle is re-synthesised and re-billed, including ten bios that had
   not changed a character, which also happened, repeatedly, in one afternoon.

   Under this scheme a bio that never changes is paid for exactly once, ever.
   Change one princess's wording or tuning and only her affected lines are
   bought again. Nothing to remember, and nothing to over-bump. */
function audioKey(agentId, kind, text, voiceId, settings) {
  return agentId + '/' + kind + '/' + crypto.createHash('sha256')
    .update([text, voiceId, JSON.stringify(settings)].join('\u0000'))
    .digest('hex').slice(0, 32);
}

const MODEL_ID = 'eleven_multilingual_v2';
/* Warmer and more expressive than the Kronborg settings. These are storybook
   voices talking to a small child, not lecturers, so stability comes down and
   style goes up.

   CASTING: all ten are young women, seventeen or eighteen. The faculty are
   princesses only, deliberately, and the register is the cool older girl
   rather than the teacher. Do not cast a mature or maternal voice here, it
   collapses the whole conceit. The visitor's own title (Princess or Prince)
   is a separate setting and has nothing to do with which voices are used. */
/* Reported twice on 2026-08-09: "The story is too slow" and "Tone is too
   slow". Teenage girls talking to a small child do not speak at reading pace.
   Nudged up rather than thrown up, because too fast is worse than too slow for
   a four-year-old following a second language.

   If this model will not take a speed, the call below drops it and tries once
   more, so an unsupported parameter costs one retry instead of silencing every
   princess in the castle. */
const VOICE_SETTINGS = { stability: 0.40, similarity_boost: 0.80, style: 0.45, use_speaker_boost: true, speed: 1.12 };

/* Per-princess overrides, merged over the defaults. The house settings are
   deliberately loose for expressiveness and that suits most of the cast, but a
   voice whose whole character is talking too fast and tripping over herself
   rambles into noise at low stability. Tune her rather than re-cast her. */
/* Spoken numbers for the counting game, served through the scripted-line
   path so each one is generated once per princess and cached forever after.
   A child counting to five every day for a year costs five clips, total. */
/* One to ten in each princess's own language, spelled for reading aloud
   rather than for print. See the note in the counting rules about why Nepali
   and Mongolian are in Latin letters. */
const NUMBERS = {
  "French": [
    "",
    "un",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix"
  ],
  "Greek": [
    "",
    "ένα",
    "δύο",
    "τρία",
    "τέσσερα",
    "πέντε",
    "έξι",
    "εφτά",
    "οχτώ",
    "εννιά",
    "δέκα"
  ],
  "Nepali": [
    "",
    "ek",
    "dui",
    "teen",
    "char",
    "panch",
    "chha",
    "saat",
    "aath",
    "nau",
    "das"
  ],
  "Norwegian": [
    "",
    "en",
    "to",
    "tre",
    "fire",
    "fem",
    "seks",
    "sju",
    "åtte",
    "ni",
    "ti"
  ],
  "Mongolian": [
    "",
    "neg",
    "hoyor",
    "gurav",
    "duruv",
    "tav",
    "zurgaa",
    "doloo",
    "naim",
    "yus",
    "arav"
  ],
  "Maori": [
    "",
    "tahi",
    "rua",
    "toru",
    "whā",
    "rima",
    "ono",
    "whitu",
    "waru",
    "iwa",
    "tekau"
  ],
  "English": [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten"
  ],
  "German": [
    "",
    "eins",
    "zwei",
    "drei",
    "vier",
    "fünf",
    "sechs",
    "sieben",
    "acht",
    "neun",
    "zehn"
  ],
  "Swahili": [
    "",
    "moja",
    "mbili",
    "tatu",
    "nne",
    "tano",
    "sita",
    "saba",
    "nane",
    "tisa",
    "kumi"
  ],
  "Portuguese": [
    "",
    "um",
    "dois",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez"
  ]
};
const LANG_OF = {
  "posy": "French",
  "nerida": "Greek",
  "zephyra": "Nepali",
  "neva": "Norwegian",
  "lenora": "Mongolian",
  "elowyn": "Maori",
  "clementine": "English",
  "piper": "German",
  "almasi": "Swahili",
  "bex": "Portuguese"
};

const FOUND_NAMES = {
  "fox": "a fox",
  "owl": "an owl",
  "hermit": "a hermit crab",
  "swift": "a swift",
  "snowfox": "a snow fox",
  "petal": "a petal",
  "wind": "the wind",
  "kite": "a kite",
  "feather": "a feather",
  "storm": "a storm",
  "balloon": "a balloon",
  "mountainSnow": "a snowy mountain",
  "spanner": "a spanner",
  "hammer": "a hammer",
  "bolt": "a bolt",
  "spring": "a spring",
  "wheel": "a wheel",
  "engine": "an engine",
  "toolbox": "a toolbox",
  "bulb": "a light bulb",
  "nut": "a nut",
  "broken": "something broken",
  "seed": "a seed",
  "sprout": "a little sprout",
  "leafy": "a leafy plant",
  "carrot": "a carrot",
  "sunflower": "a sunflower",
  "tree": "a tree",
  "raindrop": "a raindrop",
  "snowflake": "a snowflake",
  "ice": "ice",
  "wave": "a wave",
  "cloud": "a cloud",
  "sun": "the sun",
  "moonFull": "a full moon",
  "moonHalf": "a half moon",
  "moonThin": "a thin little moon",
  "star": "a star",
  "snail": "a snail",
  "bee": "a bee",
  "butterfly": "a butterfly",
  "fish": "a fish",
  "bird": "a bird",
  "rabbit": "a rabbit",
  "apple": "an apple",
  "carrotFood": "a carrot",
  "bread": "bread",
  "milk": "milk",
  "book": "a book",
  "house": "a house",
  "mountain": "a mountain",
  "shadow": "a shadow",
  "gear": "a cog",
  "bone": "a bone",
  "rock": "a rock",
  "drum": "a drum",
  "starfish": "a starfish",
  "shell": "a shell",
  "shellOpen": "an open shell",
  "crab": "a crab",
  "jellyfish": "a jellyfish",
  "seaweed": "seaweed",
  "tidepool": "a rock pool",
  "sea": "the sea",
  "pearl": "a pearl"
};

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five',
                      'six', 'seven', 'eight', 'nine', 'ten'];

function settingsFor(agent) {
  return Object.assign({}, VOICE_SETTINGS, agent.voiceSettings || {});
}

// A generated princess line is short by design (MAX_TOKENS in everly-castle-chat is
// 300). Anything materially longer than a few sentences means something has
// gone wrong upstream, and synthesising it would be paying for the bug.
const MAX_TEXT_CHARS = 600;   // live replies only; tales are fixed text and bypass this

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return jsonError(405, 'method not allowed');

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return jsonError(500, 'ELEVENLABS_API_KEY not configured');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonError(400, 'invalid json'); }

  const agentId = String(body.agent || '').trim().toLowerCase();
  const agent = AGENTS[agentId];
  if (!agent) return jsonError(400, `Unknown wing "${agentId}"`);

  const voiceId = agent.voiceId;
  if (!voiceId) return jsonError(409, `No voice configured yet for "${agentId}"`);

  /* Resolve the words. A scripted line is looked up here, server-side, and is
     never taken from the client -- one authoritative copy of the greeting, so
     the page cannot ask for audio of words that are not in SCRIPT. */
  const settings = settingsFor(agent);

  let text, cacheKey;
  const lineKey = String(body.line || '').trim();

  /* num-3 is "trois" in Posy's wing and "tatu" in Almasi's. Counting in the
     language is the promise the castle already makes out loud. */
  /* found-crab -> "a crab", in this princess's voice. One clip per thing per
     princess, bought once and then free forever, which is what makes a game
     she can play forty times affordable. */
  if (/^found-[A-Za-z]+$/.test(lineKey)) {
    text = FOUND_NAMES[lineKey.slice(6)] || '';
  }
  if (/^num-([1-9]|10)$/.test(lineKey)) {
    const set = NUMBERS[LANG_OF[agentId]] || NUMBERS.English;
    text = set[Number(lineKey.split('-')[1])] || '';
  }
  if (/^count-([0-9]|10)$/.test(lineKey)) {
    // count-3 -> "three", in this princess's voice.
    text = NUMBER_WORDS[Number(lineKey.split('-')[1])];
    cacheKey = audioKey(agentId, 'count', text, voiceId, settings);
  } else if (lineKey === 'tale') {
    /* The minute-long country story. Fixed text, so it is synthesised once per
       princess and served from the cache forever after: this is the free
       tier's whole cost model. */
    text = TALES[agentId];
    if (!text) return jsonError(404, 'No tale for "' + agentId + '"');
    cacheKey = audioKey(agentId, 'tale', text, voiceId, settings);
  } else if (lineKey) {
    const bank = SCRIPT[agentId];
    if (!bank || !bank[lineKey]) return jsonError(404, `No scripted line "${lineKey}" for "${agentId}"`);
    text = bank[lineKey];
    cacheKey = audioKey(agentId, 'script-' + lineKey, text, voiceId, settings);
  } else {
    text = String(body.text || '').trim();
    if (!text) return jsonError(400, 'nothing to say');
    if (text.length > MAX_TEXT_CHARS) return jsonError(400, 'text too long');
    cacheKey = audioKey(agentId, 'live', text, voiceId, settings);
  }

  /* If the store is unavailable this endpoint still works, but every single
     play is a fresh ElevenLabs charge. That used to fail silently, which is
     the worst way for a billing problem to behave: nothing breaks, it just
     costs money forever. It is loud now, and the response says so in a header
     so it can be checked from the browser without reading logs. */
  let store = null;
  let storeError = null;
  try {
    store = getStore(AUDIO_STORE);
  } catch (err) {
    storeError = (err && err.message) || 'unavailable';
    console.error('[everly-voice] BLOBS UNAVAILABLE, every play will be billed:', storeError);
  }

  if (store) {
    try {
      const hit = await store.get(cacheKey, { type: 'arrayBuffer' });
      if (hit && hit.byteLength) return audioResponse(Buffer.from(hit), true, 'ok');
    } catch (err) {
      console.error('[everly-castle-voice] cache read failed (non-fatal):', err && err.message);
    }
  }

  /* Leading pause, without feeding the model a word.

     This used to prepend a full stop: '. ' + text. On the multilingual model
     that is not read as punctuation, it is read as something to say, and every
     clip opened with a syllable of nonsense that sounded like a foreign
     language. Whitespace gives the encoder the same run-up without giving the
     voice anything to pronounce.

     The run-up is still needed: without it ElevenLabs starts mid-phoneme and
     the browser clips the first word, and a four-year-old who misses the first
     word of a question does not ask again, she just stops. */
  const spoken = '  ' + text;

  let resp;
  try {
    resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text: spoken, model_id: MODEL_ID, voice_settings: settings }),
    });

    /* Older voice models reject an unknown setting outright. Losing every
       spoken line in the castle over a pacing tweak is not a trade worth
       making, so on a rejection we drop the speed and go again. */
    if (!resp.ok && resp.status >= 400 && resp.status < 500 && settings && settings.speed) {
      const { speed, ...noSpeed } = settings;
      console.warn('[everly-castle-voice] speed rejected, retrying without it');
      resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, 'Accept': 'audio/mpeg' },
        body: JSON.stringify({ text: spoken, model_id: MODEL_ID, voice_settings: noSpeed }),
      });
    }
  } catch (err) {
    console.error('[everly-castle-voice] fetch failure', err);
    return jsonError(502, 'tts network failure');
  }

  if (!resp.ok) {
    const detail = await safeRead(resp);
    console.error('[everly-castle-voice] tts non-200', resp.status, detail);
    return jsonError(502, `tts upstream ${resp.status}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());

  if (store) {
    try {
      await store.set(cacheKey, buf, { metadata: { contentType: 'audio/mpeg', agent: agentId, kind: lineKey ? 'script' : 'live' } });
    } catch (err) {
      console.error('[everly-castle-voice] cache write failed (non-fatal):', err && err.message);
    }
  }

  return audioResponse(buf, false, storeError ? 'DOWN: ' + storeError : 'ok');
};

function audioResponse(buf, cached, storeState) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buf.length),
      // Keyed on the words themselves, so a given URL's audio can never change
      // without the key changing. The browser can hold it and skip the trip.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Everly-Castle-Cache': cached ? 'hit' : 'miss',
      'X-Everly-Castle-Store': storeState || 'ok',
      'Access-Control-Allow-Origin': '*',
    },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
}
function jsonError(statusCode, message) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}
async function safeRead(resp) { try { return await resp.text(); } catch { return ''; } }
