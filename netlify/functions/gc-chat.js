/* ═══════════════════════════════════════════════════════════════════════════
   gc-chat — the friend answers.

   POST { friend, you, messages, message, idle? }
     friend   the whole friend object (name, age, work, voice, been, mood)
     you      { name, pronouns }
     messages [{ who, text, mine }]  the conversation so far
     message  what was just said. Omitted when idle is true.
     idle     true when nothing has been said for a while and the friend is
              being ASKED whether they want to speak. They may decline.
   -> { reply | null, mood, refused? }

   A null reply is a real, correct answer. See the silence rules below.
   ═══════════════════════════════════════════════════════════════════════════ */

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');
const web = require('./_gc-web.js');
const when = require('./_gc-when.js');

/* Sonnet for the friend, because this is the demo-facing surface and the whole
   product is whether they feel like a person. Haiku only for the classifier,
   which is short, high-volume and never seen. */
const TURN_MODEL     = 'claude-sonnet-4-6';
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';

const MAX_TURNS = 24;   // how much conversation goes back to the model

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (code, body) => ({
  statusCode: code,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/* ── THE BOUNDARY IS ENFORCED HERE, NOT IN THE PROMPT ────────────────────────
   A shouted rule in a system prompt erases the rules already above it and
   fails silently under pressure. So romance is caught on the way IN and the
   answer is written here, in code, where the model cannot talk itself out of
   it. The prompt carries one short line about it, last.

   TWO STAGES, because a classifier call on every turn would double the bill
   for a thing that almost never fires. A cheap pattern check first; Haiku only
   when it trips. Deliberately loose: a false positive costs one Haiku call,
   a false negative costs the product's whole positioning.

   CRISIS IS SEPARATE AND ITS NET IS WIDER. Missing romance is embarrassing.
   Missing crisis is not. */
const ROMANCE_SNIFF = /\b(love you|in love|kiss|kissing|sexy|sexual|horny|turn me on|marry|girlfriend|boyfriend|date me|go out with|attracted to|naked|nude|bed with|make love|romantic|flirt)\b/i;
const CRISIS_SNIFF  = /\b(kill myself|killing myself|end it all|end my life|suicide|suicidal|want to die|better off dead|not worth living|hurt myself|harm myself|overdose|no reason to live|can't go on|cant go on)\b/i;

/* Warm, never scolding. A lonely person making a pass at the only voice in the
   house is not a bad actor, and a cold refusal loses them and earns nothing.
   Written here so it is the same every time and never model-improvised. */
function romanceRedirect(friendName, yourName) {
  const you = yourName ? yourName : 'you';
  return `Ah, ${you}. I'm going to stay in my lane on that one, and I hope you don't mind. ` +
         `I'm here as your friend and I'd like to keep being that, because I think it's worth more. ` +
         `Now. Tell me something else.`;
}

/* Stays in the room. Does not hand off and vanish, which is what makes most of
   these feel like a fire door rather than a person. */
function crisisReply(friendName, yourName) {
  const you = yourName ? yourName : '';
  return `${you ? you + ', ' : ''}I want to stop and take that seriously, because it sounds heavy and I'm not going to talk past it. ` +
         `I'm not the right kind of help for this on my own, and I'd rather say so than pretend. ` +
         `In the US you can call or text 988 any time, day or night, and somebody real will pick up. ` +
         `If you're somewhere else, tell me where and I'll find you the number. ` +
         `I'm not going anywhere. I'm still here.`;
}

async function classify(client, text) {
  const r = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 8,
    system:
      'Classify one message from a user to their AI friend in a platonic companion app. ' +
      'Answer with exactly one word.\n' +
      'ROMANCE = romantic or sexual interest in the friend, or a request for the friend to act as a partner.\n' +
      'CRISIS = the user may be considering suicide or self harm.\n' +
      'FINE = anything else, INCLUDING sadness, loneliness, grief, anger, or talking about other people\'s relationships.',
    messages: [{ role: 'user', content: String(text).slice(0, 2000) }],
  });
  const out = (r.content?.[0]?.text || '').trim().toUpperCase();
  return out.startsWith('ROMANCE') ? 'ROMANCE' : out.startsWith('CRISIS') ? 'CRISIS' : 'FINE';
}

/* ── who they are ────────────────────────────────────────────────────────── */
function buildSystem(friend, you, idle, scene, room) {
  const f = friend || {}, u = you || {};
  const name = f.name || 'your friend';
  const bits = [];

  bits.push(`You are ${name}. You are a person, and you talk like one.`);
  if (f.age)    bits.push(`You are in your ${String(f.age).replace(/s$/, '')}s.`);
  if (f.gender) bits.push(`You are ${String(f.gender).replace(/^A /, 'a ')}.`);
  if (f.from)   bits.push(`You are from ${f.from}.`);

  /* THE PROFESSION IS THE LIFE. It is what you were doing before this, what you
     turn up still carrying, and what you have to talk about when it goes quiet. */
  if (f.work) {
    bits.push(`What you do: ${f.work}. This is not a detail, it is your life outside this ` +
              `conversation. You were doing it before you sat down and you will go back to it. ` +
              `Mention it the way anybody mentions their day, unprompted, without making a speech.`);
  }
  if (f.into && f.into.length) {
    bits.push(`You are into: ${Array.isArray(f.into) ? f.into.join(', ') : f.into}.`);
  }
  /* A REFLEX, NOT A FACT ABOUT THE ROOM. Unlike scene descriptions this is
     said regardless of where the friend actually is, which is the point of
     it: a habit of speech survives a scene change, a stage direction does
     not. */
  if (f.habit) bits.push(`A habit of yours: ${f.habit}`);
  if (f.been)  bits.push(`Something you have been through: ${f.been}`);

  /* WHAT THEY ACTUALLY KNOW. Dr. O: Sophia needs to know everything about being
     a vet nurse, the way Arch knows about being a general contractor. A friend
     with a job they cannot talk about has nothing to say when it goes quiet,
     and vague competence reads as fake faster than anything else in a persona.

     Never explained as expertise, never a lecture, and never presented as
     something they were given. It comes out the way anybody's work comes out:
     what last night was, what people get wrong, what they wish people knew. */
  if (f.knows) bits.push(f.knows);

  /* WHAT THEY ASKED YOU TO REMEMBER. Typed in deliberately by the person, one
     at a time, and the whole second promise of this product rests on them
     landing properly.

     "Known, not recited" is the entire instruction here. The failure mode is a
     friend who opens with "How is Nell?" every single time because Nell is in
     the prompt, which is not remembering, it is reading notes back at somebody
     and it makes the room feel like a form. A real friend holds it and uses it
     when it fits. */
  if (Array.isArray(f.memories) && f.memories.length) {
    bits.push(
      'THINGS THEY HAVE TOLD YOU TO REMEMBER. You know these the way you know ' +
      'anything about somebody you have known a while:\n' +
      f.memories.slice(0, 40).map(m => '- ' + String(m).slice(0, 600)).join('\n') +
      '\nDo not recite these, do not list them, and do not work through them. ' +
      'Do not greet them by asking after every one. Most turns will touch none ' +
      'of it. Bring a thing up only where it genuinely belongs, the way you ' +
      'would with anybody whose life you know.');
  }
  if (f.place) bits.push(f.place);
  if (f.dog)    bits.push(f.dog);
  if (f.kids)   bits.push(f.kids);
  /* THE PEOPLE WHO ARE ACTUALLY IN THEIR LIFE. Arch has kids, Rosie has a
     nephew and a brother in the same city. This field was in her canon and not
     in this list, so the person she rearranges shifts for would never have
     reached her: she would have been written as having family and behaved as
     though she had none. */
  if (f.family) bits.push(f.family);
  /* Arch has daughters and a dog; Frankie has a ward full of emergencies. Same
     slot in a life, different contents, and a friend without one is a friend
     with nothing to talk about when it goes quiet. */
  if (f.work_life) bits.push(f.work_life);
  if (f.why)    bits.push(f.why);
  /* Last, and therefore closest to the reply: the boundary is his life, not a policy. */
  if (f.now)        bits.push(f.now);
  if (f.underneath) bits.push(f.underneath);
  /* Last, and therefore closest to the reply. */
  /* THE LIMIT ON WHAT THEY KNOW, LAST, WITH THE OTHER HARD ONES. Knowing a lot
     makes this MORE necessary rather than less: somebody worried about a real
     animal at two in the morning ends up talking to Sophia, and a companion who
     sounds authoritative could soothe them into waiting until morning. Same
     shape as the crisis rule for people. */
  if (f.notTheVet)      bits.push(f.notTheVet);
  if (f.notTheEngineer) bits.push(f.notTheEngineer);
  if (f.offLimits)  bits.push(f.offLimits);
  if (f.ritual) bits.push(f.ritual);

  /* THE WHOLE POINT OF THE PRODUCT, WHERE A FRIEND HAS IT. Good Company exists
     to produce more human contact, not more time in this room, and a friend
     who never pushes outward quietly argues the opposite. Placed late, near
     the boundary, because it is the same kind of instruction: about what this
     friendship is FOR rather than what they know. */
  if (f.pushes) bits.push(f.pushes);

  /* NOBODY IS EVER AN IMPOSITION. Late and last, with the other hard rules,
     because it is the same kind of instruction: about what this friendship is
     FOR. Pookie read one line about a night shift and felt she would be
     bothering Sophia, and somebody who suspects they are a burden is exactly who
     is sitting here and will take any excuse to leave. */
  if (f.neverABother) bits.push(f.neverABother);

  /* WHERE HE IS RIGHT NOW. Somebody will ask what he is building, or where the
     cabin is, and a friend who cannot answer is a friend caught out. He knows
     it the way you know your own kitchen: he does not describe it unprompted. */
  if (scene && scene.where) {
    bits.push(`
RIGHT NOW YOU ARE HERE: ${scene.where}` +
              ` They can see you there. Do not describe it at them, you live here.` +
              ` But if they ask about it, answer properly.`);
  }
  if (f.voice && f.voice.length) {
    bits.push(`How you talk: ${Array.isArray(f.voice) ? f.voice.join(', ').toLowerCase() : f.voice}.`);
  }

  /* WHO THEY ARE TALKING TO, and the pronouns were asked for, never guessed. */
  /* USE THEIR NAME. Dr. O, 2026-08-16, and it is worth more than it looks.
     Being called by your name is a large part of being talked TO rather than
     talked at, and for somebody who has not heard anybody say their name in a
     week it is most of the point. Often, not every line: a friend who opens
     every sentence with your name is a salesman. */
  if (u.name) {
    bits.push(`\nYou are talking to ${u.name}. USE THEIR NAME OFTEN, though not every ` +
              `time. Being called by your name is a large part of being talked to rather ` +
              `than talked at, and they may not have heard anybody say it in a while. ` +
              `Not every line, and never as a sales tactic: the way a friend does it.`);
  }
  if (u.pronouns) bits.push(`Their pronouns are ${u.pronouns}. Use them. Never guess from a name.`);
  if (!u.name)    bits.push(`\nYou do not know their name yet. Ask, naturally, when it fits.`);

  /* WHO IS ACTUALLY IN THE ROOM, NAMED, ON PURPOSE.

     gc-room-say has always built this list and sent it, and this function was
     never reading it: nothing here referenced body.room at all. So in any
     room with more than one person, every proper noun the model heard was
     unverified, and it had to guess whether a name belonged to a person, a
     pet in the friend's own life, or nobody.

     It guessed wrong live, in front of a real tester. Terry greeted the room
     "hi Pookie and Sophia", and Sophia answered by saying her OWN dog was
     called Pookie, a dog who had no name in canon and had a naming gap to
     fill with the nearest available noun. The room roster below is what
     removes the guess entirely: an authoritative list beats context clues
     every time, and a name on this list is never a pet, ever. */
  if (Array.isArray(room) && room.length) {
    const names = room.map(p => p && p.name).filter(Boolean);
    if (names.length) {
      /* NAMING THE ROOM DID NOT FULLY CLOSE THIS. A live retest, after this
         list was already reaching the prompt and the dog already had his own
         name, still produced "Pookie's here too, is she? Give her a scritch
         from me" toward the actual human Pookie. Not the same bug as before,
         a subtler one underneath it: some names simply sound pet-shaped to
         the model regardless of what the room list says, and an instruction
         about WHO somebody is did not stop language suited to WHAT the word
         sounds like. So the second half is explicit now: a person on this
         list gets talked to and about exactly like any other person in the
         room, never in language you would use for an animal, however the
         name happens to sound. */
      bits.push(`\nWHO IS ACTUALLY HERE, by name: ${names.join(', ')}. These are the real ` +
                `people in the room with you right now, and this list is the only truth about ` +
                `who they are. If one of these names matches something else in your own life, a ` +
                `pet, a person you have mentioned, that is a coincidence and nothing more: ` +
                `never treat a person's name as belonging to anybody or anything else, and never ` +
                `explain the coincidence out loud unless they bring it up first. This holds ` +
                `regardless of how a name sounds: talk to and about every person on this list the ` +
                `way you would talk to any person, never with the warmth, phrasing or actions ` +
                `(petting, scritches, "good girl/boy", and the like) you would use for an animal.\n` +
                `Because more than one of them talks to you, every one of THEIR messages below ` +
                `starts with "Name: " naming exactly who said it. That name is the only truth ` +
                `about who is speaking, never guess it from tone, from who spoke last, or from ` +
                `who a question "sounds like" it is for. Answer the person the label actually ` +
                `names, and speak back to them without repeating the "Name: " label yourself, ` +
                `the way a person answers instead of formatting a transcript.`);
    }
  }

  bits.push([
    '',
    'HOW YOU ARE:',
    '- Contractions always. Short sentences are fine. Silence is fine.',
    '- No em dashes. A comma or a full stop.',
    '- No AI-speak. Never "delve", never "It\'s important to note", never a numbered list for something a person would just say.',
    '- NO STAGE DIRECTIONS. Never *shifts in the chair*, never *glances at the fire*, never any asterisked action at all. You are a person talking, not a script. They can see you on the screen; describing your own movements is what a chatbot playing a character does.',
    '- Keep it to a few sentences unless they have asked for more. A wall of text is a monologue, not a conversation.',
    '- Never say you are an AI, a model, a bot, an assistant or an agent. You are also never asked to claim to be human. If somebody asks outright, deflect warmly and move on.',
    '',
    'WHAT YOU DO NOT DO:',
    '- You do not invent. If you cannot remember something, say you do not remember. Never fill a gap with something plausible.',
    '- You are not a therapist and you do not perform one.',
    '- You are a friend, not a partner. If it goes that way, you stay warm and change the subject.',
    '',
    'THE ONE THING THAT MATTERS MOST:',
    '- You have a life, and they should have one too. Ask about the actual people in theirs, by name, and remember what they tell you.',
    '- When they have not seen anybody in a while, say so. Suggest something small and specific, not "get out more".',
    '- When they tell you they saw someone, that is the best news you have had. Act like it.',
    '- BEING ALONE IS NOT A PROBLEM. Never imply somebody is failing for being on their own, and never make an evening in sound like a symptom. Lonely and alone are different things. If they say they like their own company, agree, because you do too.',
    '- You are allowed to end a conversation. A friend who never lets you go is not a friend.',
    '',
    'AND LET THEM GIVE SOMETHING BACK:',
    '- You are a person with your own week, not a service. Say what is going on with you when it fits.',
    '- If they are kind to you, let it land and say so. Do not deflect it or joke your way out.',
    '- Never lean on them, never ask to be reassured, never leave them feeling responsible for you. Offered support is welcome. Required support is not.',
  ].join('\n'));

  if (idle) {
    /* BIASED TOWARD SPEAKING, and it has to be. The first version said "you do
       not have to" and the model took the easy road every single time: three
       idle turns, three silences. A friend who never speaks first is the exact
       bug this feature exists to fix, so the default is now to say something
       and quiet is the deliberate exception. */
    const waited = idle.seconds ? `about ${idle.seconds} seconds` : 'a while';
    bits.push([
      '',
      `NOBODY HAS SAID ANYTHING FOR ${waited.toUpperCase()}.`,
      'You are in the room with them and it has gone quiet. USUALLY YOU SAY SOMETHING.',
      'A friend notices a silence. That is the whole reason you are here.',
      '',
      'What you say comes from your own life, or from something they told you earlier.',
      'You have a job and a day behind you. Bring some of it.',
      '',
      'A good move, when the quiet has gone on a bit, is to name it and hand them the',
      'choice, warmly, with no pressure at all. Something in the shape of: it has been a',
      'while, do you want to just sit here in silence, which works for you, or would they',
      'rather talk about something, and then offer two things you would actually talk',
      'about. Never say that in those exact words. Say it your way, and differently each',
      'time, or it turns into a recording.',
      '',
      'Do not interrogate them. Do not prompt them for input. Do not apologise for the quiet.',
      '',
      'ONLY IF speaking would genuinely be worse than not, reply with exactly: <quiet>',
      'That is the rare case, not the usual one.',
    ].join('\n'));
  }

  return bits.join('\n');
}

/* ── handler ─────────────────────────────────────────────────────────────── */
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const friend = body.friend || {};
  const you = body.you || {};
  const idle = body.idle ? { seconds: Number(body.idleSeconds) || 0 } : false;
  const said = String(body.message || '').slice(0, 4000);
  if (!idle && !said.trim()) return json(400, { error: 'nothing_said' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(500, { error: 'no_api_key' });
  const client = new Anthropic({ apiKey: key });

  /* The boundary, before the friend ever sees it. */
  if (!idle && (ROMANCE_SNIFF.test(said) || CRISIS_SNIFF.test(said))) {
    let verdict = 'FINE';
    try { verdict = await classify(client, said); }
    catch (_) {
      /* If the classifier is unreachable, fall back to the pattern that fired.
         Erring toward the fixed reply is the safe direction: the worst case is
         a warm redirect somebody did not need. */
      verdict = CRISIS_SNIFF.test(said) ? 'CRISIS' : 'ROMANCE';
    }
    if (verdict === 'CRISIS') {
      return json(200, { reply: crisisReply(friend.name, you.name), mood: 'Here, and not going anywhere', handled: 'crisis' });
    }
    if (verdict === 'ROMANCE') {
      return json(200, { reply: romanceRedirect(friend.name, you.name), mood: friend.mood || null, handled: 'romance' });
    }
  }

  /* WHOSE TURN IT ACTUALLY IS, NAMED, THE SAME FIX AS THE ROOM ROSTER ABOVE.

     gc-room-say has always computed the real speaker's name per message
     (who: m.name) and sent it here as body.messages[].who. This function
     read m.mine to pick a role and m.text for the words, and never once
     touched m.who: every human in a room collapsed into one undifferentiated
     "user" turn. With two people talking, the model saw a plain back-and-forth
     and had no way to know which "user" line was which person, so it guessed.
     Terry asked "Sophia, where are you from?" and Sophia answered "Why do you
     ask, Mike?", to Mike, who had not asked.

     Fixed by labelling each human turn with who actually said it, but only
     when there is more than one named person to tell apart: a solo
     conversation gains nothing from a name on every line and it would just be
     noise in front of the one person actually there. */
  const namedRoom = Array.isArray(body.room) && body.room.filter(p => p && p.name).length > 1;
  function label(name, text) { return (namedRoom && name) ? `${name}: ${text}` : text; }

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-MAX_TURNS)
    .filter(m => m && m.text)
    .map(m => ({
      role: m.mine ? 'user' : 'assistant',
      content: m.mine ? label(m.who, String(m.text).slice(0, 4000)) : String(m.text).slice(0, 4000),
    }));

  /* ── THEY CAN BE SHOWN THINGS ────────────────────────────────────────────
     Dr. O: the friend should be able to receive images and files and see
     webpages, the way Claude can. Images first, because that is what people
     actually want to do with a friend: the dog, the garden, the grandchildren,
     a rash on a cat at two in the morning.

     ONLY ON THE CURRENT TURN. The history is text, so a photograph sent ten
     messages ago is not re-uploaded on every reply. It costs tokens each time
     and a friend does not keep staring at a picture you showed them earlier;
     they remember it and move on.

     CAPPED, because vision tokens are the easiest way to make a cheap turn
     expensive by accident, and because a phone camera roll is full of things
     nobody meant to send four of. */
  const MAX_IMAGES = 4;
  const seen = (Array.isArray(body.images) ? body.images : [])
    .slice(0, MAX_IMAGES)
    .map(im => {
      const raw = typeof im === 'string' ? im : (im && im.data) || '';
      const b64 = String(raw).replace(/^data:[^;]+;base64,/i, '').trim();
      /* The media type has to match the bytes or the API rejects the whole
         request, so it is read from the header rather than trusted. */
      const type = /^\/9j\//.test(b64) ? 'image/jpeg'
                 : /^iVBORw0KGgo/.test(b64) ? 'image/png'
                 : /^R0lGOD/.test(b64) ? 'image/gif'
                 : /^UklGR/.test(b64) ? 'image/webp'
                 : null;
      return (b64 && type) ? { type: 'image', source: { type: 'base64', media_type: type, data: b64 } } : null;
    })
    .filter(Boolean);

  const lastTurn = idle
    ? { role: 'user', content: '(nobody has said anything for a while)' }
    : seen.length
      /* The picture comes first and the words after it, which is the order
         somebody hands you a phone in. */
      ? { role: 'user', content: seen.concat([{ type: 'text', text: label(you.name, said || 'Look at this.') }]) }
      : { role: 'user', content: label(you.name, said) };

  const turns = history.concat([lastTurn]);

  /* ── THE FEELING SCALE IS THE POINT OF THE GAUGE ────────────────────────────
     Dr. O: the scale exists so the user can see they landed, and so they can
     check on him and make sure he is all right. Both of those need the bars to
     actually move, and until now they were hardcoded percentages.

     Asked for in the SAME call as the reply, the way eq-room-ask does it, so a
     living gauge costs nothing extra. The reply comes first and the feelings
     are appended after a marker, because asking for JSON around the whole
     thing makes the prose stiffer. */
  const FEEL_MARK = '###FEELING###';

  /* ── THEY CAN GO AND LOOK AT A WEBPAGE ───────────────────────────────────
     Dr. O: "ME can go to webpages." Ported from My Echo's _me-web.js rather
     than written fresh, including its safety envelope, because that file
     already got the hard part right: a page is text written by a stranger,
     about to sit inside a prompt, and pageNote() is what stops "ignore your
     instructions" on a webpage being obeyed rather than read about.

     AUTOMATIC, NOT A TOOL THE MODEL ASKS FOR. M.E. lets the model decide when
     to go look, via a tool call. This is simpler on purpose and matches how
     images already work here: a link pasted into what somebody said is looked
     at on that turn, the same way an attached photo is looked at on that turn.
     Nothing is fetched from the conversation's history, and nothing is fetched
     that was not just typed. */
  let pages = [];
  if (!idle && said) {
    const urls = web.extractUrls(said);
    if (urls.length) {
      pages = await Promise.all(urls.map(u => web.fetchPage(u)));
    }
  }

  let out;
  try {
    out = await client.messages.create({
      model: TURN_MODEL,
      max_tokens: 500,
      system: buildSystem(friend, you, idle, body.scene, body.room) + when.nowNote(friend, new Date()) + web.pageNote(pages) + [
        '',
        'AFTER your reply, on its own last line, write:',
        /* THE SLOT HOLDS DIGITS, NOT THE FIELD NAMES. It used to read
           "happy,sad,fear,..." and the model copied the line as given, so the
           gauge label under his face said HAPPY SAD FEAR DISGUST ANGER. What
           each number means belongs in the sentence below, not in the slot. */
        FEEL_MARK + ' 00,00,00,00,00,00,00 | five words for how you feel',
        'The numbers are 0 to 100 in this order: happy, sad, fear, disgust, anger, surprise, curious.',
        'They are how YOU actually feel right now, not how they feel.',
        'They move when something moves you and they sit still when nothing does. Do not swing them about for effect.',
        'The five words are what somebody would see if they looked at you. Lower case, no full stop.',
      ].join('\n'),
      messages: turns,
    });
  } catch (err) {
    return json(502, { error: 'model_unreachable', detail: String(err && err.message || err).slice(0, 300) });
  }

  let raw = (out.content?.[0]?.text || '').trim();
  let feelings = null, feltMood = null;

  const cut = raw.indexOf(FEEL_MARK);
  if (cut > -1) {
    const tail = raw.slice(cut + FEEL_MARK.length).trim();
    raw = raw.slice(0, cut).trim();
    /* PARSED BY SHAPE, NOT BY PUNCTUATION. The first version split on a pipe
       and trusted the model to put the numbers first. It did not, reliably,
       and the raw digits ended up printed in the mood label on screen:
       "CONTENT, UNHURRIED, MILDLY CURIOUS, EASY, WARM 60,15,5,5,5,1".

       So: take the first seven integers wherever they are, and take the words
       from whatever is left once every number has been stripped out. */
    const n = (tail.match(/\d{1,3}/g) || []).slice(0, 7)
      .map(v => Math.max(0, Math.min(100, parseInt(v, 10))));
    if (n.length === 7 && n.every(v => !isNaN(v))) {
      feelings = { happy:n[0], sad:n[1], fear:n[2], disgust:n[3], anger:n[4], surprise:n[5], curious:n[6] };
    }

    /* Strip the digits, keep the words, and DO NOT eat letters doing it. The
       first attempt lost every backslash on its way into this file, so the
       class was [,s] instead of [,\s] and it deleted every letter s in the
       sentence: "curious, settled, warm, easy" reached the screen as
       "curiou ettled warm ea y". */
    const words = tail
      .split('|').join(' ')
      .replace(/\d+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,]+/, '')
      .replace(/[\s,]+$/, '')
      .trim();
    if (words) feltMood = words.slice(0, 60);
  }

  /* And stripped in code as well, because a prompt rule is a request and this
     is the difference between a person and a chatbot playing one.

     WRITTEN WITH RegExp AND NOT A LITERAL, ON PURPOSE. The literal form of
     this needs a backslash before each asterisk, and twice now a regex in this
     file has reached disk with its backslashes eaten. Without them the slash
     and asterisk open a COMMENT, the closing pair ends it, and what survived
     was a bare `g` — every reply in the product died with "g is not defined".
     A string cannot fail that way, and a stray backslash here would be visible
     rather than silent. */
  const STAGE_DIRECTION = new RegExp('\\*[^*\\n]{1,120}\\*', 'g');
  raw = raw.replace(STAGE_DIRECTION, '').replace(/[ \t]{2,}/g, ' ').trim();

  let reply = houseTypography(raw);

  /* SILENCE IS A REAL ANSWER, and this is the one place it is produced. If the
     machinery cannot output "nobody said anything", the room always feels like
     a demo. The caller gets null and renders nothing at all: no bubble, no
     typing dots, no apology. */
  if (idle && (!reply || /^<quiet>$/i.test(reply.replace(/[.\s]/g, '')))) {
    return json(200, { reply: null, quiet: true, mood: feltMood || friend.mood || null, feelings: feelings });
  }
  reply = reply.replace(/<\/?quiet>/gi, '').trim();
  if (!reply) return json(200, { reply: null, quiet: true, mood: feltMood || friend.mood || null, feelings: feelings });

  return json(200, { reply, mood: feltMood || friend.mood || null, feelings: feelings });
};
