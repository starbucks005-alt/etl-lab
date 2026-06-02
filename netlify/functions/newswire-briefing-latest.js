/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-latest — returns metadata for the latest "5 in Under 5"
   briefing. Used by the homepage strip to decide whether to render the audio
   player and what to put under it.

   GET /.netlify/functions/newswire-briefing-latest
   Public, cached 60s.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  try { connectLambda(event); } catch (_) {}

  let meta = null;
  try {
    const metaStore = getStore('newswire_briefings_meta');
    meta = await metaStore.get('latest', { type: 'json' });
  } catch (err) {
    console.error('[briefing-latest] meta read failed', err && err.message);
  }

  if (!meta) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
      body: JSON.stringify({ available: false }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      // Short cache so freshly regenerated briefings appear within seconds,
      // not minutes. The audio file itself is still cached aggressively
      // (10-min) - this is just the metadata pointer.
      'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=60',
    },
    body: JSON.stringify({ available: true, ...meta }),
  };
};
