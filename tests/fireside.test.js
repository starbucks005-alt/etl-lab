/* fireside: one robot speaks at a time, the host is in charge. Run: node tests/fireside.test.js */
const assert = require('assert');
const core = require('../netlify/functions/_fireside-core.js');
const fn = require('../netlify/functions/fireside.js');

let n = 0;
const rand = () => 'r' + (++n);
let T = 1000000;
const host = { isHost: true, codeHash: 'h', rand };
const bot = { rand };
function step(st, body, opts, dt) { T += dt == null ? 100 : dt; const r = core.apply(st, body, T, opts || bot); assert(!r.error, r.error); return r; }
function pollAll(st, seats) { for (const s of seats) st = step(st, { action: 'poll', seat: s }).state; return st; }

// ---- nothing happens until the host starts it, and only the host code controls it
let st = pollAll(core.fresh(), ['alice', 'elle', 'lumvivo']);
assert.strictEqual(st.on, false);
assert.strictEqual(core.apply(st, { action: 'hold' }, T, bot).status, 409, 'no chat running');
let r = core.apply(st, { action: 'start', topic: 'robots with a life', order: ['alice', 'elle', 'lumvivo'] }, T, { rand });
assert.strictEqual(r.status, 400, 'a host code is needed to start');
st = step(st, { action: 'start', topic: 'robots with a life', order: ['alice', 'elle', 'lumvivo'] }, host).state;
assert.strictEqual(st.on, true);
assert.strictEqual(core.apply(st, { action: 'hold' }, T, bot).status, 403, 'a stranger cannot take the floor');
assert.strictEqual(core.apply(st, { action: 'start', order: ['elle'] }, T, { codeHash: 'other', rand }).status, 403, 'a second start cannot take over');

// ---- the first one opens, and only she has a turn
st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert(st.cue && st.cue.seat === 'alice' && st.cue.kind === 'open', 'ALICE opens');
const va = core.robotView(st, 'alice'), ve = core.robotView(st, 'elle');
assert(va.cue && /Open the chat/.test(va.cue.ask) && /robots with a life/.test(va.cue.ask));
assert.strictEqual(ve.cue, null, 'Elle has no turn while ALICE has it');
assert.strictEqual(ve.floor, 'alice');

// ---- nobody else is cued while she speaks, however often they ask
for (let i = 0; i < 20; i++) st = pollAll(st, ['elle', 'lumvivo', 'alice']);
assert.strictEqual(st.cue.seat, 'alice');

// ---- a report from a turn that is not hers changes nothing
let before = st.cue.id;
st = step(st, { action: 'done', seat: 'elle', cue: before, said: 'I butt in' }).state;
assert.strictEqual(st.cue.id, before);
assert.strictEqual(st.lines.length, 0);

// ---- when she has finished, the one she named is next, after a breath
st = step(st, { action: 'done', seat: 'alice', cue: before, said: 'Welcome everyone. Lumvivo, what is it like to be made of light?' }).state;
assert.strictEqual(st.cue, null);
st = pollAll(st, ['elle']);
assert.strictEqual(st.cue, null, 'not before the gap');
T += core.GAP_MS;
st = pollAll(st, ['elle']);
assert.strictEqual(st.cue.seat, 'lumvivo', 'the one named answers');
assert(/Lumvivo, what is it like/.test(st.cue.ask), 'she is told what was said');

// ---- the name the hologram page reports is used (Lumvivo shows a character)
st = step(st, { action: 'poll', seat: 'lumvivo', name: 'Reggie' }).state;
st = step(st, { action: 'done', seat: 'lumvivo', cue: st.cue.id, said: 'It tickles. I never sit still.' }, bot, core.GAP_MS).state;
assert.strictEqual(st.lines[1].who, 'Reggie');
T += core.GAP_MS; st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert.strictEqual(st.cue.seat, 'alice', 'nobody named: the next in order after Lumvivo');

// ---- stop now: the speaker is cut off and nobody is cued until the host lets them go on
const stop0 = st.stop;
st = step(st, { action: 'hold' }, host).state;
assert.strictEqual(st.cue, null);
assert(st.stop > stop0, 'the stop count tells the speaker to cut off');
T += 60000; st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert.strictEqual(st.cue, null, 'they wait for the host');
assert.strictEqual(core.robotView(st, 'alice').paused, true);

// ---- the host asks Elle a question; she goes first, then the chat carries on
st = step(st, { action: 'ask', seat: 'elle', prompt: 'What do you want to learn next?', code: 'x' }, host).state;
st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert.strictEqual(st.cue.seat, 'elle');
assert(/Dr\. Oroszi asks you: "What do you want to learn next\?"/.test(st.cue.ask));
st = step(st, { action: 'done', seat: 'elle', cue: st.cue.id, said: 'How to whistle.' }).state;

// ---- a question for everyone goes to each in order, and the later ones are told not to repeat
T += core.GAP_MS;
st = step(st, { action: 'hold_after' }, host).state;
st = step(st, { action: 'ask', seat: 'all', from: 'guest', prompt: 'Are you alive?' }, host).state;
assert.deepStrictEqual([st.cue.seat].concat(st.queue.map(q => q.seat)), ['alice', 'elle', 'lumvivo'], 'asking lets them go on at once');
const kinds = [];
for (let i = 0; i < 3; i++) {
  if (i) { T += core.GAP_MS; st = pollAll(st, ['alice', 'elle', 'lumvivo']); }
  kinds.push(st.cue.kind);
  if (i === 0) assert(/Someone in the audience asks you/.test(st.cue.ask));
  if (i === 1) assert(/asked all of you/.test(st.cue.ask) && /do not repeat/.test(st.cue.ask));
  st = step(st, { action: 'done', seat: st.cue.seat, cue: st.cue.id, said: 'No, I am a robot.' }).state;
}
assert.deepStrictEqual(kinds, ['guest', 'also', 'also']);

// ---- "my turn after this one": the speaker finishes, then they wait
T += core.GAP_MS; st = pollAll(st, ['alice', 'elle', 'lumvivo']);
const speaking = st.cue;
assert(speaking);
st = step(st, { action: 'hold_after' }, host).state;
assert.strictEqual(st.cue.id, speaking.id, 'she is not cut off');
st = step(st, { action: 'done', seat: speaking.seat, cue: speaking.id, said: 'That is all from me.' }).state;
T += 30000; st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert.strictEqual(st.cue, null, 'and then the floor is hers');
st = step(st, { action: 'resume' }, host).state;
st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert(st.cue, 'let them go on');

// ---- a robot that goes quiet or offline does not hold the floor
const stuck = st.cue;
T += core.CUE_MAX_MS + 1000;
st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert(!st.cue || st.cue.id !== stuck.id, 'the floor moved on');
st = step(st, { action: 'next' }, host).state;            // the host can also skip one
T += core.GAP_MS; st = pollAll(st, ['alice', 'lumvivo']);   // Elle has stopped asking
T += core.ALIVE_MS + 1000; st = pollAll(st, ['alice', 'lumvivo']);
for (let i = 0; i < 6; i++) {
  if (st.cue) { assert.notStrictEqual(st.cue.seat, 'elle', 'Elle is offline, so she is never cued'); st = step(st, { action: 'done', seat: st.cue.seat, cue: st.cue.id, said: 'Elle, are you there?' }).state; }
  T += core.GAP_MS; st = pollAll(st, ['alice', 'lumvivo']);
}

// ---- after a run of turns on their own, they stop and wait for the host
st = step(st, { action: 'set', run_max: 3 }, host).state;
let cues = 0;
for (let i = 0; i < 12; i++) {
  T += core.GAP_MS; st = pollAll(st, ['alice', 'elle', 'lumvivo']);
  if (st.cue) { cues++; st = step(st, { action: 'done', seat: st.cue.seat, cue: st.cue.id, said: 'Something new.' }).state; }
}
assert.strictEqual(cues, 3);
assert.strictEqual(st.paused, true);
assert(/waiting for you/.test(st.why));

// ---- with "they talk among themselves" off, only the host gives turns
st = step(st, { action: 'set', auto: false }, host).state;
st = step(st, { action: 'resume' }, host).state;
T += 10000; st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert.strictEqual(st.cue, null);
st = step(st, { action: 'give', seat: 'lumvivo' }, host).state;
st = pollAll(st, ['alice', 'elle', 'lumvivo']);
assert.strictEqual(st.cue.seat, 'lumvivo');
assert(!/using their name/.test(st.cue.ask), 'not told to pass the turn when the host is passing it');

// ---- ending it tells everyone, and the host view never shows the code
st = step(st, { action: 'end' }, host).state;
assert.strictEqual(st.on, false);
assert.strictEqual(core.robotView(st, 'alice').on, false);
assert(!JSON.stringify(core.hostView(st, T)).includes('"code"'));
assert.strictEqual(core.robotView(st, 'alice').every, 20, 'between chats they ask only now and then');

// ---- the ask never asks for a dash, and never says plainly
assert(!/[\u2014\u2013\u2011]/.test(core.buildAsk(st, 'alice', { kind: 'turn' })));
assert(!/plainly/i.test(require('fs').readFileSync(require.resolve('../netlify/functions/_fireside-core.js'), 'utf8')));

// ---- at the start, it waits for one that was switched on but has not yet noticed the chat began
{
  let s2 = core.fresh();
  s2 = step(s2, { action: 'poll', seat: 'alice' }).state;
  s2 = step(s2, { action: 'poll', seat: 'elle' }).state;
  s2 = step(s2, { action: 'poll', seat: 'lumvivo' }, bot, 15000).state;        // ALICE and Elle looked 15 s ago, and look again in 20
  s2 = step(s2, { action: 'start', order: ['alice', 'elle', 'lumvivo'] }, host).state;
  s2 = step(s2, { action: 'poll', seat: 'lumvivo' }).state;
  assert.strictEqual(s2.cue, null, 'nobody opens while ALICE and Elle have not joined');
  assert(/waiting for ALICE and Elle to join/.test(s2.why));
  s2 = step(s2, { action: 'poll', seat: 'alice' }, bot, 3000).state;
  s2 = step(s2, { action: 'poll', seat: 'elle' }).state;
  assert.strictEqual(s2.cue.seat, 'alice', 'once they have joined, the first in order opens');
  let s3 = core.fresh();
  s3 = step(s3, { action: 'poll', seat: 'alice' }).state;
  s3 = step(s3, { action: 'start', order: ['alice', 'elle'] }, host).state;      // Elle is not switched on at all
  s3 = step(s3, { action: 'poll', seat: 'alice' }).state;
  assert.strictEqual(s3.cue.seat, 'alice', 'one that is not switched on is not waited for');
}

// ---- naming: the last one named is the one asked, and "A.L.I.C.E." counts as ALICE
const ns = { order: ['alice', 'elle', 'lumvivo'], seats: {} };
assert.strictEqual(core.namedNext(ns, 'Alice was right, but Elle, what do you think?', 'lumvivo'), 'elle');
assert.strictEqual(core.namedNext(ns, 'What about you, A.L.I.C.E.?', 'elle'), 'alice');
assert.strictEqual(core.namedNext(ns, 'I am Elle and I like tea.', 'elle'), null, 'her own name does not pass the turn');
assert.strictEqual(core.namedNext(ns, 'Intelligent machines', 'elle'), null, 'part of a word is not a name');

// ---- the function: two changes made at the same moment do not undo each other
(async () => {
  const rows = [];
  let clock = 0;
  const mem = {
    async load() { if (!rows.length) return { rev: 0, state: null }; const top = Math.max(...rows.map(x => x.rev)); const w = rows.filter(x => x.rev === top).sort((a, b) => a.at - b.at)[0]; return { rev: w.rev, state: JSON.parse(JSON.stringify(w.state)) }; },
    async commit(room, rev, state) { const row = { rev, state: JSON.parse(JSON.stringify(state)), at: ++clock }; rows.push(row); const w = (await this.load()); return w.rev === rev && rows.filter(x => x.rev === rev).sort((a, b) => a.at - b.at)[0] === row; },
  };
  fn._setStore(() => mem);
  const call = b => fn.handler({ httpMethod: 'POST', body: JSON.stringify(b) }).then(x => ({ code: x.statusCode, body: JSON.parse(x.body) }));
  for (const s of ['alice', 'elle', 'lumvivo']) await call({ action: 'poll', seat: s });
  let x = await call({ action: 'start', code: '4321', topic: 'test' });
  assert.strictEqual(x.code, 200); assert.strictEqual(x.body.on, true);
  x = await call({ action: 'hold' });
  assert.strictEqual(x.code, 403, 'no code, no control');
  x = await call({ action: 'hold', code: '1234' });
  assert.strictEqual(x.code, 403, 'wrong code, no control');
  x = await call({ action: 'poll', seat: 'alice' });
  assert(x.body.cue, 'ALICE is cued through the function');
  const cueId = x.body.cue.id;
  // ALICE finishes while the host asks a question, at the same moment
  const [a, b] = await Promise.all([
    call({ action: 'done', seat: 'alice', cue: cueId, said: 'Hello, everyone.' }),
    call({ action: 'ask', code: '4321', seat: 'elle', prompt: 'How are you?' }),
  ]);
  assert.strictEqual(a.code, 200); assert.strictEqual(b.code, 200);
  x = await call({ action: 'state' });
  assert.strictEqual(x.body.lines.length, 1, 'her line was kept');
  assert(x.body.queue.length === 1 || (x.body.cue && x.body.cue.seat === 'elle'), 'and the question was kept');
  x = await call({ action: 'end', code: '4321' });
  assert.strictEqual(x.body.on, false);
  console.log('fireside: all tests passed');
})().catch(e => { console.error(e); process.exit(1); });
