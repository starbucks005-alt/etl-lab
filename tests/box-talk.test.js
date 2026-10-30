const assert = require('assert');
const { handler, _test } = require('../netlify/functions/box-talk.js');
const gc = require('../netlify/functions/_gc-config.js');

(async () => {
  const KEY = 'box-test-key-123';
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const mem = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); }, _m: m }; };
  const lines = { companions: { tansy: { voiceId: 'thfYL0Elyru2qqTtNQsE', lines: { didnt_hear: 'Speak up.', too_many: 'Enough for today.' } } } };
  const audio = (n) => Buffer.alloc(n, 1).toString('base64');
  const ev = (key, bytes, extra) => Object.assign({ httpMethod: 'POST', headers: key ? { 'x-sun-key': key } : {}, queryStringParameters: { companion: 'tansy' }, body: audio(bytes), isBase64Encoded: true }, extra || {});
  const life = _test.writtenLife('tansy');
  assert.ok(life && /Poppy/.test(life.bio) && life.interests.length === 3, 'her written life comes from roster.json');

  const store = mem(), lineStore = mem();
  const spoken = [];
  const base = () => ({ env: {}, loadCfg: cfg, lines, store, lineStore, saved: {}, now: () => new Date('2026-10-30T12:00:00Z'),
    listen: async () => 'what do you think of humans', ask: async (sys, msgs) => { base.sys = sys; base.msgs = msgs; return 'Very little, and I think of them often.'; },
    speak: async (text) => { spoken.push(text); return Buffer.from([5, 6, 7, 8]); } });

  // closed without the code, refused with a wrong one, nothing but POST
  assert.strictEqual((await handler(ev(KEY, 20000), Object.assign(base(), { loadCfg: async () => ({}) }))).statusCode, 503);
  assert.strictEqual((await handler(ev('nope', 20000), base())).statusCode, 401);
  assert.strictEqual((await handler(Object.assign(ev(KEY, 20000), { httpMethod: 'GET' }), base())).statusCode, 405);
  // sound too short or too long is refused before anything is spent
  assert.strictEqual((await handler(ev(KEY, 100), base())).statusCode, 400);
  assert.strictEqual((await handler(ev(KEY, 400000), base())).statusCode, 413);
  assert.strictEqual((await handler(Object.assign(ev(KEY, 20000), { queryStringParameters: { companion: 'someone' } }), base())).statusCode, 404);
  assert.strictEqual(spoken.length, 0);

  // a whole turn: heard, answered, spoken, kept, counted
  const r = await handler(ev(KEY, 20000), base());
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.isBase64Encoded, true);
  assert.deepStrictEqual([...Buffer.from(r.body, 'base64')], [5, 6, 7, 8]);
  assert.strictEqual(decodeURIComponent(r.headers['X-Heard']), 'what do you think of humans');
  assert.strictEqual(decodeURIComponent(r.headers['X-Said']), 'Very little, and I think of them often.');
  assert.strictEqual(store._m.get('day-2026-10-30'), 1);
  assert.strictEqual(store._m.get('chat-tansy').length, 2);
  // her prompt carries only what is written, says she is not a person and never to make a detail up
  assert.ok(/not a person/.test(base.sys) && /do not know that one/.test(base.sys) && /Poppy/.test(base.sys));
  assert.ok(/never give him a name/.test(base.sys) && /Please look at the buttons/.test(base.sys), 'her canon and her way of deflecting are in her prompt');
  assert.ok(!/\u2014/.test(base.sys) && !/plainly/i.test(base.sys) && !/rather not make something up/i.test(base.sys));
  // the second turn sends the first one along
  await handler(ev(KEY, 20000), base());
  assert.strictEqual(base.msgs.length, 3);

  // nothing heard: she says the fixed line and nothing is counted
  const quiet = await handler(ev(KEY, 20000), Object.assign(base(), { listen: async () => '  ' }));
  assert.strictEqual(quiet.statusCode, 200);
  assert.strictEqual(decodeURIComponent(quiet.headers['X-Said']), 'Speak up.');
  assert.strictEqual(store._m.get('day-2026-10-30'), 2);

  // the day is used up: the fixed line again, and nothing is listened to or asked
  let touched = 0;
  const capped = await handler(ev(KEY, 20000), Object.assign(base(), { dailyTurns: 2, listen: async () => { touched++; return 'hi'; }, ask: async () => { touched++; return 'x'; } }));
  assert.strictEqual(decodeURIComponent(capped.headers['X-Said']), 'Enough for today.');
  assert.strictEqual(touched, 0);

  // a failing step answers 502 and is not counted
  const before = store._m.get('day-2026-10-30');
  const bad = await handler(ev(KEY, 20000), Object.assign(base(), { ask: async () => { throw new Error('anthropic_529'); } }));
  assert.strictEqual(bad.statusCode, 502);
  const bad2 = await handler(ev(KEY, 20000), Object.assign(base(), { speak: async () => Buffer.alloc(0) }));
  assert.strictEqual(bad2.statusCode, 502);
  assert.strictEqual(store._m.get('day-2026-10-30'), before);

  // the sound is wrapped as a normal 16 kHz mono wav for the speech service
  const w = _test.wav(Buffer.alloc(100));
  assert.strictEqual(w.length, 144);
  assert.strictEqual(w.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(w.readUInt32LE(24), 16000);
  assert.strictEqual(w.readUInt16LE(22), 1);
  // and the speech call asks Scribe with the site's key
  let seen;
  const t = await _test.listen(Buffer.alloc(32000), { env: { ELEVENLABS_API_KEY: 'k' }, fetchFn: async (url, opt) => { seen = { url, opt }; return { ok: true, json: async () => ({ text: ' Hello there. ' }) }; } });
  assert.strictEqual(seen.url, 'https://api.elevenlabs.io/v1/speech-to-text');
  assert.strictEqual(seen.opt.headers['xi-api-key'], 'k');
  assert.strictEqual(t, 'Hello there.');
  await assert.rejects(() => _test.listen(Buffer.alloc(32000), { env: {} }), /no_eleven_key/);
  console.log('ok: the box can hold a short conversation with Tansy, with a daily limit');
})().catch((e) => { console.error(e); process.exit(1); });
