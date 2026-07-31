/* etl-design-purge — delete ETL Design jobs and their renders.
   ─────────────────────────────────────────────────────────────────────────
   POST { job_ids: [...] }  or  { all: true }   -> { ok, deleted }
   Auth: admin basic auth, the same PRESS_ADMIN_USER / PRESS_ADMIN_PASS pair
   the cron paths use. This deletes things, so it is never public.

   Why it exists (2026-07-30): the first day of ETL Design testing generated
   pieces for businesses that do not exist, and at least one of those names,
   Foxglove in Yellow Springs, belongs to a REAL business that never asked for
   marketing material. Dr. O: "we will come across as frauds if anyone googles
   them." The renders are served by etl-design-image with no auth, so while the
   job ids are random and nothing links to them, they are fetchable by anyone
   holding a URL. They should not exist.

   Each job owns three keys: the JSON record, <id>.png, and <id>.svg.
*/

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function authorized(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    console.error('[etl-design-purge] refused: PRESS_ADMIN_USER/PASS not set');
    return false;
  }
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!/^basic /i.test(h)) return false;
  let decoded = '';
  try { decoded = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8'); } catch (_) { return false; }
  const i = decoded.indexOf(':');
  return i > 0 && decoded.slice(0, i) === user && decoded.slice(i + 1) === pass;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!authorized(event)) return json(401, { error: 'unauthorized' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore('etl_design_jobs'); } catch (e) {
    return json(500, { error: 'store_unavailable', detail: e && e.message });
  }

  let ids = [];
  if (body.all === true) {
    // Every key in the store, reduced to job ids. Listing rather than
    // guessing, so nothing is left behind because it was named unexpectedly.
    try {
      const listed = await store.list();
      const seen = new Set();
      for (const b of (listed.blobs || [])) {
        const id = String(b.key || '').replace(/\.(png|svg)$/i, '');
        if (/^dsn-/i.test(id)) seen.add(id);
      }
      ids = [...seen];
    } catch (e) {
      return json(500, { error: 'list_failed', detail: e && e.message });
    }
  } else if (Array.isArray(body.job_ids)) {
    ids = body.job_ids.map(s => String(s || '').trim()).filter(s => /^dsn-[0-9a-z-]+$/i.test(s));
  }
  if (!ids.length) return json(400, { error: 'nothing_to_delete' });

  const deleted = [];
  const failed = [];
  for (const id of ids) {
    for (const key of [id, id + '.png', id + '.svg']) {
      try { await store.delete(key); deleted.push(key); }
      catch (e) { failed.push(key + ': ' + (e && e.message)); }
    }
  }
  console.log('[etl-design-purge] deleted ' + deleted.length + ' keys across ' + ids.length + ' jobs');
  return json(200, { ok: true, jobs: ids.length, deleted: deleted.length, failed });
};
