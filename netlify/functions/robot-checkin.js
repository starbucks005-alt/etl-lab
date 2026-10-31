/* robot-checkin: lets the public robots page say which robots are on, 2026-10-31. Dr. O: the dropdown should show Connected for the real robots, not only on the home network.

   POST (a robot, about once a minute while it is on)  header x-sun-key (the same home access code as the box functions), body {id:'alice'}  -> {ok:true}
   GET  (the public panel page, no code)               -> {online:{alice:true}}  only the robots that checked in within the last three minutes.

   Nothing else is stored or sent: no address, no name, no settings. A robot that stops checking in drops off after three minutes.
   One small record holds every robot's last check-in. Two robots posting in the same instant can lose one note; the next minute puts it back.
   With no access code set the POST answers 503, like the other home functions. NOT TRIED on the live site. The test runs with a stand-in store. */
const sun = require('./_sun.js');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });
const FRESH_MS = 180000;
const MAX_ROBOTS = 30;

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('robot_checkins');
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let store = deps.store;
  try { if (!store) store = await openStore(event); } catch (_) { return json(503, { error: 'store_unavailable' }); }
  const now = deps.now ? deps.now() : Date.now();
  let all = {};
  try { all = (await store.get('all', { type: 'json' })) || {}; } catch (_) {}

  if (event.httpMethod === 'GET') {
    const online = {};
    Object.keys(all).forEach((id) => { if (now - Number(all[id]) <= FRESH_MS) online[id] = true; });
    return json(200, { online });
  }

  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  const id = String(body.id || '').toLowerCase();
  if (!/^[a-z0-9-]{1,30}$/.test(id)) return json(400, { error: 'bad_id' });
  all[id] = now;
  Object.keys(all).forEach((k) => { if (now - Number(all[k]) > FRESH_MS * 20) delete all[k]; });   // forget a robot not seen for a long while
  if (Object.keys(all).length > MAX_ROBOTS) return json(400, { error: 'too_many' });
  try { await store.setJSON('all', all); } catch (_) { return json(503, { error: 'store_unavailable' }); }
  return json(200, { ok: true });
};
