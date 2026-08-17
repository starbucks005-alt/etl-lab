/* _gc-when.js — what time it actually is, where a friend lives.
   ─────────────────────────────────────────────────────────────────────────
   Ported from My Echo's _me-when.js rather than written fresh; that file
   already solved this properly and Dr. O pointed at it directly: "My Echo has
   a clock." Nothing here had one. Sofia asked what somebody was doing tonight
   at 11:36 in the morning, because nothing anywhere told either friend what
   time it was. The gauge label under a friend's face has claimed since it
   shipped that mood "shifts... with the time of day", which was aspirational
   copy for a feature that was never built.

   A TIMEZONE PER FRIEND, NOT PER VISITOR. Same reasoning as M.E.'s: the friend
   is a person and people are somewhere. "It's evening here" is a fact about
   Sofia, not about whoever happens to be talking to her, and a friend who
   adopts the visitor's clock is not a person, it is a widget. A room with
   people in different timezones does not change this: Sofia is still
   wherever Sofia is.

   NOTHING HERE THROWS. An invalid IANA zone falls back to a default rather
   than taking a friend off the air over a typo in a canon file.
*/

const DEFAULT_TIMEZONE = 'America/New_York';

function safeTimeZone(timezone) {
  const candidate = typeof timezone === 'string' ? timezone.trim() : '';
  if (!candidate) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch (err) {
    return DEFAULT_TIMEZONE;
  }
}

function parts(timezone, now) {
  const tz = safeTimeZone(timezone);
  const at = now instanceof Date ? now : new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', hour12: false,
  });
  const found = {};
  for (const part of formatter.formatToParts(at)) found[part.type] = part.value;
  return {
    timezone: tz,
    weekday: found.weekday,
    month: found.month,
    day: Number(found.day),
    year: Number(found.year),
    // hour12:false reports midnight as 24 on some ICU builds.
    hour: Number(found.hour) % 24,
  };
}

/* Pre-dawn caught first: hour < 5 before the bare hour < 17 test, or 3am
   passes the afternoon band and a friend says good afternoon at three in the
   morning. */
function timeOfDay(hour) {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/* Plain, the way anybody knows the date, by looking rather than counting.
   NO ARITHMETIC WITH IT: a friend that knows today's date will happily work
   out somebody's age or how long ago something was from a half-remembered
   number, and a confident wrong number in front of the one person who knows
   the real one is worse than not knowing at all. */
function nowNote(friend, now) {
  const p = parts(friend && friend.timezone, now);
  return `\n\nRIGHT NOW, where you are: it is ${p.weekday} ${p.day} ${p.month} ${p.year}, ` +
    `${timeOfDay(p.hour)}. You know this the way anyone knows what day it is, by looking. ` +
    `It is background, not a thing to announce, and nobody wants the date recited back at them.\n` +
    `DO NOT DO ARITHMETIC WITH IT. Never work out somebody's age, how long ago something was, ` +
    `or how many years a thing has been going, unless you were actually told the other end of ` +
    `that span. "I don't remember what year that was" is a fine answer.`;
}

module.exports = { safeTimeZone, parts, timeOfDay, nowNote, DEFAULT_TIMEZONE };
