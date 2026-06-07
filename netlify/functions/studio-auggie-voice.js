/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-voice

   ElevenLabs TTS endpoint for Auggie. Takes text, returns mp3 audio in his
   voice (XMt7icsOj2DAS4Cn1PN1 — generated via Voice Design, third pass after
   "professional underneath" and "slightly camp" produced the wrong register).

   POST body: { text }
   Returns: audio/mpeg (mp3 bytes, base64-encoded so Netlify can ship it as
            a regular JSON-friendly response; the browser decodes and plays).

   Auth: requires valid Supabase JWT in Authorization header. Same gate as
   every other Studio function. Anonymous requests are refused before any
   ElevenLabs credits get spent.

   Env: ELEVENLABS_API_KEY must be set in Netlify site settings (already in
   use by the newswire briefing functions).
   ───────────────────────────────────────────────────────────────────────────── */

/* ── JWT validation against Supabase ────────────────────────────────────── */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

/* Auggie's ElevenLabs voice. Locked in after three Voice Design rounds.
   Settings tuned for an expressive, conversational chat-back voice; lower
   stability than the briefing reporters because Auggie is animated, not
   anchorly. style up at 0.45 lets his character come through. */
const AUGGIE_VOICE_ID = 'XMt7icsOj2DAS4Cn1PN1';
const AUGGIE_MODEL = 'eleven_turbo_v2_5';
const AUGGIE_SETTINGS = {
  stability: 0.42,
  similarity_boost: 0.78,
  style: 0.45,
  use_speaker_boost: true,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  // Auth gate
  const auth = await validateRequest(event);
  if (!auth.ok) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

  const text = (body.text || '').trim();
  if (!text) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text is required' }) };
  }
  // Cap text length to keep both ElevenLabs costs and Netlify response size
  // sane. ~4000 chars = roughly a 3-4 minute clip in this voice.
  if (text.length > 4000) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text too long (max 4000 chars)' }) };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };
  }

  try {
    // 64kbps mp3 keeps Netlify response size well under the 6 MB cap even
    // for the maximum 4000-char input. Same encoding the briefing reporters
    // use for parity.
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
        model_id: AUGGIE_MODEL,
        voice_settings: AUGGIE_SETTINGS,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '<no body>');
      console.error('[auggie-voice] ElevenLabs', res.status, errText.slice(0, 200));
      return {
        statusCode: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `ElevenLabs ${res.status}: ${errText.slice(0, 200)}` }),
      };
    }

    const arrayBuf = await res.arrayBuffer();
    const audioB64 = Buffer.from(arrayBuf).toString('base64');

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: audioB64,
        mimeType: 'audio/mpeg',
        voiceId: AUGGIE_VOICE_ID,
        charCount: text.length,
      }),
    };
  } catch (err) {
    console.error('[auggie-voice] failed', err && err.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err && err.message) || 'voice render failed' }),
    };
  }
};
