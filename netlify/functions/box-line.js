/* box-line: one spoken line for the Portable Companion box, 2026-10-30. Dr. O: the companion for this box is Tansy.

   The box is a Waveshare ESP32-S3 audio board (rising-sun/board-test). It has no voice of its own. It asks here for a line and plays what comes back.

   GET or POST ?companion=tansy&line=greeting   (or the same two words in a JSON body)
     -> the spoken line as raw sound the board can write straight to its speaker: 16 bit, mono, 16000 samples a second (audio/L16), no mp3 to unpack.
   The words come from rising-sun/box-lines.json, which Dr. O writes. A line is made once in the companion's ElevenLabs voice and kept in the 'box_lines' store, so
   playing it again costs nothing. Only lines in that file can be asked for, so nobody can use the box to make the site speak anything else.

   Every call needs the header x-sun-key, the same home access code the Rising Sun uses (see _sun.js authorized). With no code set anywhere it answers 503.
   The ElevenLabs key is the one the site already has (ELEVENLABS_API_KEY). No new environment variable.

   NOT TRIED against the real ElevenLabs service or from the board. The test runs with stand-ins. */
const crypto = require('crypto');
const sun = require('./_sun.js');
const { isElevenId } = require('./_eleven.js');

let FILE = {};
try { FILE = require('../../rising-sun/box-lines.json'); } catch (_) {}

const MODEL = 'eleven_turbo_v2_5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });

/* The same call _eleven.js makes, asking for raw 16 kHz sound instead of mp3. */
async function elevenPcm(text, voiceId, { fetchFn = fetch, env = process.env } = {}) {
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  if (!key) throw new Error('no_eleven_key');
  if (!isElevenId(voiceId)) throw new Error('bad_voice_id');
  const r = await fetchFn('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(String(voiceId).trim()) + '?output_format=pcm_16000', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'application/octet-stream' },
    body: JSON.stringify({ text: String(text).slice(0, 600), model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error('eleven_' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('box_lines');
}

function sound(buf, cached, scene) {
  return {
    statusCode: 200,
    headers: Object.assign({ 'Content-Type': 'audio/L16; rate=16000; channels=1', 'Cache-Control': 'no-store', 'X-Kept': cached ? 'yes' : 'no' }, scene ? { 'X-Scene': scene } : {}, CORS),
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const companion = String(body.companion || q.companion || 'tansy').toLowerCase();
  const line = String(body.line || q.line || 'greeting').toLowerCase();

  const lines = deps.lines || FILE;
  const c = lines.companions && lines.companions[companion];
  if (!c) return json(404, { error: 'unknown_line' });

  let store = deps.store;
  try { if (!store) store = await openStore(event); } catch (_) { store = null; }

  /* Two lines that are not one line: "story" is the next fragment in turn, "garden" is the next scene's introduction in turn. */
  let key = line, scene = '';
  if (line === 'story' || line === 'garden') {
    const names = line === 'story'
      ? Object.keys(c.lines || {}).filter((k) => /^(hs-|story-)/.test(k)).sort()
      : Object.keys(c.scenes || {}).sort();
    if (!names.length) return json(404, { error: line === 'story' ? 'no_stories_yet' : 'no_scenes_yet' });
    let n = 0;
    try { n = Number(await store.get('turn-' + line, { type: 'json' })) || 0; } catch (_) {}
    const pick = names[n % names.length];
    try { await store.setJSON('turn-' + line, (n + 1) % 1000); } catch (_) {}
    if (line === 'story') key = pick;
    else { scene = pick; key = (c.scenes[pick] || {}).intro || ''; }
  }
  const text = c.lines && c.lines[key];
  if (!text) {
    // a scene with no introduction written yet: nothing to say, the sound plays anyway
    if (scene) return { statusCode: 204, headers: Object.assign({ 'X-Scene': scene }, CORS), body: '' };
    return json(404, { error: 'unknown_line' });
  }

  const id = crypto.createHash('sha256').update([c.voiceId, MODEL, text].join('|')).digest('hex').slice(0, 40);
  try {
    if (!store) store = await openStore(event);
    const kept = await store.get('pcm-' + id, { type: 'arrayBuffer' });
    if (kept && kept.byteLength) return sound(Buffer.from(kept), true, scene);
  } catch (_) { /* nothing kept, or the store is down: make it again */ }

  let buf;
  try { buf = await (deps.speak || elevenPcm)(text, c.voiceId, deps); }
  catch (e) { return json(502, { error: 'voice_failed', detail: String((e && e.message) || e).slice(0, 80) }); }
  if (!buf || !buf.length) return json(502, { error: 'voice_failed', detail: 'empty' });
  try { if (store) await store.set('pcm-' + id, buf); } catch (_) { /* a line that could not be kept is still played */ }
  return sound(buf, false, scene);
};

exports.elevenPcm = elevenPcm;
