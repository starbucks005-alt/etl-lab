const assert = require('assert');
const { handler, _test } = require('../netlify/functions/box-control.js');
const gc = require('../netlify/functions/_gc-config.js');
const real = require('../rising-sun/box-lines.json');

(async () => {
  const KEY = 'box-test-key-123';
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const mem = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
  const lines = { companions: {
    tansy: { display: 'Tansy', voiceId: 'x', second: { label: 'Story time', kind: 'story' }, lines: { 'hs-a': 'a' }, scenes: { rain: { sound: 'rain' } } },
    meera: { display: 'Meera', voiceId: 'y', second: { label: 'Breathing', kind: 'starter', id: 'breathing' }, starters: { breathing: 'breathe' }, lines: {}, scenes: { rain: { sound: 'rain' } } },
    reggie: { display: 'Reggie', voiceId: 'z', second: { label: 'Story time', kind: 'story' }, lines: {}, scenes: { rain: { sound: 'rain' } } },
    marcus: { display: 'Marcus', voiceId: 'w', second: null, lines: {}, scenes: { rain: { sound: 'rain' } } },
  } };
  const ev = (method, key, q, body) => ({ httpMethod: method, headers: key ? { 'x-sun-key': key } : {}, queryStringParameters: q || {}, body: body ? JSON.stringify(body) : '' });
  let t = 1000;
  const d = { env: {}, loadCfg: cfg, lines, store: mem(), now: () => t };

  // closed without the code
  assert.strictEqual((await handler(ev('GET', KEY), Object.assign({}, d, { loadCfg: async () => ({}) }))).statusCode, 503);
  assert.strictEqual((await handler(ev('GET', 'nope'), d)).statusCode, 401);

  // the panel sees every companion and what each one has
  const list = JSON.parse((await handler(ev('GET', KEY), d)).body);
  assert.strictEqual(list.companion, 'tansy');
  const by = Object.fromEntries(list.companions.map((c) => [c.id, c]));
  assert.strictEqual(by.tansy.second.ready, true);        // story lines exist
  assert.strictEqual(by.reggie.second.ready, false);      // none recorded yet, so the panel says so
  assert.strictEqual(by.meera.second.ready, true);        // her starter line
  assert.strictEqual(by.marcus.second, null);             // no second button

  // two boxes in one home are told apart and each keeps her own companion
  const withId = (m, q, b) => ev(m, KEY, q, b);
  await handler(withId('POST', {}, { action: 'set_companion', companion: 'marcus', box: 'desk' }), d);
  await handler(withId('POST', {}, { action: 'set_companion', companion: 'tansy', box: 'kitchen' }), d);
  assert.ok((await handler(withId('GET', { box: '1', id: 'desk' }), d)).body.includes('companion=marcus'));
  assert.ok((await handler(withId('GET', { box: '1', id: 'kitchen' }), d)).body.includes('companion=tansy'));
  const two = JSON.parse((await handler(withId('GET', { id: 'desk' }), d)).body);
  assert.ok(two.boxes.indexOf('desk') >= 0 && two.boxes.indexOf('kitchen') >= 0 && two.box === 'desk');
  assert.strictEqual(JSON.parse((await handler(withId('GET', { id: 'Bad Name!' }), d)).body).box, 'main');

  // the battery the box reports shows on the panel, as an estimate, with how long ago it was heard
  await handler(ev('GET', KEY, { box: '1', id: 'desk', batt: '3900' }), d);
  const bat = JSON.parse((await handler(ev('GET', KEY, { id: 'desk' }), d)).body).battery;
  assert.ok(bat && bat.volts === 3.9 && bat.percent === 67 && bat.secondsAgo === 0);
  await handler(ev('GET', KEY, { box: '1', id: 'desk', batt: '99' }), d);          // nonsense is ignored
  assert.strictEqual(JSON.parse((await handler(ev('GET', KEY, { id: 'desk' }), d)).body).battery.volts, 3.9);
  assert.strictEqual(JSON.parse((await handler(ev('GET', KEY, { id: 'kitchen' }), d)).body).battery, null);

  // choosing a companion; an unknown one is refused
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'set_companion', companion: 'nobody' }), d)).statusCode, 404);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'set_companion', companion: 'meera' }), d)).statusCode, 200);
  assert.ok((await handler(ev('GET', KEY, { box: '1' }), d)).body.includes('companion=meera\nsecond=starter:breathing\ncommand=\n'));

  // a pushed button reaches the box once
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'press', button: 'second' }), d)).statusCode, 200);
  assert.ok((await handler(ev('GET', KEY, { box: '1' }), d)).body.includes('command=second'));
  assert.ok((await handler(ev('GET', KEY, { box: '1' }), d)).body.includes('command=\n'));

  // one nobody collected is dropped after a minute
  await handler(ev('POST', KEY, {}, { action: 'press', button: 'chat' }), d);
  t += 61000;
  assert.ok((await handler(ev('GET', KEY, { box: '1' }), d)).body.includes('command=\n'));

  // buttons the companion does not have are refused with the reason, not queued
  await handler(ev('POST', KEY, {}, { action: 'set_companion', companion: 'reggie' }), d);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'press', button: 'second' }), d)).statusCode, 409);
  await handler(ev('POST', KEY, {}, { action: 'set_companion', companion: 'marcus' }), d);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'press', button: 'second' }), d)).statusCode, 409);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'press', button: 'soundscape' }), d)).statusCode, 200);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'press', button: 'kick' }), d)).statusCode, 400);

  // the real file: every companion has a voice id and the two lines a quiet turn needs
  for (const [id, c] of Object.entries(real.companions)) {
    assert.ok(/^[A-Za-z0-9]{15,30}$/.test(c.voiceId), id + ' has a voice');
    assert.ok(c.lines && c.lines.didnt_hear && c.lines.too_many, id + ' has didnt_hear and too_many');
    assert.ok(_test.describe(id, c).chat);
  }
  const text = JSON.stringify(real);
  assert.ok(!/[–—]/.test(text), 'no long dashes in the file');
  console.log('ok: the box panel can pick a companion and push the three buttons');
})().catch((e) => { console.error(e); process.exit(1); });
