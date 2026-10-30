const assert = require('assert');
const { handler } = require('../netlify/functions/box-line.js');
const gc = require('../netlify/functions/_gc-config.js');

(async () => {
  const lines = { companions: { tansy: { voiceId: 'thfYL0Elyru2qqTtNQsE', lines: { greeting: 'Oh. It is you.' } } } };
  const KEY = 'box-test-key-123';
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const none = async () => ({});
  const ev = (key, q) => ({ httpMethod: 'GET', headers: key ? { 'x-sun-key': key } : {}, queryStringParameters: q || {} });
  const mem = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); } }; };

  // no key anywhere: closed. wrong key: refused.
  assert.strictEqual((await handler(ev(KEY), { env: {}, loadCfg: none, lines })).statusCode, 503);
  assert.strictEqual((await handler(ev('nope'), { env: {}, loadCfg: cfg, lines })).statusCode, 401);
  assert.strictEqual((await handler(ev(''), { env: {}, loadCfg: cfg, lines })).statusCode, 401);

  // only lines in the file can be asked for
  const store = mem();
  let made = 0;
  const speak = async (text, voice) => { made++; assert.strictEqual(voice, 'thfYL0Elyru2qqTtNQsE'); assert.strictEqual(text, 'Oh. It is you.'); return Buffer.from([1, 2, 3, 4]); };
  const d = { env: {}, loadCfg: cfg, lines, store, speak };
  assert.strictEqual((await handler(ev(KEY, { line: 'sing_me_anything' }), d)).statusCode, 404);
  assert.strictEqual((await handler(ev(KEY, { companion: 'someone' }), d)).statusCode, 404);
  assert.strictEqual(made, 0);

  // first ask makes it, second ask is kept and costs nothing
  const r1 = await handler(ev(KEY, { companion: 'tansy', line: 'greeting' }), d);
  assert.strictEqual(r1.statusCode, 200);
  assert.strictEqual(r1.isBase64Encoded, true);
  assert.strictEqual(r1.headers['Content-Type'], 'audio/L16; rate=16000; channels=1');
  assert.strictEqual(r1.headers['X-Kept'], 'no');
  assert.deepStrictEqual([...Buffer.from(r1.body, 'base64')], [1, 2, 3, 4]);
  const r2 = await handler(ev(KEY), d);
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(r2.headers['X-Kept'], 'yes');
  assert.strictEqual(made, 1);

  // a failing voice answers 502 and nothing is kept
  const bad = await handler(ev(KEY), { env: {}, loadCfg: cfg, lines, store: mem(), speak: async () => { throw new Error('eleven_401'); } });
  assert.strictEqual(bad.statusCode, 502);
  // an empty sound is not kept or played
  assert.strictEqual((await handler(ev(KEY), { env: {}, loadCfg: cfg, lines, store: mem(), speak: async () => Buffer.alloc(0) })).statusCode, 502);

  // the real request asks ElevenLabs for raw 16 kHz sound with the site's key
  let seen;
  const { elevenPcm } = require('../netlify/functions/box-line.js');
  const out = await elevenPcm('Hi.', 'thfYL0Elyru2qqTtNQsE', { env: { ELEVENLABS_API_KEY: 'k' }, fetchFn: async (url, opt) => { seen = { url, opt }; return { ok: true, arrayBuffer: async () => new Uint8Array([9, 9]).buffer }; } });
  assert.ok(seen.url.includes('/v1/text-to-speech/thfYL0Elyru2qqTtNQsE') && seen.url.endsWith('output_format=pcm_16000'));
  assert.strictEqual(seen.opt.headers['xi-api-key'], 'k');
  assert.strictEqual(out.length, 2);
  await assert.rejects(() => elevenPcm('Hi.', 'thfYL0Elyru2qqTtNQsE', { env: {} }), /no_eleven_key/);

  // the shipped lines file is well formed and has no long dashes
  const f = require('../rising-sun/box-lines.json');
  assert.ok(f.companions.tansy.voiceId && f.companions.tansy.lines.greeting);
  assert.ok(!JSON.stringify(f).includes(String.fromCharCode(8212)));
  console.log('ok: the box asks for a fixed line, it is made once and kept');
})().catch((e) => { console.error(e); process.exit(1); });
