/* ─────────────────────────────────────────────────────────────────────────────
   dose-latest-proxy.js — server-side proxy for thedose.net's daily-dose-latest
   endpoint. Avoids CORS restriction on client-side cross-origin fetch.

   GET /.netlify/functions/dose-latest-proxy
   Public, cached 60s.
   ───────────────────────────────────────────────────────────────────────────── */

const DOSE_ORIGIN = 'https://thedose.net';
const UPSTREAM    = `${DOSE_ORIGIN}/.netlify/functions/daily-dose-latest`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function bytesToDurationLabel(bytes) {
  if (!bytes || bytes <= 0) return null;
  // ElevenLabs MP3 output: ~128 kbps = 16000 bytes/sec
  const secs = Math.round(bytes / 16000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, { headers: { 'User-Agent': 'etl-dose-proxy/1' } });
  } catch (err) {
    console.error('[dose-latest-proxy] fetch failed', err && err.message);
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'upstream unavailable' }) };
  }

  if (upstream.status === 404) {
    return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'unavailable' }) };
  }

  let data;
  try {
    data = await upstream.json();
  } catch (err) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'bad upstream response' }) };
  }

  // Rewrite relative audioUrl to absolute thedose.net URL so the browser
  // <audio> element can load it cross-origin without CORS preflight.
  if (data.audioUrl && data.audioUrl.startsWith('/')) {
    data.audioUrl = DOSE_ORIGIN + data.audioUrl;
  }

  // Compute a duration label from bytes if not already present
  if (!data.duration_label && data.bytes) {
    data.duration_label = bytesToDurationLabel(data.bytes);
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
    body: JSON.stringify(data),
  };
};
