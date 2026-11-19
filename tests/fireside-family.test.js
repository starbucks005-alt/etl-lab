/* Every robot has a seat in the fireside chat, under its own names (Dr. O, 2026-11-19: "add all the bots to it"). Run: node tests/fireside-family.test.js */
const assert = require('assert');
const core = require('../netlify/functions/_fireside-core.js');
const robots = require('../al-panel/robots.json').robots;

const seatOf = (id) => (id === 'astra-lite' ? 'elle' : id.replace(/[^a-z0-9]/g, ''));
for (const r of robots) assert.ok(core.SEAT_DEFAULTS[seatOf(r.id)], 'a seat for ' + r.id);

const st = core.fresh();
st.order = ['alice', 'elle', 'astra', 'astrad', 'astro', 'astri', 'guardianf', 'guardianm', 'reggie', 'biscuit', 'mochi'];
const cases = [
  ['Astra Lite, what do you think?', ['elle']],            // the longer name wins: Elle, not Astra
  ['Astra, hello', ['astra']],
  ['Ted and Teddy, hi', ['astrad', 'astro']],               // Ted is Astrad, Teddy is Astro
  ['Astri, do you like dolls?', ['astri']],
  ['Guardian F, are you watching?', ['guardianf']],
  ['What is your favorite color, Reggie?', ['reggie']],
  ['Elle, what do you think of Astra?', ['elle']],         // a name in the middle is who it is about
];
for (const [q, want] of cases) assert.deepStrictEqual(core.namedIn(st, q), want, q);
assert.strictEqual(core.namedNext(st, 'I wonder what Astra Lite thinks', 'alice'), 'elle');
assert.strictEqual(core.namedNext(st, 'Teddy, your turn', 'astri'), 'astro');
assert.strictEqual(core.namedNext(st, 'Ted, tell them', 'astro'), 'astrad');
console.log('fireside-family: every robot has a seat and is called by its own names');
