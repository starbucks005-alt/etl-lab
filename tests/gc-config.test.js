/* gc-config: tester keys and the Azure key live in private storage, not environment variables. Run: node tests/gc-config.test.js */
const assert = require('assert');
const Module = require('module');
const mem = {};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === '@netlify/blobs') {
    return { connectLambda() {}, getStore() { return {
      async get(k) { return mem[k] || null; },
      async setJSON(k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
    }; } };
  }
  return origLoad.call(this, req, ...a);
};
process.env.OWNER_KEY = 'owner-test-key-123';
const cfg = require('../netlify/functions/_gc-config.js');
const admin = require('../netlify/functions/gc-config.js');
const call = (token, body) => admin.handler({ httpMethod: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) });

(async () => {
  assert.strictEqual((await call('', { action: 'status' })).statusCode, 401);
  assert.strictEqual((await call('wrong', { action: 'status' })).statusCode, 401);
  assert.strictEqual(await cfg.isTesterKey({}, 'laptop-tester-abc123', ['builtin-key']), false);
  assert.strictEqual(await cfg.isTesterKey({}, 'builtin-key', ['builtin-key']), true);
  let r = await call('owner-test-key-123', { action: 'add_tester', key: 'laptop-tester-abc123' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).tester_keys_added, 1);
  assert(!r.body.includes('laptop-tester-abc123'));
  assert(!JSON.stringify(mem).includes('laptop-tester-abc123'), 'key must be stored as a fingerprint only');
  assert.strictEqual(await cfg.isTesterKey({}, 'laptop-tester-abc123', []), true);
  assert.strictEqual(await cfg.isTesterKey({}, 'laptop-tester-abc124', []), false);
  assert.strictEqual((await call('owner-test-key-123', { action: 'add_tester', key: 'short' })).statusCode, 400);
  r = await call('owner-test-key-123', { action: 'set_azure', key: 'A'.repeat(32), region: 'EastUS' });
  assert.strictEqual(JSON.parse(r.body).azure_key_set, true);
  assert(!r.body.includes('AAAA'));
  const env = await cfg.azureEnv({});
  assert.strictEqual(env.AZURE_SPEECH_REGION, 'eastus');
  assert.strictEqual(env.AZURE_SPEECH_KEY.length, 32);
  await call('owner-test-key-123', { action: 'clear_testers' });
  assert.strictEqual(await cfg.isTesterKey({}, 'laptop-tester-abc123', []), false);
  console.log('gc-config tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
