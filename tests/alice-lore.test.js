/* alice-lore.test.js: plain node, `node tests/alice-lore.test.js`. The model and the storage are stand-ins. */
const assert = require('assert');
const al = require('../netlify/functions/alice-lore.js');
const bible = require('../netlify/functions/_alice-bible.js');
const seeds = require('../alice-fragments.json').fragments;

const fakeStore = () => { const m = {}; return { m, get: async (k) => (m[k] === undefined ? null : JSON.parse(JSON.stringify(m[k]))), setJSON: async (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
const post = (b, h) => ({ httpMethod: 'POST', headers: h || {}, body: JSON.stringify(b) });
const ids = (ph) => seeds.filter((s) => ph.includes(s.phase)).map((s) => s.id);
const text = 'She still counts the footsteps in the hallway by habit, and she is always one short, and she has stopped minding which one.';

(async () => {
  const seen = new Set();
  seeds.forEach((s) => { assert(!seen.has(s.id), 'unique'); seen.add(s.id); assert(bible.PHASES.some((p) => p.id === s.phase)); assert(bible.PERSPECTIVES[s.perspective] || s.perspective === 'colleague', 'perspective ' + s.id); assert(!/—/.test(s.text) && !/plainly/i.test(s.text), 'house rules ' + s.id); });
  assert(seeds.some((s) => s.phase === 4) && seeds.some((s) => s.phase === 5));

  // clean(): the closure conversation cannot be generated, the shape is enforced
  assert.strictEqual(al.clean({ text: 'You keep asking. We didn\'t. The project ended. That is all there is to it, and she knows it now.' }, 'memory'), null);
  assert.strictEqual(al.clean({ text: 'Too short.' }, 'memory'), null);
  assert.strictEqual(al.clean({ text: text + '\nMore.' }, 'memory'), null);
  assert(al.clean({ text: 'A: one two three four five.\nB: one two three four five six.' }, 'contradiction'));
  assert(!/—|plainly/i.test(al.clean({ text: text.replace('habit', 'habit — plainly') }, 'memory')));

  // phases open by what is collected, and closure also needs time and truth fragments
  const all = seeds;
  const mk = (n, ph) => new Set(all.filter((s) => ph.includes(s.phase)).slice(0, n).map((s) => s.id));
  assert.strictEqual(al.maxPhase(new Set(), all, 0), 0);
  assert.strictEqual(al.maxPhase(mk(4, [0]), all, 0), 1);
  assert.strictEqual(al.maxPhase(mk(9, [0, 1]), all, 0), 2);
  assert.strictEqual(al.maxPhase(mk(15, [0, 1, 2]), all, 0), 3);
  assert.strictEqual(al.maxPhase(new Set(all.filter((s) => s.phase <= 3).map((s) => s.id)), all, 10), 3, 'not enough days');
  const many = new Set(all.filter((s) => s.phase <= 3).map((s) => s.id));
  for (let i = 0; i < 6; i++) many.add('g-fake' + i);
  assert.strictEqual(al.maxPhase(many, all, 90), 4, 'thirty, five truth, sixty days');
  const closed = new Set([...many, 'a-x-conversation']);
  assert.strictEqual(al.maxPhase(closed, all, 90), 5);

  // a first-time visitor only ever hears the silence
  const store = fakeStore();
  for (let i = 0; i < 12; i++) {
    const r = await al.run(post({ seen: [], days: 0 }), { store, random: () => i / 12 });
    const b = JSON.parse(r.body);
    assert(b.fragment.phase === 0, 'first visit is the silence');
  }
  // a visitor who has everything earned gets a new one written, and it is kept and capped
  let calls = 0;
  const azureChat = async () => { calls++; return JSON.stringify({ text }); };
  let r;
  const nothingLeft = ids([0]);
  r = await al.run(post({ seen: nothingLeft.concat(ids([1]).slice(0, 0)), days: 0 }), { store: fakeStore(), azureChat, random: () => 0.9 });
  // with phase 0 all collected (7 of 9 needed for phase 2) phase 1 is earned (4+), so a stored phase 1 comes first
  assert(JSON.parse(r.body).fragment.phase <= 1);
  r = await al.run(post({ seen: ids([0, 1, 2, 3]), days: 0 }), { store, azureChat, random: () => 0.1 });
  const b = JSON.parse(r.body);
  assert(b.fresh && b.fragment.id.startsWith('g-') && b.fragment.phase <= 3, 'a new fragment is written');
  assert.strictEqual(calls, 1);
  const cap = fakeStore(); cap.m['count-' + new Date().toISOString().slice(0, 10)] = { n: 40 };
  calls = 0;
  r = await al.run(post({ seen: ids([0, 1, 2, 3]), days: 0 }), { store: cap, azureChat });
  assert.strictEqual(JSON.parse(r.body).all_collected, true);
  assert.strictEqual(calls, 0);

  // review needs the owner
  r = await al.run(post({ action: 'review' }), { store });
  assert.strictEqual(r.statusCode, 401);
  r = await al.run(post({ action: 'review' }, { authorization: 'Bearer yes' }), { store, isOwner: (t) => t === 'yes' });
  assert(JSON.parse(r.body).fragments.length >= seeds.length);
  console.log('alice-lore tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
