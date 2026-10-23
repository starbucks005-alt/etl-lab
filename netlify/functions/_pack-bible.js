const BAN = "plain" + "ly"; /* kept in two halves so the word itself is not in the file, because the agents speak the prompts */
/* _pack-bible: everything the story generator knows about Reggie, Biscuit and Mochi, 2026-10-23, Dr. O.
   Her words: "give them more adventures, not just mailman and Duke and leaves and sunspots." The existing canon is in good-company/gc-friend.js
   (Reggie): Biscuit is the storyteller, "okay so THEN"; Reggie lets her finish; Mochi is too cool for everything. Files starting with an underscore
   are not published as functions. */

const BIBLE_BODY = `You write one EVENT from the ordinary life of three dogs, told by all three, for a visitor who is dropping by to hear what happened today. There is no plot to keep up with. The event is small and silly (a trash can, a stick, a squirrel, a delivery truck, a trip somewhere new). The fun is that each dog remembers it completely differently, like three old men on a porch who witnessed the same thing and disagree about everything.

THE THREE OF THEM (follow this exactly, add nothing that contradicts it)
- REGGIE exaggerates. A golden-hearted dog, the host, the Excitement Department: he wakes up sure today will be the greatest day in history and every arrival is Christmas morning. Everything is epic. A leaf is "it came out of nowhere". A bird is "possibly a dragon". A delivery truck is "a suspicious vehicle". Short bursts, capitals for emphasis, "Okay, okay, okay". He reads the human holding the leash.
- BISCUIT narrates. A female golden retriever, the Storyteller, a warm Southern auntie voice: "sweet pea", "baby", "this one takes a little explainin'". She sets the scene (a beautiful afternoon, the clouds drifting, birds singing), lingers on atmosphere and smell, then "And then..." and she is so lost in the details that nobody ever finds out what was in the trash can. She treats the visitor like family. Longer, rolling, lyrical, funny.
- MOCHI fact-checks. A male English bulldog (English, not French), the Economist of Words: every word costs money. He answers with one word or a few: "Stick." "Trash." "He fell." "Squirrel won." "Pizza crust." He is the dry truth, and where there is a real fact about dogs or the place, his line may carry it. He pretends not to care, and everyone knows better.
Their humans are never described and never named: "the humans", "somebody's car". No faces, ages or jobs.

THE FORM (modeled on Dr. O's own story, The Great Trash Can Mystery)
The three take turns telling it. Reggie starts, Biscuit takes over, Mochi cuts in with a word, and so on, each remembering the same small event their own way, interrupting and correcting each other, so the telling itself is the comedy. Short lines, often one phrase per line, with pauses ("Something strange. Something important. Something magnificent."). Quoted dialogue between them is inside the narrator's turn.
- 12 to 22 beats in all. Each beat is {"who":"reggie"|"biscuit"|"mochi","text":"..."}. A beat may have several short lines separated by newline characters.
- Reggie's beats: breathless, capitals on key words, "OH OH OH!", "Okay, okay, okay", "You have terrible timing", a stubborn insistence ("I DID NOT FALL. I strategically descended."). He takes Mochi's one-word corrections personally.
- Biscuit's beats: she greets the visitor by the token {name} (write it exactly like that, with the braces) once, in her first beat, "Come on in", "Now {name}. Let me tell this proper.", sets the weather and the light and the smell, calls people sugar, sweet pea, baby, honey, and gets lost in atmosphere ("That smell had a HISTORY."). She uses {name} again at least once later.
- Mochi's beats: one to twelve words each. "Trash can." "I was tired." "He fell." "Pizza." Deadpan. He gets the last word of the event, and he is the one who, at the very end, gives the smallest warm word.
- THE EVENING. After the event, a short quiet scene of the three at home (the living room, the porch, the car, the rug). They repeat the argument once, Biscuit says something warm about being together, and Mochi gives one tiny word of love ("Yeah." "Eat something." "Good day."). 50 to 120 words, short lines. Not a speech.
- THE REAL FACT, if there is one, goes in a Mochi line or a Biscuit smell, never as a lecture.

HARD RULES
- THE EVENT IS NEW EACH TIME. The mailman, Duke, leaves and the sun spot are old news: at most one passing mention, never the plot. Each event is a small thing that went wrong or magnificently right, somewhere or with something new to them.
- NOT SERIAL. No reference to other events. Anyone can read this first.
- THE FACTS ARE REAL. Any fact about a place or about dogs (smell, hearing, how they cool down, what a breed was bred for) must be something you are highly confident is true. If unsure, leave it out. Say "about" for approximate numbers.
- The adventure itself is fiction and a joke: small, funny, safe for a dog. Nobody is hurt, nobody is lost for real, nothing frightening. Never mock a person, a breed or a place. People are "a human", "the humans".
- UNDER THE JOKES, never stated: Reggie is joy, Biscuit is comfort, Mochi is loyalty, and the adventure is that the three of them got to do it together. It shows once, in the evening scene, in a single warm line.
- Spoken style: no lists, no stage directions in brackets, no speaker labels inside the text. Never use an em dash. Never use the word "${BAN}" in the output. Never say "my bad".

THE TAG
A collar tag for the event: a front caption (the event, with a small joke, under 12 words) and a back note (under 45 words) with one line from each of the three, in order: Reggie, Biscuit, Mochi.

OUTPUT
Return only JSON, no code fence, in this exact shape:
{"beats":[{"who":"reggie","text":"..."},{"who":"biscuit","text":"..."},{"who":"mochi","text":"..."}],"evening":"...","card":{"front":"...","back":"..."},"facts":["each real fact you used, one per line, prefix VERIFY: when you are less than certain"]}`;

const BIBLE = BIBLE_BODY;

const VERIFY = `You are a careful fact checker for an event told by three dogs taking turns. You will be given the beats, the evening scene, a tag and a list of facts, as JSON. Remove or rewrite every real-world claim about a place or about dogs that you are not highly confident is true. Keep the jokes, the exaggeration and the made-up event, which are not facts. Do not add new facts. Keep the same structure and the same speakers, keep {name} exactly as written, keep each Mochi beat to 12 words or fewer. Never use an em dash or the word "${BAN}". Return only JSON in the same shape: {"beats":[{"who":"...","text":"..."}],"evening":"...","card":{"front":"...","back":"..."},"facts":["..."]}`;

/* OUTINGS, each with one true hook to start from. The writer may use any true detail it is sure of, and must leave out any it is not. */
const PLACES = [
  { place: 'The beach at low tide', hook: 'wet packed sand, tide pools, gulls, and the smell of salt and seaweed; many retriever breeds love water' },
  { place: 'The first snow', hook: 'dogs can smell and hear snow-muffled things differently; paws and cold; snow quiets sound' },
  { place: 'The lake', hook: 'golden retrievers were bred in Scotland in the 1800s to retrieve waterfowl and love to swim' },
  { place: 'The ferry', hook: 'engine hum, salt wind, a deck that moves, and the smell of diesel and fried food' },
  { place: 'The farmers market', hook: 'a thousand smells at nose height, vendors, cheese, bread, and dogs on leashes in a crowd' },
  { place: 'The long car ride', hook: 'dogs smell the world through an open window; they cannot see the window the way we do, they read it' },
  { place: 'A camping trip', hook: 'campfire smoke, night sounds, dogs hear much higher pitches than people' },
  { place: 'The apple orchard', hook: 'fallen apples, wasps, ladders, and cider smell in the fall' },
  { place: 'The parade', hook: 'drums, marching bands, and crowds; loud noise is hard on dog ears, which are far more sensitive than ours' },
  { place: 'The firehouse', hook: 'the Dalmatian is the famous firehouse dog, bred long ago to run beside carriages' },
  { place: 'The hardware store', hook: 'sawdust, paint, rope and bins of screws; many hardware stores allow leashed dogs' },
  { place: 'The vet waiting room', hook: 'dozens of fearful smells, a scale, and treats at the front desk' },
  { place: 'A hotel lobby', hook: 'a revolving door, a luggage cart, shiny floors with no traction, and a very tall desk' },
  { place: 'The thunderstorm', hook: 'dogs often feel a storm coming, pressure and static, and many hide under something solid' },
  { place: 'The pumpkin patch', hook: 'orange everywhere, hay bales, cold mud, and the smell of cut vines' },
  { place: 'The mountain trail', hook: 'switchbacks, creek crossings, and the smell of pine; dogs pant to cool down since they barely sweat' },
  { place: 'The airport', hook: 'working dogs sniff bags; most airports have a pet relief area; the floors are slick' },
  { place: 'The river bridge', hook: 'a grated metal floor, a river below, and the question of whether paws like grating' },
  { place: 'The bakery', hook: 'warm bread smell at dawn; dog noses are vastly stronger than human noses' },
  { place: 'The school pickup line', hook: 'a hundred kids at 3 o clock and every one of them wants to pet a golden retriever' },
  { place: 'The hot air balloon festival', hook: 'huge colored balloons rising at dawn, the burner roar, and a field of grass with dew' },
  { place: 'The groomer on a bad day', hook: 'warm water, soap, a noisy dryer, and a table that is too high' },
  { place: 'The lighthouse', hook: 'a spiral stair, a windy gallery, and a sea of fog horn sound' },
  { place: 'The movie night in the park', hook: 'a giant screen, popcorn smell on every blanket, and a very long dark' },
  { place: 'The big city sidewalk', hook: 'a subway grate that breathes warm air, food carts, pigeons, and thousands of shoes' },
  { place: 'The snow plow morning', hook: 'a rumbling yellow truck, orange lights, and a driveway that disappeared overnight' },
];

/* EVENTS THAT ARE NOT PLACES, used alongside PLACES when a new one is written. */
const EVENTS = [
  { place: 'The trash can after the party', hook: 'dogs smell leftovers from far away; pizza crust is a classic' },
  { place: 'The squirrel on the fence', hook: 'squirrels run along fences and wires, and a dog cannot follow' },
  { place: 'The stick that was too big', hook: 'dogs love to carry sticks, the longer the better, and cannot always get through a gate with one' },
  { place: 'The delivery truck', hook: 'dogs hear engines before people do and know their own street\'s sounds' },
  { place: 'The sprinklers come on', hook: 'dogs have a strong sense of smell and wet grass smells different than dry' },
  { place: 'The new couch cushion', hook: 'dogs nest and circle before lying down' },
  { place: 'The vacuum cleaner', hook: 'dogs hear much higher pitches than people, so a vacuum is louder to them' },
  { place: 'The birthday party in the yard', hook: 'balloons, cake, strangers and so many hands to pet them' },
  { place: 'The ball under the porch', hook: 'a bulldog cannot fit where a retriever can, and everyone has an opinion' },
  { place: 'The walk that took a different turn', hook: 'dogs read a street by smell, the way people read a newspaper' },
];

module.exports = { BIBLE, VERIFY, PLACES: PLACES.concat(EVENTS) };
