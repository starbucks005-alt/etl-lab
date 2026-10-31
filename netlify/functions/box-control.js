/* box-control: the panel for the Portable Companion box, 2026-10-30. Dr. O: pick the companion for the box, and push the three buttons from an app.

   GET            (the panel) -> the companion now chosen, the list of companions, and what buttons each has. JSON.
   POST           (the panel) body {action:'set_companion', companion:'meera'}  or  {action:'press', button:'chat'|'second'|'soundscape'}
   GET ?box=1     (the box, every few seconds) -> plain text, one word per line:  companion=...  second=...  command=...
                  A pushed button is handed to the box once, then forgotten. One that nobody collected in a minute is dropped.

   The three buttons are chat, second (story, breathing, or nothing for a companion that has none) and soundscape. The same ones as the lid.
   Every call needs the header x-sun-key, the same home access code as the other box functions. With no code set it answers 503.
   GET ?screen=1  (the screen on the cover) -> plain text: companion=... and face=... It never takes a pushed button.
   The box also sends its battery voltage (?batt=millivolts) each time it asks; the panel shows it.
   Each box has a name (for example kitchen or desk), sent as ?id= from the box and the panel, so two boxes in one home can be told apart and each have her own companion. No name means 'main'.
   NOT TRIED on the live site or the board. The test runs with a stand-in store. */
const sun = require('./_sun.js');

let FILE = {};
try { FILE = require('../../rising-sun/box-lines.json'); } catch (_) {}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });
const text = (s) => ({ statusCode: 200, headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, CORS), body: s });
const BUTTONS = ['chat', 'second', 'soundscape'];
const EXPIRES_MS = 60000;
/* An estimate from the voltage of a single lithium cell: 3.3 V is nearly empty and 4.2 V is full. The real curve is not a straight line, so the panel says "about". */
function batteryPercent(mv) { return Math.max(0, Math.min(100, Math.round((mv - 3300) / 9))); }
/* Charging cannot be read directly. A lithium cell's voltage climbs while it charges and falls on battery alone, so compare the newest reading with one at least two minutes older.
   This is a guess from a trend, and the panel says so. Needs about two minutes of readings before it says anything. */
function batteryState(b, now) {
  const h = (b && b.hist) || [];
  if (!h.length) return 'unknown';
  const latest = h[h.length - 1];
  const older = h.filter((x) => latest.at - x.at >= 120000);
  if (!older.length) return latest.mv >= 4150 ? 'full' : 'unknown';
  const d = latest.mv - older[older.length - 1].mv;
  if (d >= 15) return 'charging';
  if (d <= -15) return 'discharging';
  return latest.mv >= 4150 ? 'full' : 'steady';
}
const boxName = (v) => { const n = String(v || 'main').toLowerCase().trim(); return /^[a-z0-9-]{1,20}$/.test(n) ? n : 'main'; };

/* What one companion's buttons are. The second button is a story only when story lines are written for her. */
function describe(id, c) {
  const second = c.second || null;
  let secondOut = null;
  if (second) {
    const stories = Object.keys(c.lines || {}).filter((k) => /^(hs-|story-)/.test(k)).length;
    const ready = second.kind === 'story' ? stories > 0 : !!(c.starters && c.starters[second.id]);
    secondOut = { label: second.label, kind: second.kind, id: second.id || '', ready };
  }
  return {
    id, display: c.display || id, needsHuman: !!c.needsHuman, face: c.face || '', wake: !!(c.wake && c.wake.phoneme),
    chat: true,
    soundscape: !!(c.scenes && Object.keys(c.scenes).length),
    second: secondOut,
  };
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('box_control');
}

async function openDuet(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('box_duet');
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });

  const lines = deps.lines || FILE;
  const all = lines.companions || {};
  let store = deps.store;
  try { if (!store) store = await openStore(event); } catch (_) { return json(503, { error: 'store_unavailable' }); }
  const now = deps.now ? deps.now() : Date.now();

  let body = {};
  if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); } }
  const q = event.queryStringParameters || {};
  const id = boxName(body.box || q.id);
  const key = 'state-' + id;
  let boxes = [];
  try { boxes = (await store.get('boxes', { type: 'json' })) || []; } catch (_) {}
  if (boxes.indexOf(id) < 0) { boxes.push(id); boxes.sort(); try { await store.setJSON('boxes', boxes); } catch (_) {} }

  let st = {};
  try { st = (await store.get(key, { type: 'json' })) || {}; } catch (_) {}
  if (!all[st.companion]) st.companion = 'tansy';
  if (st.wakeBy !== 'name') st.wakeBy = 'hiesp';                 // what wakes the box: the wake word Hi ESP, or the companion's own name
  if (typeof st.listen !== 'boolean') st.listen = true;        // does the box listen for its wake word
  if (st.command && now - st.command.at > EXPIRES_MS) st.command = null;

  if (event.httpMethod === 'GET' && q.screen) {      // the small screen on the cover only looks: it takes no pushed button and reports no battery
    const c = describe(st.companion, all[st.companion]);
    return text('companion=' + st.companion + '\nface=' + (c.face || '') + '\n');
  }
  if (event.httpMethod === 'GET' && q.box) {
    const mv = parseInt(q.batt, 10);
    if (mv >= 2500 && mv <= 4500) {
      const hist = (st.battery && st.battery.hist) || [];
      if (!hist.length || now - hist[hist.length - 1].at >= 60000) hist.push({ mv, at: now });   // one reading a minute, the last eight
      while (hist.length > 8) hist.shift();
      st.battery = { mv, at: now, hist };
    }
    const c = describe(st.companion, all[st.companion]);
    const command = st.command ? st.command.button : '';
    let duet = '';                       // chat mode: a number when it is this box's turn, 'wait' while the other box has it
    try {
      const ds = deps.duetStore || await openDuet(event);
      const run = await ds.get('run', { type: 'json' });
      if (run && run.active) duet = ((run.next % 2 === 0 ? run.a : run.b) === id) ? String(run.next) : 'wait';
    } catch (_) {}
    if (st.command) st.command = null;
    try { await store.setJSON(key, st); } catch (_) {}
    const second = c.second ? (c.second.kind === 'story' ? 'story' : 'starter:' + c.second.id) : 'none';
    return text('companion=' + st.companion + '\nsecond=' + second + '\ncommand=' + command + '\nface=' + (c.face || '') + '\nlisten=' + (st.listen ? 'on' : 'off') + '\nwakeby=' + st.wakeBy + '\nwakename=' + ((all[st.companion].wake || {}).name || '') + '\nwakephoneme=' + ((all[st.companion].wake || {}).phoneme || '') + '\nduet=' + duet + '\n');
  }

  if (event.httpMethod === 'GET') {
    const battery = st.battery ? { volts: Math.round(st.battery.mv / 10) / 100, percent: batteryPercent(st.battery.mv), secondsAgo: Math.round((now - st.battery.at) / 1000), state: batteryState(st.battery, now) } : null;
    return json(200, { box: id, boxes, battery, listen: st.listen, wakeBy: st.wakeBy, companion: st.companion, companions: Object.keys(all).map((id) => describe(id, all[id])), waiting: st.command ? st.command.button : '' });
  }

  if (body.action === 'set_companion') {
    const id = String(body.companion || '').toLowerCase();
    if (!all[id]) return json(404, { error: 'unknown_companion' });
    st = { companion: id, command: null, listen: st.listen, wakeBy: st.wakeBy };
    try { await store.setJSON(key, st); } catch (_) { return json(503, { error: 'store_unavailable' }); }
    return json(200, { ok: true, companion: id });
  }
  if (body.action === 'set_wake_by') {
    if (body.by !== 'name' && body.by !== 'hiesp') return json(400, { error: 'by_must_be_name_or_hiesp' });
    st.wakeBy = body.by;
    try { await store.setJSON(key, st); } catch (_) { return json(503, { error: 'store_unavailable' }); }
    return json(200, { ok: true, wakeBy: st.wakeBy });
  }
  if (body.action === 'set_listen') {
    if (typeof body.listen !== 'boolean') return json(400, { error: 'listen_must_be_true_or_false' });
    st.listen = body.listen;
    try { await store.setJSON(key, st); } catch (_) { return json(503, { error: 'store_unavailable' }); }
    return json(200, { ok: true, listen: st.listen });
  }
  if (body.action === 'press') {
    const b = String(body.button || '').toLowerCase();
    if (BUTTONS.indexOf(b) < 0) return json(400, { error: 'unknown_button' });
    const c = describe(st.companion, all[st.companion]);
    if (b === 'second' && !(c.second && c.second.ready)) return json(409, { error: c.second ? 'not_recorded_yet' : 'no_second_button' });
    if (b === 'soundscape' && !c.soundscape) return json(409, { error: 'no_soundscape' });
    st.command = { button: b, at: now };
    try { await store.setJSON(key, st); } catch (_) { return json(503, { error: 'store_unavailable' }); }
    return json(200, { ok: true, queued: b });
  }
  return json(400, { error: 'unknown_action' });
};

exports._test = { describe, batteryPercent, batteryState };
