/* roz-voice — ElevenLabs TTS for Judge Roz. Fixed text only, never AI-generated. */

const VOICE_ID = 'QzjVPpsaJNjOgbRQOGgQ';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let text;
  try { ({ text } = JSON.parse(event.body || '{}')); } catch { return { statusCode: 400, body: 'Bad request' }; }
  if (!text || text.trim().length < 2) return { statusCode: 400, body: 'No text' };

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text.slice(0, 1000),
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.65, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false, speed: 0.92 }
    })
  });

  if (!res.ok) {
    console.error('ElevenLabs error:', await res.text());
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Voice error' };
  }

  const buf = await res.arrayBuffer();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true,
  };
};
