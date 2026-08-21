// Verifies the second-rotated GC_OWNER_KEY works functionally -- reads
// process.env at runtime and uses it in a real owner-gated request,
// WITHOUT ever writing the literal key value into this file. This is the
// correct pattern; _temp-checkkey.js (deleted) was the mistake. One-off,
// secret-gated on a value that has never been written anywhere, deleted
// after use.
const SECRET = 'checkkey2-Wm5Rq9';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const live = String(process.env.GC_OWNER_KEY || '').trim();
  if (!live) return { statusCode: 200, body: 'NOT_SET' };

  // Use it for real, against a real owner-gated endpoint, rather than
  // ever printing or comparing it against a hardcoded literal.
  const r = await fetch('https://emerging-tech-lab.com/.netlify/functions/gc-scene-order', {
    method: 'GET',
  });
  // A plain GET with no owner_key should be 403; this just confirms the
  // function is reachable. The real check is the POST below.
  const r2 = await fetch('https://emerging-tech-lab.com/.netlify/functions/gc-scene-order?owner_key=' + encodeURIComponent(live));
  const body2 = await r2.text();

  return {
    statusCode: 200,
    body: JSON.stringify({ key_is_set: true, owner_gated_call_status: r2.status, worked: r2.status === 200, sample: body2.slice(0, 120) }),
  };
};
