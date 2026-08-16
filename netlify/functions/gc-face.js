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
   casting sheet and produces faces that look like one. */
const VARIATIONS = [
  'Open, easy face. Slight smile, as if you just walked in and they looked up.',
  'A more weathered, quieter face. Not unhappy, just someone who listens first.',
  'Warmer and more animated, caught mid-sentence, laugh lines doing the work.',
  'Calm and steady, looking straight at the camera, entirely unbothered by it.',
];

function facePrompt(f, variation) {
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

  bits.push('Head and shoulders, slightly off centre, indoors or on a doorstep, ' +
            'ordinary daylight from one side. Shallow depth of field. ' +
            'A face with a life behind it: real skin, real age, nothing smoothed.');

  /* NO WRITING IN THE PICTURE. The text failures on this campus have all been
     the same failure, and a caption burned into a face is unusable. */
  bits.push('No text, no lettering, no logos, no watermark, no borders, no captions.');

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

  let face;
  try {
    face = await gemini.generate(facePrompt(f, VARIATIONS[idx]), '3:4');
  } catch (err) {
    /* Reported with the reason the model actually gave. One card fails, the
       other three still land, and the page says which. */
    return json(502, { error: 'not_drawn', variation: idx,
                       detail: String((err && err.message) || 'unknown').slice(0, 300) });
  }

  return json(200, { face, variation: idx, of: HOW_MANY });
};
