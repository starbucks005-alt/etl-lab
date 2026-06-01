/* ─────────────────────────────────────────────────────────────────────────────
   press-upload-image - attach a hero image to an existing press piece.

   POST /.netlify/functions/press-upload-image
   Body (JSON): {
     slug:           string  (required, must already exist in press_pieces)
     content_type:   'image/jpeg' | 'image/png' | 'image/webp'
     image_data_url: 'data:image/<type>;base64,<base64-bytes>'
   }

   Behavior:
     - Validates the data URL MIME against the allowlist and the supplied
       content_type.
     - Base64 decodes the payload and asserts byte length <= 4 MB.
     - Stores the raw bytes in the press_images blob store under key=slug
       with metadata {content_type, uploaded_at, byte_size}.
     - Loads the matching press_pieces entry, sets
       piece.hero_image_url = 'https://emerging-tech-lab.com/press-image/<slug>',
       and writes it back.
     - Patches the press_index 'order' entry for that slug so the hub list
       can show the thumbnail without a per-row blob read.

   Optional spam gate via PRESS_PUBLISH_TOKEN (X-Press-Token header), same as
   press-publish, so the Helper pages can use one token for both endpoints.

   Response: {ok: true, slug, url: 'https://emerging-tech-lab.com/press-image/<slug>'}
   Errors: 400 (bad payload), 404 (slug not in press_pieces), 401 (bad token),
   500 (blob write failed).
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE_BASE = 'https://emerging-tech-lab.com';
const MAX_SIZE_BYTES = 4 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Press-Token',
  'Content-Type': 'application/json',
};
const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

function parseDataUrl(s) {
  if (typeof s !== 'string') return null;
  const commaIdx = s.indexOf(',');
  if (commaIdx < 0) return null;
  const header = s.slice(0, commaIdx);
  const payload = s.slice(commaIdx + 1);
  const m = /^data:([^;]+);base64$/i.exec(header);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), base64: payload };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  // Optional spam gate (same env var as press-publish)
  const expectedToken = process.env.PRESS_PUBLISH_TOKEN;
  if (expectedToken) {
    const provided = (event.headers && (event.headers['x-press-token'] || event.headers['X-Press-Token'])) || '';
    if (provided !== expectedToken) return json(401, { error: 'invalid press token' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const slug = String(body.slug || '').trim();
  const content_type = String(body.content_type || '').trim().toLowerCase();
  const image_data_url = String(body.image_data_url || '');

  if (!slug) return json(400, { error: 'slug is required' });
  if (!ACCEPTED.has(content_type)) {
    return json(400, { error: 'content_type must be image/jpeg, image/png, or image/webp' });
  }

  const parsed = parseDataUrl(image_data_url);
  if (!parsed) return json(400, { error: 'image_data_url must be a data URL like data:image/png;base64,...' });
  if (parsed.mime !== content_type) {
    return json(400, { error: 'data URL MIME does not match content_type' });
  }
  if (!ACCEPTED.has(parsed.mime)) {
    return json(400, { error: 'data URL MIME is not in the accepted formats list' });
  }

  let buffer;
  try {
    buffer = Buffer.from(parsed.base64, 'base64');
  } catch (err) {
    return json(400, { error: 'failed to decode base64 payload' });
  }
  if (!buffer || buffer.length === 0) return json(400, { error: 'image payload is empty' });
  if (buffer.length > MAX_SIZE_BYTES) {
    return json(400, { error: 'image too large, max 4 MB' });
  }

  try { connectLambda(event); } catch (err) {
    console.error('[press-upload-image] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  const piecesStore = getStore('press_pieces');
  let piece;
  try { piece = await piecesStore.get(slug, { type: 'json' }); }
  catch (err) {
    console.error('[press-upload-image] piece read failed', err && err.message);
    return json(500, { error: 'piece read failed' });
  }
  if (!piece) return json(404, { error: 'slug not found in press_pieces' });

  const imagesStore = getStore('press_images');
  const uploaded_at = new Date().toISOString();
  try {
    await imagesStore.set(slug, buffer, {
      metadata: {
        content_type,
        uploaded_at,
        byte_size: buffer.length,
      },
    });
  } catch (err) {
    console.error('[press-upload-image] image write failed', err && err.message);
    return json(500, { error: 'image write failed' });
  }

  const hero_image_url = SITE_BASE + '/press-image/' + slug;
  piece.hero_image_url = hero_image_url;

  try { await piecesStore.setJSON(slug, piece); }
  catch (err) {
    console.error('[press-upload-image] piece write failed', err && err.message);
    return json(500, { error: 'piece write failed' });
  }

  // Patch the index order entry so the hub list can show thumbnails.
  try {
    const indexStore = getStore('press_index');
    const order = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(order)) {
      let mutated = false;
      for (let i = 0; i < order.length; i++) {
        if (order[i] && order[i].slug === slug) {
          order[i].hero_image_url = hero_image_url;
          mutated = true;
          break;
        }
      }
      if (mutated) await indexStore.setJSON('order', order);
    }
  } catch (err) {
    console.error('[press-upload-image] index patch failed', err && err.message);
    // Non-fatal: the piece JSON is the source of truth.
  }

  return json(200, {
    ok: true,
    slug,
    url: hero_image_url,
  });
};
