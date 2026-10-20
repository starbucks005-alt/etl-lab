/* sp-case.test.js: plain node, `node tests/sp-case.test.js`. */
const assert = require('assert');
const fs = require('fs');
const sp = require('../netlify/functions/sp-case.js');

(async () => {
  // Naomi is in the registry, with the standards the generator relies on
  const reg = JSON.parse(fs.readFileSync(__dirname + '/../data/studio-staff-registry.json', 'utf8'));
  const n = reg.naomi_baptiste;
  assert(n && n.persona && n.trigger_keywords.includes('standardized patient'));
  assert(/no/.test(n.persona) && /real person/.test(n.persona) && /I don't know that one/.test(n.persona));
  assert(/Dr\. O/.test(n.persona) && !/David/.test(n.persona));
  for (const bad of [String.fromCharCode(0x2014), String.fromCharCode(0x2013), String.fromCharCode(0x2011), 'plainly']) assert(!n.persona.includes(bad), 'persona has ' + bad);
  assert.strictEqual(sp.loadPersona(), n.persona);

  // parse: fenced json, and junk
  const ok = {}; sp.REQUIRED.forEach((k) => { ok[k] = 'x'; });
  assert.deepStrictEqual(sp.parseCase('```json\n' + JSON.stringify(ok) + '\n```'), ok);
  assert.strictEqual(sp.parseCase('no json here'), null);
  assert.deepStrictEqual(sp.missingKeys(ok), []);
  assert(sp.missingKeys({ title: 'x' }).length > 5);

  // handler: validation, then not configured
  const call = (o) => sp.handler(o);
  const env = {}; ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT'].forEach((k) => { env[k] = process.env[k]; delete process.env[k]; });
  assert.strictEqual((await call({ httpMethod: 'GET' })).statusCode, 200);
  assert.strictEqual((await call({ httpMethod: 'POST', body: '{}' })).statusCode, 400);
  const good = { learner: 'Nursing student', level: sp.OPTIONS.level[0], field: 'Oncology' };
  assert.strictEqual((await call({ httpMethod: 'POST', body: JSON.stringify(good) })).statusCode, 503);

  // with a stand-in for Azure: a case comes back, em dashes are removed
  process.env.AZURE_OPENAI_ENDPOINT = 'https://x.openai.azure.com'; process.env.AZURE_OPENAI_KEY = 'k'; process.env.AZURE_OPENAI_DEPLOYMENT = 'd';
  const realFetch = global.fetch;
  const withDash = Object.assign({}, ok, { title: 'A ' + String.fromCharCode(0x2014) + ' B' });
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(withDash) } }] }) });
  const r = await call({ httpMethod: 'POST', body: JSON.stringify(good) });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).case.title, 'A, B');
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"x"}' } }] }) });
  assert.strictEqual((await call({ httpMethod: 'POST', body: JSON.stringify(good) })).statusCode, 502);
  global.fetch = realFetch;
  Object.keys(env).forEach((k) => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; });

  const page = fs.readFileSync(__dirname + '/../sp-case-generator.html', 'utf8');
  assert(!page.includes(String.fromCharCode(0x2014)) && !/plainly/i.test(page));
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
