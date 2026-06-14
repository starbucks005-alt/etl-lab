/* ─────────────────────────────────────────────────────────────────────────────
   iris-greeting — Iris S. King's Command Center orientation briefing.
   Fixed script, generated once and cached in Netlify Blobs indefinitely.
   GET /.netlify/functions/iris-greeting → audio/mpeg
───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const IRIS_VOICE = {
  id: '6aDn1KB0hjpdcocrUkmq',
  model: 'eleven_turbo_v2_5',
  settings: { stability: 0.50, similarity_boost: 0.80, style: 0.25, use_speaker_boost: true }
};

const GREETING = "Welcome to the Lab. Take a moment to orient yourself. To your left, you will see our Live Campus Map, the pulse of our neighborhood, where our autonomous agents are navigating their assignments right now. To your right, the Agency Floor, where the Chief of Staff and the Lead Agent are coordinating real-time operations. You are looking at Operational Behavioral Science in motion. I am Iris. Let me know how I can assist with your briefing.";

const BLOB_KEY = 'iris-greeting-v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  try { connectLambda(event); } catch (_) {}
  const store = getStore('iris_greeting');

  let buf = null;
  try { buf = await store.get(BLOB_KEY, { type: 'arrayBuffer' }); } catch (_) {}

  if (!buf) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }) };

    const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + IRIS_VOICE.id + '?output_format=mp3_44100_64', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text: GREETING, model_id: IRIS_VOICE.model, voice_settings: IRIS_VOICE.settings }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'ElevenLabs ' + res.status + ': ' + t.slice(0, 150) }) };
    }

    const rendered = Buffer.from(await res.arrayBuffer());
    buf = rendered.buffer.slice(rendered.byteOffset, rendered.byteOffset + rendered.byteLength);
    try { await store.set(BLOB_KEY, rendered, { metadata: { contentType: 'audio/mpeg' } }); } catch (err) {
      console.warn('[iris-greeting] cache write failed', err && err.message);
    }
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' },
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true,
  };
};
