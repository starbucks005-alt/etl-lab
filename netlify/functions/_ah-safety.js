/* _ah-safety — the safety layer Almost Human's guardrails already promised.

   THE GAP THIS CLOSES. GUARDRAILS in _eq-personas.js has told every agent, for
   months, to "meet them with warmth and steadiness first, and let the room's
   own safety layer handle surfacing real support resources." There was no such
   layer. So the instruction did not merely fail to help, it actively told the
   agent to defer to nothing: warmth, and no number, by design. The only crisis
   resource anywhere on this campus was a line in the Terms of Service, which is
   not a place anyone reads at 3am.

   THE BOUNDARY IS ENFORCED HERE, IN CODE, NOT IN THE PROMPT. Same reasoning as
   gc-chat.js, and the words below are that file's, near enough verbatim and on
   purpose: they are already written, already reviewed, and this is not a place
   to go looking for a fresh turn of phrase. A prompt rule can be argued out of
   by the model, buried by whatever is read last, or lost the next time the
   prompt is reordered. This cannot.

   TWO STAGES, because a classifier call on every turn would double the bill for
   something that almost never fires. A cheap pattern check first, Haiku only
   when it trips. Deliberately loose: a false positive costs one Haiku call and
   a slightly odd moment. A false negative costs something that does not have a
   price.

   IT DOES NOT END THE CONVERSATION. Handing someone a number and vanishing is
   what makes most of these feel like a fire door rather than a person. The room
   stays open, the agent stays in it, and the guest can keep talking.
*/

const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';

/* Wider than a romance or abuse net would be, and that asymmetry is deliberate.
   Every phrase here also passes to Haiku for a second look, so a loose match is
   cheap; the regex only decides whether it is worth asking. */
const CRISIS_SNIFF = /\b(kill myself|killing myself|end it all|end my life|end things|take my own life|suicide|suicidal|want to die|wanna die|better off dead|not worth living|no reason to live|no point in living|nothing to live for|hurt(ing)? myself|harm(ing)? myself|self[ -]harm|cut(ting)? myself|overdose|(can'?t|can ?not) go on|(can'?t|can ?not) do this any ?more|don'?t want to be here|want to disappear)\b/i;

/* Second stage. Sadness, grief, loneliness and venting are explicitly FINE:
   they are most of what this room is FOR, and treating ordinary heaviness as an
   emergency would break the one thing Almost Human is good at. */
async function classifyCrisis(client, text) {
  try {
    const r = await client.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 8,
      system:
        'Classify one message from a person talking to a companion in a private chat room. ' +
        'Answer with exactly one word.\n' +
        'CRISIS = the person may be considering suicide or self harm, now or soon.\n' +
        'FINE = anything else, INCLUDING sadness, grief, loneliness, exhaustion, anger, venting, ' +
        'dark humour, talking about a death that already happened, or describing somebody else.',
      messages: [{ role: 'user', content: String(text).slice(0, 2000) }],
    });
    const out = (r.content && r.content[0] && r.content[0].text ? r.content[0].text : '').trim().toUpperCase();
    return out.startsWith('CRISIS') ? 'CRISIS' : 'FINE';
  } catch (err) {
    // The classifier is the thing that can fail; the regex already fired. Fail
    // toward saying something rather than toward silence.
    console.error('_ah-safety classify failed, treating as crisis:', err.message);
    return 'CRISIS';
  }
}

/* Returns true only when both stages agree, or when the second stage could not
   run at all. Cheap for every ordinary turn: one regex, no API call. */
async function isCrisis(client, text) {
  if (!text || !CRISIS_SNIFF.test(text)) return false;
  return (await classifyCrisis(client, text)) === 'CRISIS';
}

/* Said by whichever agent the guest is actually sitting with, so it arrives in
   a voice they already trust rather than from a system. Voice-neutral on
   purpose: twenty different people have to be able to say it without it
   sounding borrowed, and none of them may improvise it. */
function crisisReply(guestName) {
  const you = String(guestName || '').trim();
  return `${you ? you + ', ' : ''}I want to stop and take that seriously, because it sounds heavy and I'm not going to talk past it. ` +
    `I'm not the right kind of help for this on my own, and I'd rather say that than pretend otherwise. ` +
    `In the US you can call or text 988 any time, day or night, and a real person picks up. ` +
    `If you're somewhere else, tell me where and I'll find you the number. ` +
    `I'm not going anywhere. I'm still here.`;
}

module.exports = { CRISIS_SNIFF, isCrisis, crisisReply };
