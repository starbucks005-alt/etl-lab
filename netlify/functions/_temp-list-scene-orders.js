/* ONE-OFF, DELETED RIGHT AFTER USE. Dr. O paid for a scene for Isabelle and
   got no video -- gc-scene.js's render step is owner-only and payment never
   auto-triggers it, so her paid order is just sitting in the queue. This
   reads that queue using the real OWNER_KEY from the environment (never
   exposed to either of us) via gc-scene-order.js's own existing owner-only
   listing, rather than re-guessing the storage shape here. */
const { connectLambda } = require('@netlify/blobs');

const TEMP_SECRET = 'list-orders-2026-08-19-h4k9';

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const owner = process.env.OWNER_KEY;
  if (!owner) return json(500, { error: 'config' });

  const r = await fetch(
    'https://emerging-tech-lab.com/.netlify/functions/gc-scene-order?owner_key=' + encodeURIComponent(owner)
  );
  const data = await r.json();
  return json(r.status, data);
};
