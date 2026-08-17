/* gc-notify-test — prove the paid-order email actually arrives.
   ─────────────────────────────────────────────────────────────────────────
   GET/POST ?owner_key=...   -> { sent, to, reason }

   The order path and the payment gate are both verified against the live
   site. The email is not, and could not be without putting a real card
   through Stripe Checkout. This is the cheap way to find out, and it matters
   because that email is the only thing that tells anybody a person has paid
   and is waiting.

   IT SENDS THE REAL EMAIL, through the real function, with a test banner on
   it. Nothing here is a stand-in: _gc-notify.orderPaid is what a genuine paid
   order calls. A test that copies the code tests the copy, and would pass with
   a valid key and a broken sender.

   IT SAYS WHY IT FAILED. On the payment path a mail failure is swallowed on
   purpose, so somebody who has been charged still gets confirmed, which means
   the reason only ever reaches a log nobody is reading. Here it comes back in
   the answer.

   OWNER ONLY, because otherwise it is a button that sends mail to Dr. O.
*/

const notify = require('./_gc-notify.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const given = String(qs.owner_key || body.owner_key || '');
  if (!process.env.OWNER_KEY || given !== process.env.OWNER_KEY) {
    return json(403, { error: 'owner_only' });
  }

  /* Shaped exactly like a real one, and obviously not one. The words are
     deliberately ordinary so the email reads the way a real order will. */
  const pretend = {
    order_id: 'gco-test-0000000000000000',
    friend_name: 'A test, not a real friend',
    where: 'at the kitchen table with the morning light coming in',
    from: 'nobody, this is a test',
  };

  const result = await notify.orderPaid(pretend, { test: true });

  return json(result.sent ? 200 : 502, {
    ok: result.sent,
    sent: result.sent,
    to: result.to,
    reason: result.reason,
    note: result.sent
      ? 'Sent. If it does not arrive, the address is right and the delivery is not: ' +
        'check spam, then Resend’s own log.'
      : 'Not sent, and this is exactly what would have failed silently behind a real payment.',
  });
};
