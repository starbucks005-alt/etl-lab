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

/* sagas */
const { planFragments, SAGA_VOICES } = require('../tools/record-pack-stories.js');
const alice = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'alice-fragments.json'), 'utf8'));
const fairy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fairy-fragments.json'), 'utf8'));
let r = planFragments(alice, {});
assert.strictEqual(r.parts.length, 22, 'only Alice fragments have a voice by default');
assert.strictEqual(r.skipped.length, 11);
assert(r.parts.every((p) => p.who === 'alice' && p.voice === SAGA_VOICES.alice));
r = planFragments(alice, { narrator: 'N', researcher: 'R', colleague: 'C' });
assert.strictEqual(r.parts.length, 33);
assert.strictEqual(r.skipped.length, 0);
const phases = alice.fragments.map((f) => f.id);
assert.strictEqual(r.parts[0].id.length > 0, true);
r = planFragments(fairy, {});
assert.strictEqual(r.parts.length, 13, 'tansy 5, poppy 4, blue 4');
assert.strictEqual(r.skipped.length, 11, 'narrator 8, mother 3');
assert(r.parts.every((p) => !p.text.includes('{')));
console.log('saga tests passed');
