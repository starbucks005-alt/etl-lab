/* gc-voice — the friend speaks.

   POST { text, voice_id, access_token?, credit_ref?, owner_key? } -> { audio } (base64 mpeg)

   credit_ref, ADDED 2026-08-17: the shared-room equivalent of access_token.
   A guest's browser never holds the host's live token, only a one-way
   reference to it (see gc-room-open.js), so this is what lets a guest's
   own voice requests bill the room's shared balance. Checked only when
   there is no direct access_token, which is always the more trusted,
   specific identity when present.

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

   CREDITS, ALWAYS, NO FREE TIER, added 2026-08-17 after the real cost
   breakdown: a spoken reply costs roughly five times what the text of the
   same reply costs, even on the cheaper turbo model. gc-chat.js gives a
   house demo DAILY_FREE_LIMIT free text messages a day; this does not give
   voice the same allowance on ANY friend, demo included; voice always draws
   from the shared credit pool (same ah_credits table gc-chat.js and Almost
   Human both use). Checked BEFORE calling ElevenLabs, same "take the money
   before the expensive part" reasoning as every paid generation on this
   campus: no real request goes out for a message nobody can pay for. */
const AUDIO_MESSAGE_COST = 5;

const MAX_CHARS = 900;   // a long turn, not a monologue

/* eleven_turbo_v2_5, NOT eleven_multilingual_v2. Dr. O, after seeing the real
   cost: this is a friend talking in a room, not a produced narration, and
   multilingual_v2 was the pricier model for a quality gap most people would
   never notice in that context. Turbo costs meaningfully less per character
   at a small, real quality/latency tradeoff. English quality is close to
   parity; multilingual coverage is narrower, worth revisiting if a
   non-English friend's voice ever sounds worse for it. */
const MODEL = 'eleven_turbo_v2_5';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (code, body) => ({
  statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const { getCreditRow, deductCredits, getCreditRowByRef, deductCreditsByRef, safeToken } = require('./_ah-credits.js');
const { ownerUser } = require('./_owner-auth.js');

const CREDIT_REF = /^[a-f0-9]{64}$/;

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

  const isOwner = !!ownerUser(String(body.owner_key || '').trim());
  const accessToken = safeToken(body.access_token);
  const rawRef = String(body.credit_ref || '').trim();
  const creditRef = (!accessToken && CREDIT_REF.test(rawRef)) ? rawRef : null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isOwner) {
    let creditsRow = null;
    if (serviceKey) {
      if (accessToken) creditsRow = await getCreditRow(accessToken, serviceKey);
      else if (creditRef) creditsRow = await getCreditRowByRef(creditRef, serviceKey);
    }
    if (!creditsRow || creditsRow.balance < AUDIO_MESSAGE_COST) {
      return json(200, { error: 'credits_exhausted', credits_exhausted: true });
    }
  }

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

  /* Billed only now, after ElevenLabs actually returned audio — never on a
     blocked check above, and never on a failed/unreachable call, which
     returned before this point. */
  if (!isOwner && serviceKey) {
    if (accessToken) await deductCredits(accessToken, AUDIO_MESSAGE_COST, serviceKey);
    else if (creditRef) await deductCreditsByRef(creditRef, AUDIO_MESSAGE_COST, serviceKey);
  }

  return json(200, { audio: buf.toString('base64'), chars: text.length });
};
