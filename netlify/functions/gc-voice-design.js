/* gc-voice-design — describe a voice in words, hear real options, keep one.
   ─────────────────────────────────────────────────────────────────────────
   POST { action: 'design', description }
     -> { previews: [{ id, audio_b64 }], text }
   POST { action: 'create', generated_voice_id, name, description }
     -> { voice_id }

   THE OTHER HALF OF "how do they get a voice." Dr. O, after the field that
   only accepted an ID somebody already had: "for elevenlabs voice to MAKE
   one." ElevenLabs' own Voice Design model turns a text description into a
   handful of real, listenable options; this is that, wired in.

   PUBLIC, THE SAME WAY gc-face.js IS. Confirmed against our actual billing
   (ElevenLabs Pro, $99/mo for 1,400,596 characters -- checked live,
   2026-08-19, not assumed): a design call runs a few hundred characters of
   preview audio, on the order of two cents. Cheaper than a single face
   draw, so this gets the same treatment: no owner gate here, a client-side
   draw limit instead (see build.html), same shape as FACE_SETS.

   TWO STEPS, TWO ELEVENLABS ENDPOINTS, BECAUSE THAT IS HOW THEY BUILT IT.
   /v1/text-to-voice/design returns previews that expire; nothing is
   permanent, nothing is billed as a saved voice, until one of them is
   promoted through /v1/text-to-voice with its generated_voice_id. A person
   can design and listen as many times as the draw limit allows and never
   spend a permanent voice slot on one they did not want.
*/

const ELEVEN = 'https://api.elevenlabs.io';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json(500, { error: 'config', missing: 'ELEVENLABS_API_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const headers = { 'xi-api-key': key, 'Content-Type': 'application/json' };

  /* ── PLAIN TEXT-TO-SPEECH, A SAVED VOICE READING GIVEN TEXT ──────────────
     Added 2026-08-30 for the homepage's bio clips (the same file every
     .demo-card-play button already points at, see index.html). Deliberately
     NOT routed through gc-voice.js: that file's whole cost-gating shape
     (daily pool, credits, is_demo) exists for a live visitor's own spoken
     reply mid-conversation, not a one-time admin job recording a fixed
     bio line for a real, already-owned voice_id. Same no-owner-gate
     reasoning as design/create above -- a bio clip is a few hundred
     characters, on the order of a couple of cents each, recorded once and
     replayed free forever after, the same "free is whatever costs no API
     call" rule every other cached clip on this campus already follows. */
  if (body.action === 'speak') {
    const voiceId = String(body.voice_id || '').trim();
    const text = String(body.text || '').trim().slice(0, 1000);
    if (!voiceId) return json(400, { error: 'voice_id_required' });
    if (!text) return json(400, { error: 'text_required' });
    /* speed, added 2026-08-30 for Meera's bio: "she speaks too slow."
       ElevenLabs' own voice_settings.speed, 1.0 is the API default and
       what every call here got before this, so omitting it (or passing
       exactly 1) changes nothing for any other caller. Clamped to
       ElevenLabs' own documented safe range. */
    const rawSpeed = Number(body.speed);
    const speed = (rawSpeed >= 0.7 && rawSpeed <= 1.2) ? rawSpeed : 1;

    let r, buf;
    try {
      r = await fetch(ELEVEN + '/v1/text-to-speech/' + encodeURIComponent(voiceId), {
        method: 'POST', headers,
        body: JSON.stringify({
          text, model_id: 'eleven_turbo_v2_5',
          voice_settings: { speed },
        }),
      });
      if (!r.ok) {
        let detail = null;
        try { detail = await r.json(); } catch (_) {}
        return json(r.status, { error: 'eleven_refused', detail });
      }
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      return json(502, { error: 'eleven_unreachable', detail: String(e && e.message || e).slice(0, 300) });
    }

    return json(200, { audio_b64: buf.toString('base64') });
  }

  /* ── PROMOTE A PREVIEW TO A REAL, SAVED VOICE ────────────────────────── */
  if (body.action === 'create') {
    const generatedVoiceId = String(body.generated_voice_id || '').trim();
    if (!generatedVoiceId) return json(400, { error: 'generated_voice_id_required' });

    const name = String(body.name || 'A voice').trim().slice(0, 60) || 'A voice';
    const description = String(body.description || name).trim().slice(0, 500);

    let r, data;
    try {
      r = await fetch(ELEVEN + '/v1/text-to-voice', {
        method: 'POST', headers,
        body: JSON.stringify({
          voice_name: name,
          voice_description: description,
          generated_voice_id: generatedVoiceId,
        }),
      });
      data = await r.json();
    } catch (e) {
      return json(502, { error: 'eleven_unreachable', detail: String(e && e.message || e).slice(0, 300) });
    }
    if (!r.ok) return json(r.status, { error: 'eleven_refused', detail: data });
    if (!data || !data.voice_id) return json(502, { error: 'no_voice_id', detail: data });

    return json(200, { voice_id: data.voice_id });
  }

  /* ── DESIGN: DESCRIPTION IN, LISTENABLE PREVIEWS OUT ─────────────────── */
  const description = String(body.description || '').trim().slice(0, 1000);
  if (!description) return json(400, { error: 'description_required' });

  let r, data;
  try {
    r = await fetch(ELEVEN + '/v1/text-to-voice/design', {
      method: 'POST', headers,
      body: JSON.stringify({
        voice_description: description,
        /* ElevenLabs writes the sample line itself from the description,
           so nobody building a friend has to also compose a paragraph for
           a stranger's voice to read aloud. */
        auto_generate_text: true,
      }),
    });
    data = await r.json();
  } catch (e) {
    return json(502, { error: 'eleven_unreachable', detail: String(e && e.message || e).slice(0, 300) });
  }
  if (!r.ok) return json(r.status, { error: 'eleven_refused', detail: data });

  const previews = Array.isArray(data && data.previews)
    ? data.previews.map(p => ({ id: p.generated_voice_id, audio_b64: p.audio_base_64 })).filter(p => p.id && p.audio_b64)
    : [];
  if (!previews.length) return json(502, { error: 'no_previews', detail: data });

  return json(200, { previews, text: (data && data.text) || null });
};
