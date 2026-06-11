/* ─────────────────────────────────────────────────────────────────────────────
   wardrobe-window

   The PUBLIC shop window. No auth: it only ever serves looks that were
   explicitly published from the fitting room ("Put in the window").

     ?list=1   -> JSON index of published looks (id, name, outfit, category)
     ?id=x     -> the look as PNG
   ───────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const params = event.queryStringParameters || {};
  const win = getStore('shop_window');

  if (params.id) {
    const id = String(params.id).replace(/[^a-z0-9-]/gi, '');
    const buf = await win.get('img/' + id + '.png', { type: 'arrayBuffer' });
    if (!buf) return { statusCode: 404, body: 'not in the window' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true,
    };
  }

  const index = (await win.get('index', { type: 'json' })) || [];
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    body: JSON.stringify(index),
  };
};
