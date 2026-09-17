/* leadership-table.test.js, the class code and what it is allowed to reach.
   Plain node, no install: `node tests/leadership-table.test.js`.

   The shared classroom table borrows Almost Human's plumbing (the turn lock and
   the arrival-forward read rule live in _ah-table.js, one audited copy) and
   adds one classroom-shaped thing on top: a code a teacher can read out loud,
   that a whole class can use, rather than a link that burns on the first tap.

   What is checked here is the part that can be checked without a database: the
   code is drawn from an alphabet nobody misreads, it survives being typed back
   in lower case with the dash in it, a mistyped code comes back as nothing
   rather than as somebody else's table, and, the one that matters most, a class
   code can never be replayed as a seat at any table on this campus.

   The rest of this feature is a browser and a database, so it is checked in
   tools/leadership-table-smoke.js instead, which needs both.
*/

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ', ' + detail : ''}`); }
}

const t = require('../netlify/functions/_leadership-table.js');
const ah = require('../netlify/functions/_ah-table.js');

console.log('\nThe code a class types in');
const codes = [];
for (let i = 0; i < 3000; i++) codes.push(t.newClassCode());
check('every code is eight characters from the unambiguous alphabet',
  codes.every((c) => new RegExp(`^[${t.CODE_ALPHABET}]{${t.CODE_LENGTH}}$`).test(c)));
check('no 0, O, 1, I or L, which is what gets misread off a screen',
  codes.every((c) => !/[01OIL]/.test(c)));
check('three thousand codes, no repeat', new Set(codes).size === codes.length);

const one = t.newClassCode();
check('it is shown four and four', t.displayCode(one) === one.slice(0, 4) + '-' + one.slice(4));
check('typed back with the dash it still matches', t.normalizeClassCode(t.displayCode(one)) === one);
check('typed back in lower case with spaces it still matches',
  t.normalizeClassCode('  ' + t.displayCode(one).toLowerCase() + ' ') === one);
check('a short code is refused rather than guessed at', t.normalizeClassCode(one.slice(0, 7)) === null);
check('nonsense is refused', t.normalizeClassCode('hello there') === null);
check('nothing is refused', t.normalizeClassCode('') === null && t.normalizeClassCode(null) === null);

console.log('\nA class code is not a seat');
const inviteToken = t.inviteTokenFor(one);
check('the invite is stored under a CLASS- prefix', inviteToken === 'CLASS-' + one);
check("and Almost Human's own token check refuses it, so no endpoint there can claim it",
  ah.safeTableToken(inviteToken) === null);
check('a seat token is a different shape, and passes that check',
  typeof ah.safeTableToken(ah.newToken()) === 'string');
check('a class code cannot be replayed as a seat', ah.safeTableToken(one) === null);

console.log('\nThe size of a class');
check('the seat cap is a room of people, not a broadcast', t.SEAT_CAP > 0 && t.SEAT_CAP <= 100);

console.log(failures === 0 ? '\nThe door holds.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
