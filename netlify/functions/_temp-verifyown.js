// Real end-to-end verification of the new own_vimeo_id path: places a
// real order (mode:'own', her own already-known Vimeo id) through the
// real gc-scene-order.js endpoint, then fulfills it through the real
// gc-scene.js endpoint (owner key read server-side), confirming the
// whole path -- order, delivery link, notification -- actually works.
// One-off, secret-gated, deleted after use.
const SECRET = 'verifyown-Ht4Qxn';
const ORDER_BASE = 'https://emerging-tech-lab.com/.netlify/functions/gc-scene-order';
const SCENE_BASE = 'https://emerging-tech-lab.com/.netlify/functions/gc-scene';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const ownerKey = process.env.OWNER_KEY;
  if (!ownerKey) return { statusCode: 200, body: 'NO_OWNER_KEY' };

  if (q.action === 'order') {
    // A tiny 1x1 portrait placeholder -- this order path never uses it
    // for a Vimeo delivery, but portrait is still required to create
    // any order.
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const r = await fetch(ORDER_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portrait: tinyPng,
        friend: { name: 'VerifyTest', gender: 'A woman' },
        mode: 'own',
        own_vimeo_id: '1219868589',
        from: '',
      }),
    });
    const text = await r.text();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };
  }

  if (q.action === 'fulfill') {
    const r = await fetch(SCENE_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_key: ownerKey, order_id: q.order_id, unpaid_on_purpose: true }),
    });
    const text = await r.text();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };
  }

  return { statusCode: 400, body: 'action required: order | fulfill' };
};
