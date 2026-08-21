// Verifies the second-rotated GC_OWNER_KEY without ever writing the literal
// value in this file -- compares a SHA-256 hash instead (one-way, so the hash
// itself leaking would not expose the secret). The first version of this
// check hit gc-scene-order.js, which actually gates on OWNER_KEY, not
// GC_OWNER_KEY -- wrong endpoint, not a broken rotation. GC_OWNER_KEY is only
// ever compared inside gc-chat.js/gc-voice.js against body.owner_key, and
// calling either for real would spend money, so this checks the env var
// directly instead.
const crypto = require('crypto');
const SECRET = 'checkkey2-Wm5Rq9';
const EXPECTED_HASH = '4bee29aa655d97b17f6c7542a51ad2f02c75431b77cff530ec7ccc65a0dc969f';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const live = String(process.env.GC_OWNER_KEY || '').trim();
  if (!live) return { statusCode: 200, body: 'NOT_SET' };

  const liveHash = crypto.createHash('sha256').update(live).digest('hex');

  return {
    statusCode: 200,
    body: JSON.stringify({ key_is_set: true, matches_rotated_value: liveHash === EXPECTED_HASH }),
  };
};
