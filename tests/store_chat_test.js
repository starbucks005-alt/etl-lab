/* Tests for netlify/functions/store-chat.js with the model and the counter store
   replaced by stand-ins. Run: node tests/store_chat_test.js */
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@anthropic-ai/sdk') return function Anthropic() {};
  if (req === '@netlify/blobs') return { getStore() { throw new Error('no store in tests'); }, connectLambda() {} };
  return origLoad.call(this, req, ...rest);
};
const assert = require('assert');
const { handler, _internals } = require('../netlify/functions/store-chat.js');

function memoryStore() {
  const m = {};
  return { async get(k) { return m[k] || null; }, async setJSON(k, v) { m[k] = v; }, _m: m };
}
function fakeClient(text, spy) {
  return { messages: { async create(args) { if (spy) spy.push(args); return { content: [{ type: 'text', text }] }; } } };
}
const ev = (over) => Object.assign({
  httpMethod: 'POST',
  headers: { origin: 'https://emerging-tech-lab.com', 'x-nf-client-connection-ip': '1.2.3.4' },
  body: JSON.stringify({ message: 'hello', vid: 'abc' })
}, over);

(async () => {
  process.env.ANTHROPIC_API_KEY = 'test';
  // persona and store facts are in the system prompt
  assert(_internals.SYSTEM.includes('You are Tansy, of the Radiant Court'));
  assert(_internals.SYSTEM.includes('Almost Human'));
  assert(!/[‒-―]/.test(_internals.SYSTEM), 'no long dashes in the prompt');

  // wrong site is refused
  let r = await handler(ev({ headers: { origin: 'https://example.com' } }), {}, { store: memoryStore(), client: fakeClient('x') });
  assert.strictEqual(r.statusCode, 403);
  // wrong method
  r = await handler(ev({ httpMethod: 'GET' }), {}, { store: memoryStore(), client: fakeClient('x') });
  assert.strictEqual(r.statusCode, 405);
  // empty message
  r = await handler(ev({ body: JSON.stringify({ message: '  ' }) }), {}, { store: memoryStore(), client: fakeClient('x') });
  assert.strictEqual(r.statusCode, 400);

  // a normal reply, long dashes removed, history trimmed and starts with a user turn
  const spy = [];
  const hist = [{ role: 'assistant', text: 'old' }, { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }];
  r = await handler(ev({ body: JSON.stringify({ message: 'what is lumvivo', vid: 'v1', history: hist }) }), {}, { store: memoryStore(), client: fakeClient('Oh. It is a pod — fine.', spy) });
  assert.strictEqual(r.statusCode, 200);
  assert(!/—/.test(JSON.parse(r.body).reply));
  assert.strictEqual(spy[0].messages[0].role, 'user');
  assert.strictEqual(spy[0].messages[spy[0].messages.length - 1].content, 'what is lumvivo');
  assert(spy[0].max_tokens <= 300);

  // visitor limit
  const st = memoryStore();
  for (let i = 0; i < 20; i++) {
    r = await handler(ev({ body: JSON.stringify({ message: 'hi', vid: 'same' }) }), {}, { store: st, client: fakeClient('ok') });
    assert.strictEqual(r.statusCode, 200, 'turn ' + i);
  }
  r = await handler(ev({ body: JSON.stringify({ message: 'hi', vid: 'same' }) }), {}, { store: st, client: fakeClient('ok') });
  assert.strictEqual(r.statusCode, 429);
  assert.strictEqual(JSON.parse(r.body).limit, true);

  // model failure becomes a clean error
  const bad = { messages: { async create() { throw new Error('boom'); } } };
  r = await handler(ev(), {}, { store: memoryStore(), client: bad });
  assert.strictEqual(r.statusCode, 502);

  // no message text is stored
  const st2 = memoryStore();
  await handler(ev({ body: JSON.stringify({ message: 'secret words here', vid: 'q' }) }), {}, { store: st2, client: fakeClient('ok') });
  assert(!JSON.stringify(st2._m).includes('secret'));
  console.log('store-chat tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
