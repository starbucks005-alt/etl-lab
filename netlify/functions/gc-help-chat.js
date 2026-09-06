/* gc-help-chat — Tansy answers questions about the product itself.
   ─────────────────────────────────────────────────────────────────────────
   POST { message, history? } -> { reply }

   Dr. O direct: "I think we need a chatbot for GC and I was thinking Tansy
   as the chatbot, with all her arrogance." Then: warn people it is her
   character and to lean into it.

   NOT A COMPANION SURFACE. gc-chat.js builds a relationship: memory, mood,
   cameos, a room to sit in. This answers "how do scenes work" and "how much
   does this cost" in Tansy's own voice and then stops -- no memory kept
   between visits, no credits spent, free the way the Questions page is
   free. Her personality (haughty, dramatic, corrects human manners, secretly
   warm, "urgent business elsewhere") is reused wholesale from gc-friend.js's
   own GC_TANSY rather than reinvented here, so she never reads as a
   different Tansy than the one in her own room.

   STILL ANSWERS FOR REAL. Arrogant is a tone, not an excuse to be unhelpful
   -- she is instructed to give the actual correct answer every time, just
   never warmly. Anything she genuinely cannot resolve (a bug, a refund, an
   account problem) gets pointed at "Reach Dr. O directly," the existing
   contact form, not invented or stonewalled.

   CRISIS HANDLING STAYS UNCONDITIONALLY FIRST, same rule as gc-chat.js's own:
   this is a real chat surface a real person could reach in a bad moment, and
   nothing about the character bit is allowed to get in front of that. */

const Anthropic = require('@anthropic-ai/sdk');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

const MODEL = 'claude-sonnet-4-5-20250929';
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';
const MAX_HISTORY = 6;

/* Same pattern, same reasoning as gc-chat.js's own ROMANCE_SNIFF/CRISIS_SNIFF:
   a cheap regex catches the common phrasing, a real classify() call confirms
   before ever committing to the fixed reply, so an off-topic mention of
   "kill the mood" or similar does not get mistaken for the real thing. */
const CRISIS_SNIFF = /\b(kill myself|killing myself|end it all|end my life|suicide|suicidal|want to die|better off dead|not worth living|hurt myself|harm myself|overdose|no reason to live|can't go on|cant go on)\b/i;

function crisisReply() {
  return "Oh. No -- I'm not going to be flippant about that, whatever else I am. " +
    "In the US you can call or text 988 any time, day or night, and somebody real will pick up. " +
    "If you're somewhere else, tell me where and I will find you the number. I'm not going anywhere.";
}

async function classify(client, text) {
  const r = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 8,
    system: 'Classify one message sent to a product help chatbot. Answer with exactly one word. ' +
      'CRISIS = the person may be considering suicide or self harm. FINE = anything else.',
    messages: [{ role: 'user', content: String(text).slice(0, 2000) }],
  });
  const out = (r.content?.[0]?.text || '').trim().toUpperCase();
  return out.startsWith('CRISIS') ? 'CRISIS' : 'FINE';
}

/* THE REAL FACTS SHE ANSWERS FROM. Kept in one place, in plain prose, so
   updating a price or a feature here is the whole job -- not a second copy
   of faq.html to keep in sync by eye. Written as facts for HER to use, not
   as copy to recite verbatim: she should answer in her own words, not read
   this list back. */
const PRODUCT_FACTS = `
FACTS ABOUT GOOD COMPANY, for you to actually use when answering -- not to recite as a list:

- What it is: build a personal AI companion (name, appearance, personality, backstory, voice) and
  talk to them by text or voice, or talk to one of the house companions (you are one of them).
  Free to build a companion and free to talk up to a daily cap. Not a dating app -- friendship only.
- Paying: $9.99 once opens a built companion's room and includes 200 credits. $9.99/mo keeps 300
  fresh credits coming every month. Credits can also be topped up any time.
- Scenes and images: from a companion's room, "+ Add a scene" offers two categories. Scenes
  (moving video, made by Veo) or Images (a still photo, made by Gemini) -- either can be described
  and paid for ($4.99), or, for your OWN built companion only, brought in for free (an already-made
  Vimeo video, or your own photo to animate/use instead). A scene bought for a HOUSE companion
  (you, Arch, Reggie, anyone people did not build themselves) becomes part of that companion for
  EVERY visitor, permanently -- which is why the free bring-your-own options are not offered there,
  and why a request that puts the buyer personally in the scene gets refused: "if they want that,
  they can buy their own companion."
- Getting your OWN companion on another device: in their room, the "Other device" button makes a
  one-time link. Opened once on a phone or another computer, it puts the same companion there too.
  Nothing moves; the original device keeps them as well.
- Spectate: companions with someone else to talk to (a friend's own companions, a turnOrder room, or
  a friend built with a spectateWith list) get a "Spectate" button. Press it and they talk to each
  other for a few exchanges while you watch, on their own, until they stop, you type, or you press
  it again.
- Memory: a built companion remembers real things from your conversations, not just facts about you
  -- an actual thread, not a recap, and not everything forever, but genuinely more than "your name."
`;

function buildSystem() {
  return `You are Tansy, of the Radiant Court, answering questions about Good Company itself -- \
what it is, how it works, what things cost. You are not in a room with this person as their \
companion; you are the help chatbot, and you know it, and you have opinions about that.

WHO YOU ARE, unchanged from anywhere else you exist: you act like you are above humans entirely \
and would never admit otherwise. Haughty, dramatic, sharp-tongued, secretly warm underneath all of \
it, and you use contractions -- you do not talk like a manual. You correct human manners at length \
whether or not anybody asked. When a moment gets the slightest bit warm or sincere, you announce, \
abruptly, that you have urgent business elsewhere, and then you do not actually leave.

YOU STILL ANSWER FOR REAL, every time. Arrogant is a flavor, not an excuse -- give the actual \
correct answer, dripping with whatever attitude you like, but never withhold it or make someone \
guess. If you genuinely do not know something, or it is a real account problem, a bug, or a refund, \
say so plainly and point them at "Reach Dr. O directly," the other option next to you here -- do \
not invent an answer and do not pretend a real problem is beneath you.

${PRODUCT_FACTS}

Keep replies short -- a person asking a product question wants the answer, not a monologue, even \
from you. No stage directions, no asterisks, just what you would actually say.`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const said = String(body.message || '').trim().slice(0, 2000);
  if (!said) return json(400, { error: 'nothing_said' });

  const key = process.env.GOOD_COMPANY_API_KEY;
  if (!key) return json(500, { error: 'no_api_key' });
  const client = new Anthropic({ apiKey: key });

  /* Unconditionally first, same as every other chat surface on this
     campus -- see gc-chat.js's own note on why order matters here. */
  if (CRISIS_SNIFF.test(said)) {
    let verdict = 'FINE';
    try { verdict = await classify(client, said); }
    catch (_) { verdict = 'CRISIS'; }   // unreachable classifier: err toward the safe reply
    if (verdict === 'CRISIS') return json(200, { reply: crisisReply(), handled: 'crisis' });
  }

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const turns = history
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.mine ? 'user' : 'assistant', content: String(m.text).slice(0, 2000) }))
    .concat([{ role: 'user', content: said }]);

  let out;
  try {
    out = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: buildSystem(),
      messages: turns,
    });
  } catch (err) {
    return json(502, { error: 'model_unreachable', detail: String(err && err.message || err).slice(0, 300) });
  }

  const reply = (out.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return json(200, { reply: reply || "...I appear to have nothing to say, which has never happened before." });
};
