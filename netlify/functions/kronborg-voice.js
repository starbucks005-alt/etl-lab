/* ─────────────────────────────────────────────────────────────────────────────
   kronborg-voice — ElevenLabs text-to-speech for the History: Denmark 1500-1600s
   classroom.

   Voice only plays for each character's BIO, not every chat reply -- Dr. O's
   call for this classroom, cheaper and keeps the ongoing back-and-forth
   text-only. The bio text itself is resolved here, server-side, from
   kronborg-chat.js's BIOS (real English / Old Danish text from Dr. O's
   source document), not trusted from the client -- one authoritative copy,
   no drift between what's shown and what's spoken. accent:"english" plays
   the English bio; anything else (default) plays the real Old Danish text,
   through ElevenLabs' multilingual voice model, actually pronounced as
   Danish, not a phonetic accent trick layered on English.

   hans_bodil is the one exception: BIOS.hans_bodil[lang] is an array of
   alternating {speaker, text} segments (its bio split by sentence) so the
   two real child voices trade lines -- pass segment: <index> to pick one.
   It also has no single agent.voiceId; it carries a `voices: {hans, bodil}`
   map instead, and speaker:"hans"|"bodil" picks the right child's voice.

   POST { agent: <key>, accent?: "danish"|"english", speaker?: "hans"|"bodil", segment?: number }
     -> audio/mpeg

   Env: ELEVENLABS_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const { AGENTS, BIOS } = require('./kronborg-chat.js');

const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.85, style: 0.2, use_speaker_boost: true };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
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

  const accent = String(body.accent || 'danish').trim().toLowerCase();
  const lang = accent === 'english' ? 'en' : 'da';
  const bioEntry = bio[lang];
  if (!bioEntry) return jsonError(404, `No ${lang} bio configured for "${agentId}"`);

  let text, speaker;
  if (Array.isArray(bioEntry)) {
    const seg = bioEntry[Number(body.segment) || 0];
    if (!seg) return jsonError(400, 'invalid segment');
    text = seg.text;
    speaker = seg.speaker;
  } else {
    text = bioEntry;
    speaker = String(body.speaker || '').trim().toLowerCase();
  }

  const voiceId = (agent.voices && agent.voices[speaker]) || agent.voiceId;
  if (!voiceId) return jsonError(409, `No voice configured yet for "${agentId}"`);

  // Leading pause buffer -- without it ElevenLabs starts mid-phoneme and the
  // browser clips the first word (same fix proven on gk-clara-voice.js).
  text = '. ' + text;

  let resp;
  try {
    resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
    });
  } catch (err) {
    console.error('[kronborg-voice] fetch failure', err);
    return jsonError(502, 'tts network failure');
  }

  if (!resp.ok) {
    const detail = await safeRead(resp);
    console.error('[kronborg-voice] tts non-200', resp.status, detail);
    return jsonError(502, `tts upstream ${resp.status}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};

function jsonError(statusCode, message) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}
async function safeRead(resp) { try { return await resp.text(); } catch { return ''; } }
