/* ─────────────────────────────────────────────────────────────────────────────
   press-publish — store a new press piece in Netlify Blobs.

   Called cross-origin from Imani's Helper page on thegauntlet.studio and from
   Jess's Helper page on greylanderpress.com. Persists the piece in the
   press_pieces blob store, keyed by slug. Returns the public URL the visitor
   can share immediately.

   Optional spam gate via PRESS_PUBLISH_TOKEN env var. If set, callers must
   include header X-Press-Token matching it. Without the env var, any caller
   can publish (acceptable for a brand-new press hub with no spam yet).

   POST body : {
     title:        string  (required, 8-200 chars)
     dek:          string  (optional, 0-300 chars - subtitle)
     body:         string  (required, 200-10000 chars - the press release body)
     source_url:   string  (required, the client's site URL - the dofollow backlink target)
     source_label: string  (optional, what to call the source - "Gandhi King Foundation", etc.)
     author:       string  (optional, the byline / company representative)
     platform:     'gauntlet' | 'greylander' | 'lab'  (which platform of origin)
     slug:         string  (optional, the function will generate one if omitted)
   }
   Response  : {
     ok:     true,
     slug:   string,
     url:    string       // https://emerging-tech-lab.com/press/<slug>
   }
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const TITLE_MIN = 8, TITLE_MAX = 200;
const DEK_MAX = 300;
const BODY_MIN = 200, BODY_MAX = 10000;
const SLUG_MAX = 80;
const PLATFORMS = new Set(['gauntlet', 'greylander', 'lab']);

const PRESS_BASE_URL = 'https://emerging-tech-lab.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Press-Token',
  'Content-Type': 'application/json',
};
const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

function slugify(s, fallbackSeed) {
  const base = String(s || '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX) || ('piece-' + fallbackSeed);
  return base;
}
function shortHash(s) {
  let h = 0; const str = String(s || Date.now());
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 4);
}

function isValidUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  // Optional spam gate
  const expectedToken = process.env.PRESS_PUBLISH_TOKEN;
  if (expectedToken) {
    const provided = (event.headers && (event.headers['x-press-token'] || event.headers['X-Press-Token'])) || '';
    if (provided !== expectedToken) return json(401, { error: 'invalid press token' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const title        = String(body.title || '').trim();
  const dek          = String(body.dek || '').trim().slice(0, DEK_MAX);
  const pieceBody    = String(body.body || '').trim();
  const source_url   = String(body.source_url || '').trim();
  const source_label = String(body.source_label || '').trim().slice(0, 140);
  const author       = String(body.author || '').trim().slice(0, 140);
  const platform     = String(body.platform || 'lab').trim().toLowerCase();
  const userSlug     = String(body.slug || '').trim();

  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return json(400, { error: `title must be ${TITLE_MIN}-${TITLE_MAX} characters` });
  if (pieceBody.length < BODY_MIN || pieceBody.length > BODY_MAX) return json(400, { error: `body must be ${BODY_MIN}-${BODY_MAX} characters` });
  if (!isValidUrl(source_url)) return json(400, { error: 'source_url must be a valid http(s) URL' });
  if (!PLATFORMS.has(platform)) return json(400, { error: 'platform must be gauntlet | greylander | lab' });

  // Connect Blobs and pick the slug
  try { connectLambda(event); } catch (err) {
    console.error('[press-publish] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }
  const store = getStore('press_pieces');

  let slug = userSlug ? slugify(userSlug, shortHash(title)) : slugify(title, shortHash(title));
  // If slug already exists, append a short hash to disambiguate.
  try {
    const existing = await store.get(slug, { type: 'json' });
    if (existing) slug = slug + '-' + shortHash(title + Date.now());
  } catch (_) {}

  const piece = {
    slug,
    title,
    dek,
    body: pieceBody,
    source_url,
    source_label: source_label || (() => { try { return new URL(source_url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
    author,
    platform,
    published_at: new Date().toISOString(),
  };

  try {
    await store.setJSON(slug, piece);
    // Also append to a flat index so press-index can list pieces in order.
    const indexStore = getStore('press_index');
    let order = [];
    try { const existing = await indexStore.get('order', { type: 'json' }); if (Array.isArray(existing)) order = existing; } catch (_) {}
    order.unshift({ slug, title, dek, platform, source_label: piece.source_label, published_at: piece.published_at });
    await indexStore.setJSON('order', order.slice(0, 500));
  } catch (err) {
    console.error('[press-publish] blob write failed', err && err.message);
    return json(500, { error: 'blob write failed' });
  }

  return json(200, {
    ok: true,
    slug,
    url: PRESS_BASE_URL + '/press/' + slug,
  });
};
