/* sun-music-token: gives the panel a fresh Apple Music developer token, 2026-10-18.

   GET (header x-sun-key) -> { token, expires_in }      or 404 { error: 'apple_not_set' } until the three Apple values are saved on the panel.
   The key never leaves the site; only the short-lived signed token does. NOT TRIED against Apple. */
const sun = require('./_sun.js');
const apple = require('./_apple.js');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

exports.handler = async function (event, _ctx, deps = {}) {
  const json = (code, o) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(o) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'get_only' });
  const a = sun.authorized(event, deps.env);
  if (!a.ok) return json(a.code, { error: a.error });
  let saved = {};
  try { saved = await sun.loadSettings(deps.store || (await sun.openStore(event))); } catch (_) {}
  try {
    return json(200, apple.makeDeveloperToken({ teamId: saved.apple_team_id, keyId: saved.apple_key_id, privateKey: saved.apple_private_key }, { now: deps.now }));
  } catch (e) {
    return json(e.message === 'apple_not_set' ? 404 : 500, { error: e.message === 'apple_not_set' ? 'apple_not_set' : 'token_failed' });
  }
};
