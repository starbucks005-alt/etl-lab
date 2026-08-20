// Final real end-to-end confirmation: both the tested prompt AND the
// actually-wired-in crop fix, through the real production endpoint.
// One-off, secret-gated, deleted after use.
const SECRET = 'final-Wn3xRq';
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
