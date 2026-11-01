/* story-audio: the recorded episodes kept by story-record-background, 2026-11-01.
   GET ?status=1&watch=series/episode,series/episode   -> JSON {recorded:{'reggie-biscuit-mochi/trash':1,...}, running:{'series/episode':{done,total}}, written:{series:[episodes that have a written story]}}
   GET ?series=...&episode=...           -> the mp3 (audio/mpeg), the newest version
   Needs the header x-sun-key, the same home access code as the rest of the box. NOT TRIED on the live site. */
const sun = require('./_sun.js');

let PACK = { episodes: [] };
try { PACK = require('../../pack-episodes.json'); } catch (_) {}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (statusCode, o) => ({ statusCode, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS), body: JSON.stringify(o) });

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('box_stories');
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'get_only' });
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return json(a.code, { error: a.error });
  let store = deps.store;
  try { if (!store) store = await openStore(event); } catch (_) { return json(503, { error: 'store_unavailable' }); }
  const q = event.queryStringParameters || {};
  let idx = { ids: {} }; try { idx = (await store.get('index', { type: 'json' })) || idx; } catch (_) {}

  if (q.status) {
    const running = {};
    for (const id of String(q.watch || '').split(',').filter((x) => /^[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}$/.test(x)).slice(0, 20)) {
      let st = null; try { st = await store.get('status-' + id.replace('/', '-'), { type: 'json' }); } catch (_) {}
      if (st && st.state === 'recording') running[id] = { done: st.done, total: st.total };
      else if (st && st.state === 'failed') running[id] = { failed: st.error || 'failed' };
    }
    return json(200, { recorded: idx.ids, running, written: { 'reggie-biscuit-mochi': ((deps.pack || PACK).episodes || []).map((e) => e.id) } });
  }
  const series = String(q.series || ''), episode = String(q.episode || '');
  const v = idx.ids[series + '/' + episode];
  if (!v) return json(404, { error: 'not_recorded' });
  let buf = null; try { buf = await store.get('ep-' + series + '-' + episode + '_v' + v, { type: 'arrayBuffer' }); } catch (_) {}
  if (!buf || !buf.byteLength) return json(404, { error: 'not_recorded' });
  return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' }, CORS), body: Buffer.from(buf).toString('base64'), isBase64Encoded: true };
};
