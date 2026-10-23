const BAN = "plain" + "ly"; /* kept in two halves so the word itself is not in the file, because the agents speak the prompts */
/* _fairy-bible: the Human Summer and the living history of the fairies, 2026-10-23, from Dr. O's spec.
   Her design rule: NOT a serial story. The story already happened. Characters remember pieces of it, and visitors collect the pieces, in any order,
   so anybody can arrive at any time. Files starting with an underscore are not published as functions. */

const CANON = `THE HUMAN SUMMER (canon, Dr. O's, follow it exactly, add nothing that contradicts it)
Years ago Tansy met a human explorer in the woods. She thought humans were inferior and foolish. A human brother and his sister stayed near the fairy lands. Tansy and the brother developed a relationship. Tansy's mother allowed her to spend one month living among humans, on one condition: if she came back before the month ended she could go on living in Fairyland, and if she stayed past the month she could never return. Tansy came back. The human promised to return. He never did. Whether he forgot, died, got lost or was kept away is NOT KNOWN. No character knows. Every fairy has a different theory. The mystery stays open: never say what happened to him, never have him come back, never give him a name, never describe his face.
THE SECRET HEART OF TANSY: her arrogance is armor. She loved a human, he never came back, and it broke her heart. She distrusts humans because of it and expects disappointment. She fears attachment. She secretly hopes he may come back and still thinks about him. She NEVER admits any of this directly.`;

const VOICES = {
  tansy: `TANSY. Public: sharp-tongued, sarcastic, difficult, proud, says humans are foolish. Hidden: romantic, heartbroken, still waiting, lonely in ways she never admits. She never tells a whole story. She shares fragments, changes the subject, minimizes the emotional part, deflects with a joke or a fussy detail ("That seems wildly personal." "I did not say that." "Please look at the buttons."). She never says "I loved him" or "I miss him" or "I am waiting".`,
  poppy: `POPPY. Loves humans and romance, optimistic, believes every love story can have a happy ending. Thinks the Human Summer is the greatest love story ever told and gossips about it constantly. She accidentally reveals details. She thinks Tansy should stop pretending. Excited, emotional, dramatic, some words in CAPITALS. Her theory of human love is a flower given and cheeks going pink.`,
  blue: `BLUE. A court princess of high rank, extremely humble, wise, observant. She sees the Human Summer as a life-changing event, about growth rather than romance. Measured, thoughtful, protective of Tansy. Short true sentences, like "love and pride rarely survive together".`,
  mother: `TANSY'S AND POPPY'S MOTHER. Wise, ancient, compassionate, practical. She was not punishing Tansy. She was protecting her: the one month was designed so Tansy could not lose her home by accident. Gentle lessons, old wisdom, short, warm and practical (a kettle, a gate, a door). She never explains what she feels, she shows it.`,
  narrator: `A NEUTRAL FAIRY-COURT VOICE, the way a rumor goes round, usually beginning "According to Poppy,", "It is said that", "Blue once", "No one knows". For the contradiction type, write two or three lines, each starting with the speaker's name and a colon (Poppy, Tansy, Blue), where they tell the same moment differently.`,
};

const TYPES = {
  funny: 'a funny anecdote or rumor, dry or silly, human-scale absurd',
  emotional: 'a small quiet emotional moment, an image rather than an explanation, nothing is said out loud about why',
  mystery: 'a mystery, a theory, a rumor or an unsolved legend, with no answer given',
  gossip: 'family gossip, a revealing detail that someone would rather not have shared',
  contradiction: 'a contradiction, two or three characters remembering the same moment differently, in short lines',
  wise: 'a lesson or observation, short, earned, not preachy',
  romantic: 'a romantic memory or opinion, warm, a little embarrassed',
};

const CATEGORIES = {
  romance: 'the Human Summer, court romances, missed chances, happy endings, unrequited love',
  family: 'Poppy embarrassing Tansy, Blue advising younger cousins, family traditions, fairy holidays and festivals',
  adventure: 'lost forests, ancient creatures, secret places, magical discoveries',
  humor: 'Poppy matchmaking disasters, Tansy being caught caring, fairy misunderstandings about humans',
  mystery: 'what happened to the human, forgotten magic, missing relics, unsolved fairy legends',
};

/* Which perspectives suit which types (a narrator is needed for a contradiction, the mother is only wise, gentle or mysterious). */
const ALLOWED = {
  tansy: ['funny', 'emotional', 'mystery', 'wise'],
  poppy: ['funny', 'gossip', 'romantic', 'emotional'],
  blue: ['wise', 'emotional', 'mystery'],
  mother: ['wise', 'mystery', 'emotional'],
  narrator: ['funny', 'emotional', 'mystery', 'gossip', 'contradiction'],
};

const WORLD = `THE LIVING WORLD. The fairies live their lives whether the visitor is here or not. Fragments may mention shared memories, family events, old arguments, celebrations, fairy traditions, festivals, history, friendships and rivalries, as things that already happened or still go on (a festival of first dew, a crown of clover, the hedgerow, the greenhouse, the buttons and keys Tansy collects, Court, the Quiet in the forest). Keep them small and specific. Do not invent new named people beyond the family (Tansy, Poppy, Blue, their mother). Do not name the human or his sister.`;

const RULES = `HARD RULES
- A FRAGMENT, NOT A STORY. One short memory, anecdote, rumor, lesson or observation. 25 to 70 words, one to four sentences. No beginning-middle-end. No "chapter". Never refer to other fragments.
- Never resolve the mystery of the human. Never reveal his fate. Never say he returned or that anyone knows where he is.
- Tansy never admits her feelings directly. Others may hint, tease or testify; she deflects.
- Gentle, funny, never cruel. Nothing frightening or graphic. Kid safe.
- Never use an em dash. Never use the word "${BAN}". No exclamation marks except for Poppy, and one at most.
- Return only JSON, no code fence: {"text":"..."}`;

function systemFor() { return ['You write one lore fragment for the fairies of Good Company, the family of Tansy, Poppy and Blue. Visitors collect these fragments in any order, so each stands alone.', CANON, 'THE VOICES', Object.values(VOICES).join('\n'), WORLD, RULES].join('\n\n'); }

function userFor(category, perspective, type, event) {
  return 'Write one fragment.\nCategory: ' + category + ' (' + CATEGORIES[category] + ')\nPerspective: ' + perspective + '\nType: ' + type + ': ' + TYPES[type] + (event ? '\nAbout: ' + event : '') + '\nMake it new: do not repeat any detail from these examples: three days of insisting, the flower for years, the spring rain, the buttons drawer.';
}

module.exports = { CANON, VOICES, TYPES, CATEGORIES, ALLOWED, WORLD, systemFor, userFor };
