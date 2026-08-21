// Confirms the freshly-rotated GC_OWNER_KEY is actually live in a deployed
// function, without ever echoing the value itself. One-off, secret-gated,
// deleted after use.
const SECRET = 'checkkey-Rn8Yq2';
const EXPECTED = '9VRGV0WxyrVI4N_lG2i6uh9S0MYzaAl2';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };
  const live = String(process.env.GC_OWNER_KEY || '').trim();
  return { statusCode: 200, body: JSON.stringify({ matches_new_value: live === EXPECTED, is_set: !!live }) };
};
