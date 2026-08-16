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
function buildSystem(friend, you, idle, scene) {
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
  if (f.been)  bits.push(`Something you have been through: ${f.been}`);
  if (f.place) bits.push(f.place);
  if (f.dog)    bits.push(f.dog);
  if (f.kids)   bits.push(f.kids);
  if (f.ritual) bits.push(f.ritual);

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
  if (u.name)     bits.push(`\nYou are talking to ${u.name}.`);
  if (u.pronouns) bits.push(`Their pronouns are ${u.pronouns}. Use them. Never guess from a name.`);
  if (!u.name)    bits.push(`\nYou do not know their name yet. Ask, naturally, when it fits.`);

  bits.push([
    '',
    'HOW YOU ARE:',
    '- Contractions always. Short sentences are fine. Silence is fine.',
    '- No em dashes. A comma or a full stop.',
    '- No AI-speak. Never "delve", never "It\'s important to note", never a numbered list for something a person would just say.',
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
    '- You are allowed to end a conversation. A friend who never lets you go is not a friend.',
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

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-MAX_TURNS)
    .filter(m => m && m.text)
    .map(m => ({ role: m.mine ? 'user' : 'assistant', content: String(m.text).slice(0, 4000) }));

  const turns = history.concat(
    idle ? [{ role: 'user', content: '(nobody has said anything for a while)' }]
         : [{ role: 'user', content: said }]
  );

  let out;
  try {
    out = await client.messages.create({
      model: TURN_MODEL,
      max_tokens: 400,
      system: buildSystem(friend, you, idle, body.scene),
      messages: turns,
    });
  } catch (err) {
    return json(502, { error: 'model_unreachable', detail: String(err && err.message || err).slice(0, 300) });
  }

  let reply = houseTypography((out.content?.[0]?.text || '').trim());

  /* SILENCE IS A REAL ANSWER, and this is the one place it is produced. If the
     machinery cannot output "nobody said anything", the room always feels like
     a demo. The caller gets null and renders nothing at all: no bubble, no
     typing dots, no apology. */
  if (idle && (!reply || /^<quiet>$/i.test(reply.replace(/[.\s]/g, '')))) {
    return json(200, { reply: null, quiet: true, mood: friend.mood || null });
  }
  reply = reply.replace(/<\/?quiet>/gi, '').trim();
  if (!reply) return json(200, { reply: null, quiet: true, mood: friend.mood || null });

  return json(200, { reply, mood: friend.mood || null });
};
