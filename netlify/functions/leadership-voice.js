/* ─────────────────────────────────────────────────────────────────────────────
   leadership-voice — ElevenLabs text-to-speech for the ETL Leadership
   Classroom (PTX 7006), sibling to kronborg-voice.js.

   Two modes, one endpoint:

     { agent }          the agent's BIO. The bio text is resolved here,
                        server-side, from leadership-chat.js's BIOS (one
                        authoritative copy), never trusted from the client, so
                        the words on screen and the words spoken cannot drift.
                        Fixed text, so it is cached in Blobs and generated once.

     { agent, text }    what this leader just said in the chat, spoken aloud.
                        Added 2026-09-10 for the live classroom: the class hears
                        the leaders instead of the room reading replies off a
                        screen. Same shape ptx4990-voice.js (the biology
                        classroom) has used since it was built. A reply is
                        different every time, so it is not cached.

   Either way the voiceId comes from AGENTS here, never from the client, so no
   caller can put a leader's words in another leader's voice.

   Simpler than kronborg-voice.js: English only, one voice per agent (no
   segments, no accent, no speaker split), so there is no per-agent
   pitch-shifting either.

   POST { agent: <key>, text?: string } -> audio/mpeg

   Env: ELEVENLABS_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const { AGENTS, BIOS } = require('./leadership-chat.js');
const { getStore, connectLambda } = require('@netlify/blobs');

const AUDIO_STORE = 'leadership_bio_audio';
// Bump this whenever a bio's TEXT or an agent's voiceId changes, or the store
// will keep serving a recording of the words that used to be there.
const CACHE_VERSION = 'v1';

const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.85, style: 0.2, use_speaker_boost: true };
// A chat reply is capped by leadership-chat.js's MAX_TOKENS long before this,
// so this is a backstop against a caller sending a wall of text to synthesise.
const TEXT_CAP = 1500;

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

  const voiceId = agent.voiceId;
  if (!voiceId) return jsonError(409, `No voice configured yet for "${agentId}"`);

  const said = String(body.text || '').trim();
  const isReply = said.length > 0;

  const text0 = isReply ? said.slice(0, TEXT_CAP) : BIOS[agentId];
  if (!text0) return jsonError(404, `No bio configured for "${agentId}"`);

  // Leading pause buffer -- without it ElevenLabs starts mid-phoneme and the
  // browser clips the first word (same fix proven on kronborg-voice.js).
  const text = '. ' + text0;

  /* ── Cache ────────────────────────────────────────────────────────────────
     A bio is fixed text and a voice ID is fixed, so the audio is a pure
     function of the two and can only ever come out identical. First play
     generates and stores; every play after that is served from the store and
     never reaches ElevenLabs -- see kronborg-voice.js for the fuller
     rationale (this endpoint follows it from day one instead of learning it
     the hard way). */
  const cacheKey = [CACHE_VERSION, agentId, voiceId].join('|');
  let store = null;
  // Only a bio is cacheable: a chat reply is new words every time, so there is
  // nothing to hit and storing it would just fill the store with one-offs.
  if (!isReply) {
    try { store = getStore(AUDIO_STORE); } catch (_) { /* Blobs unavailable: fall through and synthesise */ }
  }

  if (store) {
    try {
      const hit = await store.get(cacheKey, { type: 'arrayBuffer' });
      if (hit && hit.byteLength) return audioResponse(Buffer.from(hit), false);
    } catch (err) {
      console.error('[leadership-voice] cache read failed (non-fatal):', err && err.message);
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
    console.error('[leadership-voice] fetch failure', err);
    return jsonError(502, 'tts network failure');
  }

  if (!resp.ok) {
    const detail = await safeRead(resp);
    console.error('[leadership-voice] tts non-200', resp.status, detail);
    return jsonError(502, `tts upstream ${resp.status}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());

  // Store for next time. A failure here costs nothing but a repeat charge, so
  // it never blocks handing this listener their audio.
  if (store) {
    try {
      await store.set(cacheKey, buf, { metadata: { contentType: 'audio/mpeg', agent: agentId } });
    } catch (err) {
      console.error('[leadership-voice] cache write failed (non-fatal):', err && err.message);
    }
  }

  return audioResponse(buf, isReply);
};

function audioResponse(buf, isReply) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buf.length),
      // A given agent's bio never changes without a CACHE_VERSION bump, so the
      // browser can hold it too and skip the round trip entirely. A reply is
      // said once and never repeated, so there is nothing worth holding.
      'Cache-Control': isReply ? 'no-store' : 'public, max-age=31536000, immutable',
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
