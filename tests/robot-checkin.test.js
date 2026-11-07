// robot-checkin: every robot has its own record, so two robots checking in at the same moment can never erase each other (the dots used to flicker).
const assert = require('assert');
const { handler } = require('../netlify/functions/robot-checkin.js');

(async () => {
  const mem = () => {
    const m = new Map();
    return {
      get: async (k) => (m.has(k) ? m.get(k) : null),
      setJSON: async (k, v) => { await new Promise((r) => setTimeout(r, Math.random() * 5)); m.set(k, v); },   // slow writes, so simultaneous posts really overlap
      list: async (o) => ({ blobs: [...m.keys()].filter((k) => !o || !o.prefix || k.indexOf(o.prefix) === 0).map((key) => ({ key })) }),
      _m: m
    };
  };
  const env = { SUN_DEVICE_KEY: 'k1' };
  const post = (store, id, now, key) => handler({ httpMethod: 'POST', headers: { 'x-sun-key': key === undefined ? 'k1' : key }, body: JSON.stringify({ id }) }, { store, env, now: () => now });
  const get = async (store, now) => JSON.parse((await handler({ httpMethod: 'GET', headers: {} }, { store, env, now: () => now })).body);
  let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };

  // two, then ten, robots posting at the very same moment: all of them stay on
  for (const n of [2, 10]) {
    const s = mem(); const ids = Array.from({ length: n }, (_, i) => 'robot' + i);
    await Promise.all(ids.map((id) => post(s, id, 1000)));
    const online = (await get(s, 1000)).online;
    ok(ids.every((id) => online[id]), n + ' robots posting at once: all are on, got ' + Object.keys(online).join(','));
  }

  // fresh for three minutes, then gone, and a robot posting again comes back
  const s = mem();
  await post(s, 'alice', 0); await post(s, 'astro', 100000);
  ok(Object.keys((await get(s, 150000)).online).sort().join() === 'alice,astro', 'both on after 150 s');
  ok(Object.keys((await get(s, 200000)).online).join() === 'astro', 'alice drops off after three minutes, astro stays');
  await post(s, 'alice', 210000);
  ok(Object.keys((await get(s, 211000)).online).sort().join() === 'alice,astro', 'alice is back after she checks in again');

  // the access code and the id are checked; a wrong code writes nothing
  const t = mem();
  ok((await post(t, 'alice', 0, 'wrong')).statusCode === 401, 'a wrong code is refused');
  ok((await post(t, 'Bad Id!', 0)).statusCode === 400, 'a bad id is refused');
  ok(Object.keys((await get(t, 0)).online).length === 0, 'nothing was written by the refused posts');
  ok((await handler({ httpMethod: 'POST', headers: {}, body: '{}' }, { store: t, env: {}, now: () => 0, loadCfg: async () => ({}) })).statusCode === 503, 'with no access code set the POST answers 503');

  // the list is capped, a known robot can still check in, and CORS answers
  const u = mem();
  for (let i = 0; i < 30; i++) await post(u, 'r' + i, 0);
  ok((await post(u, 'one-too-many', 0)).statusCode === 400, 'the 31st robot is refused');
  ok((await post(u, 'r5', 1000)).statusCode === 200, 'a robot already on the list can still check in');
  ok((await handler({ httpMethod: 'OPTIONS' }, {})).statusCode === 204, 'OPTIONS answers');

  if (bad) { console.log(bad + ' check(s) failed'); process.exit(1); }
  console.log('robot-checkin: all checks passed');
})();
