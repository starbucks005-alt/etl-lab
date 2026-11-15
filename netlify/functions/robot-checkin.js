/* robot-checkin: lets the public robots page say which robots are on, 2026-10-31. Dr. O: the dropdown should show Connected for the real robots, not only on the home net

   POST (a robot, about once a minute while it is on)  header x-sun-key (the same home access code as the box functions), body {id:'alice'}  -> {ok:true}
   GET  (the public panel page, no code)               -> {online:{alice:true}}  only the robots that checked in within the last three minutes.

   Nothing else is stored or sent: no address, no name, no settings. A robot that stops checking in drops off after three minutes.
   2026-11-07: each robot now has its own record (ck/<id>). Before, one shared record held every robot, so two robots checking in at the same
   moment could erase each other and the dots flickered. Now a robot can only ever write its own note.
   With no access code set the POST answers 503, like the other home functions.
   2026-11-15, Dr. O: motion detection and welcome must be off by default, with a way to switch them for every robot. A check-in answer now carries
   the every-robot motion switch, {all:{motion:{on, rev}}}, and a robot's POST with set_motion: true or false changes it (the owner's code only; a
   tester's code is refused). Each robot obeys a rev it has not seen, at its next check-in. Only that one on/off and its count are kept. */
const sun = require('./_sun.js');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });
const FRESH_MS = 180000;
const MAX_ROBOTS = 30;
const PREFIX = 'ck/';
const ALL_MOTION = 'all/motion';      // not under ck/, so it is never counted as a robot

async function readMotion(store) {
  try {
    const m = await store.get(ALL_MOTION, { type: 'json' });
    if (m && typeof m === 'object') return { on: !!m.on, rev: Number(m.rev) || 0 };
  } catch (_) { /* unreadable: the same as never set */ }
  return { on: false, rev: 0 };
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('robot_checkins');
}

async function listKeys(store) {
  const l = await store.list({ prefix: PREFIX });
  return (l && l.blobs ? l.blobs : []).map((b) => b.key).filter((k) => typeof k === 'string' && k.indexOf(PREFIX) === 0);
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let store = deps.store;
  try { if (!store) store = await openStore(event); } catch (_) { return json(503, { error: 'store_unavailable' }); }
  const now = deps.now ? deps.now() : Date.now();

  if (event.httpMethod === 'GET') {
    const online = {};
    let keys = [];
    try { keys = await listKeys(store); } catch (_) { return json(200, { online }); }
    await Promise.all(keys.map(async (k) => {
      try {
        const ts = await store.get(k, { type: 'json' });
        if (ts !== null && ts !== undefined && now - Number(ts) <= FRESH_MS) online[k.slice(PREFIX.length)] = true;
      } catch (_) { /* one unreadable note must not hide the others */ }
    }));
    return json(200, { online });
  }

  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  const id = String(body.id || '').toLowerCase();
  if (!/^[a-z0-9-]{1,30}$/.test(id)) return json(400, { error: 'bad_id' });
  try {
    const keys = await listKeys(store);
    if (keys.indexOf(PREFIX + id) === -1 && keys.length >= MAX_ROBOTS) return json(400, { error: 'too_many' });
    await store.setJSON(PREFIX + id, now);
  } catch (_) { return json(503, { error: 'store_unavailable' }); }
  let motion = await readMotion(store);
  if (typeof body.set_motion === 'boolean') {
    if (a.who !== 'owner') return json(403, { error: 'owner_only' });
    motion = { on: body.set_motion, rev: motion.rev + 1 };
    try { await store.setJSON(ALL_MOTION, { on: motion.on, rev: motion.rev, at: now, by: id }); } catch (_) { return json(503, { error: 'store_unavailable' }); }
  }
  return json(200, { ok: true, all: { motion } });
};
