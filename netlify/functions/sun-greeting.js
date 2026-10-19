/* sun-greeting: each fairy's hello, recorded once, 2026-10-19, Dr. O: "their greeting should be recorded so not costing after one try".
   GET ?fairy=ash  ->  the mp3 of her greeting and her first question. The first request makes it with her voice and keeps it in the 'rising_sun_audio' store; every request
   after that is served from there, so a fairy's hello costs one spoken line however many people play it. The key holds the voice and the words, so a new voice or
   new words makes a new recording on the next play. Only the seven shipped fairies, with their shipped words, so nobody can make it say anything else. */
const crypto = require('crypto');
const sun = require('./_sun.js');
const { azureVoiceName, azureSpeak } = require('./_azure-tts.js');
const gcConfig = require('./_gc-config.js');
const { elevenSpeak, isElevenId } = require('./_eleven.js');
let PERSONAS = {};
try { PERSONAS = require('../../rising-sun/personas.json'); } catch (_) {}

exports.handler = async function (event, _ctx, deps = {}) {
  const q = (event.queryStringParameters || {});
  const id = String(q.fairy || '');
  const p = sun.SHIPPED.includes(id) ? PERSONAS[id] : null;
  if (!p) return { statusCode: 404, body: 'no_fairy' };
  const text = [p.greeting, p.ask].filter(Boolean).join(' ');
  const voice = String(p.voice || '').trim();
  if (!text || !(azureVoiceName(voice) || isElevenId(voice))) return { statusCode: 404, body: 'no_voice' };
  const store = deps.store || (() => { const { getStore, connectLambda } = require('@netlify/blobs'); try { connectLambda(event); } catch (_) {} return getStore('rising_sun_audio'); })();
  const key = id + '-' + crypto.createHash('sha256').update(voice + '|' + text).digest('hex').slice(0, 16);
  let buf = null;
  try { const got = await store.get(key, { type: 'arrayBuffer' }); if (got) buf = Buffer.from(got); } catch (_) {}
  if (!buf) {
    const speak = deps.speak || (async (t, v) => (azureVoiceName(v) ? azureSpeak(t, azureVoiceName(v), { env: await gcConfig.azureEnv(event) }) : elevenSpeak(t, v)));
    try { buf = await speak(text, voice); } catch (_) { return { statusCode: 502, body: 'no_audio' }; }
    try { await store.set(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); } catch (_) { /* played anyway, recorded next time */ }
  }
  return { statusCode: 200, isBase64Encoded: true, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' }, body: buf.toString('base64') };
};
