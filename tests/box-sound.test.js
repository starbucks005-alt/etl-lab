const assert = require('assert');
const { handler, elevenSound } = require('../netlify/functions/box-sound.js');
const lineH = require('../netlify/functions/box-line.js').handler;
const gc = require('../netlify/functions/_gc-config.js');

(async () => {
  const KEY = 'box-test-key-123';
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const mem = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
  const lines = { companions: { tansy: { voiceId: 'thfYL0Elyru2qqTtNQsE',
    lines: { greeting: 'Oh.', 'hs-a': 'Story A.', 'hs-b': 'Story B.', 'nature-jungle': 'Jungle intro.' },
    scenes: { jungle: { intro: 'nature-jungle', sound: 'A jungle at dawn' }, rain: { intro: 'nature-rain', sound: 'Rain on leaves' } } } } };
  const ev = (key, q) => ({ httpMethod: 'GET', headers: key ? { 'x-sun-key': key } : {}, queryStringParameters: q || {} });

  // the sound: closed without the code, only scenes from the file, made once and kept
  let made = 0; const prompts = [];
  const store = mem();
  const d = { env: {}, loadCfg: cfg, lines, store, make: async (p) => { made++; prompts.push(p); return Buffer.from([1, 2, 3, 4]); } };
  assert.strictEqual((await handler(ev(KEY, { name: 'jungle' }), Object.assign({}, d, { loadCfg: async () => ({}) }))).statusCode, 503);
  assert.strictEqual((await handler(ev('nope', { name: 'jungle' }), d)).statusCode, 401);
  assert.strictEqual((await handler(ev(KEY, { name: 'a song by someone' }), d)).statusCode, 404);
  assert.strictEqual(made, 0);
  const s1 = await handler(ev(KEY, { name: 'jungle' }), d);
  assert.strictEqual(s1.statusCode, 200); assert.strictEqual(s1.headers['X-Kept'], 'no'); assert.strictEqual(s1.isBase64Encoded, true);
  const s2 = await handler(ev(KEY, { name: 'jungle' }), d);
  assert.strictEqual(s2.headers['X-Kept'], 'yes'); assert.strictEqual(made, 1);
  assert.strictEqual((await handler(ev(KEY, { name: 'rain' }), Object.assign({}, d, { make: async () => { throw new Error('eleven_401'); } }))).statusCode, 502);

  // the real request: raw 16 kHz sound, a seamless loop, no names in the prompts
  let seen;
  const out = await elevenSound('Rain on leaves', { env: { ELEVENLABS_API_KEY: 'k' }, fetchFn: async (url, opt) => { seen = { url, opt }; return { ok: true, arrayBuffer: async () => new Uint8Array([7]).buffer }; } });
  assert.ok(seen.url.startsWith('https://api.elevenlabs.io/v1/sound-generation') && seen.url.endsWith('output_format=pcm_16000'));
  const sent = JSON.parse(seen.opt.body);
  assert.strictEqual(sent.loop, true); assert.strictEqual(sent.duration_seconds, 20); assert.strictEqual(out.length, 1);
  await assert.rejects(() => elevenSound('x', { env: {} }), /no_eleven_key/);

  // box-line: Story time goes through the stories in turn, Gardenscape through the scenes in turn
  const ls = mem();
  const ld = { env: {}, loadCfg: cfg, lines, store: ls, speak: async (t) => Buffer.from(t) };
  const said = [];
  for (let i = 0; i < 3; i++) { const r = await lineH(ev(KEY, { line: 'story' }), ld); said.push(Buffer.from(r.body, 'base64').toString()); }
  assert.deepStrictEqual(said, ['Story A.', 'Story B.', 'Story A.']);
  const g1 = await lineH(ev(KEY, { line: 'garden' }), ld);                       // jungle has an intro: she says it, and the scene is named
  assert.strictEqual(g1.statusCode, 200); assert.strictEqual(g1.headers['X-Scene'], 'jungle'); assert.strictEqual(Buffer.from(g1.body, 'base64').toString(), 'Jungle intro.');
  const g2 = await lineH(ev(KEY, { line: 'garden' }), ld);                       // rain has no intro written yet: nothing to say, the sound still plays
  assert.strictEqual(g2.statusCode, 204); assert.strictEqual(g2.headers['X-Scene'], 'rain');
  const none = await lineH(ev(KEY, { line: 'story' }), Object.assign({}, ld, { store: mem(), lines: { companions: { tansy: { voiceId: 'thfYL0Elyru2qqTtNQsE', lines: { greeting: 'Oh.' } } } } }));
  assert.strictEqual(none.statusCode, 404);
  console.log('ok: Gardenscape sounds and Story time go in turn, made once and kept');
})().catch((e) => { console.error(e); process.exit(1); });
