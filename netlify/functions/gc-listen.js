/* gc-listen — the friend listens.

   POST { audio, mime?, visitor_id?, access_token?, owner_key?, tester_key?, is_demo? }
     audio: base64 of one short recording (the pages send 16 kHz mono WAV, one spoken sentence)
     -> { text }   what was said, "" when it was not speech
   GET  -> { enabled }   whether listening is switched on, so a page knows which way to listen. No secrets.

   WHY THIS EXISTS, 2026-10-07, Dr. O. The pages' always-on microphone used the browser's own speech recognition,
   and on an Android phone or tablet that plays the system "listening" chime every time it starts, which with
   "always on" is a constant beep. It cannot be silenced from a page. This lets a page record the microphone
   itself and send each sentence here instead, which works the same on every phone, tablet and laptop, and on
   iPhones, which have no browser speech recognition at all.

   OFF UNTIL SWITCHED ON. GC_LISTEN_ENABLED must be "1" in the Netlify environment. Anything else, or nothing,
   and every call answers listening_off and the pages keep using the browser's listening. That is the whole
   switch: no code change to turn it on or off, and a redeploy makes it take effect.

   COST. ElevenLabs bills Scribe by the hour of audio, about $0.22 an hour on their API price list when this was
   written, so a three second sentence is a fiftieth of a cent. Cheap, but it is a public endpoint that spends
   money, so it follows gc-voice.js's rules:
     * the owner key, the tester key and a lab key are recognised the same way, and cost nothing here;
     * everyone else has a daily cap per visitor and per address (gc_listen_usage in Blobs), checked BEFORE the
       call to ElevenLabs and counted only after it succeeds;
     * a hard limit on the size and length of one recording, enforced here, not trusted to the page;
     * with neither a visitor id nor an address to count against, there is no free listening, same as voice.

   ELEVENLABS_API_KEY comes from the campus environment, as in gc-voice.js. */
const MODEL = 'scribe_v1';

const MAX_AUDIO_BYTES = 500 * 1024;   // about 15 seconds of 16 kHz mono 16 bit
const MIN_AUDIO_BYTES = 8 * 1024;     // under a quarter of a second: nothing there
const PER_VISITOR_DAILY = 100;        // sentences a day, about five minutes of talking
const PER_ADDRESS_DAILY = 300;        // a shared connection (a booth, a classroom) gets three times that

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-lab-key',
};
const json = (code, body) => ({
  statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const { ownerUser } = require('./_owner-auth.js');
const { isLabKey, labCallAllowed } = require('./_lab-key.js');
const sherlockCap = require('./_sherlock-cap.js');

/* Same list as gc-chat.js and gc-voice.js, kept as its own copy the way they do. */
const GC_TESTER_KEYS = ['pookie-test-2026'];

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

const enabled = () => String(process.env.GC_LISTEN_ENABLED || '').trim() === '1';

/* ElevenLabs writes "[outro jingle]", "(laughter)" and so on for sound that is not speech. */
function cleanText(t) {
  const s = String(t || '').trim();
  if (/^[[(][^\])]*[\])]\.?$/.test(s)) return '';
  return s;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod === 'GET') return json(200, { enabled: enabled() });
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  if (!enabled()) return json(200, { error: 'listening_off', listening_off: true });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json(500, { error: 'no_voice_key' });

  if (String(event.body || '').length > MAX_AUDIO_BYTES * 1.4) return json(413, { error: 'too_long' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const b64 = String(body.audio || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return json(400, { error: 'no_audio' });
  const audio = Buffer.from(b64, 'base64');
  if (audio.length < MIN_AUDIO_BYTES) return json(200, { text: '' });
  if (audio.length > MAX_AUDIO_BYTES) return json(413, { error: 'too_long' });
  const mime = /^audio\/(wav|x-wav|webm|ogg|mp4|mpeg)$/.test(String(body.mime || '')) ? String(body.mime) : 'audio/wav';

  const rawOwnerKey = String(body.owner_key || '').trim();
  const gcOwnerKey = String(process.env.GC_OWNER_KEY || '').trim();
  const isOwner = !!ownerUser(rawOwnerKey) || (!!gcOwnerKey && rawOwnerKey === gcOwnerKey);
  const rawTesterKey = String(body.tester_key || '').trim();
  const isTester = !isOwner && !!rawTesterKey && GC_TESTER_KEYS.indexOf(rawTesterKey) > -1;
  const visitorId = safeVisitorId(body.visitor_id);

  /* A lab key counts as free here and nothing more, metered per key per day by labCallAllowed, which fails closed. */
  let isLabPaid = false;
  if (!isOwner && !isTester && isLabKey(event.headers)) {
    isLabPaid = await labCallAllowed(event, event.headers);
  }

  let capResult = null;
  if (!isOwner && !isTester && !isLabPaid) {
    capResult = await sherlockCap.check(event, 'gc_listen_usage', {
      visitorId, perVisitor: PER_VISITOR_DAILY, perAddress: PER_ADDRESS_DAILY,
    });
    if (!capResult.allowed || !capResult.keys.length) {
      console.log(`[gc-listen] REJECTED daily_capped (${capResult.reason || 'no visitor id'}) visitor=${visitorId || 'none'}`);
      return json(200, { error: 'daily_capped', daily_capped: true });
    }
  }

  let r;
  try {
    const form = new FormData();
    form.append('model_id', MODEL);
    form.append('tag_audio_events', 'false');     // no "[outro jingle]" notes in the words
    form.append('diarize', 'false');
    form.append('file', new Blob([audio], { type: mime }), 'clip.' + (mime.split('/')[1] || 'wav'));
    r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': key }, body: form,
    });
  } catch (err) {
    return json(502, { error: 'listen_unreachable', detail: String(err && err.message || err).slice(0, 200) });
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return json(r.status === 401 ? 401 : 502, { error: 'listen_failed', status: r.status, detail: detail.slice(0, 300) });
  }

  let text = '';
  try { text = cleanText((await r.json()).text); } catch (_) { text = ''; }

  /* Counted only now, after ElevenLabs answered, never on a blocked check or a failed call. */
  if (capResult) await sherlockCap.bump(capResult, 1);

  return json(200, { text });
};

exports._test = { cleanText, MAX_AUDIO_BYTES, MIN_AUDIO_BYTES, PER_VISITOR_DAILY, PER_ADDRESS_DAILY };
