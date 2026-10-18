/* sun-morning.test.js: plain node, `node tests/sun-morning.test.js`. Stand-ins for Anthropic and Azure; nothing here touches the network. */
const assert = require('assert');
const m = require('../netlify/functions/sun-morning.js');
const personas = require('../rising-sun/personas.json');
(async () => {
  assert.strictEqual(m.pick('check my calendar please'), 'calendar');
  assert.strictEqual(m.pick('the news'), 'news');
  assert.strictEqual(m.pick('what is a rainbow'), 'else');
  assert.strictEqual(m.pick('  '), 'nothing');
  assert.strictEqual((await m.step({ step: 'wake', fairy: 'arrogant' }, { personas })).say.split('?')[0], 'Are you ready to basque in my glory');
  assert((await m.step({ step: 'wake' }, { personas })).say.startsWith('Good morning, human.'));
  assert((await m.step({ step: 'wake', fairy: 'default' }, { personas })).say.includes('news, check your calendar, or something else'));
  assert((await m.step({ step: 'answer', heard: 'news' }, { personas })).say.includes('not have the news'));   // says so, makes none up
  let sys;
  const r = await m.step({ step: 'answer', heard: 'where did you go to school' }, { personas, ask: async (s) => { sys = s; return 'I do not know that one.'; } });
  assert.strictEqual(r.choice, 'else');
  assert(/do not know that one/.test(sys) && /not a human/.test(sys));       // empty backstory: the prompt says nothing is written
  assert(!/\u2014/.test(sys));
  assert((await m.step({ step: 'answer', heard: 'tell me a joke' }, { personas, ask: async () => { throw new Error('x'); } })).error === 'brain_failed');
  assert.strictEqual((await m.step({ step: 'nope' }, { personas })).error, 'bad_step');
  const ev = (key, body) => ({ httpMethod: 'POST', headers: { 'x-sun-key': key }, body: JSON.stringify(body) });
  assert.strictEqual((await m.handler(ev('k', { step: 'wake' }), {}, { env: {} })).statusCode, 503);        // no key set: closed
  assert.strictEqual((await m.handler(ev('bad', { step: 'wake' }), {}, { env: { SUN_DEVICE_KEY: 'k' } })).statusCode, 401);
  const ok = await m.handler(ev('k', { step: 'wake', audio: true }), {}, { env: { SUN_DEVICE_KEY: 'k' }, speak: async () => Buffer.from('mp3') });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(JSON.parse(ok.body).audio, Buffer.from('mp3').toString('base64'));
  // Bedrock first, Anthropic after. Stand-in network; no keys are real.
  const { bedrockAsk } = require('../netlify/functions/_bedrock.js');
  let seen;
  const fetchOk = async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ output: { message: { content: [{ text: 'Hello from Bedrock.' }] } } }) }; };
  assert.strictEqual(await bedrockAsk('sys', 'hi', { fetchFn: fetchOk, env: { AWS_BEARER_TOKEN_BEDROCK: 'k', AWS_REGION: 'us-east-1' } }), 'Hello from Bedrock.');
  assert(seen.url.startsWith('https://bedrock-runtime.us-east-1.amazonaws.com/model/') && seen.url.endsWith('/converse'));
  assert.strictEqual(seen.o.headers.Authorization, 'Bearer k');
  assert.strictEqual(JSON.parse(seen.o.body).system[0].text, 'sys');
  await assert.rejects(bedrockAsk('s', 't', { fetchFn: fetchOk, env: {} }), /no_bedrock_key/);
  await assert.rejects(bedrockAsk('s', 't', { fetchFn: fetchOk, env: { AWS_BEARER_TOKEN_BEDROCK: 'k', AWS_REGION: 'evil.com/x' } }), /bad_aws_region/);
  await assert.rejects(bedrockAsk('s', 't', { fetchFn: async () => ({ ok: false, status: 403 }), env: { AWS_BEARER_TOKEN_BEDROCK: 'k' } }), /bedrock_403/);
  process.env.AWS_BEARER_TOKEN_BEDROCK = 'k';
  const viaBedrock = await m.step({ step: 'answer', heard: 'tell me about the sun' }, { personas, fetchFn: fetchOk });
  assert.strictEqual(viaBedrock.say, 'Hello from Bedrock.');
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
