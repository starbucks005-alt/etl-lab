/* city-agent-voice - public, no auth, no billing (this page has no credit system at all).
   POST { text, voice_id } -> audio/mpeg, base64. Uses ELEVENLABS_API_KEY.
   Same call shape as voice-preview.js's synthExisting path, turbo model for cost
   (this is a resident asking a question, not a produced narration), sentence-boundary
   trim so a long answer never gets read into a cut-off word mid-sentence. */

const MODEL = 'eleven_turbo_v2_5';
const MAX_CHARS = 1200;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: 'no_voice_key' }) };

  const voiceId = String(body.voice_id || '').trim();
  if (!/^[A-Za-z0-9]{12,40}$/.test(voiceId)) return { statusCode: 400, body: JSON.stringify({ error: 'no_voice_id' }) };

  let text = String(body.text || '').trim();
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'nothing_to_say' }) };
  if (text.length > MAX_CHARS) {
    const cut = text.slice(0, MAX_CHARS);
    const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = lastSentence > MAX_CHARS * 0.6 ? cut.slice(0, lastSentence + 1) : cut;
  }

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId), {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { statusCode: r.status === 401 ? 401 : 502, body: JSON.stringify({ error: 'voice_failed', status: r.status, detail: detail.slice(0, 300) }) };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return { statusCode: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }, body: buf.toString('base64'), isBase64Encoded: true };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'voice_unreachable', detail: String(err && err.message || err).slice(0, 200) }) };
  }
};
