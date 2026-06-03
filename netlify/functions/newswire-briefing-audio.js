/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-audio — serves the cached mp3 for an "Above the Fold"
   episode.

   GET /.netlify/functions/newswire-briefing-audio[?episode=<key>][?v=<ts>]

   Query params:
     episode  blob key for a specific episode (e.g. episode-2026-06-03).
              If omitted, serves the 'latest' alias (today's daily briefing).
     v        cache-buster used by the homepage strip when it knows a new
              briefing was just generated. Ignored server-side.

   Public, cached aggressively. The per-episode model means the RSS feed
   resolves each item to its own URL (?episode=<key>) and Spotify/Apple
   never see "different episode, same URL".
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

// Whitelist episode key shape: episode-YYYY-MM-DD or 'latest'. Anything
// else gets rejected as 400 - the blob store will happily return whatever
// you ask for, including unrelated keys, so we validate the request.
const VALID_EPISODE_RE = /^episode-\d{4}-\d{2}-\d{2}$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, body: 'method not allowed' };
  }

  try { connectLambda(event); } catch (_) {}

  const qs = event.queryStringParameters || {};
  const requested = (qs.episode || '').trim();

  let blobKey = 'latest';
  if (requested) {
    if (requested !== 'latest' && !VALID_EPISODE_RE.test(requested)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
        body: 'invalid episode key format',
      };
    }
    blobKey = requested;
  }

  let buffer = null;
  try {
    const audioStore = getStore('newswire_briefings_audio');
    buffer = await audioStore.get(blobKey, { type: 'arrayBuffer' });
  } catch (err) {
    console.error('[briefing-audio] read failed for', blobKey, err && err.message);
  }

  if (!buffer) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
      body: blobKey === 'latest' ? 'briefing not yet generated' : `episode ${blobKey} not found`,
    };
  }

  const bytes = Buffer.from(buffer);
  // Note: we deliberately do NOT advertise Accept-Ranges. We do not honor
  // Range requests (Netlify functions can't easily slice a response), and
  // claiming Range support without honoring it makes some browsers refuse
  // to load the audio in an HTML5 <audio> element even though direct-URL
  // navigation works fine. Force full-download by omitting that header.
  //
  // Cache: per-episode keys are immutable once written, so we cache them
  // for a day. 'latest' may change throughout the day (regenerations),
  // so it gets the shorter cache the previous version used.
  const cacheControl = blobKey === 'latest'
    ? 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600'
    : 'public, max-age=86400, s-maxage=86400, immutable';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(bytes.length),
      'Cache-Control': cacheControl,
    },
    body: bytes.toString('base64'),
    isBase64Encoded: true,
  };
};
