/* sun-interest: somebody who tried the Rising Sun preview says "tell me when it is ready", 2026-10-19, Dr. O: make the panel so inviting that a
   19 year old asks when she can get a light or a candle. Kept in the 'rising_sun_interest' blob store, one record per email, so a repeat is an update.
   POST { email, product: light|candle|both, fairy, source, website }  open to anyone. 'website' is a trap field a person never fills in.
   GET with Authorization: Bearer <owner key>  returns the list for Dr. O. Nothing here ever sends an email. */
const crypto = require('crypto');
const { ownerUser } = require('./_owner-auth.js');
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode, o) => ({ statusCode, headers: H, body: JSON.stringify(o) });
const PRODUCTS = ['light', 'candle', 'both'];
const FAIRIES = ['poppy', 'velvet', 'ember', 'ash', 'flint', 'tansy', 'blue'];

function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('rising_sun_interest');
}

exports.handler = async function (event, _ctx, deps = {}) {
  const store = deps.store || openStore(event);
  if (event.httpMethod === 'GET') {
    const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
    const gcOwner = String(process.env.GC_OWNER_KEY || '').trim();
    if (!ownerUser(token) && !(gcOwner && token === gcOwner)) return json(401, { error: 'owner_key_needed' });
    const out = [];
    const l = await store.list();
    for (const b of (l.blobs || [])) { const v = await store.get(b.key, { type: 'json' }); if (v) out.push(v); }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return json(200, { count: out.length, interested: out });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  if (body.website) return json(200, { ok: true });                                   // a bot filled the trap field: say thanks and keep nothing
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(400, { error: 'That does not look like an email address.' });
  const rec = {
    email,
    product: PRODUCTS.includes(body.product) ? body.product : 'both',
    fairy: FAIRIES.includes(body.fairy) ? body.fairy : '',
    source: /^[a-z0-9-]{1,40}$/.test(String(body.source || '')) ? body.source : '',
    at: new Date(deps.now || Date.now()).toISOString(),
  };
  await store.setJSON(crypto.createHash('sha256').update(email).digest('hex').slice(0, 32), rec);
  return json(200, { ok: true });
};
