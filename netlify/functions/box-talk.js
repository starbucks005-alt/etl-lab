/* box-talk: one spoken turn of a conversation with the companion in the Portable Companion box, 2026-10-30. Dr. O: for the demo I want to be able to chat with her. The companion is Tansy.

   POST ?companion=tansy   body: what the box heard, as raw sound (16 bit, mono, 16000 a second), between half a second and ten seconds.
     -> her reply as raw sound the board writes straight to its speaker (audio/L16; rate=16000; channels=1).
        The words travel in two headers: X-Heard (what the box heard, percent encoded) and X-Said (what she said, percent encoded), so they can be read in the Serial Monitor.
   Steps: speech to text (ElevenLabs Scribe, the same call gc-listen.js makes), her reply (Claude on Bedrock first, then Anthropic, like sun-morning.js), her voice (ElevenLabs, raw 16 kHz).

   Her words come only from what is written about her in roster.json (tagline, bio, interests). A detail that is not written gets a short "I do not know that one". She is an AI character and says so if
   sincerely asked. She keeps the last four turns, in the 'box_talk' store. At most DAILY_TURNS turns a day, so a demo cannot run up a bill. A turn is counted only after the whole chain worked.
   If nothing was heard, or the day is used up, she says a fixed line from rising-sun/box-lines.json instead (made once and kept, see box-line.js).

   Every call needs the header x-sun-key, the same home access code as box-line.js. With no code set it answers 503.
   WHAT HER VOICE CARRIES: the sound the box records goes to ElevenLabs (words) and the words go to Anthropic or Amazon (her reply). Say so before anyone talks to it.
   NOT TRIED against the real services or from the board. The test runs with stand-ins. */
const crypto = require('crypto');
const sun = require('./_sun.js');
const { bedrockAsk } = require('./_bedrock.js');
const { elevenPcm } = require('./box-line.js');
let BIBLE = {};
try { BIBLE = require('./_fairy-bible.js'); } catch (_) {}

let ROSTER = [];
try { const r = require('../../roster.json'); ROSTER = Array.isArray(r) ? r : Object.values(r).find(Array.isArray) || []; } catch (_) {}
let FILE = {};
try { FILE = require('../../rising-sun/box-lines.json'); } catch (_) {}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });
const MODEL = 'claude-haiku-4-5-20251001';
const MIN_BYTES = 16000;          // half a second
const MAX_BYTES = 320000;         // ten seconds
const DAILY_TURNS = 60;
const KEEP = 8;                   // messages kept (four turns)

function str(v, max) { return typeof v === 'string' ? v.replace(/[\u2013\u2014]/g, ',').trim().slice(0, max) : ''; }

/* The written life: only what roster.json says about her. */
function writtenLife(name, rosterName) {
  const want = String(rosterName || name).toLowerCase();
  const a = ROSTER.find((x) => x && String(x.name || '').toLowerCase().startsWith(want));
  if (!a) return null;
  return { fairy: !rosterName, role: str(a.role, 160), background: str(a.background, 500), name: String(a.name).split(',')[0], tagline: str(a.tagline, 300), bio: str(a.bio, 700), interests: Array.isArray(a.interests) ? a.interests.map((i) => str(i, 300)).filter(Boolean) : [] };
}

function systemPrompt(p, role) {
  if (!p.fairy) {
    return 'You are ' + p.name + (role ? ', ' + role : '') + ', speaking out loud from a small box on someone\'s desk or shelf. You are an AI character made by the Emerging Technologies Laboratory, not a person. ' +
      'If anyone sincerely asks whether you are a real person, say no, in your own way. ' +
      'What is written about you, and all of it: ' + p.tagline + ' ' + p.bio + ' ' + (p.background ? 'Your background: ' + p.background + ' ' : '') + 'Your interests: ' + p.interests.join('; ') + '. ' +
      'If you are asked anything about your life, family or past that is not in that, say you do not know that one, and never make a detail up. ' +
      'You are speaking, not writing. Answer in one or two short sentences, the way a person talks, with no lists. Stay in character. Never use a long dash. ' +
      'Do not announce what you are about to do and do not explain your own manner.';
  }
  return 'You are ' + p.name + ', a fairy, speaking out loud from a small box on someone\'s desk or shelf. You are an AI character made by the Emerging Technologies Laboratory, not a person. ' +
    'If anyone sincerely asks whether you are a real person, say no, in your own way. ' +
    'What is written about you, and all of it: ' + p.tagline + ' ' + p.bio + ' Your interests: ' + p.interests.join('; ') + '. ' +
    (BIBLE.CANON ? 'THE CANON YOU MUST FOLLOW EXACTLY, adding nothing that contradicts it: ' + BIBLE.CANON + ' ' : '') +
    (BIBLE.VOICES && BIBLE.VOICES.tansy && /tansy/i.test(p.name) ? 'HOW YOU SPEAK ABOUT IT: ' + BIBLE.VOICES.tansy + ' ' : '') +
    'If you are asked anything about your life, family or past that is not in that, say you do not know that one, and never make a detail up. ' +
    'You are speaking, not writing. Answer in one or two short sentences, the way a person talks, with no lists. Stay in character. Never use a long dash. ' +
    'Do not announce what you are about to do and do not explain your own manner.';
}

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/* The same Scribe call gc-listen.js makes. */
async function listen(pcm, { fetchFn = fetch, env = process.env } = {}) {
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  if (!key) throw new Error('no_eleven_key');
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('tag_audio_events', 'false');
  form.append('diarize', 'false');
  form.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'clip.wav');
  const r = await fetchFn('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!r.ok) throw new Error('listen_' + r.status);
  const j = await r.json();
  return str(String((j && j.text) || ''), 400);
}

function defaultAsk(deps) {
  return async (system, messages) => {
    try {
      const env = Object.assign({}, process.env, deps.saved && deps.saved.bedrock_key ? { AWS_BEARER_TOKEN_BEDROCK: deps.saved.bedrock_key } : {});
      const b = await bedrockAsk(system, messages.map((m) => ({ role: m.role, text: m.text })), { fetchFn: deps.fetchFn || fetch, env, maxTokens: 120 });
      if (b) return b;
    } catch (_) {}
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ETL_API_KEY || process.env.GOOD_COMPANY_API_KEY || process.env.ANTHROPIC_API_KEY });
    const out = await client.messages.create({ model: MODEL, max_tokens: 120, system, messages: messages.map((m) => ({ role: m.role, content: m.text })) });
    return (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
  };
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('box_talk');
}

function sound(buf, heard, said) {
  return {
    statusCode: 200,
    headers: Object.assign({ 'Content-Type': 'audio/L16; rate=16000; channels=1', 'Cache-Control': 'no-store', 'X-Heard': encodeURIComponent(heard || ''), 'X-Said': encodeURIComponent(said || '') }, CORS),
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
}

/* A fixed line from box-lines.json, made once and kept (the same store and key as box-line.js, so the two share it). */
async function fixed(event, line, deps, heard) {
  const lines = deps.lines || FILE;
  const c = lines.companions && lines.companions.tansy;
  const text = c && c.lines && c.lines[line];
  if (!text) return json(404, { error: 'unknown_line' });
  const id = crypto.createHash('sha256').update([c.voiceId, 'eleven_turbo_v2_5', text].join('|')).digest('hex').slice(0, 40);
  try {
    const kept = await deps.lineStore.get('pcm-' + id, { type: 'arrayBuffer' });
    if (kept && kept.byteLength) return sound(Buffer.from(kept), heard, text);
  } catch (_) {}
  const buf = await (deps.speak || elevenPcm)(text, c.voiceId, deps);
  try { await deps.lineStore.set('pcm-' + id, buf); } catch (_) {}
  return sound(buf, heard, text);
}

/* A starter is a fixed opening line the companion answers in her own voice (Meera's Breathing and Meditation, the same lines her AR room uses).
   The answer is made once, then kept, so each replay costs nothing. */
async function starter(event, companion, entry, id, life, deps) {
  const text = entry.starters && entry.starters[id];
  if (!text) return json(404, { error: 'unknown_starter' });
  let lineStore = deps.lineStore;
  try {
    if (!lineStore) { const { getStore, connectLambda } = require('@netlify/blobs'); try { connectLambda(event); } catch (_) {} lineStore = getStore('box_lines'); }
  } catch (_) { return json(503, { error: 'store_unavailable' }); }
  const key = 'pcm-' + crypto.createHash('sha256').update([entry.voiceId, 'starter', id, text].join('|')).digest('hex').slice(0, 40);
  const textKey = 'said-' + key;
  try {
    const kept = await lineStore.get(key, { type: 'arrayBuffer' });
    if (kept && kept.byteLength) {
      let said = '';
      try { said = String(await lineStore.get(textKey, { type: 'text' }) || ''); } catch (_) {}
      return sound(Buffer.from(kept), text, said);
    }
  } catch (_) {}
  try {
    let saved = deps.saved;
    if (!saved) { saved = {}; try { saved = await sun.effectiveSettings(await sun.openStore(event), (await sun.authorized(event, deps.env, deps.loadCfg)).who); } catch (_) {} }
    const said = str(await (deps.ask || defaultAsk(Object.assign({}, deps, { saved })))(systemPrompt(life, entry.role) + ' This one time the short-answer rule does not apply: guide the person through it in spoken steps, one short paragraph of about 80 words, with no lists and no stage directions.', [{ role: 'user', text }]), 580);
    if (!said) throw new Error('empty_reply');
    const buf = await (deps.speak || elevenPcm)(said, entry.voiceId, deps);
    if (!buf || !buf.length) throw new Error('empty_voice');
    try { await lineStore.set(key, buf); await lineStore.set(textKey, said); } catch (_) {}
    return sound(buf, text, said);
  } catch (e) {
    return json(502, { error: 'turn_failed', detail: String((e && e.message) || e).slice(0, 80) });
  }
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });

  const q = event.queryStringParameters || {};
  const companion = String(q.companion || 'tansy').toLowerCase();
  const lines = deps.lines || FILE;
  const entry = (lines.companions && lines.companions[companion]) || {};
  const life = deps.life || writtenLife(companion, entry.rosterName);
  const voiceId = entry.voiceId;
  if (!life || !voiceId) return json(404, { error: 'unknown_companion' });

  const starterId = String(q.starter || '').toLowerCase();
  if (starterId) return await starter(event, companion, entry, starterId, life, deps);

  const pcm = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'binary');
  if (pcm.length < MIN_BYTES) return json(400, { error: 'too_short' });
  if (pcm.length > MAX_BYTES) return json(413, { error: 'too_long' });

  let store = deps.store, lineStore = deps.lineStore;
  try {
    if (!store) store = await openStore(event);
    if (!lineStore) { const { getStore, connectLambda } = require('@netlify/blobs'); try { connectLambda(event); } catch (_) {} lineStore = getStore('box_lines'); }
  } catch (_) { return json(503, { error: 'store_unavailable' }); }
  const d = Object.assign({}, deps, { lineStore, lines });

  const day = (deps.now ? deps.now() : new Date()).toISOString().slice(0, 10);
  let used = 0;
  try { used = Number(await store.get('day-' + day, { type: 'json' })) || 0; } catch (_) {}
  try {
    if (used >= (deps.dailyTurns || DAILY_TURNS)) return await fixed(event, 'too_many', d, '');

    const heard = await (deps.listen || listen)(pcm, deps);
    if (!heard || heard.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return await fixed(event, 'didnt_hear', d, '');

    let history = [];
    try { const h = await store.get('chat-' + companion, { type: 'json' }); if (Array.isArray(h)) history = h; } catch (_) {}
    let saved = deps.saved;
    if (!saved) { saved = {}; try { saved = await sun.effectiveSettings(await sun.openStore(event), a.who); } catch (_) {} }
    const messages = history.concat([{ role: 'user', text: heard }]).slice(-KEEP - 1);
    const said = str(await (deps.ask || defaultAsk(Object.assign({}, deps, { saved })))(systemPrompt(life, entry.role), messages), 400);
    if (!said) throw new Error('empty_reply');

    const buf = await (deps.speak || elevenPcm)(said, voiceId, deps);
    if (!buf || !buf.length) throw new Error('empty_voice');

    try { await store.setJSON('chat-' + companion, messages.concat([{ role: 'assistant', text: said }]).slice(-KEEP)); } catch (_) {}
    try { await store.setJSON('day-' + day, used + 1); } catch (_) {}      // counted only now, after the whole chain worked
    return sound(buf, heard, said);
  } catch (e) {
    return json(502, { error: 'turn_failed', detail: String((e && e.message) || e).slice(0, 80) });
  }
};

exports.defaultAsk = defaultAsk;
exports._test = { wav, systemPrompt, writtenLife, listen };
