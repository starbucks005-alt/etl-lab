/* ─────────────────────────────────────────────────────────────────────────────
   carol-channel-audio — the channel keeper's spoken daily floor note.

   Reads today's keeper_digest from the carol_channel blob (written by
   carol-channel.js) and renders it ONCE in the keeper's ElevenLabs voice,
   cached per dateKey. This week's keeper is Auggie (Iris is visiting her
   sister Tessa at college). When the keeper rotates, change KEEPER_VOICE
   here and KEEPER in carol-channel.js together.

   GET /.netlify/functions/carol-channel-audio
   Returns: audio/mpeg (today's floor note)
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

// Voice per keeper. The day's channel blob says who keeps the channel;
// the floor note renders in THAT voice. Only voice-wired agents may
// keep the channel (enforced by the pools in carol-channel.js).
const KEEPER_VOICES = {
  'Auggie':    { id: 'XMt7icsOj2DAS4Cn1PN1', model: 'eleven_turbo_v2_5', settings: { stability: 0.30, similarity_boost: 0.85, style: 0.85, use_speaker_boost: true } },
  'Jen Lopez': { id: 'Nq8lEMZJxW4MjEjQcBIo', model: 'eleven_turbo_v2_5', settings: { stability: 0.45, similarity_boost: 0.80, style: 0.40, use_speaker_boost: true } },
  'Iris':      { id: '6aDn1KB0hjpdcocrUkmq', model: 'eleven_turbo_v2_5', settings: { stability: 0.50, similarity_boost: 0.80, style: 0.25, use_speaker_boost: true } },
};

function etDateKey() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const y = et.getFullYear(), m = String(et.getMonth() + 1).padStart(2, '0'), d = String(et.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  try { connectLambda(event); } catch (_) {}
  const store = getStore('carol_channel');
  const dateKey = etDateKey();
  const audioKey = 'audio:' + dateKey;

  let buf = null;
  try { buf = await store.get(audioKey, { type: 'arrayBuffer' }); } catch (_) {}

  if (!buf) {
    let channel = null;
    try { channel = await store.get(dateKey, { type: 'json' }); } catch (_) {}
    const digest = channel && channel.keeper_digest;
    if (!digest) {
      return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'no floor note yet today - open the channel first' }) };
    }
    const voice = KEEPER_VOICES[channel.keeper] || KEEPER_VOICES['Auggie'];
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }) };
    const url = 'https://api.elevenlabs.io/v1/text-to-speech/' + voice.id + '?output_format=mp3_44100_64';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text: digest, model_id: voice.model, voice_settings: voice.settings }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ElevenLabs ' + res.status + ': ' + t.slice(0, 150) }) };
    }
    const rendered = Buffer.from(await res.arrayBuffer());
    buf = rendered.buffer.slice(rendered.byteOffset, rendered.byteOffset + rendered.byteLength);
    try { await store.set(audioKey, rendered, { metadata: { contentType: 'audio/mpeg' } }); } catch (err) { console.warn('[carol-channel-audio] cache write failed', err && err.message); }
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=300' },
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true,
  };
};
