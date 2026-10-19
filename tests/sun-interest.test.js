const assert = require('assert');
const h = require('../netlify/functions/sun-interest.js').handler;
(async () => {
  const mem = {};
  const store = { setJSON: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, get: async (k) => mem[k] || null, list: async () => ({ blobs: Object.keys(mem).map((key) => ({ key })) }) };
  const sent = [];
  const fetchFn = async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200 }; };
  const deps = { store, now: 1760000000000, fetchFn, env: { RESEND_API_KEY: 'rk' } };
  const post = (b, d) => h({ httpMethod: 'POST', headers: {}, body: JSON.stringify(b) }, {}, Object.assign({}, deps, d || {}));
  assert.strictEqual((await post({ email: 'nope' })).statusCode, 400);
  assert.strictEqual((await post({ email: 'a@b.co', website: 'spam.com' })).statusCode, 200);
  assert.strictEqual(Object.keys(mem).length, 0); assert.strictEqual(sent.length, 0);                    // the trap field keeps nothing and sends nothing
  assert.strictEqual((await post({ email: 'Her@Example.com ', product: 'candle', fairy: 'ember', source: 'qr-1' })).statusCode, 200);
  assert.strictEqual(sent.length, 1); assert.ok(sent[0].html.includes('Take me off the list'));          // the first signup gets one note, with a way off
  await post({ email: 'her@example.com', product: 'light', fairy: 'nobody<script>' });
  assert.strictEqual(sent.length, 1);                                                                    // a repeat sends nothing more
  const recs = Object.keys(mem).filter((k) => k.indexOf('u-') !== 0); assert.strictEqual(recs.length, 1);
  assert.strictEqual(mem[recs[0]].product, 'light'); assert.strictEqual(mem[recs[0]].fairy, '');
  await post({ email: 'two@example.com', product: 'light' }, { fetchFn: async () => { throw new Error('down'); } });   // mail failing never loses a signup
  assert.strictEqual(Object.keys(mem).filter((k) => k.indexOf('u-') !== 0).length, 2);
  // a stranger can neither read the list nor send to it
  assert.strictEqual((await h({ httpMethod: 'GET', headers: {} }, {}, deps)).statusCode, 401);
  assert.strictEqual((await post({ action: 'announce', subject: 's', message: 'm' })).statusCode, 401);
  // the way off the list
  const tok = mem[recs[0]].token;
  const off = await h({ httpMethod: 'GET', headers: {}, queryStringParameters: { u: tok } }, {}, deps);
  assert.ok(/off the list/.test(off.body)); assert.strictEqual(mem[recs[0]].unsubscribed, true);
  assert.ok(/not valid/.test((await h({ httpMethod: 'GET', headers: {}, queryStringParameters: { u: 'nonsense' } }, {}, deps)).body));
  // announcing, as the owner (the owner key is read from the environment the way the other owner doors do)
  process.env.GC_OWNER_KEY = 'owner-test-key';
  const own = { authorization: 'Bearer owner-test-key' };
  const ann = (b) => h({ httpMethod: 'POST', headers: own, body: JSON.stringify(b) }, {}, deps);
  sent.length = 0;
  let r = JSON.parse((await ann({ action: 'announce', subject: 'Ready', message: 'The light is ready.', test: true })).body);
  assert.strictEqual(r.sent, 1); assert.strictEqual(sent[0].to[0], 'drterryoroszi@emerging-tech-lab.com');   // a test goes only to Dr. O
  sent.length = 0;
  r = JSON.parse((await ann({ action: 'announce', subject: 'Ready', message: 'The light is ready.\n\nSecond line.' })).body);
  assert.strictEqual(r.sent, 1); assert.strictEqual(sent[0].to[0], 'two@example.com');                       // the one who left is skipped
  const list = JSON.parse((await h({ httpMethod: 'GET', headers: own }, {}, deps)).body);
  assert.strictEqual(list.count, 2); assert.strictEqual(list.active, 1); assert.ok(!JSON.stringify(list).includes(tok));   // the list never shows anyone's way-off token
  assert.strictEqual((await h({ httpMethod: 'DELETE', headers: {} }, {}, deps)).statusCode, 405);
  console.log('ok: the alert list');
})().catch((e) => { console.error(e); process.exit(1); });
