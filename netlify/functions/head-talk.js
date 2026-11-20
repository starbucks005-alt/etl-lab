/* head-talk: one spoken turn for a robot whose head runs on the round Waveshare ESP32-S3 audio board, 2026-11-19.
   Dr. O: Astri's eye stack and servo board cost a week; her head is to carry the round board, a speaker and cabochon eyes, with the thinking on the website.

   POST ?robot=astri   body: what the head heard, as raw sound (16 bit, mono, 16000 a second), between half a second and ten seconds.
     -> her answer as raw sound the board writes straight to its speaker (audio/L16; rate=16000; channels=1).
        The words travel in two headers, X-Heard and X-Said (percent encoded), so the board can print them where they can be read.
     -> 204 with X-Why when there is nothing to say: nothing was heard (didnt_hear), or the day's turns are used up (day_used). The head stays quiet.

   WHO SHE IS comes from the same file her Pi uses, al-panel/pi/personalities.json, so the head and the Pi say the same things about her and nothing is written twice.
   HER VOICE comes from al-panel/robots.json: an Azure voice name (Astri is en-US-AnaNeural) or an ElevenLabs id. box-line.js makes either one as raw 16 kHz sound.
   Steps: speech to text (ElevenLabs Scribe, as box-talk.js), her answer (Claude on Bedrock first, then Anthropic, as box-talk.js), her voice.

   A walk-up event means a new person every few minutes, so she keeps only the last two turns, and forgets them after two quiet minutes.
   At most DAILY_TURNS turns a day for each robot, counted only after the whole chain worked.
   Every call needs the header x-sun-key, the same home access code the Companion box uses (_sun.js authorized). With no code set it answers 503.
   WHAT SHE HEARS GOES OUT: the sound goes to ElevenLabs (words) and the words to Anthropic or Amazon (her answer), and her answer to Azure or ElevenLabs (her voice).
   THE FIRESIDE CHAT (2026-11-19, Dr. O: "add all the bots to it"): the head takes part through the same director the Pis use (fireside.js). Nobody hears anybody
   through the air: the director hands each one the words said so far, as text.
     POST ?robot=astri&fireside=poll -> 204 with X-On (1 while a chat is on) and X-Every (seconds until the head should ask again), or, when it is her turn,
        200 with her answer as sound, X-Cue (the turn's id) and X-Said. Her answer is thought and spoken here, so the board only plays it.
     POST ?robot=astri&fireside=done&cue=<id> -> 204. The board says she has finished speaking, and the director is told what she said.
     The host's Stop cuts a Pi off mid sentence; a head finishes its answer (two or three sentences) before the floor moves on.
   NOT TRIED against the real services or from the board. The test runs with stand-ins. */
const sun = require('./_sun.js');
const { elevenPcm } = require('./box-line.js');
const { defaultAsk, _test: boxTest } = require('./box-talk.js');

let PERSONAS = {};
try { PERSONAS = require('../../al-panel/pi/personalities.json'); } catch (_) {}
let ROBOTS = [];
try { const r = require('../../al-panel/robots.json'); ROBOTS = Array.isArray(r.robots) ? r.robots : []; } catch (_) {}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });
const quiet = (why, heard) => ({ statusCode: 204, headers: Object.assign({ 'Cache-Control': 'no-store', 'X-Why': why, 'X-Heard': encodeURIComponent(heard || '') }, CORS), body: '' });
const MIN_BYTES = 16000;          // half a second
const MAX_BYTES = 320000;         // ten seconds
const DAILY_TURNS = 400;          // a four hour walk-up event is a turn every 36 seconds
const KEEP = 4;                   // messages kept (two turns)
const FORGET_MS = 120000;         // two quiet minutes and the next person starts fresh

/* The seat and name each robot has in the fireside chat, the same as ROBOT_SEATS in al-panel/pi/al_fireside.py and SEAT_DEFAULTS in _fireside-core.js. */
const SEATS = { alice: ['alice', 'ALICE'], 'astra-lite': ['elle', 'Elle'], astra: ['astra', 'Astra'], astrad: ['astrad', 'Ted'], astro: ['astro', 'Astro'], astri: ['astri', 'Astri'],
  'guardian-f': ['guardianf', 'Guardian F'], 'guardian-m': ['guardianm', 'Guardian M'], reggie: ['reggie', 'Reggie'], biscuit: ['biscuit', 'Biscuit'], mochi: ['mochi', 'Mochi'] };
const ROOM = 'etl-fireside';

async function defaultDirector(body) {
  const r = await require('./fireside.js').handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  if (!r || r.statusCode !== 200) return null;
  try { return JSON.parse(r.body); } catch (_) { return null; }
}

function str(v, max) { return typeof v === 'string' ? v.replace(/[\u2013\u2014]/g, ',').trim().slice(0, max) : ''; }

/* Her voice, from her entry in robots.json. */
function voiceFor(robotId, robots = ROBOTS) {
  const r = robots.find((x) => x && x.id === robotId);
  const s = (r && r.setup) || {};
  if (s.azure_voice) return 'azure:' + s.azure_voice;
  if (s.voice === 'elevenlabs' && s.voice_id) return s.voice_id;
  return null;
}

/* 2026-11-20, Dr. O: "his voice is high" (Astro, on his round board). On his Pi it was lowered with robot_pitch.txt; the head gets the same here, from
   "head": {"pitch_down": <percent>} in his robots.json entry. It is the Pi's plain way: the voice played slower, so it is lower and a little slower too. */
function pitchFor(robotId, robots = ROBOTS) {
  const r = robots.find((x) => x && x.id === robotId);
  const v = Number(r && r.head && r.head.pitch_down);
  return v > 0 ? Math.min(30, v) : 0;
}

function lower(pcm, percent) {
  if (!percent || !pcm || pcm.length < 4) return pcm;
  const f = 1 - percent / 100;
  const n = Math.floor(pcm.length / 2), m = Math.floor(n / f);
  const out = Buffer.alloc(m * 2);
  for (let i = 0; i < m; i++) {
    const x = i * f, a = Math.floor(x), b = Math.min(a + 1, n - 1), w = x - a;
    out.writeInt16LE(Math.round(pcm.readInt16LE(a * 2) * (1 - w) + pcm.readInt16LE(b * 2) * w), i * 2);
  }
  return out;
}

/* Her written self, word for word from the file her Pi uses, and how a head speaks. */
function systemPrompt(entry) {
  return String(entry.prompt || '') + ' ' +
    'You are speaking out loud from your own robot head to whoever is standing in front of you. Often that is a child, at an event where people walk up one after another. ' +
    'If what you hear sounds like the end of one person and the start of another, greet the new person. ' +
    'Keep every answer suitable for a young child. You are speaking, not writing: no lists, no stage directions, and never a long dash.';
}

function sound(buf, heard, said) {
  return {
    statusCode: 200,
    headers: Object.assign({ 'Content-Type': 'audio/L16; rate=16000; channels=1', 'Cache-Control': 'no-store', 'X-Heard': encodeURIComponent(heard || ''), 'X-Said': encodeURIComponent(said || '') }, CORS),
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('head_talk');
}

const waiting = (on, every) => ({ statusCode: 204, headers: Object.assign({ 'Cache-Control': 'no-store', 'X-On': on ? '1' : '0', 'X-Every': String(every) }, CORS), body: '' });

async function fireside(event, deps, fs, robot, entry, voiceId, a, q) {
  const seat = SEATS[robot];
  if (!seat) return json(404, { error: 'no_seat' });
  const director = deps.director || defaultDirector;
  const call = (action, more) => director(Object.assign({ action, room: ROOM, seat: seat[0], name: seat[1] }, more || {}));
  let store = deps.store;
  try { if (!store) store = await openStore(event); } catch (_) { return json(503, { error: 'store_unavailable' }); }

  if (fs === 'done') {
    const cue = String(q.cue || '').slice(0, 60);
    let said = '';
    try { const k = await store.get('fs-' + cue, { type: 'json' }); said = (k && k.said) || ''; } catch (_) {}
    await call('done', { cue, said });
    return waiting(true, 1);
  }
  if (fs !== 'poll') return json(400, { error: 'unknown_fireside_step' });

  const v = await call('poll');
  if (!v || !('on' in v)) return json(502, { error: 'director_unreachable' });
  const every = Math.max(1, Number(v.every) || (v.on ? 1 : 20));
  const cue = v.on && v.cue && v.cue.id ? v.cue : null;
  if (!cue) return waiting(!!v.on, every);
  try { if (await store.get('fs-' + cue.id, { type: 'json' })) return waiting(true, 1); } catch (_) {}   // this turn was already answered

  try {
    let saved = deps.saved;
    if (!saved) { saved = {}; try { saved = await sun.effectiveSettings(await sun.openStore(event), a.who); } catch (_) {} }
    const said = str(await (deps.ask || defaultAsk(Object.assign({}, deps, { saved })))(systemPrompt(entry), [{ role: 'user', text: String(cue.ask || '').slice(0, 4000) }]), 400);
    if (!said) throw new Error('empty_reply');
    const buf = lower(await (deps.speak || elevenPcm)(said, voiceId, deps), pitchFor(robot, deps.robots || ROBOTS));
    if (!buf || !buf.length) throw new Error('empty_voice');
    try { await store.setJSON('fs-' + cue.id, { said }); } catch (_) {}
    await call('speaking', { cue: cue.id });
    const r = sound(buf, '', said);
    r.headers['X-Cue'] = cue.id; r.headers['X-On'] = '1';
    return r;
  } catch (e) {
    try { await store.setJSON('fs-' + cue.id, { said: '' }); } catch (_) {}
    await call('done', { cue: cue.id, said: '' });                 // the floor moves on instead of waiting 75 seconds for her
    return waiting(true, 1);
  }
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });

  const q = event.queryStringParameters || {};
  const robot = String(q.robot || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  const personas = deps.personas || PERSONAS;
  const entry = personas[robot];
  const voiceId = voiceFor(robot, deps.robots || ROBOTS);
  if (!entry || !entry.prompt || !voiceId) return json(404, { error: 'unknown_robot' });

  const fs = String(q.fireside || '');
  if (fs) return await fireside(event, deps, fs, robot, entry, voiceId, a, q);

  const pcm = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'binary');
  if (pcm.length < MIN_BYTES) return json(400, { error: 'too_short' });
  if (pcm.length > MAX_BYTES) return json(413, { error: 'too_long' });

  let store = deps.store;
  try { if (!store) store = await openStore(event); } catch (_) { return json(503, { error: 'store_unavailable' }); }

  const now = deps.now ? deps.now() : new Date();
  const day = now.toISOString().slice(0, 10);
  let used = 0;
  try { used = Number(await store.get(robot + '-day-' + day, { type: 'json' })) || 0; } catch (_) {}
  if (used >= (deps.dailyTurns || DAILY_TURNS)) return quiet('day_used', '');

  try {
    const heard = str(await (deps.listen || boxTest.listen)(pcm, deps), 400);
    if (!heard || heard.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return quiet('didnt_hear', heard);

    let history = [];
    try {
      const h = await store.get(robot + '-chat', { type: 'json' });
      if (h && Array.isArray(h.messages) && now.getTime() - Number(h.at || 0) < FORGET_MS) history = h.messages;
    } catch (_) {}
    let saved = deps.saved;
    if (!saved) { saved = {}; try { saved = await sun.effectiveSettings(await sun.openStore(event), a.who); } catch (_) {} }
    const messages = history.concat([{ role: 'user', text: heard }]).slice(-KEEP - 1);
    const said = str(await (deps.ask || defaultAsk(Object.assign({}, deps, { saved })))(systemPrompt(entry), messages), 400);
    if (!said) throw new Error('empty_reply');

    const buf = lower(await (deps.speak || elevenPcm)(said, voiceId, deps), pitchFor(robot, deps.robots || ROBOTS));
    if (!buf || !buf.length) throw new Error('empty_voice');

    try { await store.setJSON(robot + '-chat', { at: now.getTime(), messages: messages.concat([{ role: 'assistant', text: said }]).slice(-KEEP) }); } catch (_) {}
    try { await store.setJSON(robot + '-day-' + day, used + 1); } catch (_) {}      // counted only now, after the whole chain worked
    return sound(buf, heard, said);
  } catch (e) {
    return json(502, { error: 'turn_failed', detail: String((e && e.message) || e).slice(0, 80) });
  }
};

exports._test = { voiceFor, systemPrompt, SEATS, pitchFor, lower };
