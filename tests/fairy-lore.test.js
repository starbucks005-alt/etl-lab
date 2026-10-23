/* fairy-lore.test.js: plain node, `node tests/fairy-lore.test.js`. The model and the storage are stand-ins. */
const assert = require('assert');
const fl = require('../netlify/functions/fairy-lore.js');
const bible = require('../netlify/functions/_fairy-bible.js');
const seeds = require('../fairy-fragments.json').fragments;

const fakeStore = () => { const m = {}; return { m, get: async (k) => (m[k] === undefined ? null : JSON.parse(JSON.stringify(m[k]))), setJSON: async (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
const post = (b, h) => ({ httpMethod: 'POST', headers: h || {}, body: JSON.stringify(b) });
const text = 'Poppy swears Tansy practiced scolding the moon for an entire week before the festival, just in case it said something rude first. Nobody has asked her about it since.';

(async () => {
  // seeds are shaped right and obey the rules
  assert(seeds.length >= 20);
  const ids = new Set();
  seeds.forEach((s) => {
    assert(!ids.has(s.id), 'unique ids'); ids.add(s.id);
    assert(bible.CATEGORIES[s.category] && bible.ALLOWED[s.perspective] && bible.TYPES[s.type], 'valid slots: ' + s.id);
    assert(!/—/.test(s.text) && !/plainly/i.test(s.text), 'house rules: ' + s.id);
  });

  // clean(): dashes and the tell word go, the mystery cannot be resolved, shape is enforced
  assert.strictEqual(fl.clean({ text: text.replace('moon', 'moon — plainly') }, 'funny').includes('—'), false);
  assert.strictEqual(fl.clean({ text: 'The human came back to the forest last spring and Tansy pretended she had not seen him from the window.' }, 'gossip'), null, 'cannot say he came back');
  assert.strictEqual(fl.clean({ text: 'The human died long ago in a far country, and the fairies whispered that Tansy had always known it.' }, 'mystery'), null, 'cannot say he died');
  assert.strictEqual(fl.clean({ text: 'Too short.' }, 'funny'), null);
  assert.strictEqual(fl.clean({ text: text + '\nBlue: And then she did.' }, 'funny'), null, 'only contradictions may use several lines');

  // a visitor gets a stored fragment, never one they hold, in any category
  const store = fakeStore();
  let r = await fl.run(post({ seen: [], category: 'romance' }), { store, random: () => 0 });
  let b = JSON.parse(r.body);
  assert(b.ok && b.fragment.category === 'romance' && b.fragment.text);
  const romance = seeds.filter((s) => s.category === 'romance').map((s) => s.id);
  r = await fl.run(post({ seen: romance.slice(0, romance.length - 1), category: 'romance' }), { store, random: () => 0 });
  assert.strictEqual(JSON.parse(r.body).fragment.id, romance[romance.length - 1]);

  // a category used up: a new fragment is written, kept and capped
  let calls = 0;
  const azureChat = async () => { calls++; return JSON.stringify({ text }); };
  r = await fl.run(post({ seen: romance, category: 'romance' }), { store, azureChat, random: () => 0 });
  b = JSON.parse(r.body);
  assert(b.ok && b.fresh && b.fragment.id.startsWith('g-'));
  assert.strictEqual(store.m.fragments.length, 1);
  assert.strictEqual(calls, 1);
  // the same stored fragment is served to a visitor who has not got it, without another call
  r = await fl.run(post({ seen: romance, category: 'romance' }), { store, azureChat, random: () => 0 });
  assert.strictEqual(JSON.parse(r.body).fragment.text, text);
  assert.strictEqual(calls, 1);

  // junk never breaks the page; the cap stops writing
  const junk = fakeStore();
  r = await fl.run(post({ seen: romance, category: 'romance' }), { store: junk, azureChat: async () => 'nope', claudeChat: async () => null, random: () => 0 });
  assert(JSON.parse(r.body).fragment, 'falls back to another stored fragment');
  const cap = fakeStore(); cap.m['count-' + new Date().toISOString().slice(0, 10)] = { n: 40 };
  calls = 0;
  await fl.run(post({ seen: romance, category: 'romance' }), { store: cap, azureChat, random: () => 0 });
  assert.strictEqual(calls, 0, 'nothing is written past the cap');

  // everything collected
  r = await fl.run(post({ seen: seeds.map((s) => s.id) }), { store: fakeStore(), azureChat: async () => 'nope', claudeChat: async () => null });
  assert.strictEqual(JSON.parse(r.body).all_collected, true);

  // review needs the owner
  r = await fl.run(post({ action: 'review' }), { store });
  assert.strictEqual(r.statusCode, 401);
  r = await fl.run(post({ action: 'review' }, { authorization: 'Bearer yes' }), { store, isOwner: (t) => t === 'yes' });
  assert(JSON.parse(r.body).fragments.length > seeds.length - 1);
  console.log('fairy-lore tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
