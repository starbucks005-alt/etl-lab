// Recording a story on the site: the key is the site's own, a story is recorded once, a running one is not started twice, and what was recorded can be heard back.
const rec = require('../netlify/functions/story-record-background.js');
const aud = require('../netlify/functions/story-audio.js');
const assert = require('assert');
const gc = require('../netlify/functions/_gc-config.js');
const mem = () => { const m = new Map(); return { _m: m, get: async (k, o) => { const v = m.get(k); if (v === undefined) return null; return o && o.type === 'json' ? JSON.parse(v) : (Buffer.isBuffer(v) ? v : v); }, set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; };
(async () => {
  const KEY = 'home-code';
  const ev = (method, body, q) => ({ httpMethod: method, headers: { 'x-sun-key': KEY }, queryStringParameters: q || {}, body: body ? JSON.stringify(body) : '' });
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const store = mem(), spoken = [];
  const pack = { episodes: [{ id: 'trash', beats: [{ who: 'reggie', text: 'Hello {name}.' }, { who: 'biscuit', text: 'Now, sweet pea.' }], evening: 'Later.' }] };
  const base = () => ({ env: { ELEVENLABS_API_KEY: 'k' }, loadCfg: cfg, store, pack, now: () => 1000, speak: async (key, voice, text) => { spoken.push([voice, text]); return Buffer.from([1, 2, 3]); } });
  const post = (b, d) => rec.handler(ev('POST', b), Object.assign(base(), d || {}));

  assert.strictEqual((await rec.handler(Object.assign(ev('POST', {}), { headers: {} }), base())).statusCode, 401);
  assert.strictEqual((await post({ series: 'tansy', episode: 'x' })).statusCode, 404);
  assert.strictEqual((await post({ series: 'reggie-biscuit-mochi', episode: 'nope' })).statusCode, 404);
  assert.strictEqual((await post({ series: 'reggie-biscuit-mochi', episode: 'trash' }, { env: {} })).statusCode, 503, 'no key on the site, no recording');

  const r1 = await post({ series: 'reggie-biscuit-mochi', episode: 'trash' });
  assert.strictEqual(r1.statusCode, 202);
  assert.strictEqual(spoken.length, 3, 'two beats and the evening scene');
  assert.notStrictEqual(spoken[0][0], spoken[1][0], 'Reggie and Biscuit have different voices');
  assert.ok(/sweet pea/.test(spoken[0][1]) && !/\{name\}/.test(spoken[0][1]), 'the name slot is fixed');
  assert.strictEqual(spoken.length, 3);

  assert.strictEqual((await post({ series: 'reggie-biscuit-mochi', episode: 'trash' })).statusCode, 409, 'already recorded: no second recording by accident');
  const again = await post({ series: 'reggie-biscuit-mochi', episode: 'trash', again: true });
  assert.strictEqual(again.statusCode, 202);
  assert.ok(store._m.has('ep-reggie-biscuit-mochi-trash_v2'), 'a second recording is _v2 and the first is kept');
  assert.ok(store._m.has('ep-reggie-biscuit-mochi-trash_v1'));

  store._m.set('status-reggie-biscuit-mochi-squirrel', JSON.stringify({ state: 'recording', done: 2, total: 13, at: 1000 }));
  assert.strictEqual((await post({ series: 'reggie-biscuit-mochi', episode: 'squirrel' }, { pack: { episodes: [{ id: 'squirrel', beats: [{ who: 'reggie', text: 'x' }] }] } })).statusCode, 409, 'one already running is not started twice');

  const st = JSON.parse((await aud.handler(ev('GET', null, { status: '1', watch: 'reggie-biscuit-mochi/squirrel' }), { env: {}, loadCfg: cfg, store })).body);
  assert.strictEqual(st.recorded['reggie-biscuit-mochi/trash'], 2);
  assert.deepStrictEqual(st.running['reggie-biscuit-mochi/squirrel'], { done: 2, total: 13 });
  const got = await aud.handler(ev('GET', null, { series: 'reggie-biscuit-mochi', episode: 'trash' }), { env: {}, loadCfg: cfg, store });
  assert.strictEqual(got.headers['Content-Type'], 'audio/mpeg');
  assert.strictEqual(Buffer.from(got.body, 'base64').length, 9, 'the newest recording comes back');
  assert.strictEqual((await aud.handler(ev('GET', null, { series: 'reggie-biscuit-mochi', episode: 'beach' }), { env: {}, loadCfg: cfg, store })).statusCode, 404);
  assert.strictEqual((await aud.handler(Object.assign(ev('GET', null, { status: '1' }), { headers: {} }), { env: {}, loadCfg: cfg, store })).statusCode, 401);
  console.log('story recording: on the site with its own key, once per story, heard back');
})().catch((e) => { console.error(e); process.exit(1); });
