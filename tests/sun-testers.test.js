const assert = require('assert');
const sun = require('../netlify/functions/_sun.js');
const gc = require('../netlify/functions/_gc-config.js');
const settings = require('../netlify/functions/sun-settings.js');
(async () => {
  const ev = (k, m, b) => ({ httpMethod: m || 'GET', headers: { 'x-sun-key': k }, body: b ? JSON.stringify(b) : '' });
  const cfg = async () => ({ sun_key_hash: gc.hash('owner-code-123456'), sun_testers: [{ id: 'pookie', hash: gc.hash('pookie-code-654321') }] });
  assert.strictEqual((await sun.authorized(ev('owner-code-123456'), {}, cfg)).who, 'owner');
  assert.strictEqual((await sun.authorized(ev('pookie-code-654321'), {}, cfg)).who, 't-pookie');
  assert.strictEqual((await sun.authorized(ev('nope'), {}, cfg)).code, 401);
  assert.strictEqual((await sun.authorized(ev(''), {}, cfg)).code, 401);
  const mem = {}; const store = { get: async (k) => mem[k] || null, setJSON: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
  const call = (k, m, b) => settings.handler(ev(k, m, b), {}, { loadCfg: cfg, store });
  await call('owner-code-123456', 'POST', { bedrock_key: 'SECRETBEDROCKKEY1234567890', wake_hour: 6, reminders: ['owner pill'] });
  const t1 = JSON.parse((await call('pookie-code-654321', 'POST', { bedrock_key: 'HACK', wake_hour: 9, reminders: ['pookie thing'] })).body);
  assert.strictEqual(t1.settings.wake_hour, 9);                                               // her own settings
  assert.deepStrictEqual(t1.settings.reminders, ['pookie thing']);
  assert.strictEqual(t1.settings.bedrock_set, true);                                          // ETL's key is there for her to use, never shown
  assert.ok(!JSON.stringify(t1).includes('SECRETBEDROCKKEY1234567890') && !JSON.stringify(t1).includes('HACK'));
  const o = JSON.parse((await call('owner-code-123456', 'GET')).body);
  assert.strictEqual(o.settings.wake_hour, 6);                                                // the owner's are untouched
  assert.deepStrictEqual(o.settings.reminders, ['owner pill']);
  assert.strictEqual(mem['settings'].bedrock_key, 'SECRETBEDROCKKEY1234567890');                           // a tester cannot overwrite it
  assert.ok(mem['t-pookie:settings'] && !mem['t-pookie:settings'].bedrock_key);
  const eff = await sun.effectiveSettings(store, 't-pookie');
  assert.strictEqual(eff.bedrock_key, 'SECRETBEDROCKKEY1234567890');                                       // the fairy can still think for her
  console.log('ok: a tester has a code of her own, her own settings, and no provider keys');
})().catch((e) => { console.error(e); process.exit(1); });
