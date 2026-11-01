// The box panel's story library: every serial in good-company/stories.json is listed with its numbered episodes, one can be set up
// in the box, and the episode the listener is up to is kept. Nothing is played that is not recorded.
const { _test } = require('../netlify/functions/box-control.js');
const lib = require('../good-company/stories.json');
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const out = _test.libraryOf('reggie', lib, { 'reggie-biscuit-mochi': 3 }, 'kit');
ok(out.length === lib.series.length, 'every serial is listed, found ' + out.length);
for (const id of ['tansy', 'kit', 'reggie-biscuit-mochi']) ok(out.some((s) => s.id === id), id + ' is in the library');
const r = out.find((s) => s.id === 'reggie-biscuit-mochi');
ok(r.mine && r.on === 3 && !r.setUp, 'Reggie\'s serial is his, marked on episode 3');
ok(out.find((s) => s.id === 'kit').setUp, 'the chosen serial is marked as set up');
ok(r.episodes.every((e) => e.n > 0 && e.title && e.ready === false), 'episodes carry number and title, and unrecorded ones say so');
ok(_test.libraryOf('reggie', lib, { 'reggie-biscuit-mochi': 99 }, '').find((s) => s.id === 'reggie-biscuit-mochi').on === 1, 'a mark that is not an episode falls back to episode 1');
// switching companion drops the story set up for the last one
(async () => {
  const bc = require('../netlify/functions/box-control.js');
  const gc = require('../netlify/functions/_gc-config.js');
  const KEY = 'k1', m = new Map();
  const store = { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } };
  const d = { env: {}, loadCfg: async () => ({ sun_key_hash: gc.hash(KEY) }), store, duetStore: { get: async () => null }, now: () => 1000, library: lib };
  const ev = (method, body, q) => ({ httpMethod: method, headers: { 'x-sun-key': KEY }, queryStringParameters: q || {}, body: body ? JSON.stringify(body) : '' });
  await bc.handler(ev('POST', { action: 'set_companion', companion: 'alice' }), d);
  await bc.handler(ev('POST', { action: 'set_story', series: 'alice' }), d);
  let g = JSON.parse((await bc.handler(ev('GET', null, {}), d)).body);
  if (!g.companions.find((c) => c.id === 'alice').library.find((x) => x.id === 'alice').setUp) { bad++; console.log('FAIL the set up story is kept for the same companion'); }
  await bc.handler(ev('POST', { action: 'set_companion', companion: 'reggie' }), d);
  g = JSON.parse((await bc.handler(ev('GET', null, {}), d)).body);
  if (g.companions.find((c) => c.id === 'reggie').library.some((x) => x.setUp)) { bad++; console.log('FAIL a new companion starts with no story set up'); }
  console.log(bad ? bad + ' check(s) failed' : 'story library: all serials listed, set-up, episode mark and switching work');
  process.exit(bad ? 1 : 0);
})();
