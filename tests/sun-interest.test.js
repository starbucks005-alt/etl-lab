const assert = require('assert');
const h = require('../netlify/functions/sun-interest.js').handler;
(async () => {
  const mem = {};
  const store = { setJSON: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, get: async (k) => mem[k] || null, list: async () => ({ blobs: Object.keys(mem).map((key) => ({ key })) }) };
  const post = (b) => h({ httpMethod: 'POST', headers: {}, body: JSON.stringify(b) }, {}, { store, now: 1760000000000 });
  assert.strictEqual((await post({ email: 'nope' })).statusCode, 400);
  assert.strictEqual((await post({ email: 'a@b.co', website: 'spam.com' })).statusCode, 200);
  assert.strictEqual(Object.keys(mem).length, 0);                                       // the trap field keeps nothing
  assert.strictEqual((await post({ email: 'Her@Example.com ', product: 'candle', fairy: 'ember', source: 'qr-1' })).statusCode, 200);
  await post({ email: 'her@example.com', product: 'light', fairy: 'nobody<script>' });
  const k = Object.keys(mem); assert.strictEqual(k.length, 1);                          // the same person twice is one record
  const r = mem[k[0]]; assert.strictEqual(r.product, 'light'); assert.strictEqual(r.fairy, ''); assert.strictEqual(r.email, 'her@example.com');
  assert.strictEqual((await h({ httpMethod: 'GET', headers: {} }, {}, { store })).statusCode, 401);   // a stranger cannot read the list
  assert.strictEqual((await h({ httpMethod: 'DELETE', headers: {} }, {}, { store })).statusCode, 405);
  console.log('ok: interest list');
})().catch((e) => { console.error(e); process.exit(1); });
