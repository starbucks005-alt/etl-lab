// Calls the REAL gc-scene.js handler directly (in-process), using the real
// owner key read server-side (never exposed to the caller), to prove the
// actual production retry-on-filter path works end to end, not just the
// standalone diagnostic. Secret-gated, one-off, deleted after use.
const scene = require('./gc-scene.js');

const SECRET = 'veo-verify-7bq2Ln';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const ownerKey = process.env.OWNER_KEY;
  if (!ownerKey) return { statusCode: 200, body: 'NO_OWNER_KEY' };

  if (q.action === 'start') {
    const fakeEvent = {
      httpMethod: 'POST',
      queryStringParameters: {},
      body: JSON.stringify({
        owner_key: ownerKey,
        order_id: 'gco-50d7788a514ba05b',
        unpaid_on_purpose: true,
      }),
    };
    const res = await scene.handler(fakeEvent);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: res.body };
  }

  if (q.action === 'poll') {
    const fakeEvent = {
      httpMethod: 'GET',
      queryStringParameters: { job_id: q.job_id, owner_key: ownerKey },
      body: '{}',
    };
    const res = await scene.handler(fakeEvent);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: res.body };
  }

  return { statusCode: 400, body: 'action required: start | poll' };
};
