/* gc-voice — the friend speaks.

   POST { text, voice_id, access_token?, credit_ref?, owner_key?, is_demo?, visitor_id? }
     -> { audio } (base64 mpeg)

   is_demo/visitor_id, ADDED 2026-08-18: lets a house demo draw free audio
   from the same daily pool gc-chat.js already meters text against. See the
   note below.

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

   CREDITS ON A BUILT FRIEND, ALWAYS, NO FREE TIER: a spoken reply costs
   roughly five times what the text of the same reply costs, even on the
   cheaper turbo model, so a friend somebody built and owns draws from the
   shared credit pool (same ah_credits table gc-chat.js and Almost Human
   both use) with no free fallback, exactly like gc-chat.js's own text gate.

   A HOUSE DEMO IS DIFFERENT NOW, changed 2026-08-18. Dr. O: "the free daily
   has to have audio because the audio makes it" — a demo experienced as
   silent text does not show what this product actually is. So a demo
   friend (Arch, Sophia, Reggie, Tansy) now gets real audio inside the SAME
   shared daily pool gc-chat.js already meters text against
   (DAILY_FREE_LIMIT units/day/visitor, the ah_daily_usage Blobs store),
   weighted at AUDIO_MESSAGE_COST units per spoken reply, the identical 1:5
   ratio the paid credit system already uses. This does not add a second,
   separate free allowance: a visitor who spends the whole pool on audio
   gets about 3 spoken replies a day; spent on text, still 15. Same total
   cost ceiling either way, on purpose. Checked BEFORE calling ElevenLabs,
   same "take the money before the expensive part" reasoning as every paid
   generation on this campus: no real request goes out for a message
   nobody can pay for, free tier included. */
const AUDIO_MESSAGE_COST = 5;
const DAILY_FREE_LIMIT = 15;   // MUST MATCH gc-chat.js's own constant — same shared pool

/* 900 -> 1300, 2026-08-18: Dr. O caught Reggie's own sun-patch monologue
   getting cut off mid-sentence in audio while the full text still showed —
   he is written as "talks a lot" and was routinely running past the old
   cap. Raised rather than left tight, since a demo friend's audio silently
   falling short of his own displayed text is a worse experience than the
   extra ElevenLabs cost of the longer replies this now allows through.
   Real cost note, not hidden: AUDIO_MESSAGE_COST stays a flat 5 credits
   regardless of length, so a friend who reliably talks this long is
   modestly under-priced against real per-character TTS cost — worth
   revisiting if that gap ever matters at real volume. */
const MAX_CHARS = 1300;

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

const { getCreditRowByRef, deductCreditsByRef, safeToken } = require('./_ah-credits.js');
/* PER-COMPANION CREDITS, added 2026-08-28 -- see gc-chat.js's own identical
   import comment and _gc-companion-credits.js's header for the full
   reasoning. The shared-room guest path (credit_ref) still reads the old
   pooled ah_credits table, a real follow-up gap, not an oversight. */
const { readCompanionCreditRow, deductCompanionCredits } = require('./_gc-companion-credits.js');
const { ownerUser } = require('./_owner-auth.js');
/* DUAL VISITOR+ADDRESS CAP, added 2026-08-30 -- same fix, same reasoning,
   same shared ah_daily_usage pool as gc-chat.js's own identical comment.
   A visitorId-only cap on the voice pool had the identical hole a
   text-only one did: clear storage, get a fresh visitor id, the audio
   pool looks untouched too. */
const sherlockCap = require('./_sherlock-cap.js');

const CREDIT_REF = /^[a-f0-9]{64}$/;

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json(500, { error: 'no_voice_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  let text = String(body.text || '').trim();
  if (text.length > MAX_CHARS) {
    /* SENTENCE-BOUNDARY TRIM, not an arbitrary character cut, fixed
       2026-08-18 alongside raising the cap itself: if a reply still runs
       past MAX_CHARS, the audio should stop on a finished thought, the
       same reasoning as the cameo-line trim in gc-chat.js. Falls back to a
       word boundary if no sentence end falls in a reasonable range, and to
       a flat cut only if neither does. */
    const cut = text.slice(0, MAX_CHARS);
    const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (lastSentence > MAX_CHARS * 0.6) {
      text = cut.slice(0, lastSentence + 1);
    } else {
      const lastSpace = cut.lastIndexOf(' ');
      text = (lastSpace > MAX_CHARS * 0.8 ? cut.slice(0, lastSpace) : cut).trim();
    }
  }
  const voiceId = String(body.voice_id || '').trim();
  if (!text) return json(400, { error: 'nothing_to_say' });
  if (!/^[A-Za-z0-9]{12,40}$/.test(voiceId)) return json(400, { error: 'no_voice_id' });

  const rawOwnerKey = String(body.owner_key || '').trim();
  /* GC_OWNER_KEY, same reasoning as gc-chat.js's own comment: a second,
     independent door that only Good Company checks, additive to the
     shared campus OWNER_KEY, never replacing it. .trim() on both sides —
     see gc-chat.js's own comment on why the env var side needs it too. */
  const gcOwnerKey = String(process.env.GC_OWNER_KEY || '').trim();
  const isOwner = !!ownerUser(rawOwnerKey) ||
    (!!gcOwnerKey && rawOwnerKey === gcOwnerKey);
  /* SAME SIGNAL AS gc-chat.js, added 2026-08-18 — see its own comment. Tells
     the client whether a key arrived and was rejected, versus never having
     arrived at all, without ever echoing the key value itself back. */
  const ownerKeySentButRejected = !isOwner && !!rawOwnerKey;
  const isDemo = body.is_demo === true;
  const visitorId = safeVisitorId(body.visitor_id);
  const accessToken = safeToken(body.access_token);
  /* friend_id, added 2026-08-28: which companion's own credit row to check,
     same reasoning as gc-chat.js's activeFriend.id. Not validated against a
     format here since it is only ever used as an opaque key into
     gc_companion_credits, same trust level as accessToken/creditRef below. */
  const friendId = String(body.friend_id || '').trim() || null;
  const rawRef = String(body.credit_ref || '').trim();
  const creditRef = (!accessToken && CREDIT_REF.test(rawRef)) ? rawRef : null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  /* PER-COMPANION, NOT POOLED, changed 2026-08-28 -- see gc-chat.js's own
     identical comment for the full reasoning. A demo has no per-companion
     row, so credits never apply to one, only the free daily cap below. */
  let creditsRow = null;
  if (!isOwner && serviceKey) {
    if (!isDemo && accessToken && friendId) {
      creditsRow = await readCompanionCreditRow(accessToken, friendId, serviceKey);
    } else if (creditRef) {
      creditsRow = await getCreditRowByRef(creditRef, serviceKey);
    }
  }
  const hasCredits = Boolean(!isOwner && creditsRow && creditsRow.balance >= AUDIO_MESSAGE_COST);

  let usingFreeDailyCap = false;
  let dailyCapResult = null;

  /* LOGGED, added 2026-08-19, same reasoning as gc-chat.js's own fix from
     the same day: a rejection here used to leave no trace at all, which is
     exactly how Reggie/Sophia/Tansy's broken is_demo flag went unnoticed
     for two days. Grep-able by "REJECTED". */
  if (!isOwner && !hasCredits) {
    if (!isDemo) {
      console.log(`[gc-voice] REJECTED credits_exhausted voice=${voiceId || '?'} is_demo=${isDemo} owner_key_rejected=${ownerKeySentButRejected} visitor=${visitorId || 'none'}`);
      return json(200, { error: 'credits_exhausted', credits_exhausted: true, owner_key_rejected: ownerKeySentButRejected });
    }
    /* SAME POOL GC-CHAT.JS ALREADY METERS TEXT AGAINST, weighted 5x here.
       See the file-level note above: this is not a second free allowance,
       it is audio spending down the same daily units text already does. */
    usingFreeDailyCap = true;
    dailyCapResult = await sherlockCap.check(event, 'ah_daily_usage', {
      visitorId, perVisitor: DAILY_FREE_LIMIT, perAddress: DAILY_FREE_LIMIT * 2,
    });
    /* NEITHER A VISITOR ID NOR AN ADDRESS TO METER AGAINST -- keys.length
       is 0 -- keeps the original behaviour: cannot verify a free allowance
       exists, so no free audio, same as before this fix. */
    if (!dailyCapResult.allowed || !dailyCapResult.keys.length) {
      console.log(`[gc-voice] REJECTED daily_capped (${dailyCapResult.reason || 'no visitor id'}) voice=${voiceId || '?'} owner_key_rejected=${ownerKeySentButRejected} visitor=${visitorId || 'none'}`);
      return json(200, { error: 'daily_capped', daily_capped: true, owner_key_rejected: ownerKeySentButRejected });
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
  if (!isOwner) {
    if (hasCredits && serviceKey && !isDemo && accessToken && friendId) {
      await deductCompanionCredits(accessToken, friendId, AUDIO_MESSAGE_COST, serviceKey);
    } else if (hasCredits && serviceKey && creditRef) {
      await deductCreditsByRef(creditRef, AUDIO_MESSAGE_COST, serviceKey);
    } else if (usingFreeDailyCap && dailyCapResult) {
      await sherlockCap.bump(dailyCapResult, AUDIO_MESSAGE_COST);
    }
  }

  return json(200, { audio: buf.toString('base64'), chars: text.length });
};
