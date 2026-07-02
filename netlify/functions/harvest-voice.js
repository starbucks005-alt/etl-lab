// harvest-voice.js — text-to-speech proxy for The Harvest Circuit chat.
//
// POST { partner, text } -> audio/mpeg. Each Harvest Circuit character can
// carry a voice here; a partner with no entry in VOICES returns 404 so the
// front end just hides the listen button rather than erroring.
//
// Required env var: ELEVENLABS_API_KEY (already set for the campus).

const VOICES = {
  ruben: {
    id: 'aOZ9Pl8uWUTet0DS7PYP',
    settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  },
  vic: {
    id: 'g1FVKFidZjHPxXdfA89c',
    settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  },
  camille: {
    id: 'xNtG3W2oqJs0cJZuTyBc',
    settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  },
  luca: {
    id: 'wIXSd2QOwnI0ZGOZbVj2',
    settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  },
};
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

  const voice = VOICES[String(body.partner || '').trim().toLowerCase()];
  if (!voice) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'no_voice_for_partner' }) };

  const text = String(body.text || '').trim();
  if (!text) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text_required' }) };
  if (text.length > 2000) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text_too_long' }) };

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: voice.settings }),
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
