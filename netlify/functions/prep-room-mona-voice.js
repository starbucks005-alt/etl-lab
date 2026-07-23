// prep-room-mona-voice.js — text-to-speech proxy for Mona Bahrami, MD (Prep Room).
//
// POST { text } -> audio/mpeg. Same pattern as harvest-voice.js.
//
// Required env var: ELEVENLABS_API_KEY (already set for the campus).

const VOICE_ID = 'wvk9Caj0nEx4l3I9LaR6';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };
const MODEL_ID = 'eleven_turbo_v2_5';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method_not_allowed' }) };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'no_elevenlabs_key' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_json' }) }; }

  const text = String(body.text || '').trim();
  if (!text) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text_required' }) };
  if (text.length > 2000) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text_too_long' }) };

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'elevenlabs_failed', detail: detail.slice(0, 300) }) };
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
