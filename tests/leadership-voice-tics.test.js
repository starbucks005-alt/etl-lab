/* leadership-voice-tics.test.js, the machine in the leaders' mouths, measured.
   Plain node, no install needed: `node tests/leadership-voice-tics.test.js`.

   Dr. O sat in her own leadership class on 2026-09-17 and wrote down what she
   heard the leaders say:

     "That is not a small thing"
     "I want to say one thing plainly,"
     "I am going to say plainly what the others have said with more patience
      than I sometimes have."
     "I have lived close enough to it to call it plainly."
     "plainest language I know how to use."
     "You walk in, you speak plainly, and you make"
     "I want to sit with it for a moment"

   Those seven lines are the fixture below, and they are the only specification
   this file needs. Four of them the scrub takes out on its own, for nothing.
   The other three need the repair pass, so what is checked there is that they
   are still flagged, and that the fences around the rewrite hold: a rewrite is
   kept only if it is close to the same length, keeps every web address exactly,
   and actually has fewer tics than what went in.

   WHY THE WORD COUNT IS A BAN HERE AND A CEILING IN MY ECHO. There, "rather
   than" is load bearing in a hundred real instructions and a blind replace
   would change how three families' Echoes talk. Here it is one word, in one
   classroom, that a room of students has already heard out loud, so zero is
   the number. NOT_A_BRIEFING is cut out of the count for the same reason My
   Echo cuts it: it is the rule that forbids the word, so it has to name it.
*/

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return { default: class Stub {} };
  return origLoad.apply(this, arguments);
};

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ', ' + detail : ''}`); }
}

const chatFile = path.join(__dirname, '..', 'netlify', 'functions', 'leadership-chat.js');
const chat = require(chatFile);
const { AGENTS, scrubVoice, straightenVoice, ticCount } = chat;

console.log('\nThe rule reaches everybody');
Object.keys(AGENTS).forEach((key) => {
  check(`${key} is told how they sound`, /HOW YOU SOUND, AND THIS COMES AFTER EVERYTHING ABOVE/.test(AGENTS[key].system));
});

console.log('\nThe word is not in anything that gets spoken');
/* The file with its comments stripped and NOT_A_BRIEFING cut out: what is left
   is the text that actually reaches a model. */
const src = fs.readFileSync(chatFile, 'utf8');
function cutBlock(text, startsWith) {
  const from = text.indexOf(startsWith);
  if (from === -1) return text;
  const to = text.indexOf('].join(', from);
  return to === -1 ? text : text.slice(0, from) + text.slice(to);
}
// Both of these have to name the word in order to forbid it.
const withoutTheRule = cutBlock(cutBlock(src, 'const NOT_A_BRIEFING = ['), 'const VOICE_REPAIR_BRIEF = (');
const spoken = withoutTheRule
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const said = (spoken.match(/\bplain(?:ly|est)\b/gi) || []).length;
check('no prompt or persona says it', said === 0, said + ' left');
Object.keys(AGENTS).forEach((key) => {
  const persona = AGENTS[key].system.split('HOW YOU SOUND, AND THIS COMES AFTER EVERYTHING ABOVE')[0];
  check(`${key}'s own persona is clean`, !/\bplain(?:ly|est)\b/i.test(persona));
});

console.log('\nWhat she actually heard, put back through the scrub');
const HEARD_AND_FIXED = [
  ['I want to say one thing plainly, the fire changed the whole direction of my life.',
   'The fire changed the whole direction of my life.'],
  ['The ice took the ship. That is not a small thing. We walked out anyway.',
   'The ice took the ship. We walked out anyway.'],
  ['I want to sit with it for a moment. Then I will answer you.',
   'Then I will answer you.'],
  ['Let me be direct, the standard I set cost my daughter her health.',
   'The standard I set cost my daughter her health.'],
  /* Added an hour after the first pass shipped. Dr. O: "MLK just said this",
     quoting "That is not nothing,". The first pass only matched a whole
     sentence ending in a full stop, and the comma form is the one the model
     actually reaches for. Both forms, and the "not just" version of the same
     move, are fixtures now. */
  ['That is not nothing, it is the whole of the movement.',
   'It is the whole of the movement.'],
  ['We walked for 381 days. That is not nothing. We won.',
   'We walked for 381 days. We won.'],
  ['It was not just a hard year, it was the year everything changed.',
   'It was the year everything changed.'],
];
HEARD_AND_FIXED.forEach(([heard, want]) => {
  const got = scrubVoice(heard);
  check(`"${heard.slice(0, 42)}..." comes out clean`, got === want, 'got: ' + got);
});

const NEEDS_THE_REWRITE = [
  'I am going to say plainly what the others have said with more patience than I sometimes have.',
  'I have lived close enough to it to call it plainly.',
  'You walk in, you speak plainly, and you make them listen.',
  'That is the plainest language I know how to use.',
];
NEEDS_THE_REWRITE.forEach((heard) => {
  check(`"${heard.slice(0, 42)}..." is still caught after the scrub`, ticCount(scrubVoice(heard)) > 0);
});

console.log('\nThe fences around the rewrite');
const answering = (text) => ({ messages: { create: async () => ({ content: [{ type: 'text', text }] }) } });
(async () => {
  const line = 'I have lived close enough to it to call it plainly.';
  check('a good rewrite is used',
    (await straightenVoice(answering('I have lived close enough to it to call it what it is.'), 'Harriet Tubman', line))
      === 'I have lived close enough to it to call it what it is.');
  check('a rewrite that still has the tic is refused',
    (await straightenVoice(answering('I will say it plainly, I have lived close to it.'), 'Harriet Tubman', line)) === line);
  check('a rewrite that throws the line away is refused',
    (await straightenVoice(answering('Yes.'), 'Harriet Tubman', line)) === line);

  const withUrl = 'Read it at https://www.gutenberg.org/ebooks/5199 and I say it plainly.';
  check('a rewrite that bends a source link is refused',
    (await straightenVoice(answering('Read it at https://www.gutenberg.org/ebooks/5200 and I say it straight out to you.'), 'Ernest Shackleton', withUrl))
      === scrubVoice(withUrl));
  check('a rewrite that keeps the link is used',
    /5199/.test(await straightenVoice(answering('Read it at https://www.gutenberg.org/ebooks/5199 and I say it straight out to you.'), 'Ernest Shackleton', withUrl)));
  check('a failed call never breaks the turn',
    (await straightenVoice({ messages: { create: async () => { throw new Error('upstream 529'); } } }, 'Ernest Shackleton', withUrl))
      === scrubVoice(withUrl));
  const clean = 'You did not give your best today, and you know it.';
  check('a clean line never reaches the repair at all', (await straightenVoice(null, 'John Wooden', clean)) === clean);

  console.log(failures === 0 ? '\nThe leaders sound like themselves.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
