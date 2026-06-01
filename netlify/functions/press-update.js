/* ─────────────────────────────────────────────────────────────────────────────
   press-update — edit an existing press piece.

   POST /.netlify/functions/press-update
   Basic-auth gated against PRESS_ADMIN_USER + PRESS_ADMIN_PASS env vars.
   Same-origin gated: Origin or Referer must be https://emerging-tech-lab.com
   to defeat CSRF against cached Basic credentials.

   Body: { slug: string, title?, dek?, body?, source_url?, source_label?,
           author?, hero_image_url? }

   Only fields present in the body are updated. slug, platform, and
   published_at are immutable. Returns { ok: true, slug, url }.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const TITLE_MIN = 8, TITLE_MAX = 200;
const DEK_MAX = 300;
const BODY_MIN = 40, BODY_MAX = 10000;
const LABEL_MAX = 140;
const AUTHOR_MAX = 140;

const PRESS_BASE_URL = 'https://emerging-tech-lab.com';
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
  const origin = h.origin || h.Origin || '';
  const referer = h.referer || h.Referer || '';
  const oh = originHost(origin);
  const rh = originHost(referer);
  if (oh && ALLOWED_ORIGIN_HOSTS.has(oh)) return true;
  if (rh && ALLOWED_ORIGIN_HOSTS.has(rh)) return true;
  return false;
}

function isValidUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
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
    console.error('[press-update] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  const piecesStore = getStore('press_pieces');
  let existing;
  try {
    existing = await piecesStore.get(slug, { type: 'json' });
  } catch (err) {
    console.error('[press-update] blob read failed', err && err.message);
    return json(500, { error: 'blob read failed' });
  }
  if (!existing || typeof existing !== 'object') {
    return json(404, { error: 'slug not found' });
  }

  const merged = Object.assign({}, existing);

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const v = String(body.title || '').trim();
    if (v.length < TITLE_MIN || v.length > TITLE_MAX) return json(400, { error: `title must be ${TITLE_MIN}-${TITLE_MAX} characters` });
    merged.title = v;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dek')) {
    merged.dek = String(body.dek || '').trim().slice(0, DEK_MAX);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'body')) {
    const v = String(body.body || '').trim();
    if (v.length < BODY_MIN || v.length > BODY_MAX) return json(400, { error: `body must be ${BODY_MIN}-${BODY_MAX} characters` });
    merged.body = v;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'source_url')) {
    const v = String(body.source_url || '').trim();
    if (!isValidUrl(v)) return json(400, { error: 'source_url must be a valid http(s) URL' });
    merged.source_url = v;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'source_label')) {
    merged.source_label = String(body.source_label || '').trim().slice(0, LABEL_MAX);
    if (!merged.source_label) {
      try { merged.source_label = new URL(merged.source_url).hostname.replace(/^www\./, ''); } catch { merged.source_label = ''; }
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'author')) {
    merged.author = String(body.author || '').trim().slice(0, AUTHOR_MAX);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'hero_image_url')) {
    const raw = body.hero_image_url;
    if (raw === null || raw === '') {
      merged.hero_image_url = null;
    } else if (typeof raw === 'string' && isValidUrl(raw)) {
      merged.hero_image_url = raw;
    } else {
      return json(400, { error: 'hero_image_url must be a valid URL, empty string, or null' });
    }
  }
  // Newswire schema edits
  const DESKS = new Set(['us', 'world', 'business', 'technology', 'security', 'science', 'health', 'entertainment', 'sports']);
  if (Object.prototype.hasOwnProperty.call(body, 'desk')) {
    const v = String(body.desk || '').trim().toLowerCase();
    if (!DESKS.has(v)) return json(400, { error: 'desk must be one of: ' + Array.from(DESKS).join(', ') });
    merged.desk = v;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'byline_kind')) {
    const v = String(body.byline_kind || '').trim().toLowerCase();
    if (v !== 'client' && v !== 'reporter') return json(400, { error: 'byline_kind must be client | reporter' });
    merged.byline_kind = v;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'reporter_id')) {
    merged.reporter_id = String(body.reporter_id || '').trim().slice(0, 80) || null;
  }

  // Immutable fields: enforce by reverting to existing values.
  merged.slug = existing.slug;
  merged.platform = existing.platform;
  merged.published_at = existing.published_at;

  try {
    await piecesStore.setJSON(slug, merged);
  } catch (err) {
    console.error('[press-update] blob write failed', err && err.message);
    return json(500, { error: 'blob write failed' });
  }

  // Patch the press_index 'order' entry so the public hub list reflects the
  // edit. Platform and published_at are immutable so we don't touch those.
  try {
    const indexStore = getStore('press_index');
    let order = [];
    try { const arr = await indexStore.get('order', { type: 'json' }); if (Array.isArray(arr)) order = arr; } catch (_) {}
    let touched = false;
    for (let i = 0; i < order.length; i++) {
      if (order[i] && order[i].slug === slug) {
        order[i] = Object.assign({}, order[i], {
          title: merged.title,
          dek: merged.dek,
          platform: merged.platform,
          source_label: merged.source_label,
          published_at: merged.published_at,
        });
        if (Object.prototype.hasOwnProperty.call(merged, 'hero_image_url')) {
          if (merged.hero_image_url) order[i].hero_image_url = merged.hero_image_url;
          else delete order[i].hero_image_url;
        }
        if (merged.desk) order[i].desk = merged.desk;
        if (merged.byline_kind) order[i].byline_kind = merged.byline_kind;
        if (merged.reporter_id) order[i].reporter_id = merged.reporter_id;
        else if (merged.byline_kind === 'client') delete order[i].reporter_id;
        touched = true;
        break;
      }
    }
    if (touched) await indexStore.setJSON('order', order);
  } catch (err) {
    console.error('[press-update] press_index patch failed', err && err.message);
    // Non-fatal: the piece itself updated. Don't fail the request.
  }

  return json(200, {
    ok: true,
    slug,
    url: PRESS_BASE_URL + '/press/' + slug,
  });
};
