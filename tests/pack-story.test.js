/* pack-story.test.js: plain node, `node tests/pack-story.test.js`. The model and the storage are stand-ins. */
const assert = require('assert');
const ex = require('../netlify/functions/pack-story.js');
const { PLACES } = require('../netlify/functions/_pack-bible.js');

const beat = (who, text) => ({ who, text });
const good = (place) => ({
  beats: [
    beat('reggie', '"OH OH OH!"\n"You\'re here!"\n' + place + ' JUST escalated.\nIt came out of nowhere.\nPossibly a dragon.'),
    beat('biscuit', 'Now {name}.\nLet me tell this proper.\nIt was a lovely morning, blue sky, gentle breeze.\nAnd then there was a smell, {name}.\nThat smell had a HISTORY.'),
    beat('mochi', 'Trash.'),
    beat('reggie', 'It started at 9:14 in the morning.\nOr maybe 9:15.\nDefinitely morning.\nBiscuit and I were conducting neighborhood security operations.\n"Sniffing," Mochi said.\nWe were conducting security operations when I detected something.\nSomething strange.\nSomething important.\nSomething magnificent.'),
    beat('reggie', 'We approached carefully.\nLike detectives.\nOr detective explorers.\nI did not fall. I strategically descended.'),
    beat('biscuit', 'Mercy, that smell was singing.\nCalling.\nInviting.\nPromising answers, sugar.'),
    beat('mochi', 'He fell.'),
  ],
  evening: 'Reggie stretched across the living room rug.\n"That was a great adventure."\n"It was a trash can," said Mochi.\nBiscuit smiled.\n"I think the real treasure was spending the day together."\nMochi looked at both of them, and gave the smallest nod.\n"Yeah."',
  card: { front: place + ': a dragon, allegedly', back: 'Reggie: Dragon. Biscuit: Destiny. Mochi: Trash.' },
  facts: ['VERIFY: dogs smell better than people'],
});
const fakeStore = () => {
  const m = {};
  return { m, get: async (k) => (m[k] === undefined ? null : JSON.parse(JSON.stringify(m[k]))), setJSON: async (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } };
};
const post = (b, h) => ({ httpMethod: 'POST', headers: h || {}, body: JSON.stringify(b) });

(async () => {
  // clean(): em dashes and the tell word go, bad shapes are refused
  const dirty = good('Peru');
  dirty.beats[0].text = dirty.beats[0].text.replace('Possibly', 'Possibly \u2014 plainly,');
  const c = ex.clean(dirty);
  assert(c && !/\u2014/.test(c.beats[0].text) && !/plainly/i.test(c.beats[0].text), 'dash and the tell word removed');
  const noName = good('Peru'); noName.beats[1].text = noName.beats[1].text.split('{name}').join('friend');
  assert.strictEqual(ex.clean(noName), null, 'no {name} in Biscuit is refused');
  const chatty = good('Peru'); chatty.beats[2].text = 'Well I think that the whole thing was really just a lot of fuss over nothing at all.';
  assert.strictEqual(ex.clean(chatty), null, 'Mochi is brief');
  const missing = good('Peru'); missing.beats = missing.beats.filter((b) => b.who !== 'mochi');
  assert.strictEqual(ex.clean(missing), null, 'all three must speak');
  const badWho = good('Peru'); badWho.beats[0].who = 'duke';
  assert.strictEqual(ex.clean(badWho), null, 'only the three speak');
  const noEve = good('Peru'); noEve.evening = 'Short.';
  assert.strictEqual(ex.clean(noEve), null, 'the evening scene is required');
  assert.strictEqual(ex.clean({ beats: good('Peru').beats, evening: good('Peru').evening, card: { front: '', back: 'x' } }), null, 'no card front is refused');
  assert.deepStrictEqual(ex.parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.strictEqual(ex.parseJson('nonsense'), null);

  // a visitor who has heard nothing gets a seed story; the facts list is never sent
  const store = fakeStore();
  let r = await ex.run(post({ seen: [] }), { store });
  let b = JSON.parse(r.body);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(b.episode.id, 'trash');
  assert(!('facts' in b.episode), 'facts are not sent to visitors');
  r = await ex.run(post({ seen: ['trash'] }), { store });
  assert.strictEqual(JSON.parse(r.body).episode.id, 'squirrel');

  // heard all three seeds: a new one is written, checked, kept, and capped per day
  let calls = 0;
  const azureChat = async () => { calls++; return JSON.stringify(good('Somewhere')); };
  const seen3 = ['trash', 'squirrel', 'stick', 'beach', 'ferry', 'market'];
  r = await ex.run(post({ seen: seen3 }), { store, azureChat, random: () => 0 });
  b = JSON.parse(r.body);
  assert(b.ok && b.fresh && b.episode.id && !used(b.episode.place), 'a fresh episode is returned');
  function used(p) { return ['The Great Squirrel Incident', 'The Great Trash Can Mystery', 'The Stick of Destiny', 'The beach at low tide', 'The ferry', 'The farmers market'].includes(p); }
  assert.strictEqual(calls, 2, 'one draft and one checking pass');
  assert.strictEqual(store.m.episodes.length, 1, 'it is kept');
  assert.strictEqual(store.m.episodes[0].facts.length, 1, 'its facts are kept for review');
  // the same story is told again, unchanged, to the next visitor who has not heard it
  r = await ex.run(post({ seen: seen3 }), { store, azureChat });
  assert.strictEqual(JSON.parse(r.body).episode.id, b.episode.id);
  assert.strictEqual(calls, 2, 'not written twice');

  // a model that returns junk never breaks the page
  const junk = fakeStore();
  r = await ex.run(post({ seen: seen3 }), { store: junk, azureChat: async () => 'not json', claudeChat: async () => null });
  assert.strictEqual(JSON.parse(r.body).all_seen, true);

  // the daily cap stops writing
  const cap = fakeStore();
  cap.m['count-' + new Date().toISOString().slice(0, 10)] = { n: 6 };
  calls = 0;
  r = await ex.run(post({ seen: seen3 }), { store: cap, azureChat });
  assert.strictEqual(JSON.parse(r.body).all_seen, true);
  assert.strictEqual(calls, 0, 'nothing is written past the cap');

  // review needs the owner
  r = await ex.run(post({ action: 'review' }), { store });
  assert.strictEqual(r.statusCode, 401);
  r = await ex.run(post({ action: 'review' }, { authorization: 'Bearer yes' }), { store, isOwner: (t) => t === 'yes' });
  b = JSON.parse(r.body);
  assert(b.ok && b.episodes.length === 7 && Array.isArray(b.episodes[0].facts), 'the owner sees every story and its facts');
  assert(PLACES.length >= 20, 'a large pool of real places');
  console.log('pack-story tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
