/* ─────────────────────────────────────────────────────────────────────────────
   sherlock-voice — ElevenLabs text-to-speech for the "Solve It With Sherlock"
   classroom.

   Voice plays for each character's BIO, not for every chat reply. Same call
   Dr. O made for the Kronborg classroom: cheaper, and it keeps the ongoing
   back and forth text only. The bio text is resolved here, server side, from
   sherlock-chat.js's BIOS, not trusted from the client, so there is one
   authoritative copy and no drift between what is shown and what is spoken.

   Voice IDs are not set yet. AGENTS[key].voiceId is null across the cast
   until Dr. O sources them, and this endpoint returns a clean 409 with the
   agent key until then rather than failing obscurely.

   POST { agent: <key> } -> audio/mpeg

   Env: ELEVENLABS_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const { AGENTS, BIOS } = require('./sherlock-chat.js');
const { getStore, connectLambda } = require('@netlify/blobs');

const AUDIO_STORE = 'sherlock_bio_audio';
// Bump whenever a bio's TEXT or an agent's voiceId changes, or the store will
// keep serving a recording of the words that used to be there.
const CACHE_VERSION = 'v1';

const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.85, style: 0.2, use_speaker_boost: true };

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
  if (!agent) return jsonError(400, `Unknown agent "${agentId}"`);

  const bio = BIOS[agentId];
  if (!bio) return jsonError(404, `No bio configured for "${agentId}"`);

  const voiceId = agent.voiceId;
  if (!voiceId) return jsonError(409, `No voice configured yet for "${agentId}"`);

  // Leading pause buffer. Without it ElevenLabs starts mid-phoneme and the
  // browser clips the first word (same fix proven on gk-clara-voice.js).
  const text = '. ' + bio;

  /* ── Cache ────────────────────────────────────────────────────────────────
     A bio is fixed text and a voice ID is fixed, so the audio can only ever
     come out identical. Synthesising it again on every play buys the same
     bytes twice. First play generates and stores; every play after is served
     from the store and never reaches ElevenLabs.

     Resolving the bio text server-side is still right, so what is shown and
     what is spoken cannot drift. That was never the same thing as
     re-synthesising it, and conflating the two is what quietly billed the
     Kronborg classroom on every play from launch. */
  const cacheKey = [CACHE_VERSION, agentId, voiceId].join('|');
  let store = null;
  try { store = getStore(AUDIO_STORE); } catch (_) { /* Blobs unavailable: synthesise anyway */ }

  if (store) {
    try {
      const hit = await store.get(cacheKey, { type: 'arrayBuffer' });
      if (hit && hit.byteLength) return audioResponse(Buffer.from(hit));
    } catch (err) {
      console.error('[sherlock-voice] cache read failed (non-fatal):', err && err.message);
    }
  }

  let resp;
  try {
    resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
    });
  } catch (err) {
    console.error('[sherlock-voice] fetch failure', err);
    return jsonError(502, 'tts network failure');
  }

  if (!resp.ok) {
    const detail = await safeRead(resp);
    console.error('[sherlock-voice] tts non-200', resp.status, detail);
    return jsonError(502, `tts upstream ${resp.status}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());

  // A failed write costs one repeat charge, never this listener's audio.
  if (store) {
    try {
      await store.set(cacheKey, buf, { metadata: { contentType: 'audio/mpeg', agent: agentId } });
    } catch (err) {
      console.error('[sherlock-voice] cache write failed (non-fatal):', err && err.message);
    }
  }

  return audioResponse(buf);
};

function audioResponse(buf) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buf.length),
      // Never changes without a CACHE_VERSION bump, so the browser can hold it
      // too and skip the round trip entirely.
      'Cache-Control': 'public, max-age=31536000, immutable',
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
