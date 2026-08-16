/* gc-voice — the friend speaks.

   POST { text, voice_id } -> { audio } (base64 mpeg)

   ELEVENLABS_API_KEY comes from the campus environment, same as M.E.'s
   me-voice.js, which is the pattern this follows.

   THE VOICE ID COMES FROM THE FRIEND, not from a lookup table here. Every
   friend this product makes has their own, kept with the rest of who they are
   in gc-friend.js. A voice is part of a person, not a setting.

   COST. Speech is billed per character, so this is the one part of a
   conversation that gets more expensive the more somebody talks, and the
   audience for this product talks a lot. Hence:
     * off by default. Text is free, audio is opted into.
     * a hard character cap per turn, enforced here rather than trusted to the
       caller.
     * nothing is spoken twice: the browser keeps what it already fetched.
*/

const MAX_CHARS = 900;   // a long turn, not a monologue
const MODEL = 'eleven_multilingual_v2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (code, body) => ({
  statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json(500, { error: 'no_voice_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const text = String(body.text || '').trim().slice(0, MAX_CHARS);
  const voiceId = String(body.voice_id || '').trim();
  if (!text) return json(400, { error: 'nothing_to_say' });
  if (!/^[A-Za-z0-9]{12,40}$/.test(voiceId)) return json(400, { error: 'no_voice_id' });

  let r;
  try {
    r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId), {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        /* Steady rather than theatrical. He is talking to somebody across a
           room, not performing. */
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    });
  } catch (err) {
    return json(502, { error: 'voice_unreachable', detail: String(err && err.message || err).slice(0, 200) });
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return json(r.status === 401 ? 401 : 502, { error: 'voice_failed', status: r.status, detail: detail.slice(0, 300) });
  }

  const buf = Buffer.from(await r.arrayBuffer());
  return json(200, { audio: buf.toString('base64'), chars: text.length });
};
