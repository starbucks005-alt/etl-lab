/* head-talk: a robot head's spoken turn. Run: node tests/head-talk.test.js. Nothing real is heard, said or spent: every service is a stand-in. */
const assert = require('assert');
const { handler, _test } = require('../netlify/functions/head-talk.js');
const gc = require('../netlify/functions/_gc-config.js');

(async () => {
  const KEY = 'head-test-key-123';
  const cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const mem = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); }, _m: m }; };
  const audio = (n) => Buffer.alloc(n, 1).toString('base64');
  const ev = (key, bytes, robot) => ({ httpMethod: 'POST', headers: key ? { 'x-sun-key': key } : {}, queryStringParameters: { robot: robot || 'astri' }, body: audio(bytes), isBase64Encoded: true });

  // Astri's voice and words come from the files her Pi uses
  assert.strictEqual(_test.voiceFor('astri'), 'azure:en-US-AnaNeural', 'Astri speaks in Ana, from robots.json');
  const real = require('../al-panel/pi/personalities.json');
  const sys = _test.systemPrompt(real.astri);
  assert.ok(sys.startsWith(real.astri.prompt), 'her own written prompt, word for word, comes first');
  assert.ok(/say no/.test(sys) && /I don't know that one/.test(sys), 'she says she is not a person, and never makes a fact up');
  assert.ok(/young child/.test(sys));
  assert.ok(!/[\u2014\u2011]/.test(sys) && !/plainly/i.test(sys) && !/rather not make something up/i.test(sys));
  assert.ok(!/David/.test(sys));

  const store = mem();
  let t = new Date('2026-11-21T15:00:00Z');
  const spoken = [];
  const base = () => ({ env: {}, loadCfg: cfg, store, saved: {}, now: () => t,
    listen: async () => 'hi astri do you like dolls', ask: async (s, msgs) => { base.sys = s; base.msgs = msgs; return 'Yes! I love dolls. Do you?'; },
    speak: async (text, voice) => { spoken.push([text, voice]); return Buffer.from([5, 6, 7, 8]); } });

  // closed without the code, refused with a wrong one, nothing but POST, nobody unknown
  assert.strictEqual((await handler(ev(KEY, 20000), Object.assign(base(), { loadCfg: async () => ({}) }))).statusCode, 503);
  assert.strictEqual((await handler(ev('nope', 20000), base())).statusCode, 401);
  assert.strictEqual((await handler(Object.assign(ev(KEY, 20000), { httpMethod: 'GET' }), base())).statusCode, 405);
  assert.strictEqual((await handler(ev(KEY, 20000, 'nobody'), base())).statusCode, 404);
  assert.strictEqual((await handler(ev(KEY, 100), base())).statusCode, 400);
  assert.strictEqual((await handler(ev(KEY, 400000), base())).statusCode, 413);
  assert.strictEqual(spoken.length, 0, 'nothing spent before a real turn');

  // a whole turn: heard, answered in her voice, words in the headers, counted
  const r = await handler(ev(KEY, 20000), base());
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual([...Buffer.from(r.body, 'base64')], [5, 6, 7, 8]);
  assert.strictEqual(decodeURIComponent(r.headers['X-Heard']), 'hi astri do you like dolls');
  assert.strictEqual(decodeURIComponent(r.headers['X-Said']), 'Yes! I love dolls. Do you?');
  assert.strictEqual(spoken[0][1], 'azure:en-US-AnaNeural');
  assert.ok(base.sys.startsWith(real.astri.prompt));
  assert.strictEqual(store._m.get('astri-day-2026-11-21'), 1);

  // the next sentence soon after carries the last turn along
  t = new Date('2026-11-21T15:00:30Z');
  await handler(ev(KEY, 20000), base());
  assert.strictEqual(base.msgs.length, 3);
  // two quiet minutes later, the next person starts fresh
  t = new Date('2026-11-21T15:03:00Z');
  await handler(ev(KEY, 20000), base());
  assert.strictEqual(base.msgs.length, 1, 'a new person does not inherit the last one\'s conversation');

  // nothing heard: quiet, nothing said, nothing counted
  const before = store._m.get('astri-day-2026-11-21');
  const q = await handler(ev(KEY, 20000), Object.assign(base(), { listen: async () => ' . ' }));
  assert.strictEqual(q.statusCode, 204);
  assert.strictEqual(q.headers['X-Why'], 'didnt_hear');
  assert.strictEqual(store._m.get('astri-day-2026-11-21'), before);

  // the day's turns used up: quiet, and the services are not called
  let listened = false;
  const full = await handler(ev(KEY, 20000), Object.assign(base(), { dailyTurns: before, listen: async () => { listened = true; return 'hi'; } }));
  assert.strictEqual(full.statusCode, 204);
  assert.strictEqual(full.headers['X-Why'], 'day_used');
  assert.strictEqual(listened, false);

  // a failed step is reported, not counted
  const bad = await handler(ev(KEY, 20000), Object.assign(base(), { ask: async () => { throw new Error('down'); } }));
  assert.strictEqual(bad.statusCode, 502);
  assert.strictEqual(store._m.get('astri-day-2026-11-21'), before);

  // the fireside chat: the director gives her a turn, the website answers in her voice, and the board says when she has finished
  const calls = [];
  let dirState = { on: false };
  const director = async (b) => { calls.push(b); if (b.action === 'poll') return dirState; return { on: true }; };
  const fsEv = (step, cue) => ({ httpMethod: 'POST', headers: { 'x-sun-key': KEY }, queryStringParameters: Object.assign({ robot: 'astri', fireside: step }, cue ? { cue } : {}), body: '' });
  const fsBase = () => Object.assign(base(), { director, store: mem() });
  let w = await handler(fsEv('poll'), fsBase());
  assert.strictEqual(w.statusCode, 204); assert.strictEqual(w.headers['X-On'], '0'); assert.strictEqual(w.headers['X-Every'], '20');
  assert.deepStrictEqual([calls[0].seat, calls[0].name, calls[0].room], ['astri', 'Astri', 'etl-fireside'], 'she joins under her own seat');
  dirState = { on: true, every: 1, cue: null };
  w = await handler(fsEv('poll'), fsBase());
  assert.strictEqual(w.headers['X-On'], '1'); assert.strictEqual(w.headers['X-Every'], '1');
  dirState = { on: true, every: 1, cue: { id: 'c7-x', ask: '[Fireside chat] It is your turn.' } };
  const s2 = fsBase();
  const turn = await handler(fsEv('poll'), s2);
  assert.strictEqual(turn.statusCode, 200);
  assert.strictEqual(turn.headers['X-Cue'], 'c7-x');
  assert.strictEqual(decodeURIComponent(turn.headers['X-Said']), 'Yes! I love dolls. Do you?');
  assert.strictEqual(base.msgs[0].text, '[Fireside chat] It is your turn.', 'she answers the words the director handed her');
  assert.ok(calls.some((c) => c.action === 'speaking' && c.cue === 'c7-x'));
  const again = await handler(fsEv('poll'), s2);
  assert.strictEqual(again.statusCode, 204, 'a turn already answered is not answered twice');
  await handler(fsEv('done', 'c7-x'), s2);
  const done = calls.filter((c) => c.action === 'done').pop();
  assert.deepStrictEqual([done.cue, done.said, done.seat], ['c7-x', 'Yes! I love dolls. Do you?', 'astri'], 'the director is told what she said');
  // if her answer fails, the floor moves on at once
  const s3 = Object.assign(fsBase(), { ask: async () => { throw new Error('down'); } });
  dirState = { on: true, every: 1, cue: { id: 'c8-y', ask: 'x' } };
  assert.strictEqual((await handler(fsEv('poll'), s3)).statusCode, 204);
  assert.ok(calls.some((c) => c.action === 'done' && c.cue === 'c8-y' && c.said === ''));
  // every robot has a seat
  for (const r of require('../al-panel/robots.json').robots) assert.ok(_test.SEATS[r.id], 'a seat for ' + r.id);

  console.log('head-talk: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
