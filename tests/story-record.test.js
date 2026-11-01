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

  const st = JSON.parse((await aud.handler(ev('GET', null, { status: '1', watch: 'reggie-biscuit-mochi/squirrel' }), { env: {}, loadCfg: cfg, store, now: () => 2000 })).body);
  assert.strictEqual(st.recorded['reggie-biscuit-mochi/trash'], 2);
  assert.ok(Array.isArray(st.written['reggie-biscuit-mochi']), 'it says which episodes have a written story');
  assert.deepStrictEqual(st.running['reggie-biscuit-mochi/squirrel'], { done: 2, total: 13 });
  const got = await aud.handler(ev('GET', null, { series: 'reggie-biscuit-mochi', episode: 'trash' }), { env: {}, loadCfg: cfg, store });
  assert.strictEqual(got.headers['Content-Type'], 'audio/mpeg');
  assert.strictEqual(Buffer.from(got.body, 'base64').length, 9, 'the newest recording comes back');
  assert.strictEqual((await aud.handler(ev('GET', null, { series: 'reggie-biscuit-mochi', episode: 'beach' }), { env: {}, loadCfg: cfg, store })).statusCode, 404);
  assert.strictEqual((await aud.handler(Object.assign(ev('GET', null, { status: '1' }), { headers: {} }), { env: {}, loadCfg: cfg, store })).statusCode, 401);
  // Nora's and Cressida's approved episodes (rising-sun/box-stories.json) record the same way, each in her own voice
  const real = require('../rising-sun/box-stories.json');
  const nora = real.series.find((x) => x.id === 'nora-adventures'), cress = real.series.find((x) => x.id === 'cressida-observations');
  assert.ok(nora && nora.episodes.length === 3 && cress && cress.episodes.length === 3, 'all six approved episodes are in the live story file');
  const spk = [];
  const rn = await post({ series: 'nora-adventures', episode: 'giza-bakers' }, { pack, stories: undefined, speak: async (k, v, t) => { spk.push(v); return Buffer.from([9]); } });
  assert.strictEqual(rn.statusCode, 202);
  assert.ok(spk.length >= 5 && spk.every((v) => v === 'pb6kCegKK9i4oRBqeUjR'), 'Nora is read in Nora\'s voice');
  const spc = [];
  await post({ series: 'cressida-observations', episode: 'the-wedding' }, { speak: async (k, v) => { spc.push(v); return Buffer.from([9]); } });
  assert.ok(spc.length >= 5 && spc.every((v) => v === 'RTBzdwjfw0SPTkN2srfl'), 'Cressida is read in Cressida\'s voice');
  const lib = require('../good-company/stories.json');
  for (const id of ['nora-adventures', 'cressida-observations']) assert.ok(lib.series.find((x) => x.id === id).episodes.length === 3, id + ' is in the story library');
  const stw = JSON.parse((await aud.handler(ev('GET', null, { status: '1' }), { env: {}, loadCfg: cfg, store })).body);
  assert.ok(stw.written['nora-adventures'].indexOf('giza-bakers') >= 0, 'the panel is told which episodes are written');
  // a refusal or a failure inside the background job is written down, so the panel can say what happened
  const st2 = mem();
  const baseB = (x) => Object.assign({ env: { ELEVENLABS_API_KEY: 'k' }, loadCfg: cfg, store: st2, pack, now: () => 5000 }, x || {});
  await rec.handler(ev('POST', { series: 'reggie-biscuit-mochi', episode: 'trash' }), baseB({ speak: async () => { throw new Error('eleven_429'); } }));
  let le = JSON.parse((await aud.handler(ev('GET', null, { status: '1' }), { env: {}, loadCfg: cfg, store: st2, now: () => 6000 })).body).lastError;
  assert.ok(le && le.error === 'eleven_429' && le.episode === 'trash', 'a failure at ElevenLabs is reported with its reason');
  await rec.handler(ev('POST', { series: 'reggie-biscuit-mochi', episode: 'nope' }), baseB());
  le = JSON.parse((await aud.handler(ev('GET', null, { status: '1' }), { env: {}, loadCfg: cfg, store: st2, now: () => 6000 })).body).lastError;
  assert.strictEqual(le.error, 'unknown_episode', 'a refusal inside the background job is reported too');
  // a recording that made no progress for four minutes is taken to have died, so it can be started again
  st2._m.set('status-reggie-biscuit-mochi-trash', JSON.stringify({ state: 'recording', done: 2, total: 19, at: 1000 }));
  const again2 = await rec.handler(ev('POST', { series: 'reggie-biscuit-mochi', episode: 'trash' }), baseB({ now: () => 1000 + 5 * 60 * 1000, speak: async () => Buffer.from([1]) }));
  assert.strictEqual(again2.statusCode, 202, 'a stuck recording does not block the story for fifteen minutes');
  // a recording that stopped moving is reported as stopped, with how far it got
  const stl = JSON.parse((await aud.handler(ev('GET', null, { status: '1', watch: 'reggie-biscuit-mochi/squirrel' }), { env: {}, loadCfg: cfg, store, now: () => 1000 + 5 * 60 * 1000 })).body);
  assert.deepStrictEqual(stl.running['reggie-biscuit-mochi/squirrel'], { failed: 'stalled', done: 2, total: 13 }, 'a stalled recording says it stopped and where');
  // if the site stops the job part way, it carries itself on in fresh calls until the story is whole (here a stop after every single part)
  const st3 = mem(); let calls = 0; const spk3 = [];
  const run3 = (extra) => rec.handler(ev('POST', extra), { env: { ELEVENLABS_API_KEY: 'k' }, loadCfg: cfg, store: st3, pack, now: () => 9000, budgetMs: 0,
    speak: async (k, v, t) => { spk3.push(t); return Buffer.from([spk3.length]); },
    selfCall: async (event, payload) => { calls++; await run3(Object.assign({ resume: true }, payload)); } });
  await run3({ series: 'reggie-biscuit-mochi', episode: 'trash' });
  assert.strictEqual(spk3.length, 3, 'every part was voiced exactly once, none twice');
  assert.strictEqual(calls, 2, 'it carried itself on twice for three parts');
  const done3 = JSON.parse(st3._m.get('status-reggie-biscuit-mochi-trash'));
  assert.strictEqual(done3.state, 'done');
  assert.deepStrictEqual([...Buffer.from(st3._m.get('ep-reggie-biscuit-mochi-trash_v1'))], [1, 2, 3], 'the parts are joined in order');
  // A.L.I.C.E.'s saga and the fairies' Human Summer: only the tellers who have a voice are read, and what was left out is said
  const st4 = mem(); const used4 = [];
  const run4 = (series, episode, extra) => rec.handler(ev('POST', { series, episode }), Object.assign({ env: { ELEVENLABS_API_KEY: 'k' }, loadCfg: cfg, store: st4, now: () => 7000, budgetMs: 100000, speak: async (k, v, t) => { used4.push([v, t]); return Buffer.from([1]); } }, extra || {}));
  await run4('alice', 'alice-saga');
  assert.ok(used4.length >= 20 && used4.every((u) => u[0] === 'gZL79pBTvaNfNPOCXh6n'), 'A.L.I.C.E.\'s own fragments are read in her voice');
  const sk = JSON.parse(st4._m.get('index')).skipped['alice/alice-saga'];
  assert.ok(sk && sk.n === 11 && sk.who.indexOf('narrator') >= 0, 'the fragments of tellers with no voice are left out and reported (' + JSON.stringify(sk) + ')');
  used4.length = 0;
  await run4('tansy', 'tansy-human-summer');
  const vs = new Set(used4.map((u) => u[0]));
  assert.ok(vs.has('thfYL0Elyru2qqTtNQsE') && vs.has('VJFN2gyaDzoKekQ8ZuKB') && vs.has('WUyjxM8OTY6l8LhTmdkq') && vs.size === 3, 'Tansy, Poppy and Blue each in their own voice');
  // Kit: an Azure voice, so no ElevenLabs key is needed, and the visitor is her boss
  const azureCalls = [];
  const st5 = mem();
  const rk = await rec.handler(ev('POST', { series: 'kit', episode: 'kit-mongolia' }), { env: {}, loadCfg: cfg, store: st5, now: () => 8000, budgetMs: 100000, azureEnv: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'eastus' },
    fetchFn: async (u, o) => { azureCalls.push({ u, o }); return { ok: true, arrayBuffer: async () => new Uint8Array([7, 7]).buffer }; } });
  assert.strictEqual(rk.statusCode, 202);
  assert.ok(azureCalls.length === 1 && /microsoft/.test(azureCalls[0].u) && /Ada/.test(azureCalls[0].o.body), 'Kit is spoken by Azure in her voice');
  assert.ok(/Oh good, boss, sit down/.test(azureCalls[0].o.body) && !/\{name\}/.test(azureCalls[0].o.body), 'the visitor is her boss');
  assert.strictEqual(JSON.parse(st5._m.get('status-kit-kit-mongolia')).state, 'done');
  const wm = require('../netlify/functions/story-record-background.js').writtenMap({});
  assert.deepStrictEqual([wm.alice, wm.tansy, wm.kit], [['alice-saga'], ['tansy-human-summer'], ['kit-mongolia', 'kit-jordan', 'kit-ohio']], 'the panel is told what is written for the others');
  console.log('story recording: on the site with its own key, once per story, heard back');
})().catch((e) => { console.error(e); process.exit(1); });
