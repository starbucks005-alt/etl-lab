/* sun-settings: what the Rising Sun panel saves and what the board reads, 2026-10-18, Dr. O: "panel like astra so personalities of the fire fairy can vary and the user can
   easily set things up".

   GET   -> { settings, fairies }   wake time, how long the sunrise takes, time zone, which fairy, the fairies, and calendar_set (true or false; the link itself is never sent back)
   POST  -> { settings }   a patch: wake_hour, wake_min, sunrise_minutes, zone, fairy, fairies { id: {name, greeting, ask, manner, backstory, voice} }, calendar_url, delete_fairy

   Every call needs the header x-sun-key to equal SUN_DEVICE_KEY. With no key set it answers 503. NOT TRIED against the real blob store; the tests use a stand-in. */
const sun = require('./_sun.js');
let BASE = {};
try { BASE = require('../../rising-sun/personas.json'); } catch (_) {}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

exports.handler = async function (event, _ctx, deps = {}) {
  const json = (code, o) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });
  const store = deps.store || (await sun.openStore(event));
  const view = (saved) => ({ settings: sun.publicView(saved), fairies: sun.fairyList(BASE, saved) });
  if (event.httpMethod === 'GET') return json(200, view(await sun.loadSettings(store)));
  if (event.httpMethod !== 'POST') return json(405, { error: 'get_or_post' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  const next = sun.applyPatch(await sun.loadSettings(store), body);
  await sun.saveSettings(store, next);
  return json(200, view(next));
};
