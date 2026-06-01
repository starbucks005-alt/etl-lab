/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-audio — serves the cached mp3 for the latest "5 in
   Under 5" briefing.

   GET /.netlify/functions/newswire-briefing-audio[?v=<timestamp>]
   Public, cached aggressively. The ?v=<timestamp> query param is the
   cache-buster the homepage strip uses to force a refresh after a new
   briefing is generated.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, body: 'method not allowed' };
  }

  try { connectLambda(event); } catch (_) {}

  let buffer = null;
  try {
    const audioStore = getStore('newswire_briefings_audio');
    buffer = await audioStore.get('latest', { type: 'arrayBuffer' });
  } catch (err) {
    console.error('[briefing-audio] read failed', err && err.message);
  }

  if (!buffer) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
      body: 'briefing not yet generated',
    };
  }

  const bytes = Buffer.from(buffer);
  // Note: we deliberately do NOT advertise Accept-Ranges. We do not honor
  // Range requests (Netlify functions can't easily slice a response), and
  // claiming Range support without honoring it makes some browsers refuse
  // to load the audio in an HTML5 <audio> element even though direct-URL
  // navigation works fine. Force full-download by omitting that header.
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600',
    },
    body: bytes.toString('base64'),
    isBase64Encoded: true,
  };
};
