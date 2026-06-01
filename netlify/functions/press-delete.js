/* ─────────────────────────────────────────────────────────────────────────────
   press-delete — remove a press piece.

   POST /.netlify/functions/press-delete
   Basic-auth gated against PRESS_ADMIN_USER + PRESS_ADMIN_PASS env vars.
   Same-origin gated: Origin or Referer must be https://emerging-tech-lab.com.

   Body: { slug: string }

   Removes the entry from press_pieces, best-effort removes the matching key
   from press_images, and filters the slug out of the press_index 'order'
   array. Returns { ok: true, slug }. 404 if slug not present.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const ALLOWED_ORIGIN_HOSTS = new Set([
  'emerging-tech-lab.com',
  'www.emerging-tech-lab.com',
]);

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function requireBasicAuth(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    return { ok: false, response: { statusCode: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'admin disabled' } };
  }
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = /^Basic\s+(.+)$/i.exec(header);
  if (!m) {
    return { ok: false, response: { statusCode: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic realm="ETL Press Admin", charset="UTF-8"' }, body: JSON.stringify({ error: 'auth required' }) } };
  }
  let decoded = '';
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch { decoded = ''; }
  const idx = decoded.indexOf(':');
  const u = idx >= 0 ? decoded.slice(0, idx) : '';
  const p = idx >= 0 ? decoded.slice(idx + 1) : '';
  if (u !== user || p !== pass) {
    return { ok: false, response: { statusCode: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic realm="ETL Press Admin", charset="UTF-8"' }, body: JSON.stringify({ error: 'invalid credentials' }) } };
  }
  return { ok: true };
}

function originHost(value) {
  if (!value) return '';
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}

function requireSameOrigin(event) {
  const h = event.headers || {};
  const oh = originHost(h.origin || h.Origin || '');
  const rh = originHost(h.referer || h.Referer || '');
  if (oh && ALLOWED_ORIGIN_HOSTS.has(oh)) return true;
  if (rh && ALLOWED_ORIGIN_HOSTS.has(rh)) return true;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  if (!requireSameOrigin(event)) {
    return json(403, { error: 'cross-origin request refused' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const slug = String(body.slug || '').trim();
  if (!slug) return json(400, { error: 'slug required' });

  try { connectLambda(event); } catch (err) {
    console.error('[press-delete] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  const piecesStore = getStore('press_pieces');
  let existing = null;
  try {
    existing = await piecesStore.get(slug, { type: 'json' });
  } catch (err) {
    console.error('[press-delete] blob read failed', err && err.message);
    // Continue: maybe the index can still be cleaned up.
  }

  // Always attempt the blob delete - idempotent for missing keys. This also
  // clears "zombie" blob keys that exist with empty/null values, which the
  // admin lists from piecesStore.list() and we need to remove.
  try {
    await piecesStore.delete(slug);
  } catch (err) {
    // Netlify Blobs delete on a missing key is supposed to succeed silently.
    // If we hit an error here, log it but continue - the index cleanup below
    // is still worth attempting.
    console.warn('[press-delete] piece delete error (continuing)', err && err.message);
  }

  // Best-effort delete of the matching hero image.
  try {
    const imagesStore = getStore('press_images');
    await imagesStore.delete(slug);
  } catch (err) {
    // Swallow: image may not exist, and that's fine.
    console.warn('[press-delete] image delete skipped', err && err.message);
  }

  // Patch the index.
  let indexRemoved = false;
  try {
    const indexStore = getStore('press_index');
    let order = [];
    try { const arr = await indexStore.get('order', { type: 'json' }); if (Array.isArray(arr)) order = arr; } catch (_) {}
    const filtered = order.filter(o => o && o.slug !== slug);
    if (filtered.length !== order.length) {
      await indexStore.setJSON('order', filtered);
      indexRemoved = true;
    }
  } catch (err) {
    console.error('[press-delete] press_index patch failed', err && err.message);
    // Non-fatal: piece itself is gone.
  }

  // Always return 200. Delete is idempotent: if nothing was actually present
  // to clean up, that is fine. The admin list will refresh and the row goes
  // away. Surface what we did via the response for debugging.
  return json(200, {
    ok: true,
    slug,
    was_orphan: !existing,
    index_cleaned: indexRemoved,
  });
};
