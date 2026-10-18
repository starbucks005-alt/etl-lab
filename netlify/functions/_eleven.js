/* _eleven: speak text with an ElevenLabs voice, 2026-10-18, Dr. O: one fairy, her voice from ElevenLabs, "build up as interest happens".

   The same call gc-voice.js makes, with the same model and a steady setting. ELEVENLABS_API_KEY is the key the site already has, so nothing new is set.
   Returns a Buffer of mp3 audio, or throws (no key, a refusal), and the caller leaves the audio out and keeps the words.
   NOT TRIED against the real service from here; the request follows gc-voice.js. */
const MODEL = 'eleven_turbo_v2_5';
const ID_RE = /^[A-Za-z0-9]{12,30}$/;

function isElevenId(v) { return ID_RE.test(String(v || '').trim()); }

async function elevenSpeak(text, voiceId, { fetchFn = fetch, env = process.env } = {}) {
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  if (!key) throw new Error('no_eleven_key');
  if (!isElevenId(voiceId)) throw new Error('bad_voice_id');
  const r = await fetchFn('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(String(voiceId).trim()), {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: String(text).slice(0, 1500), model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error('eleven_' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { elevenSpeak, isElevenId };
