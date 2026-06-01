/* ─────────────────────────────────────────────────────────────────────────────
   press-image - serve a hero image by slug from the press_images blob store.

   GET /.netlify/functions/press-image?slug=foo (reached via the pretty
   redirect /press-image/<slug> in netlify.toml).

   Returns the raw bytes with the correct Content-Type drawn from blob
   metadata and a long, immutable Cache-Control so the edge can hold the
   image for a week. 404 responses return a tiny 1x1 transparent PNG with
   no-store so missing images do not poison the CDN cache.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const DEFAULT_CONTENT_TYPE = 'image/jpeg';

// 1x1 transparent PNG fallback for 404s.
const TRANSPARENT_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function notFoundResponse() {
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
    body: TRANSPARENT_PNG_B64,
    isBase64Encoded: true,
  };
}

exports.handler = async (event) => {
  const slug = (event.queryStringParameters && event.queryStringParameters.slug) || '';
  if (!slug) return notFoundResponse();

  try { connectLambda(event); } catch (err) {
    console.error('[press-image] connectLambda failed', err && err.message);
    return notFoundResponse();
  }

  const store = getStore('press_images');

  let arrayBuffer;
  let metadata = null;
  try {
    // Prefer the combined getWithMetadata when available so we make one round trip.
    if (typeof store.getWithMetadata === 'function') {
      const result = await store.getWithMetadata(slug, { type: 'arrayBuffer' });
      if (result && result.data) {
        arrayBuffer = result.data;
        metadata = result.metadata || null;
      }
    } else {
      arrayBuffer = await store.get(slug, { type: 'arrayBuffer' });
      try {
        if (typeof store.getMetadata === 'function') {
          metadata = await store.getMetadata(slug);
        }
      } catch (_) { /* metadata is optional */ }
    }
  } catch (err) {
    console.error('[press-image] blob read failed', err && err.message);
    return notFoundResponse();
  }

  if (!arrayBuffer) return notFoundResponse();

  const buffer = Buffer.from(arrayBuffer);
  const contentType = (metadata && metadata.content_type) || DEFAULT_CONTENT_TYPE;
  const byteSize = (metadata && metadata.byte_size) || buffer.length;
  const etag = '"' + byteSize + '-' + slug + '"';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=604800, immutable',
      'ETag': etag,
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
};
