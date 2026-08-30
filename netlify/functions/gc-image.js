/* gc-image — serves one generated still by order id.
   ─────────────────────────────────────────────────────────────────────────
   GET ?order_id=...&file=1 -> the image itself, PUBLIC

   NO OWNER KEY, same reasoning as gc-scene.js's own file route: receiving
   one is just a file already paid for and already generated (see
   gc-image-checkout.js's own GET, which does the actual work). Nothing
   here spends anything or starts anything -- it only ever reads a blob
   that generation already wrote.
*/

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};
  const orderId = String(qs.order_id || '').trim();
  if (!/^gci-[0-9a-f]+$/i.test(orderId)) return json(400, { error: 'order_id_required' });

  try { connectLambda(event); } catch (_) {}
  const store = getStore('gc_image_orders');

  const order = await store.get(orderId, { type: 'json' });
  if (!order || !order.image_key) return json(409, { error: 'not_ready' });

  const bytes = await store.get(order.image_key, { type: 'arrayBuffer' });
  if (!bytes) return json(404, { error: 'file_missing' });

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
    body: Buffer.from(bytes).toString('base64'),
    isBase64Encoded: true,
  };
};
