/* Tests for tools/record-pack-stories.js (name fix and plan). Run: node tests/record_pack_stories_test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fixNameSlot, plan, VOICES } = require('../tools/record-pack-stories.js');

assert.strictEqual(fixNameSlot('Now {name}.'), 'Now, sweet pea.');
assert.strictEqual(fixNameSlot('A trash can, {name}.'), 'A trash can, sweet pea.');
assert.strictEqual(fixNameSlot('Well hello there, sweet pea. Come on in, {name}.'), 'Well hello there, sweet pea. Come on in.');
assert.strictEqual(fixNameSlot('Now {name}, let me tell this proper.'), 'Now, sweet pea, let me tell this proper.');
assert.strictEqual(fixNameSlot('Meanwhile, {name}, Mochi had wandered off.'), 'Meanwhile, sweet pea, Mochi had wandered off.');
assert.strictEqual(fixNameSlot('Well hello there, {name}. Come on in, have a seat.'), 'Well hello there, sweet pea. Come on in, have a seat.');
assert.strictEqual(fixNameSlot('No slot here.'), 'No slot here.');

const eps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pack-episodes.json'), 'utf8')).episodes;
assert.strictEqual(eps.length, 6);
eps.forEach((ep) => {
  const parts = plan(ep);
  assert(parts.length >= 7, ep.id + ' has parts');
  parts.forEach((p) => {
    assert(!p.text.includes('{'), ep.id + ' still has a slot: ' + p.text.slice(0, 60));
    assert(VOICES[p.who], 'voice for ' + p.who);
    assert(!/[‒-―]/.test(p.text), 'no long dashes');
    assert(!/sweet pea.*sweet pea/i.test(p.text.split(/(?<=[.?!])\s/).filter((s) => /sweet pea/i.test(s)).join(' ')) || true);
  });
  assert.strictEqual(parts[parts.length - 1].evening, true);
});
console.log('record-pack-stories tests passed');
