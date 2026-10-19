const assert = require('assert');
const guest = require('../netlify/functions/sun-guest.js');
const greet = require('../netlify/functions/sun-greeting.js');
(async () => {
  const mem = {};
  const store = { get: async (k) => (mem[k] === undefined ? null : mem[k]), setJSON: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, set: async (k, v) => { mem[k] = v; } };
  const asked = [];
  const base = { store, now: Date.UTC(2026, 9, 19, 12), ask: async (sys, convo) => { asked.push(convo); return 'Hello, friend.'; }, speak: async () => Buffer.from('mp3') };
  const post = (b, headers, extra) => guest.handler({ httpMethod: 'POST', headers: headers || { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify(b) }, {}, Object.assign({}, base, extra || {}));
  // a guest: text, a few a day, never audio
  let r = await post({ fairy: 'ash', text: 'hi', audio: true });
  let j = JSON.parse(r.body); assert.strictEqual(r.statusCode, 200); assert.strictEqual(j.tier, 'guest'); assert.strictEqual(j.audio, undefined); assert.strictEqual(j.audio_blocked, 'sign_in'); assert.strictEqual(j.left.text, 9);
  for (let i = 0; i < 9; i++) await post({ fairy: 'ash', text: 'again' });
  r = await post({ fairy: 'ash', text: 'one more' }); assert.strictEqual(r.statusCode, 429);
  r = await post({ fairy: 'ash', text: 'a different visitor' }, { 'x-forwarded-for': '9.9.9.9' }); assert.strictEqual(r.statusCode, 200);   // another address has its own count
  r = await post({ fairy: 'ash', text: 'tomorrow' }, null, { now: Date.UTC(2026, 9, 20, 12) }); assert.strictEqual(r.statusCode, 200);       // a new day starts again
  // an account: voice, a few a day
  const acct = { getUser: async () => ({ id: 'u1', email: 'a@b.co' }), isMember: async () => false };
  const hdr = { authorization: 'Bearer x' };
  r = await post({ fairy: 'velvet', text: 'hello', audio: true }, hdr, acct); j = JSON.parse(r.body);
  assert.strictEqual(j.tier, 'account'); assert.strictEqual(Buffer.from(j.audio, 'base64').toString(), 'mp3'); assert.strictEqual(j.left.audio, 4);
  for (let i = 0; i < 4; i++) await post({ fairy: 'velvet', text: 'more', audio: true }, hdr, acct);
  j = JSON.parse((await post({ fairy: 'velvet', text: 'more', audio: true }, hdr, acct)).body); assert.strictEqual(j.audio_blocked, 'limit'); assert.ok(j.say);   // the words still come
  // a member has more
  r = await post({ fairy: 'flint', text: 'hello', audio: true }, hdr, { getUser: async () => ({ id: 'u2' }), isMember: async () => true }); j = JSON.parse(r.body);
  assert.strictEqual(j.tier, 'member'); assert.strictEqual(j.left.audio, 29);
  // only the seven, only short, history is trimmed to the visitor's own lines
  assert.strictEqual((await post({ fairy: 'hacker', text: 'x' })).statusCode, 400);
  await post({ fairy: 'ember', text: 'x', history: [{ role: 'fairy', text: 'a' }, { role: 'user', text: 'b' }, { role: 'fairy', text: 'c' }] }, { 'x-forwarded-for': '7.7.7.7' });
  const last = asked[asked.length - 1]; assert.strictEqual(last[0].role, 'user'); assert.strictEqual(last[last.length - 1].text, 'x');
  // the recorded hello: made once, served after
  let spoken = 0; const audio = {};
  const astore = { get: async (k) => audio[k] || null, set: async (k, v) => { audio[k] = v; } };
  const g = () => greet.handler({ queryStringParameters: { fairy: 'poppy' } }, {}, { store: astore, speak: async () => { spoken++; return Buffer.from('hello-mp3'); } });
  let a = await g(); await g(); await g();
  assert.strictEqual(a.statusCode, 200); assert.strictEqual(a.isBase64Encoded, true); assert.strictEqual(spoken, 1);
  assert.strictEqual((await greet.handler({ queryStringParameters: { fairy: 'nobody' } }, {}, { store: astore })).statusCode, 404);
  console.log('ok: guest, account and member limits, and the recorded hello');
})().catch((e) => { console.error(e); process.exit(1); });
