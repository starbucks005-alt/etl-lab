// Kicks off a real gc-scene.js render on Isabelle's real order again, this
// time through the crop + last-frame fix, to confirm the full pipeline
// actually produces a correctly-shaped, better-looped clip end to end.
// One-off, secret-gated, deleted after use.
const SECRET = 'deliver2-h9Kx4Bn';
const BASE = 'https://emerging-tech-lab.com/.netlify/functions/gc-scene';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const ownerKey = process.env.OWNER_KEY;
  if (!ownerKey) return { statusCode: 200, body: 'NO_OWNER_KEY' };

  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_key: ownerKey, order_id: 'gco-50d7788a514ba05b', unpaid_on_purpose: true }),
  });
  const text = await r.text();
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };
};
