const assert = require('assert');
const { handler, _test } = require('../netlify/functions/box-control.js');
const gc = require('../netlify/functions/_gc-config.js');
const real = require('../rising-sun/box-lines.json');

(async () => {
  const KEY = 'box-test-key-123';
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const mem = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
  const lines = { companions: {
    tansy: { display: 'Tansy', wake: { name: 'Tansy', phoneme: 'TaNZm' }, face: '/rising-sun/box-faces/tansy_v1.jpg', voiceId: 'x', second: { label: 'Story time', kind: 'story' }, lines: { 'hs-a': 'a' }, scenes: { rain: { sound: 'rain' } } },
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

  // the small screen on the cover is told which picture to show
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'screen' }), d)).body.includes('face=/rising-sun/box-faces/tansy_v1.jpg'));
  await handler(ev('POST', KEY, {}, { action: 'press', button: 'chat', box: 'screen' }), d);
  assert.ok((await handler(ev('GET', KEY, { screen: '1', id: 'screen' }), d)).body.includes('companion=tansy\nface=/rising-sun/box-faces/tansy_v1.jpg\nclip=\n'));
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'screen' }), d)).body.includes('command=chat'), 'the screen looking did not take the pushed button');

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

  // listening for the wake word can be switched off from the panel, per box, and stays off when the companion changes
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'desk' }), d)).body.includes('listen=on'));
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'set_listen', listen: 'no', box: 'desk' }), d)).statusCode, 400);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'set_listen', listen: false, box: 'desk' }), d)).statusCode, 200);
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'desk' }), d)).body.includes('listen=off'));
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'kitchen' }), d)).body.includes('listen=on'));
  await handler(ev('POST', KEY, {}, { action: 'set_companion', companion: 'tansy', box: 'desk' }), d);
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'desk' }), d)).body.includes('listen=off'));
  assert.strictEqual(JSON.parse((await handler(ev('GET', KEY, { id: 'desk' }), d)).body).listen, false);
  await handler(ev('POST', KEY, {}, { action: 'set_listen', listen: true, box: 'desk' }), d);

  // charging is a guess from the trend: rising means charging, falling means on battery, and it says nothing until it has two minutes of readings
  const bt = (mv) => handler(ev('GET', KEY, { box: '1', id: 'trend', batt: String(mv) }), d);
  const stateNow = async () => JSON.parse((await handler(ev('GET', KEY, { id: 'trend' }), d)).body).battery.state;
  t = 5000000; await bt(3700);
  assert.strictEqual(await stateNow(), 'unknown');
  t += 70000; await bt(3710); t += 70000; await bt(3725);
  assert.strictEqual(await stateNow(), 'charging');
  t += 70000; await bt(3700); t += 70000; await bt(3680); t += 70000; await bt(3660);
  assert.strictEqual(await stateNow(), 'discharging');
  t += 400000; await bt(4180); t += 70000; await bt(4180); t += 70000; await bt(4182);
  assert.strictEqual(await stateNow(), 'full');
  assert.ok(_test.batteryPercent(4200) === 100 && _test.batteryPercent(3300) === 0);

  // what wakes the box: Hi ESP until the panel says the companion's name, and the name comes with the sound spelling for the chip
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'wake' }), d)).body.includes('wakeby=hiesp\n'));
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'set_wake_by', by: 'shout', box: 'wake' }), d)).statusCode, 400);
  assert.strictEqual((await handler(ev('POST', KEY, {}, { action: 'set_wake_by', by: 'name', box: 'wake' }), d)).statusCode, 200);
  const wk = (await handler(ev('GET', KEY, { box: '1', id: 'wake' }), d)).body;
  assert.ok(wk.includes('wakeby=name\n') && wk.includes('wakename=Tansy\n') && wk.includes('wakephoneme=TaNZm\n'));
  await handler(ev('POST', KEY, {}, { action: 'set_companion', companion: 'meera', box: 'wake' }), d);
  assert.ok((await handler(ev('GET', KEY, { box: '1', id: 'wake' }), d)).body.includes('wakeby=name\n'), 'changing the companion keeps how the box is woken');

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
    if (c.face) assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', c.face)), id + ' face file exists');
  }
  // every sound spelling uses only letters the chip's sound alphabet has (from Espressif's own table)
  const ALPHABET = new Set('aNbVcLFdSBReDfgGhKWiTMZjkPlmnYopqrstuvw'.split(''));
  for (const [id, c] of Object.entries(real.companions)) {
    if (!c.wake) continue;
    assert.ok(c.wake.name && c.wake.phoneme && c.wake.phoneme.length <= 40, id + ' wake has a name and a short phoneme');
    for (const ch of c.wake.phoneme.replace(/ /g, '')) assert.ok(ALPHABET.has(ch), id + ' phoneme letter ' + ch + ' is in the chip alphabet');
  }
  // a clip, when a companion has one, is a real file in the repo
  for (const [id, c] of Object.entries(real.companions)) if (c.clip) assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', c.clip)), id + ' clip file exists');
  const text = JSON.stringify(real);
  assert.ok(!/[–—]/.test(text), 'no long dashes in the file');
  console.log('ok: the box panel can pick a companion and push the three buttons');
})().catch((e) => { console.error(e); process.exit(1); });
