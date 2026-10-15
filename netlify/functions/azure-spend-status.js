/* azure-spend-status — the page that shows where each Azure workload stands. Added 2026-10-14, Dr. O.
     /.netlify/functions/azure-spend-status?token=YOUR_TOKEN            the page, from the last daily run
     /.netlify/functions/azure-spend-status?token=YOUR_TOKEN&refresh=1  read Azure now instead
     add &format=json for the data
   Guarded by AZURE_SPEND_TOKEN, because it shows what the lab spends. With no token set it answers 503 and shows
   nothing. Compared in constant time. Bookmark the URL; do not share it. */

const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const spend = require('./_azure-spend.js');

function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  const want = process.env.AZURE_SPEND_TOKEN;
  if (!want) return { statusCode: 503, headers: H, body: 'tracker not set up' };
  const q = event.queryStringParameters || {};
  if (!q.token || !same(q.token, want)) return { statusCode: 401, headers: H, body: 'not allowed' };

  let sum = null;
  try {
    if (q.refresh === '1' && spend.configured()) {
      sum = spend.analyze(await spend.fetchDaily(Number(process.env.AZURE_SPEND_WINDOW_DAYS) || 60));
    } else {
      const raw = await getStore('azure-spend').get('latest');
      if (raw) sum = JSON.parse(raw);
    }
  } catch (e) {
    return { statusCode: 502, headers: H, body: 'could not read the summary: ' + String((e && e.message) || e).slice(0, 200) };
  }
  if (!sum) return { statusCode: 404, headers: H, body: 'no summary yet. The daily run has not happened, or add &refresh=1' };

  if (q.format === 'json') return { statusCode: 200, headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(sum) };
  return { statusCode: 200, headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' }, body: spend.renderHtml(sum) };
};
