/* sun-apple.test.js: plain node, `node tests/sun-apple.test.js`. Signs with a key made for the test and checks the token the way Apple would: ES256, the right header and claims. Nothing touches the network. */
const assert = require('assert');
const crypto = require('crypto');
const apple = require('../netlify/functions/_apple.js');
const settings = require('../netlify/functions/sun-settings.js');
const tokenFn = require('../netlify/functions/sun-music-token.js');

(async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  // the .p8 as pasted, with Windows line endings and stray blank lines, and as the bare body
  assert(apple.cleanPrivateKey('\r\n' + pem.replace(/\n/g, '\r\n') + '\r\n\r\n').startsWith('-----BEGIN PRIVATE KEY-----'));
  assert(apple.cleanPrivateKey(body).includes('BEGIN PRIVATE KEY'));
  assert.strictEqual(apple.cleanPrivateKey('not a key'), '');
  assert.strictEqual(apple.cleanPrivateKey(''), '');
  assert.strictEqual(apple.cleanPrivateKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'), '');   // the right shape but no key inside

  const now = Date.parse('2026-10-18T12:00:00Z');
  const { token, expires_in } = apple.makeDeveloperToken({ teamId: 'ABCDE12345', keyId: 'KEYID67890', privateKey: apple.cleanPrivateKey(pem) }, { now });
  const [h, p, s] = token.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepStrictEqual(dec(h), { alg: 'ES256', kid: 'KEYID67890' });
  assert.strictEqual(dec(p).iss, 'ABCDE12345'); assert.strictEqual(dec(p).iat, Math.floor(now / 1000)); assert.strictEqual(dec(p).exp - dec(p).iat, 12 * 3600);
  assert.strictEqual(expires_in, 12 * 3600);
  assert(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));   // the signature checks out
  assert.strictEqual(Buffer.from(s, 'base64url').length, 64);                                                                          // raw r and s, as JWT requires
  assert.throws(() => apple.makeDeveloperToken({ teamId: 'bad', keyId: 'KEYID67890', privateKey: pem }), /apple_not_set/);
  assert.throws(() => apple.makeDeveloperToken({ teamId: 'ABCDE12345', keyId: 'KEYID67890', privateKey: '' }), /apple_not_set/);

  // saving from the panel: kept, never sent back, needs all three
  const mem = {}; const store = { get: async (k) => mem[k] || null, setJSON: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
  const call = (method, body2) => settings.handler({ httpMethod: method, headers: { 'x-sun-key': 'k' }, body: body2 ? JSON.stringify(body2) : '' }, {}, { env: { SUN_DEVICE_KEY: 'k' }, store });
  let r = JSON.parse((await call('POST', { apple_team_id: 'abcde12345', apple_key_id: 'keyid67890', apple_private_key: pem })).body);
  assert.strictEqual(r.settings.apple_set, true);
  assert(!JSON.stringify(r).includes('BEGIN PRIVATE') && !JSON.stringify(r).includes('ABCDE12345') && !JSON.stringify(r).includes(body.slice(10, 40)));
  assert.strictEqual(mem.settings.apple_team_id, 'ABCDE12345');                                                                         // upper-cased
  await call('POST', { apple_key_id: 'short' });
  assert.strictEqual(mem.settings.apple_key_id, 'KEYID67890');                                                                          // a bad id is refused
  await call('POST', { apple_private_key: 'garbage' });
  assert(mem.settings.apple_private_key.includes('BEGIN PRIVATE KEY'));                                                                 // a bad key is refused

  // the token function
  const get = (key, deps) => tokenFn.handler({ httpMethod: 'GET', headers: { 'x-sun-key': key } }, {}, deps);
  assert.strictEqual((await get('x', { env: {}, store })).statusCode, 503);
  assert.strictEqual((await get('wrong', { env: { SUN_DEVICE_KEY: 'k' }, store })).statusCode, 401);
  const ok = await get('k', { env: { SUN_DEVICE_KEY: 'k' }, store, now });
  assert.strictEqual(ok.statusCode, 200);
  const [h2, p2, s2] = JSON.parse(ok.body).token.split('.');
  assert.strictEqual(h2 + '.' + p2, h + '.' + p);                                                                                       // same header and claims (the signature differs each time, by design)
  assert(crypto.verify('sha256', Buffer.from(h2 + '.' + p2), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s2, 'base64url'))); assert.strictEqual(ok.headers['Cache-Control'], 'no-store');
  await call('POST', { apple_team_id: '' });                                                                                            // clearing removes all three
  assert.strictEqual(JSON.parse((await call('GET')).body).settings.apple_set, false);
  assert.strictEqual((await get('k', { env: { SUN_DEVICE_KEY: 'k' }, store })).statusCode, 404);
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
