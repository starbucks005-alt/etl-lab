/* ─────────────────────────────────────────────────────────────────────────────
   rowan-world-says (reader)

   Reads back the briefs written by rowan-world-says-background:
   - ?list=1  -> the rolling index (newest first)
   - ?id=x    -> one brief, full JSON (status running|done|error)

   Auth: PRESS_ADMIN basic auth, same staff door as the trigger.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

function checkAdminAuth(event) {
  const expectedUser = process.env.PRESS_ADMIN_USER;
  const expectedPass = process.env.PRESS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) return false;
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [u, p] = decoded.split(':');
  return u === expectedUser && p === expectedPass;
}

exports.handler = async function (event) {
  if (!checkAdminAuth(event)) return { statusCode: 401, body: 'unauthorized' };
  try { connectLambda(event); } catch (_) {}

  const params = event.queryStringParameters || {};
  const store = getStore('rowan_world');
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (params.id) {
    const rec = await store.get(String(params.id), { type: 'json' });
    if (!rec) return { statusCode: 404, headers, body: JSON.stringify({ error: 'no such brief' }) };
    return { statusCode: 200, headers, body: JSON.stringify(rec) };
  }

  const index = (await store.get('index', { type: 'json' })) || [];
  return { statusCode: 200, headers, body: JSON.stringify(index) };
};
