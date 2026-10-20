/* naomi-chat.test.js: plain node, `node tests/naomi-chat.test.js`. Azure, Claude and the voice are stand-ins. */
const assert = require('assert');
const fs = require('fs');
const chat = require('../netlify/functions/naomi-chat.js');
const voice = require('../netlify/functions/naomi-voice.js');

(async () => {
  // messages: junk dropped, must end on the user
  assert.deepStrictEqual(chat.cleanMessages(null), []);
  assert.deepStrictEqual(chat.cleanMessages([{ role: 'assistant', content: 'Hi' }]), []);
  assert.deepStrictEqual(chat.cleanMessages([{ role: 'assistant', content: 'Hi' }, { role: 'user', content: ' Help ' }, { role: 'system', content: 'x' }]), [{ role: 'user', content: 'Help' }]);

  const post = (messages) => ({ httpMethod: 'POST', body: JSON.stringify({ messages }) });
  const ask = [{ role: 'user', content: 'Is one learning objective enough?' }];
  assert.strictEqual((await chat.run({ httpMethod: 'GET' })).statusCode, 405);
  assert.strictEqual((await chat.run(post([]))).statusCode, 400);

  // Azure answers: her persona is the system turn, dashes cleaned
  let seen = null;
  let r = await chat.run(post(ask), { azureChat: async (m) => { seen = m; return 'Yes. One is best — three at most.'; } });
  let b = JSON.parse(r.body);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(b.source, 'azure');
  assert.strictEqual(b.answer, 'Yes. One is best, three at most.');
  assert.strictEqual(seen[0].role, 'system');
  assert(/Naomi Baptiste/.test(seen[0].content) && /RIGHT NOW/.test(seen[0].content));
  assert.deepStrictEqual(seen.slice(1), ask);
  for (const bad of [String.fromCharCode(0x2014), 'plainly']) assert(!chat.systemPrompt('').includes(bad));

  // Azure not set up: Claude answers
  class FakeAnthropic { constructor() { this.messages = { create: async () => ({ content: [{ type: 'text', text: 'From Claude.' }] }) }; } }
  r = await chat.run(post(ask), { azureChat: async () => null, Anthropic: FakeAnthropic, env: { ETL_API_KEY: 'k' } });
  b = JSON.parse(r.body);
  assert.strictEqual(b.source, 'claude');
  assert.strictEqual(b.answer, 'From Claude.');

  // neither: 503
  r = await chat.run(post(ask), { azureChat: async () => null, env: {} });
  assert.strictEqual(r.statusCode, 503);

  // voice: Shimmer, mp3, 503 when the key is missing
  assert.strictEqual(voice.VOICE, 'en-US-ShimmerTurboMultilingualNeural');
  let voiceSeen = null;
  r = await voice.run({ httpMethod: 'POST', body: JSON.stringify({ text: 'Hello' }) }, { env: {}, speak: async (t, v) => { voiceSeen = v; return Buffer.from('mp3'); } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.headers['Content-Type'], 'audio/mpeg');
  assert.strictEqual(voiceSeen, voice.VOICE);
  r = await voice.run({ httpMethod: 'POST', body: JSON.stringify({ text: 'Hello' }) }, { env: {}, speak: async () => { throw new Error('no_azure_key'); } });
  assert.strictEqual(r.statusCode, 503);
  assert.strictEqual((await voice.run({ httpMethod: 'POST', body: '{}' }, { env: {} })).statusCode, 400);

  // the page and the portraits
  const page = fs.readFileSync(__dirname + '/../naomi.html', 'utf8');
  for (const f of ['naomi-babiste-eyes-open.png', 'naomi-babiste-eyes-closed.png']) {
    assert(page.includes('/agents/' + f));
    assert(fs.existsSync(__dirname + '/../agents/' + f), f);
  }
  for (const f of ['naomi.html', 'sp-case-generator.html', 'netlify/functions/naomi-chat.js', 'netlify/functions/naomi-voice.js']) {
    const s = fs.readFileSync(__dirname + '/../' + f, 'utf8');
    for (const bad of [String.fromCharCode(0x2014), String.fromCharCode(0x2013), String.fromCharCode(0x2011), 'plainly']) assert(!s.includes(bad), f + ' has ' + bad);
  }
  console.log('naomi-chat: ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
