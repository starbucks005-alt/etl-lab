/* box-sound: a nature sound for the Gardenscape button, 2026-10-30. Dr. O: the buttons are Gardenscape, Story time and Chat with Tansy.

   GET ?companion=tansy&name=jungle   (names are the scenes in rising-sun/box-lines.json: jungle, waterfall, rain, night-woods)
     -> about 20 seconds of that sound as raw sound the board writes straight to its speaker (audio/L16; rate=16000; channels=1). The box plays it again and again until a button is pressed.
   The prompt for each sound is in box-lines.json, so only those sounds can be asked for. A sound is made once with ElevenLabs sound effects, asking for a seamless loop, and kept in the 'box_sounds'
   store, so playing it again costs nothing. Needs the header x-sun-key, the same home access code as box-line.js.

   NOT CHECKED: ElevenLabs' Service-Specific Terms for its sound effects (Dr. O reads them before any box is sold), and the request below has not been tried against the real service or from the board.
   The prompts describe a place. They never name an artist, a song or a person. */
const crypto = require('crypto');
const sun = require('./_sun.js');

let FILE = {};
try { FILE = require('../../rising-sun/box-lines.json'); } catch (_) {}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });
const SECONDS = 20;

async function elevenSound(prompt, { fetchFn = fetch, env = process.env } = {}) {
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  if (!key) throw new Error('no_eleven_key');
  const r = await fetchFn('https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_16000', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'application/octet-stream' },
    body: JSON.stringify({ text: String(prompt).slice(0, 400), duration_seconds: SECONDS, prompt_influence: 0.5, loop: true, model_id: 'eleven_text_to_sound_v2' }),
  });
  if (!r.ok) throw new Error('eleven_' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('box_sounds');
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'get_only' });
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });

  const q = event.queryStringParameters || {};
  const companion = String(q.companion || 'tansy').toLowerCase();
  const name = String(q.name || '').toLowerCase();
  const lines = deps.lines || FILE;
  const scene = lines.companions && lines.companions[companion] && lines.companions[companion].scenes && lines.companions[companion].scenes[name];
  if (!scene || !scene.sound) return json(404, { error: 'unknown_sound' });

  const id = crypto.createHash('sha256').update(['sfx-v2', SECONDS, scene.sound].join('|')).digest('hex').slice(0, 40);
  let store = deps.store;
  try {
    if (!store) store = await openStore(event);
    const kept = await store.get('pcm-' + id, { type: 'arrayBuffer' });
    if (kept && kept.byteLength) return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'audio/L16; rate=16000; channels=1', 'Cache-Control': 'no-store', 'X-Kept': 'yes' }, CORS), body: Buffer.from(kept).toString('base64'), isBase64Encoded: true };
  } catch (_) {}

  let buf;
  try { buf = await (deps.make || elevenSound)(scene.sound, deps); }
  catch (e) { return json(502, { error: 'sound_failed', detail: String((e && e.message) || e).slice(0, 80) }); }
  if (!buf || !buf.length) return json(502, { error: 'sound_failed', detail: 'empty' });
  try { if (store) await store.set('pcm-' + id, buf); } catch (_) {}
  return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'audio/L16; rate=16000; channels=1', 'Cache-Control': 'no-store', 'X-Kept': 'no' }, CORS), body: buf.toString('base64'), isBase64Encoded: true };
};

exports.elevenSound = elevenSound;
