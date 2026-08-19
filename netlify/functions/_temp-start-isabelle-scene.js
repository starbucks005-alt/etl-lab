/* ONE-OFF, DELETED RIGHT AFTER USE. Starts the actual Veo render for
   Isabelle's now-confirmed-paid scene order, using the real OWNER_KEY from
   the environment (never exposed to either of us). gc-scene.js's own POST
   is owner-only; its GET (polling) is not, so nothing further needs this
   temp file once the job_id comes back. */
const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

const TEMP_SECRET = 'start-scene-2026-08-19-t2m8';
const ORDER_ID = 'gco-50d7788a514ba05b';

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const owner = process.env.OWNER_KEY;
  if (!owner) return json(500, { error: 'config' });

  const r = await fetch('https://emerging-tech-lab.com/.netlify/functions/gc-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_key: owner, order_id: ORDER_ID }),
  });
  const data = await r.json();
  return json(r.status, data);
};
