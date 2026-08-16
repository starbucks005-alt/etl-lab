/* gc-face — four faces for the friend somebody just described.
   ─────────────────────────────────────────────────────────────────────────
   The last unwired step of the build. Everything above it already works: the
   answers are collected and written in the shape the room reads. This turns
   those answers into four faces and lets the person pick the one that looks
   like their friend.

   FOUR, NOT ONE. Dr. O's brief from the start: "images are generated so the
   person is unique to them, they pick one." A single face is a verdict handed
   down. Four is a choice, and the choosing is the moment the friend stops
   being a form and starts being somebody. It is also the honest option: no
   model gets a face right first time from a paragraph of text.

   THEY DIFFER IN THE FACE, NOT IN THE BRIEF. All four are the same person as
   described, same age, same gender, same work, same weather in their life.
   What varies is everything the answers did not pin down, appearance included,
   because the answers do not ask about it and we do not ask about it. The cast
   this product is for is not one kind of person and the four faces should not
   arrive assuming otherwise. Nothing in the interface remarks on it.

   WHAT COMES BACK IS A PHOTOGRAPH OF A PERSON. Not an illustration, not a
   portrait study, not a stock headshot. Somebody's actual friend, caught
   mid-life, in the clothes they own.

   ONE FACE PER CALL, AND THE PAGE ASKS FOUR TIMES. Not four in one call, which
   is the obvious shape and the wrong one: this platform has a real ceiling on
   how long a synchronous function may run, lower than whatever timeout is
   declared for it, and the Kronborg table already paid for that lesson in
   dropped connections. Four image generations awaited together would sit right
   on it. Four separate invocations each finish comfortably, they run at the
   same time anyway because the browser fires them together, and each face
   appears as it lands instead of all four after a long blank wait. A failure
   is then one card, not the whole grid.

   COST, because this is the first thing in Good Company that spends real money
   per use: roughly five to seven cents an image, so twenty to twenty-eight
   cents for a set of four. Everything else in the build is free. The page will
   not repeat a press while one is in flight, and drawing another set is a
   deliberate second press.
*/

const gemini = require('./_gemini-image.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (code, obj) => ({
  statusCode: code,
  headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  body: JSON.stringify(obj),
});

const HOW_MANY = 4;

/* The four differ here and nowhere else. Written as directions to a
   photographer rather than a list of attributes, because the second reads as a
   casting sheet and produces faces that look like one.

   THEY HAVE TO DIFFER IN ANCESTRY TOO, AND SAYING SO IS THE ONLY THING THAT
   WORKS. The first version of this file left it unsaid and claimed in a
   comment that four faces "should not arrive assuming" one kind of person.
   They did: a woman in her sixties from Ohio came back white four times out of
   four. Left alone the model has a default and picks it every time, so the
   person whose friend does not look like that is quietly told to pick anyway.

   Said as a direction to one photographer about one person, never as a list of
   categories to work through, which produces a casting sheet. Nothing in the
   interface mentions any of this; the four faces just look like four people.
   [[etl-cast-diversity-theme]] */
const VARIATIONS = [
  'Open, easy face. Slight smile, as if you just walked in and they looked up.',

  'A more weathered, quieter face. Not unhappy, just someone who listens first. ' +
  'This one is Black.',

  'Warmer and more animated, caught mid-sentence, laugh lines doing the work. ' +
  'This one has East Asian or South Asian features.',

  'Calm and steady, looking straight at the camera, entirely unbothered by it. ' +
  'This one is Latino or Middle Eastern, or of mixed heritage.',
];

/* WHY THESE EXIST AT ALL: "DRAW FOUR MORE" WAS DRAWING THE SAME FOUR.

   The prompt for a given set of answers was byte-identical every time, so the
   second press asked the model the exact same question and got the same four
   people back. Pookie pressed it repeatedly and kept meeting the same faces,
   which makes the button a lie.

   There is no seed parameter to reach for here; image_config is already
   rejected by this endpoint. So the variety has to be in the words. These
   change the photograph without touching the brief: same person, different day
   and different corner of their life. Picked by a nonce the browser sends, so
   every press is a genuinely different set. */
const LIGHT = [
  'Overcast afternoon light, soft and even.',
  'Low evening sun coming in from one side, warm.',
  'Bright flat morning light.',
  'Indoors, light from a window off to one side, the rest of the room dim.',
  'Grey winter daylight, cool and plain.',
];

const SETTING = [
  'On their own doorstep.',
  'In their kitchen, leaning against the counter.',
  'Just inside the front room, coat still on.',
  'Outside, in the street where they live.',
  'At the back of the house, door open behind them.',
];

const FRAME = [
  'Close, head and shoulders, filling the frame.',
  'A little further back, from the chest up, the room visible around them.',
  'Slightly to one side, not centred, looking just past the camera.',
  'Straight on, plain and direct, nothing clever about it.',
];

function pick(list, n) { return list[Math.abs(n) % list.length]; }

function facePrompt(f, variation, nonce) {
  const bits = [];

  bits.push('A photograph of a real person. Natural photography, not an illustration, ' +
            'not a render, not a stock headshot.');

  /* The answers, as given. Anything left blank stays blank and is never
     guessed at, exactly as the summary list on the build page treats them. */
  const who = [];
  if (f.age)    who.push('in their ' + String(f.age).replace(/s$/, '') + 's');
  if (f.gender) who.push(String(f.gender).replace(/^A /, '').toLowerCase());
  if (who.length) bits.push('They are ' + who.join(', ') + '.');

  if (f.work) bits.push('They work as: ' + f.work + '. They look like somebody who ' +
                        'actually does that for a living, in the clothes that job leaves you in.');
  if (f.from) bits.push('They are from ' + f.from + '.');
  if (f.into) bits.push('Outside work they are into ' + (Array.isArray(f.into) ? f.into.join(', ') : f.into) + '.');

  bits.push(variation);

  /* AN ORDINARY PRIVATE PERSON, NOT A FACE ANYBODY RECOGNISES. Pookie's sets
     came back with two famous actors in them, and our own Arch. Left to itself
     the model reaches for the handsome, well-lit, familiar face, because that
     is what photographs of fifty-year-old men mostly are in its training.

     Two things are wrong with that and only one of them is legal. It is
     somebody's actual likeness, a real living person who did not agree to be
     anybody's companion. And it breaks the only promise this screen makes,
     which is that this friend is theirs: a face you have seen in films is the
     opposite of a friend nobody else has. */
  bits.push('This must be an ordinary private individual with an unremarkable, ' +
            'un-famous face. Not a celebrity, not an actor, not a model, not a public ' +
            'figure, and not resembling any recognisable person. Not conventionally ' +
            'handsome or beautiful, not styled, not a professional photograph. ' +
            'The kind of face you would pass in a supermarket and not look at twice.');

  /* Same brief, different day. Without these the prompt is identical every
     time and so is what comes back. */
  bits.push(pick(SETTING, nonce + 1));
  bits.push(pick(LIGHT, nonce + 2));
  bits.push(pick(FRAME, nonce + 3));

  /* THE FRAMING IS ASKED FOR IN WORDS, NOT AS A PARAMETER. The shared module
     will take an aspect ratio and send it as image_config, and this endpoint
     rejects that outright: "Unknown parameter 'image_config'". The other
     callers on this campus pass one and never notice, because they fall back
     to the other engine when the call fails. Said in the prompt it works, and
     the card crops with object-fit anyway. */
  bits.push('Vertical portrait orientation, taller than it is wide. ' +
            'Head and shoulders, slightly off centre, indoors or on a doorstep, ' +
            'ordinary daylight from one side. Shallow depth of field. ' +
            'A face with a life behind it: real skin, real age, nothing smoothed.');

  /* NO WRITING IN THE PICTURE, AND LAST BECAUSE THAT IS WHERE IT HOLDS. It was
     already last and still leaked: a hobby of crosswords put a newspaper in
     her hands with a real masthead on it. So it now names the way it actually
     fails, which is a prop carrying words rather than a caption stamped on the
     image. Interests set the setting, never a thing with writing on it. */
  bits.push('Absolutely no writing anywhere in the frame. No text, no lettering, no numbers, ' +
            'no logos, no signage, no watermark, no caption, no border. ' +
            'Nothing in their hands or behind them that would have words printed on it: ' +
            'no newspaper, no book cover, no magazine, no packaging, no screen. ' +
            'Their interests belong in the setting around them, not in a printed prop.');

  return bits.join(' ');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });

  if (!gemini.apiKey()) {
    /* Says which thing is missing. A page that cannot draw should say so
       rather than sit there looking broken. */
    return json(503, { error: 'no_image_key', detail: 'No Gemini API key in the environment.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const f = body.friend || {};
  if (!f.age && !f.gender && !f.work) {
    return json(400, { error: 'nothing_to_draw', detail: 'Answer the questions first.' });
  }

  /* Which of the four this call is drawing. Out of range wraps rather than
     refuses: asking for a fifth face is a reasonable thing to want and there
     is no reason to make it an error. */
  const n = Number(body.variation);
  const idx = (Number.isFinite(n) && n >= 0) ? Math.floor(n) % VARIATIONS.length : 0;

  /* Sent by the page, different on every press, so "draw four more" actually
     draws four more rather than the same four again. Falls back to something
     that at least differs between the four cards of one set. */
  const nn = Number(body.nonce);
  const nonce = Number.isFinite(nn) ? Math.floor(Math.abs(nn)) + idx : idx;

  let face;
  try {
    face = await gemini.generate(facePrompt(f, VARIATIONS[idx], nonce));   // no aspect, see facePrompt
  } catch (err) {
    /* Reported with the reason the model actually gave. One card fails, the
       other three still land, and the page says which. */
    return json(502, { error: 'not_drawn', variation: idx,
                       detail: String((err && err.message) || 'unknown').slice(0, 300) });
  }

  return json(200, { face, variation: idx, of: HOW_MANY });
};
