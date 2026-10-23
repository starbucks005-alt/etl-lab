/* explorer-recent.test.js: plain node, `node tests/explorer-recent.test.js`. The storage is a stand-in. */
const assert = require('assert');
const { recentNote } = require('../netlify/functions/_explorer-recent.js');

const store = (v) => ({ get: async () => v });
const ep = (place, verified) => ({ place, verified, text: 'At ' + place + ' it was cold. Sorry, {name}, I have to go, they\'re on to me.' });

(async () => {
  assert.strictEqual(await recentNote({}, { store: store(null) }), '');
  assert.strictEqual(await recentNote({}, { store: store([]) }), '');
  assert.strictEqual(await recentNote({}, { store: { get: async () => { throw new Error('down'); } } }), '');
  assert.strictEqual(await recentNote({}, { store: store([ep('Peru', false)]) }), '', 'unchecked stories are not used');
  const n = await recentNote({}, { store: store([ep('Peru', true), ep('Chad', false), ep('Fiji', true)]) });
  assert(n.includes('Peru') && n.includes('Fiji') && !n.includes('Chad'));
  assert(!n.includes('{name}') && !n.includes('on to me'));
  console.log('explorer-recent ok');
})();
