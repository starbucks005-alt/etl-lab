const assert = require('assert');
const sun = require('../netlify/functions/_sun.js');
const gc = require('../netlify/functions/_gc-config.js');
(async () => {
  const ev = (k) => ({ headers: { 'x-sun-key': k } });
  const none = async () => ({});
  const set = async () => ({ sun_key_hash: gc.hash('my-private-sun-key-77') });
  assert.strictEqual((await sun.authorized(ev('x'), {}, none)).code, 503);                       // nothing set anywhere: closed
  assert.strictEqual((await sun.authorized(ev(''), {}, set)).code, 401);                         // empty never matches
  assert.strictEqual((await sun.authorized(ev('wrong'), {}, set)).code, 401);
  assert.strictEqual((await sun.authorized(ev('my-private-sun-key-77'), {}, set)).ok, true);     // the private record works
  assert.strictEqual((await sun.authorized(ev('envkey'), { SUN_DEVICE_KEY: 'envkey' }, none)).ok, true);  // the environment variable still works
  assert.strictEqual((await sun.authorized(ev('my-private-sun-key-77'), { SUN_DEVICE_KEY: 'envkey' }, set)).code, 401);
  assert.strictEqual((await sun.authorized(ev('x'), {}, async () => { throw new Error('blob'); })).code, 503);
  const cfg = require('../netlify/functions/gc-config.js');
  console.log('ok: the sun key can live in private storage');
})().catch((e) => { console.error(e); process.exit(1); });
