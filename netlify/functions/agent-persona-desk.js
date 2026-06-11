/* ─────────────────────────────────────────────────────────────────────────────
   agent-persona-desk

   Read side of the Persona Desk (Basic auth, PRESS_ADMIN):
     ?list=1            -> drafts index JSON (newest first)
     ?slug=x            -> full dossier JSON
     ?slug=x&img=1      -> canonical portrait PNG
   ───────────────────────────────────────────────────────────────────────── */

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

exports.handler = async (event) => {
  if (!checkAdminAuth(event)) {
    return { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="persona-desk"' }, body: 'unauthorized' };
  }
  try { connectLambda(event); } catch (_) {}

  const params = event.queryStringParameters || {};
  const store = getStore('agent_drafts');

  if (params.list) {
    const index = (await store.get('drafts/index', { type: 'json' })) || [];
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(index) };
  }

  const slug = (params.slug || '').toLowerCase().trim();
  if (!slug) return { statusCode: 400, body: 'slug required' };

  if (params.img) {
    const buf = await store.get(slug + '/portrait.png', { type: 'arrayBuffer' });
    if (!buf) return { statusCode: 404, body: 'portrait not painted yet' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="' + slug + '-portrait.png"' },
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true,
    };
  }

  const dossier = await store.get(slug + '/dossier', { type: 'json' });
  if (!dossier) return { statusCode: 404, body: 'no dossier for ' + slug };
  return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(dossier) };
};
