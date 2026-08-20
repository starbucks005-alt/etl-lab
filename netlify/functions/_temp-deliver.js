// Kicks off the REAL gc-scene.js POST endpoint over real HTTP (not in-process,
// which hit a Netlify Blobs context issue on the last attempt) for Isabelle's
// actual stuck order, using the real OWNER_KEY read server-side and never
// exposed to the caller. One-off, secret-gated, deleted after use.
const SECRET = 'deliver-isabelle-k3n8Wp';
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
