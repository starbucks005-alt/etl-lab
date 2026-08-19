/* ONE-OFF, DELETED RIGHT AFTER USE. Isabelle's scene order (gco-50d7788a514ba05b)
   sits at status "waiting" even though Dr. O says she completed payment. Before
   treating it as paid (and rendering a real Veo clip on that assumption), check
   with Stripe directly whether a session for this order actually shows paid --
   the app's own record depends on a return-trip redirect that may never have
   completed, so it is not proof either way on its own. */
const Stripe = require('stripe');

const TEMP_SECRET = 'check-stripe-2026-08-19-r9w3';
const ORDER_ID = 'gco-50d7788a514ba05b';

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: 'config' });
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  const sessions = await stripe.checkout.sessions.list({ limit: 20 });
  const matches = sessions.data
    .filter(s => s.metadata && s.metadata.gc_order_id === ORDER_ID)
    .map(s => ({
      id: s.id,
      payment_status: s.payment_status,
      amount_total: s.amount_total,
      created: new Date(s.created * 1000).toISOString(),
      customer_email: s.customer_details && s.customer_details.email,
    }));

  return json(200, { order_id: ORDER_ID, matches, checked_recent: sessions.data.length });
};
