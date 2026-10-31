/* box-duet: "chat mode" for two Portable Companion boxes, 2026-10-31. Dr. O: two boxes so she can show people how the companions talk to each other.

   The website runs the conversation. Whose turn it is alternates, starting with box a. A box asks for its turn, gets that companion's next line as sound, plays it, then says done.
   The other box's turn opens only after that. Each line is written for the speaker from the companion's written life (the same words box-talk uses), as a reply to the line before.

   POST (the panel) {action:'start', a:'desk', b:'kitchen', topic?:'...', turns?:8}   {action:'stop'}
   GET  (the panel) -> the state, JSON
   GET  ?id=<box>&turn=<n>  (a box) -> its line as raw sound (audio/L16; rate=16000; channels=1) with X-Said, or 204 when it is not that box's turn
   POST (a box) {action:'done', id, turn}

   At most MAX_TURNS lines in a run and DAY_LINES lines a day, so a demo cannot run up a bill. A line that cannot be made ends the run.
   Every call needs the header x-sun-key, the same home access code as the other box functions. NOT TRIED against the real services or on the boxes. The test runs with stand-ins. */
const crypto = require('crypto');
const sun = require('./_sun.js');
const talk = require('./box-talk.js');
const { elevenPcm } = require('./box-line.js');

let FILE = {};
try { FILE = require('../../rising-sun/box-lines.json'); } catch (_) {}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });
const MAX_TURNS = 20, DEFAULT_TURNS = 8, DAY_LINES = 80;
const boxName = (v) => { const n = String(v || '').toLowerCase().trim(); return /^[a-z0-9-]{1,20}$/.test(n) ? n : ''; };
const speakerOf = (run, n) => (n % 2 === 0 ? run.a : run.b);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[–—]/g, ',').trim().slice(0, max) : '');

async function open(event, name) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore(name);
}

function duetRules(otherName, topic) {
  return ' RIGHT NOW you are talking with ' + otherName + ', who is in a second small box on the same table, while people watch and listen. ' +
    'Say one or two short spoken sentences to ' + otherName + ', picking up what they just said or something of your own. ' +
    'Do not speak to the people watching, do not narrate or describe what anyone is doing, and give no stage directions: what you write is read aloud as it stands. ' +
    'Do not repeat a line you used earlier. ' + (topic ? 'The people watching asked the two of you to talk about: ' + topic + '. ' : '');
}

/* The conversation so far, from the speaker's side: the other's lines are what she hears, her own are what she said. It must start with a hearing turn. */
function messagesFor(run, speaker) {
  const out = [];
  for (const t of run.turns) out.push({ role: t.by === speaker ? 'assistant' : 'user', text: t.text });
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', text: out.length ? '(the talk begins)' : (run.topic ? 'Begin. Talk about: ' + run.topic : 'Begin the conversation.') });
  return out;
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });

  const lines = deps.lines || FILE;
  const all = lines.companions || {};
  let store = deps.store, ctl = deps.controlStore;
  try { if (!store) store = await open(event, 'box_duet'); if (!ctl) ctl = await open(event, 'box_control'); } catch (_) { return json(503, { error: 'store_unavailable' }); }
  const now = deps.now ? deps.now() : Date.now();
  const day = new Date(now).toISOString().slice(0, 10);

  let run = null;
  try { run = await store.get('run', { type: 'json' }); } catch (_) {}
  const save = async () => { try { await store.setJSON('run', run); } catch (_) {} };
  const companionOf = async (id) => { let st = null; try { st = await ctl.get('state-' + id, { type: 'json' }); } catch (_) {} return st && all[st.companion] ? st.companion : 'tansy'; };

  const q = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); } }

  // a box asks for its line
  if (event.httpMethod === 'GET' && q.id && q.turn !== undefined) {
    const id = boxName(q.id), n = parseInt(q.turn, 10);
    if (!run || !run.active || n !== run.next || speakerOf(run, n) !== id) return { statusCode: 204, headers: CORS, body: '' };
    const key = 'pcm-' + run.id + '-' + n;
    try {
      const kept = await store.get(key, { type: 'arrayBuffer' });
      if (kept && kept.byteLength) return sound(Buffer.from(kept), (run.turns[n] || {}).text || '');
    } catch (_) {}
    let used = 0;
    try { used = Number(await store.get('day-' + day, { type: 'json' })) || 0; } catch (_) {}
    if (used >= (deps.dayLines !== undefined ? deps.dayLines : DAY_LINES)) { run.active = false; run.ended = 'day_limit'; await save(); return json(429, { error: 'day_limit' }); }
    try {
      const me = await companionOf(id), other = await companionOf(id === run.a ? run.b : run.a);
      const entry = all[me] || {};
      const life = deps.life ? deps.life[me] : talk._test.writtenLife(me, entry.rosterName);
      if (!life || !entry.voiceId) throw new Error('unknown_companion');
      const otherName = (all[other] && all[other].display) || other;
      let saved = deps.saved;
      if (!saved) { saved = {}; try { saved = await sun.effectiveSettings(await sun.openStore(event), a.who); } catch (_) {} }
      const ask = deps.ask || talk.defaultAsk(Object.assign({}, deps, { saved }));
      const said = clean(await ask(talk._test.systemPrompt(life, entry.role) + duetRules(otherName, run.topic), messagesFor(run, id)), 400);
      if (!said) throw new Error('empty_reply');
      const buf = await (deps.speak || elevenPcm)(said, entry.voiceId, deps);
      if (!buf || !buf.length) throw new Error('empty_voice');
      run.turns[n] = { n, by: id, text: said };
      await save();
      try { await store.set(key, buf); await store.setJSON('day-' + day, used + 1); } catch (_) {}
      return sound(buf, said);
    } catch (e) {
      run.active = false; run.ended = 'failed: ' + String((e && e.message) || e).slice(0, 60); await save();
      return json(502, { error: 'turn_failed', detail: run.ended });
    }
  }

  if (event.httpMethod === 'GET') return json(200, { run: run ? { active: run.active, a: run.a, b: run.b, topic: run.topic, next: run.next, max: run.max, ended: run.ended || '', lines: run.turns.filter(Boolean).map((t) => ({ by: t.by, text: t.text })) } : null });

  if (body.action === 'start') {
    const A = boxName(body.a), B = boxName(body.b);
    if (!A || !B || A === B) return json(400, { error: 'two_different_boxes' });
    const max = Math.max(2, Math.min(MAX_TURNS, parseInt(body.turns, 10) || DEFAULT_TURNS));
    run = { id: crypto.randomBytes(6).toString('hex'), active: true, a: A, b: B, topic: clean(body.topic, 200), max, next: 0, turns: [] };
    await save();
    return json(200, { ok: true, max });
  }
  if (body.action === 'stop') { if (run) { run.active = false; run.ended = 'stopped'; await save(); } return json(200, { ok: true }); }
  if (body.action === 'done') {
    const id = boxName(body.id), n = parseInt(body.turn, 10);
    if (!run || !run.active || n !== run.next || speakerOf(run, n) !== id) return json(409, { error: 'not_your_turn' });
    run.next = n + 1;
    if (run.next >= run.max) { run.active = false; run.ended = 'finished'; }
    await save();
    return json(200, { ok: true, next: run.next, active: run.active });
  }
  return json(400, { error: 'unknown_action' });
};

function sound(buf, said) {
  return {
    statusCode: 200,
    headers: Object.assign({ 'Content-Type': 'audio/L16; rate=16000; channels=1', 'Cache-Control': 'no-store', 'X-Said': encodeURIComponent(said || '') }, CORS),
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
}

exports._test = { messagesFor, speakerOf };
