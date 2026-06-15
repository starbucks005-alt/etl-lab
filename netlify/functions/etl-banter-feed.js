/* ─────────────────────────────────────────────────────────────────────────────
   etl-banter-feed — returns the live agency floor banter messages.

   GET /.netlify/functions/etl-banter-feed
   Returns: { messages: [{agent, role, time, ts, message}] }

   Messages are newest-first. The cron (etl-banter-cron) writes here every
   2 minutes. broadcast.html polls this every 10 seconds and appends any
   message with ts > lastSeen to the chat feed.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  try { connectLambda(event); } catch (_) {}
  const store = getStore('etl_banter');

  try {
    const msgs = await store.get('messages', { type: 'json' });
    return json(200, { messages: Array.isArray(msgs) ? msgs : [] });
  } catch (_) {
    return json(200, { messages: [] });
  }
};
