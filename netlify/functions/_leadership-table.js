/* _leadership-table -- the classroom half of a shared table, on top of the
   plumbing Almost Human already proved.

   Dr. O, 2026-09-17: "can you make it so I can bring people into the group
   table in the classroom?", and then, when asked which kind of bringing in:
   live people joining by link. Her students, a guest speaker, a colleague.

   WHY THIS REQUIRES _ah-table.js RATHER THAN COPYING IT, which is the opposite
   of what this classroom does everywhere else. The chat backend and the emotion
   engine are self-contained here on purpose, so a change for another classroom
   cannot break this one mid-semester. That reasoning does not survive contact
   with this particular file: _ah-table.js holds the turn lock and the
   arrival-forward read rule, and a second copy of a privacy rule is the thing
   that rots. A bug found there would be fixed once and missed here. One audited
   copy, and everything classroom-shaped lives in these files instead.

   WHAT IS DIFFERENT FROM ALMOST HUMAN'S TABLE, and both differences are the
   classroom:

   1. THE INVITE IS A CLASS CODE, not a single-use link. Almost Human invites
      one friend and burns the invite on the first tap, which is right for a
      table for two and wrong for a room of students, where thirty people claim
      the same code in the same minute. So a classroom invite is never marked
      claimed; it is a code the whole room can use until the table closes or
      SEAT_CAP is reached.
   2. NOBODY PAYS. Almost Human checks a subscription and spends the host's
      credits. The classroom is free and stays free, so none of that is here.

   The code is stored as the invite token with a CLASS- prefix, which
   _ah-table.js's own safeTableToken rejects: an Almost Human endpoint can
   therefore never claim a classroom invite, and a class code can never be
   replayed as a seat. That isolation is deliberate rather than incidental.
*/

const crypto = require('crypto');
const { sbSelect } = require('./_ah-table.js');

// No 0/O/1/I/L: this code gets read out loud in a room and written on a board.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

// A class, not a stadium. Also the ceiling on what one code can be spread to if
// it escapes the room it was read out in.
const SEAT_CAP = 40;

function newClassCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH * 2);
  let out = '';
  for (let i = 0; out.length < CODE_LENGTH && i < bytes.length; i++) {
    // Rejection sampling, so every letter is as likely as every other one.
    const v = bytes[i];
    if (v < 256 - (256 % CODE_ALPHABET.length)) out += CODE_ALPHABET[v % CODE_ALPHABET.length];
  }
  return out.length === CODE_LENGTH ? out : newClassCode();
}

/* What somebody types, turned into what is stored. Lower case, spaces, the
   dash this is displayed with, and the two letters people reliably mistype for
   digits all come back to the same code. */
function normalizeClassCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1');
  // 0 and 1 are not in the alphabet at all, so a code containing either was
  // mistyped rather than mis-shown, and there is nothing to recover.
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(s) ? s : null;
}

function inviteTokenFor(code) {
  return 'CLASS-' + code;
}

// Shown four and four, which is how a person reads a code off a screen.
function displayCode(code) {
  return code.slice(0, 4) + '-' + code.slice(4);
}

async function seatCount(key, roomId) {
  const rows = await sbSelect(
    key,
    `etl_table_people?room_id=eq.${encodeURIComponent(roomId)}&removed=eq.false&select=id`
  );
  return rows.length;
}

module.exports = {
  CODE_ALPHABET,
  CODE_LENGTH,
  SEAT_CAP,
  newClassCode,
  normalizeClassCode,
  inviteTokenFor,
  displayCode,
  seatCount,
};
