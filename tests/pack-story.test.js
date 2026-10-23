/* pack-story.test.js: plain node, `node tests/pack-story.test.js`. The model and the storage are stand-ins. */
const assert = require('assert');
const ex = require('../netlify/functions/pack-story.js');
const { PLACES } = require('../netlify/functions/_pack-bible.js');

const EXIT = "Gotta go, {name}, somebody just said the word walk.";
const good = (place) => ({
  text: 'Oh good, {name}, sit, okay so THEN, I have one for you. ' + place + ' first, the land, because you should know where you are when a story goes wrong. ' +
    'The light was low and gold, the ground was dry and loud under my boots, and the air smelled like warm stone and somebody cooking something wonderful. ' +
    'I found a small round thing under a rock and I was certain it was ancient. It was a bottle cap. A very proud one. Reggie says, "Did you find treasure?" ' +
    'I wrote back, "A bottle cap." She said, "Best one ever." I told her not to put that on a poster. She is making the poster. ' + EXIT,
  card: { front: place + ': one bottle cap and a lot of sky', back: 'Dear niece, here is the proof. One bottle cap. The sky is real, though. Mochi: fine.' },
  facts: ['VERIFY: the sky is large'],
});
const fakeStore = () => {
  const m = {};
  return { m, get: async (k) => (m[k] === undefined ? null : JSON.parse(JSON.stringify(m[k]))), setJSON: async (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } };
};
const post = (b, h) => ({ httpMethod: 'POST', headers: h || {}, body: JSON.stringify(b) });

(async () => {
  // clean(): em dashes and the tell word go, the exit line is forced, bad shapes are refused
  const dirty = good('Peru');
  dirty.text = dirty.text.replace('the land,', 'the land — plainly,');
  const c = ex.clean(dirty);
  assert(c && !/—/.test(c.text) && !/plainly/i.test(c.text), 'dash and plainly removed');
  assert(c.text.endsWith(EXIT), 'ends on the exit line');
  const noExit = good('Peru'); noExit.text = noExit.text.replace(EXIT, 'See you.');
  assert(ex.clean(noExit).text.endsWith(EXIT), 'a missing exit line is put back');
  const noName = good('Peru'); noName.text = noName.text.split('{name}').join('friend');
  assert.strictEqual(ex.clean(noName), null, 'no {name} is refused');
  const tiny = good('Peru'); tiny.text = 'Hi {name}. ' + EXIT;
  assert.strictEqual(ex.clean(tiny), null, 'too short is refused');
  assert.strictEqual(ex.clean({ text: good('Peru').text, card: { front: '', back: 'x' } }), null, 'no card front is refused');
  assert.deepStrictEqual(ex.parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.strictEqual(ex.parseJson('nonsense'), null);

  // a visitor who has heard nothing gets a seed story; the facts list is never sent
  const store = fakeStore();
  let r = await ex.run(post({ seen: [] }), { store });
  let b = JSON.parse(r.body);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(b.episode.id, 'beach');
  assert(!('facts' in b.episode), 'facts are not sent to visitors');
  r = await ex.run(post({ seen: ['beach'] }), { store });
  assert.strictEqual(JSON.parse(r.body).episode.id, 'ferry');

  // heard all three seeds: a new one is written, checked, kept, and capped per day
  let calls = 0;
  const azureChat = async () => { calls++; return JSON.stringify(good('Somewhere')); };
  const seen3 = ['beach', 'ferry', 'market'];
  r = await ex.run(post({ seen: seen3 }), { store, azureChat, random: () => 0 });
  b = JSON.parse(r.body);
  assert(b.ok && b.fresh && b.episode.id && !used(b.episode.place), 'a fresh episode is returned');
  function used(p) { return ['The beach at low tide', 'The ferry', 'The farmers market'].includes(p); }
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
  assert(b.ok && b.episodes.length === 4 && Array.isArray(b.episodes[0].facts), 'the owner sees every story and its facts');
  assert(PLACES.length >= 20, 'a large pool of real places');
  console.log('pack-story tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
