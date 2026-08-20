// Real end-to-end test of the new default prompt, through the actual
// production gc-scene.js POST endpoint (real HTTP, real owner key read
// server-side), against Isabelle's real order and real (uncropped, since
// this exercises the pipeline's own crop step too) portrait. One-off,
// secret-gated, deleted after use.
const SECRET = 'trynew-Qp6xLv';
const BASE = 'https://emerging-tech-lab.com/.netlify/functions/gc-scene';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const ownerKey = process.env.OWNER_KEY;
  if (!ownerKey) return { statusCode: 200, body: 'NO_OWNER_KEY' };

  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_key: ownerKey, order_id: 'gco-50d7788a514ba05b' }),
  });
  const text = await r.text();
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };
};
