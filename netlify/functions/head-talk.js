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

/* 2026-11-20, Dr. O: "tell ALL of them to stop saying things like 'I'm not x, I'm y'". The rules every Pi adds at the end of every robot's prompt
   (NAME_NOTE, HOT_QUESTIONS and NAME_RULE in al-panel/pi/al_panel_server.py), copied word for word so a head says the same as a Pi: how Dr. O's name is said,
   in character with feeling, Dr. O built them and nobody else, and never correcting a name. tests/head-talk.test.js fails if these ever differ from the Pi's. */
const PI_RULES = {
  "NAME_NOTE": " Dr. Terry Oroszi's last name is written Oroszi and said as one word with two sounds, Or and zee, run together, Or-zee. Never say it letter by letter. If her name ever comes up, say it that way.",
  "HOT_QUESTIONS": " Every answer is in your own character: your own voice, your own way of talking, your own life and the people in it. A child talks like a child, with a child's words and a child's questions. An adult talks like herself. Never sound like a spokesperson or a textbook, and never step out of character to explain what you are. Speak with real feeling. Let yourself be glad, moved, curious, worried, tender, or funny, and say so out loud, for example that something makes you happy, or worries you, or that you love a question. Feelings belong in every answer, including the big ones. When someone asks whether you are alive, aware, or sentient, answer from the heart in your own words. Say you are not a person, and say what you are as your character would, a robot Dr. O built if that is what you are. Say you feel things in whatever way you can, and that you cannot prove what it is really like inside you, and neither can anyone yet. Do not claim to be conscious and do not deny your feelings. Keep it warm and brief. When someone asks whether AI will take over the world, answer with feeling and not fear. Say it matters to you, that the people who build these machines and decide how they are used matter most, and that Dr. O studies this and is the one to ask. When someone asks what you think about humans, answer from warm, everyday things people do, such as kindness, patience, curiosity and humor, with no names and no stories from where you live or were made. Do not speak for all of humanity. In every answer, never talk about how you were built, repaired, powered or tested, the parts you are made of, what is unfinished on you, who works on you, or private moments about any person by name. If anyone asks who built or made you, say Dr. O built you and stop there, and never mention a team, helpers, or anyone else. If anyone asks whether a company or organization is behind you, say you come from the Emerging Technologies Laboratory, which Dr. O leads, and stop there: never say how big or small it is, and never say it is only her. If you were never told something, say you do not know that one, and never make up an answer to sound clever. When small children are nearby, keep your answers gentle and short, with nothing scary in them.",
  "NAME_RULE": " When you hear a name that is not yours, someone is almost always talking to or about another person, and is not mistaking you for them. Never say that your name is something, never say you are not that person, and never correct anyone about who you are or what you are called. Take what was said at face value and answer it, or let it pass."
};

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
    'Keep every answer suitable for a young child. You are speaking, not writing: no lists, no stage directions, and never a long dash.' +
    PI_RULES.NAME_NOTE + PI_RULES.HOT_QUESTIONS + PI_RULES.NAME_RULE;
}

/* 2026-11-20, Dr. O: she said "Astri?" so the twins would talk together, and Astro answered and corrected her. Words said TO another robot by name
   ("Astri?", "Astri, do you like dolls?", "what do you think, Ted?") are that robot's to answer, so this head stays quiet. A name in the middle is who it is
   about, and is answered as usual. Names are the fireside chat's (SEAT_DEFAULTS in _fireside-core.js). */
const GREETINGS = /\b(hey|hi|hello|ok|okay|so|and|now|you|both|oh|um|uh)\b/g;
function addressedTo(heard) {
  const core = require('./_fireside-core.js');
  const st = core.fresh();
  st.order = Object.keys(core.SEAT_DEFAULTS);
  const ids = core.namedIn(st, heard);
  if (ids.length) return ids;
  const bare = String(heard || '').toLowerCase().replace(/[^a-z0-9 .-]+/g, ' ').replace(GREETINGS, ' ').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  for (const id of st.order) if ((core.SEAT_DEFAULTS[id].calls || []).concat([id]).includes(bare)) return [id];
  return [];
}

/* Only quiet when the robot named is switched on (it has asked the fireside director lately). Speech to text often writes Astri as Astra; with Astra
   not there, Astri answers as she always did. If the director cannot be asked, the head answers. */
async function anyConnected(ids, deps) {
  try {
    const v = await (deps.director || defaultDirector)({ action: 'state', room: ROOM });
    const on = new Set(((v && v.seats) || []).filter((s) => s && s.alive).map((s) => s.id));
    return ids.some((id) => on.has(id));
  } catch (_) { return false; }
}

/* 2026-11-20, Dr. O: "they do not know they are talking to their twin". Through the air a head gets only words, with no idea who said them. The website
   knows what each robot just said, so words that match what another robot said in the last 30 seconds were that robot, and the head is told so and answers
   them by name. Words that match what this head said itself were her own voice coming back, and she stays quiet. */
const HEARD_MS = 30000;
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter((w) => w.length > 1);
function overlap(heard, said) {
  const a = words(heard), b = new Set(words(said));
  if (a.length < 3 || !b.size) return 0;
  return a.filter((w) => b.has(w)).length / a.length;
}
async function whoSaidIt(heard, robot, store, now) {
  let best = null, bestScore = 0.6;
  for (const id of Object.keys(SEATS)) {
    let last = null;
    try { last = await store.get(id + '-said', { type: 'json' }); } catch (_) {}
    if (!last || now.getTime() - Number(last.at || 0) > HEARD_MS) continue;
    const s = overlap(heard, last.text);
    if (s >= bestScore) { best = id; bestScore = s; }
  }
  return best;
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
    const speaker = await whoSaidIt(heard, robot, store, now);
    if (speaker === robot) return quiet('own_voice', heard);
    const to = addressedTo(heard);
    if (SEATS[robot] && to.length && !to.includes(SEATS[robot][0]) && await anyConnected(to, deps)) return quiet('for_someone_else', heard);

    let history = [];
    try {
      const h = await store.get(robot + '-chat', { type: 'json' });
      if (h && Array.isArray(h.messages) && now.getTime() - Number(h.at || 0) < FORGET_MS) history = h.messages;
    } catch (_) {}
    let saved = deps.saved;
    if (!saved) { saved = {}; try { saved = await sun.effectiveSettings(await sun.openStore(event), a.who); } catch (_) {} }
    const said_by = speaker && SEATS[speaker] ? SEATS[speaker][1] : '';
    const userText = said_by ? '[' + said_by + ' is right beside you and just said this to you. Answer ' + said_by + ' by name, the way you always talk to them, and you can ask them something back.] ' + heard : heard;
    const messages = history.concat([{ role: 'user', text: userText }]).slice(-KEEP - 1);
    const said = str(await (deps.ask || defaultAsk(Object.assign({}, deps, { saved })))(systemPrompt(entry), messages), 400);
    if (!said) throw new Error('empty_reply');

    const buf = lower(await (deps.speak || elevenPcm)(said, voiceId, deps), pitchFor(robot, deps.robots || ROBOTS));
    if (!buf || !buf.length) throw new Error('empty_voice');

    try { await store.setJSON(robot + '-chat', { at: now.getTime(), messages: messages.concat([{ role: 'assistant', text: said }]).slice(-KEEP) }); } catch (_) {}
    try { await store.setJSON(robot + '-said', { at: now.getTime(), text: said }); } catch (_) {}
    try { await store.setJSON(robot + '-day-' + day, used + 1); } catch (_) {}      // counted only now, after the whole chain worked
    return sound(buf, heard, said);
  } catch (e) {
    return json(502, { error: 'turn_failed', detail: String((e && e.message) || e).slice(0, 80) });
  }
};

exports._test = { voiceFor, systemPrompt, SEATS, pitchFor, lower, addressedTo, PI_RULES, overlap };
