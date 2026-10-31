const assert = require('assert');
const { handler, _test } = require('../netlify/functions/box-duet.js');
const control = require('../netlify/functions/box-control.js').handler;
const gc = require('../netlify/functions/_gc-config.js');

(async () => {
  const KEY = 'box-test-key-123';
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const mem = () => { const m = new Map(); return { _m: m, get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
  const lines = { companions: {
    tansy: { display: 'Tansy', voiceId: 'tansyvoice00000000000', role: 'a fairy', lines: {}, scenes: {} },
    meera: { display: 'Meera', voiceId: 'meeravoice00000000000', role: 'a yoga teacher', rosterName: 'Meera Kapoor', lines: {}, scenes: {} } } };
  const store = mem(), controlStore = mem();
  await controlStore.setJSON('state-desk', { companion: 'tansy' });
  await controlStore.setJSON('state-kitchen', { companion: 'meera' });
  const heard = [], spoken = [];
  const life = { tansy: { name: 'Tansy', tagline: 't', bio: 'b', interests: [], fairy: true }, meera: { name: 'Meera', tagline: 't', bio: 'b', interests: [], fairy: false, background: '' } };
  let t = 1000;
  const d = { env: {}, loadCfg: cfg, lines, store, controlStore, duetStore: store, life, saved: {}, now: () => t,
    ask: async (sys, msgs) => { heard.push({ sys, msgs }); return 'Line number ' + heard.length + '.'; },
    speak: async (text, voice) => { spoken.push([text, voice]); return Buffer.from([1, 2, 3, 4]); } };
  const ev = (method, key, q, body) => ({ httpMethod: method, headers: key ? { 'x-sun-key': key } : {}, queryStringParameters: q || {}, body: body ? JSON.stringify(body) : '' });

  // closed without the code
  assert.strictEqual((await handler(ev('GET', 'nope'), d)).statusCode, 401);
  // two different boxes are needed
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'start', a: 'desk', b: 'desk' }), d)).statusCode, 400);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'start', a: 'desk', b: 'kitchen', topic: 'the garden', turns: 4 }), d)).statusCode, 200);

  // the boxes are told whose turn it is
  const ask = async (id) => (await control(ev('GET', KEY, { box: '1', id }), Object.assign({}, d, { store: controlStore }))).body;
  assert.ok((await ask('desk')).includes('duet=0\n'));
  assert.ok((await ask('kitchen')).includes('duet=wait\n'));

  // the other box gets nothing out of turn
  assert.strictEqual((await handler(ev('GET', KEY, { id: 'kitchen', turn: '0' }), d)).statusCode, 204);
  assert.strictEqual((await handler(ev('GET', KEY, { id: 'desk', turn: '1' }), d)).statusCode, 204);

  // turn 0: desk's companion speaks in her own voice, with the topic and the other's name in her instructions
  const r0 = await handler(ev('GET', KEY, { id: 'desk', turn: '0' }), d);
  assert.strictEqual(r0.statusCode, 200);
  assert.strictEqual(decodeURIComponent(r0.headers['X-Said']), 'Line number 1.');
  assert.strictEqual(spoken[0][1], 'tansyvoice00000000000');
  assert.ok(/Meera/.test(heard[0].sys) && /the garden/.test(heard[0].sys), 'she is told who she is talking with and the topic');
  assert.ok(!/[–—]/.test(heard[0].sys), 'no long dashes in what she is told');
  // asking again for the same turn gives the kept line, nothing new is made
  await handler(ev('GET', KEY, { id: 'desk', turn: '0' }), d);
  assert.strictEqual(spoken.length, 1);

  // the next turn opens only after done, and only from the right box
  assert.strictEqual((await handler(ev('GET', KEY, { id: 'kitchen', turn: '1' }), d)).statusCode, 204);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'done', id: 'kitchen', turn: 0 }), d)).statusCode, 409);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'done', id: 'desk', turn: 0 }), d)).statusCode, 200);
  const r1 = await handler(ev('GET', KEY, { id: 'kitchen', turn: '1' }), d);
  assert.strictEqual(r1.statusCode, 200);
  assert.strictEqual(spoken[1][1], 'meeravoice00000000000');
  // she hears the other's line as what was said to her
  assert.deepStrictEqual(heard[1].msgs.map((m) => m.role), ['user']);
  assert.strictEqual(heard[1].msgs[0].text, 'Line number 1.');
  assert.ok(!/fairy/.test(heard[1].sys), 'Meera is not told she is a fairy');

  // back to desk: her own line is what she said, and the history starts with something heard
  await handler(ev('POST', KEY, {}, { action: 'done', id: 'kitchen', turn: 1 }), d);
  await handler(ev('GET', KEY, { id: 'desk', turn: '2' }), d);
  assert.deepStrictEqual(heard[2].msgs.map((m) => m.role), ['user', 'assistant', 'user']);

  // the run ends by itself at the turn limit and the boxes stop being told
  await handler(ev('POST', KEY, {}, { action: 'done', id: 'desk', turn: 2 }), d);
  await handler(ev('GET', KEY, { id: 'kitchen', turn: '3' }), d);
  const fin = await handler(ev('POST', KEY, {}, { action: 'done', id: 'kitchen', turn: 3 }), d);
  assert.strictEqual(JSON.parse(fin.body).active, false);
  assert.ok((await ask('desk')).includes('duet=\n'));
  const st = JSON.parse((await handler(ev('GET', KEY), d)).body).run;
  assert.strictEqual(st.ended, 'finished'); assert.strictEqual(st.lines.length, 4);

  // stop works, and a failed line ends the run instead of leaving it stuck
  await handler(ev('POST', KEY, {}, { action: 'start', a: 'desk', b: 'kitchen' }), d);
  const bad = await handler(ev('GET', KEY, { id: 'desk', turn: '0' }), Object.assign({}, d, { speak: async () => { throw new Error('eleven_401'); } }));
  assert.strictEqual(bad.statusCode, 502);
  assert.ok((await ask('desk')).includes('duet=\n'));
  await handler(ev('POST', KEY, {}, { action: 'start', a: 'desk', b: 'kitchen' }), d);
  await handler(ev('POST', KEY, {}, { action: 'stop' }), d);
  assert.ok((await ask('desk')).includes('duet=\n'));

  // the daily limit
  await handler(ev('POST', KEY, {}, { action: 'start', a: 'desk', b: 'kitchen' }), d);
  const lim = await handler(ev('GET', KEY, { id: 'desk', turn: '0' }), Object.assign({}, d, { dayLines: 0 }));
  assert.strictEqual(lim.statusCode, 429);
  console.log('ok: two boxes can talk to each other, one turn at a time, with limits');
})().catch((e) => { console.error(e); process.exit(1); });
