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
const { getStore, connectLambda } = require('@netlify/blobs');

/* ── THE DRAW CAP, SERVER SIDE ────────────────────────────────────────────
   Added 2026-08-28. The only enforcement of "three sets per friend" used to
   live in the browser's own localStorage, and it had two separate holes:
   clearing storage (or a private window) reset it to zero, and worse, the
   client's own counter reset itself every time ANY face was picked on ANY
   friend -- draw three sets, pick one you do not even want, the counter
   clears, draw three more. Neither hole needed clearing storage at all.

   This is the real ceiling: twelve images (three sets of four, the same
   number build.html has always advertised) per visitor per friend, counted
   here, never reset by picking a face. A visitor with no id at all and a
   friend with no id at all cannot be told apart from any other such
   request, so they share one bucket rather than getting a free pass --
   the honest path always has both ids by the time this fires.

   Not perfectly atomic: four draws in one set really do arrive as four
   concurrent calls (see the comment below on why), and a plain blob
   get-then-set can under rare concurrent overlap let a couple of those
   through under the wire. That is a rounding error against the real
   failure mode this closes, which was unlimited. */
const PORTRAIT_LIMIT = 12;

async function drawsSoFar(store, key) {
  try {
    const v = await store.get(key);
    return parseInt(v, 10) || 0;
  } catch (e) { return 0; }
}

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
   [[etl-cast-diversity-theme]]

   AND THE FIRST ONE NEEDS A DIRECTION AS MUCH AS THE OTHER THREE. When I fixed
   the four-white-women problem I gave slots two, three and four an ancestry and
   left this one saying nothing, which does not mean "anything": it means the
   model's default, every single time.

   That default has a face, and it is Arch's. Cal came back as a greying bearded
   man in a plaid collar on a porch, and Dr. O looked at a scene made from him
   and said "that looks like Arch". It did. It was not the video drifting, the
   portrait was already him. It is the same convergence Pookie hit when her four
   options came back as Arch, Henry and a gym guy.

   So this slot is steered too, away from the house default rather than into
   another fixed look. Our own demo friend came out of the same model, so
   "unspecified" and "looks like Arch" are the same instruction.

   ROTATED, NOT ASSIGNED TO SLOTS. This used to read "slot two is Black, slot
   three is East Asian, slot four is Latino", which is the casting sheet the
   paragraph above warns against, written by me two hours after warning about
   it. It also left slot one as "the default", and the default has a face: Arch's.

   So there are two lists now. The manner is fixed per slot, because four
   different expressions is the point of showing four. The appearance rotates
   with the nonce, so no slot is typecast, no slot is unspecified, and pressing
   again genuinely reshuffles who turns up. */
const MANNER = [
  'Open, easy face. Slight smile, as if you just walked in and they looked up.',
  'A more weathered, quieter face. Not unhappy, just someone who listens first.',
  'Warmer and more animated, caught mid-sentence, laugh lines doing the work.',
  'Calm and steady, looking straight at the camera, entirely unbothered by it.',
];

/* Every one of these is a direction, including the ones that would otherwise
   be left to the default. Nothing here is a fixed slot and nothing here is
   remarked on anywhere a person can see. [[etl-cast-diversity-theme]] */
const LOOK = [
  'This one is Black.',
  'This one has East Asian features.',
  'This one has South Asian features.',
  'This one is Latino or Hispanic.',
  'This one is Middle Eastern or North African.',
  'This one is white, and specifically not the stock greying bearded man in a ' +
  'checked shirt: give them a particular face of their own.',
  'This one is of mixed heritage.',
  'This one is Indigenous or Native American.',
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
/* WARM, ALL OF THEM. The first set of these included grey winter daylight and
   the street outside, and every face came back gloomy and cold in a dark coat.
   Somebody is choosing a friend from these. Every option here has to be a
   light and a place you would be pleased to walk into. */
const LIGHT = [
  'Warm afternoon light, soft and flattering.',
  'Low golden evening sun coming in from one side.',
  'Bright, clear morning light, cheerful.',
  'Lamplight indoors in the evening, warm and comfortable.',
  'Soft daylight through a big window, gentle on the face.',
];

const SETTING = [
  'In their own kitchen, comfortable, a warm room behind them.',
  'In a bright front room, sitting near the window.',
  'At a table in a nice cafe, cup in front of them.',
  'In a garden on a good day, greenery behind them.',
  'In a comfortable living room, lamps on, home behind them.',
];

const FRAME = [
  'Close, head and shoulders, filling the frame.',
  'A little further back, from the chest up, the room visible around them.',
  'Slightly to one side, not centred, looking just past the camera.',
  'Straight on, plain and direct, nothing clever about it.',
];

function pick(list, n) { return list[Math.abs(n) % list.length]; }

function facePrompt(f, idx, nonce) {
  const bits = [];

  bits.push('A photograph of a real person. Natural photography, not an illustration, ' +
            'not a render, not a stock headshot.');

  /* The answers, as given. Anything left blank stays blank and is never
     guessed at, exactly as the summary list on the build page treats them. */
  const who = [];
  if (f.age)    who.push('in their ' + String(f.age).replace(/s$/, '') + 's');
  if (f.gender) who.push(String(f.gender).replace(/^A /, '').toLowerCase());
  if (who.length) bits.push('They are ' + who.join(', ') + '.');

  /* THE JOB IS IN THE FACE, NOT IN THE OUTFIT. This used to end "in the clothes
     that job leaves you in", which dressed everybody in work coats and put
     them on a building site. You are not meeting them at work. You are meeting
     them because they came to see you. */
  if (f.work) bits.push('They work as: ' + f.work + '. That shows in their bearing and ' +
                        'their hands, not in their clothes. They are not at work here ' +
                        'and not wearing work clothing.');
  if (f.from) bits.push('They are from ' + f.from + '.');
  if (f.into) bits.push('Outside work they are into ' + (Array.isArray(f.into) ? f.into.join(', ') : f.into) + '.');

  /* How they hold themselves, fixed per slot: four different expressions is
     the point of showing four. Then how they look, rotated by the nonce, so no
     slot is typecast and no slot is left on the default. */
  bits.push(MANNER[idx % MANNER.length]);
  bits.push(LOOK[(idx + nonce) % LOOK.length]);

  /* AN ORDINARY PRIVATE PERSON, NOT A FACE ANYBODY RECOGNISES. Pookie's sets
     came back with two famous actors in them, and our own Arch. Left to itself
     the model reaches for the handsome, well-lit, familiar face, because that
     is what photographs of fifty-year-old men mostly are in its training.

     Two things are wrong with that and only one of them is legal. It is
     somebody's actual likeness, a real living person who did not agree to be
     anybody's companion. And it breaks the only promise this screen makes,
     which is that this friend is theirs: a face you have seen in films is the
     opposite of a friend nobody else has.

     NOT FAMOUS IS NOT THE SAME AS NOT NICE, and the first version of this
     confused the two. It said "not conventionally handsome, not styled, the
     kind of face you would pass in a supermarket", which is a fine way to
     avoid an actor and a terrible way to offer somebody a friend. Pookie's
     four came back drab, and she said plainly that she wants good looking
     companions even if it is not romantic. She is right, and the two are not
     in tension: you are allowed to want your friend to be lovely to look at.
     Wanting that is not wanting a date. Ordinary means not famous. It has
     never meant plain on purpose. */
  bits.push('Not a celebrity, not an actor, not a model, not a public figure, and not ' +
            'resembling any recognisable person. A real face rather than a magazine ' +
            'one: its own particular features, a life behind it, nothing airbrushed.');

  bits.push('Within that, an attractive and appealing person. Good looking in an ' +
            'ordinary human way, the sort of face people are drawn to and are glad ' +
            'to see. Kind eyes, an open expression.');

  bits.push('They have made an effort. Clean and well kept, hair done, dressed in good ' +
            'clothes they chose and like and that suit them, the way you turn out to ' +
            'see somebody you are pleased to see. Not scruffy, not dishevelled, not in ' +
            'work-stained clothing or gym clothing, no heavy coat.');

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

/* creaturePrompt — ADDED 2026-08-27 for the new nonhuman builder path
   (build.html's "What kind of companion" toggle). facePrompt() above is
   built entirely around a human subject -- ancestry rotation, "not a
   celebrity," "hair done," work clothes -- none of which makes sense
   pointed at a dog or a fairy, so this is a genuinely separate prompt
   rather than a branch bolted onto the human one.

   f.gender CARRIES THE SPECIES HERE. Not a new field: the creature-mode
   question in build.html is "What are they" writing into the same `gender`
   value Reggie's own canon already uses this way (`gender: 'A dog'`), so
   this reads it exactly like facePrompt() does, just without treating it
   as one clause among several -- it is the actual subject of the sentence.

   KEPT FROM THE HUMAN PROMPT: warm setting/light/framing, no writing in
   the frame, appealing rather than plain. DROPPED: ancestry (a species has
   no ancestry to rotate), celebrity/likeness language (does not apply),
   "made an effort" clothing language (most creatures do not wear
   clothes, and insisting on it is how a dog ends up in a cardigan). */
function creaturePrompt(f, idx, nonce) {
  const bits = [];
  const subject = f.gender ? String(f.gender).replace(/^An? /i, '').trim() : 'creature';

  bits.push('A photograph of a real ' + subject + '. Natural photography, not an ' +
            'illustration, not a render, not a cartoon, not a mascot costume.');

  if (f.into) bits.push('They are into ' + (Array.isArray(f.into) ? f.into.join(', ') : f.into) + '.');
  if (f.work) bits.push('What they do: ' + f.work + '.');

  /* Manner and rotation reused from the human set -- an expression and a
     angle are species-neutral, and reusing them keeps four genuinely
     different photographs instead of four copies of one description. */
  bits.push(MANNER[idx % MANNER.length]);

  bits.push('A particular, individual ' + subject + ' with its own real features and its ' +
            'own particular look, not a generic or idealised example of the type. Full of ' +
            'life and personality, an expression that makes you want to know them.');

  bits.push(pick(SETTING, nonce + 1));
  bits.push(pick(LIGHT, nonce + 2));
  bits.push(pick(FRAME, nonce + 3));

  bits.push('Vertical portrait orientation, taller than it is wide. Shallow depth of ' +
            'field. Real texture, real detail, nothing smoothed or stylised.');

  bits.push('Absolutely no writing anywhere in the frame. No text, no lettering, no ' +
            'numbers, no logos, no signage, no watermark, no caption, no border.');

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

  connectLambda(event);
  const store = getStore('gc_portrait_draws');
  const visitorId = String(body.visitor_id || 'no-visitor').trim() || 'no-visitor';
  const friendId = String(f.id || 'no-friend').trim() || 'no-friend';
  const drawKey = visitorId + '::' + friendId;

  const already = await drawsSoFar(store, drawKey);
  if (already >= PORTRAIT_LIMIT) {
    return json(429, { error: 'draw_limit', detail: 'That is all the portraits for this one.' });
  }

  /* Which of the four this call is drawing. Out of range wraps rather than
     refuses: asking for a fifth face is a reasonable thing to want and there
     is no reason to make it an error. */
  const n = Number(body.variation);
  const idx = (Number.isFinite(n) && n >= 0) ? Math.floor(n) % MANNER.length : 0;

  /* Sent by the page, different on every press, so "draw four more" actually
     draws four more rather than the same four again. Falls back to something
     that at least differs between the four cards of one set. */
  const nn = Number(body.nonce);
  const nonce = Number.isFinite(nn) ? Math.floor(Math.abs(nn)) + idx : idx;

  const prompt = (f.kind === 'creature') ? creaturePrompt(f, idx, nonce) : facePrompt(f, idx, nonce);

  let face;
  try {
    face = await gemini.generate(prompt);   // no aspect, see facePrompt/creaturePrompt
  } catch (err) {
    /* Reported with the reason the model actually gave. One card fails, the
       other three still land, and the page says which. A failed draw is not
       billed against the cap -- nothing was actually spent. */
    return json(502, { error: 'not_drawn', variation: idx,
                       detail: String((err && err.message) || 'unknown').slice(0, 300) });
  }

  try { await store.set(drawKey, String(already + 1)); } catch (e) {}

  return json(200, { face, variation: idx, of: HOW_MANY });
};
