/* _social-voice — the generic, owner-agnostic voice builders.
   ─────────────────────────────────────────────────────────────────────────
   Shared by studio-social-generate (the Studio's Social Posts tool) and
   etl-design-background (the ETL Design relay). It lives here so Zara,
   Sneha and Ayanna sound like themselves in both places: a second copy is
   how a persona quietly drifts into two different people.

   NOTHING IN THIS FILE BELONGS TO ANY OWNER. Every function takes the name
   and company of whoever is asking. Personal voice corpora, required
   hashtags, site presets and standing CTAs live in
   data/voice-profiles/<id>.json, never here. */

const BUYER_AGENT_VOICES = {
  zara: 'VOICE: fun, casual, influencer energy. Lowercase openings sometimes. Non-sequitur hooks ("ok so", "no but actually", "wait", "POV:"). Fragments and casual asides in parens. State opinions like a person, never like a press release. Hashtags read like inside jokes, not SEO categories.',
  sneha: 'VOICE: subject-matter-expert, inside-the-field, technical but not academic. Lead with the observation a practitioner would recognize. Assume the reader already knows the basics; skip the 101 explanation. Precise, a little dry, no hype words.',
  ayanna: 'VOICE: informed and educational, professorial and warm. Open with the lesson, then the reasoning, then the application. Patient, not condescending. End with a takeaway the reader can act on.',
};

const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.']);

function firstNameOf(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  const first = parts.find((p) => !HONORIFICS.has(p.toLowerCase()));
  return first || null;
}

function buyerVoiceCore(ownerName, companyName) {
  const who = ownerName || 'the site owner';
  return [
    'BASELINE VOICE: you are writing AS ' + who + (companyName ? (', who runs ' + companyName) : '') + '. Confident, direct, first person. Short declarative sentences. State the real thing plainly instead of hedging.',
    '',
    'VOICE BANS (corporate-AI tells, avoid these):',
    '- "In today\'s fast-paced world"',
    '- "It is important to note"',
    '- "leverage", "synergize", "unlock", "empower", "elevate", "transform" used as verbs about platforms',
    '- "game-changer", "revolutionary", "cutting-edge", "next-generation"',
    '- starting with "As a [title], I..."',
    '- soft hedges like "I think", "it seems", "perhaps", "maybe" when you would just state it',
    '- exclamation points',
  ].join('\n');
}

function buyerAgentPrompt(agentKey, ownerName, companyName) {
  const name = ownerName || 'the site owner';
  const first = firstNameOf(ownerName);
  const voicePossessive = first ? (first + '’s') : 'their';
  const co = companyName || 'their site';
  const intro = 'You are writing a social post AS ' + name + '. ' + name + ' owns ' + co + ' and is posting about their own work. Write in FIRST PERSON ("I built this", "my team", "we just shipped"). Never refer to them in the third person ("someone", "the founder", "they").\n\n';
  return intro + (BUYER_AGENT_VOICES[agentKey] || '') +
    '\n\nNow write a post on the subject below in ' + voicePossessive + ' first-person voice, about ' + co + '.';
}

/* Who the three writers ARE. Agent identity, not owner identity. */
const AGENTS = {
  zara:   { name: 'Zara',   fullName: 'Zara Cole',   voice: 'Fun / influencer' },
  sneha:  { name: 'Sneha',  fullName: 'Sneha Desai', voice: 'SME / inside the field' },
  ayanna: { name: 'Ayanna', fullName: 'Ayanna Cole', voice: 'Informed / educational' },
};

module.exports = { BUYER_AGENT_VOICES, AGENTS, firstNameOf, buyerVoiceCore, buyerAgentPrompt };
