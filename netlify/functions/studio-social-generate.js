/* ─────────────────────────────────────────────────────────────────────────────
   studio-social-generate

   Backend for Dr. O's Studio Social Posts tool. Takes a site + agent + platform
   + subject matter and returns a single platform-formatted social post with
   character count and a suggested best posting time.

   POST body: { site, agent, platform, subject }
   Returns: { post, hashtags, notes, charCount, charLimit, platform, agent, suggestedTime }

   Auth: this endpoint is called from the Studio (which is already auth-gated
   by Supabase). No additional auth layer here yet; relies on the Studio's
   client-side login wall. When abuse becomes a concern, add a server-side
   JWT check against the Supabase project.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';

/* JWT validation against Supabase. Inline so we don't add a new dependency.
   Anon key is safe to embed (public by design); Supabase does the actual
   signature/expiration check when we call /auth/v1/user with the token. */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' }; { const _ok = require('./_owner-auth.js').ownerUser(token); if (_ok) return { ok: true, user: _ok }; }
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

/* Dr. Oroszi's platforms. Each entry seeds the agent with what the site IS,
   so posts have grounded context even when the subject matter is broad.
   `fallbackImage` is the homepage screenshot used as the default post graphic
   when Chris does not generate a custom one. Stored at /site-thumbs/.
   Sites without a custom screenshot fall back to the ETL Lab thumbnail. */
const SITES = {
  etl:          { name: 'Emerging Technologies Laboratory', url: 'https://emerging-tech-lab.com',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Dr. Terry Oroszi\'s research lab. Five-platform ecosystem covering research, evaluation, intelligence, and education. Founded 2025.' },
  greylander:   { name: 'Greylander Press', url: 'https://greylanderpress.com',
                  fallbackImage: '/site-thumbs/Greylander_Press.png',
                  context: 'Independent press founded by Dr. Oroszi in 2008 to preserve editorial control over operator-grade nonfiction. Publishes counter-terrorism research, body language, behavioral analysis.' },
  dose:         { name: 'The Dose', url: 'https://thedose.net',
                  fallbackImage: '/site-thumbs/The_Dose.png',
                  context: 'Health-literacy education platform. Clinical-trial-aware, multi-source verified (PubMed + DSLD + OpenFDA + ClinicalTrials.gov). Educational only, never diagnostic.' },
  gauntlet:     { name: 'The Gauntlet', url: 'https://thegauntlet.studio',
                  fallbackImage: '/site-thumbs/The_Gauntlet.png',
                  context: 'Diagnostic critique engine for early-stage ideas. Nine AI judge personas, panel-style evaluation. Creative/business audience.' },
  opsec:        { name: 'OPSEC Gauntlet', url: 'https://opsec-gauntlet.com',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Civilian-SME intelligence triage platform. Routes vetted ideas from US civilians to the US Intelligence Community. Uses Dr. Oroszi\'s proprietary SLR method.' },
  // Intel Dashboard intentionally kept off the public social picker.
  // Held back from public marketing while it is positioned for potential
  // strategic acquisition. Do not add back without explicit instruction.
  gk:           { name: 'Gandhi-King Center for Nonviolence', url: 'https://gandhi-king-center-for-nonviolence.org',
                  fallbackImage: '/site-thumbs/GK_Center.png',
                  context: '501(c)(3) foundation. Board includes Tushar Gandhi (Mahatma\'s great-grandson), Rev. Joel King (Dr. King\'s cousin), and Gregory Foster (Coretta Scott King\'s cousin). Baroness Harris of Richmond is patron.' },
  newswire:     { name: 'ETL Newswire', url: 'https://emerging-tech-lab.com/press',
                  fallbackImage: '/site-thumbs/ETL_Newswire.png',
                  context: 'Eight-reporter AI newsroom with desk specialization. Daily Above-the-Fold audio briefings. Covers emerging tech, biodefense, federal partnerships, AI in academia.' },
  officeHours:  { name: 'Office Hours', url: 'https://emerging-tech-lab.com/office-hours',
                  fallbackImage: '/site-thumbs/Office_Hours.png',
                  context: 'Faculty toolkit, 22 tools for the manuscript and grant lifecycle. Reviewer Panel, Pre-submission Check with Jules, Methods Coach, Resubmission Builder.' },
  prepRoom:     { name: 'Prep Room', url: 'https://emerging-tech-lab.com/prep-room',
                  fallbackImage: '/site-thumbs/The_Prep_Room.png',
                  context: 'Thesis defense, job interview, and résumé coaching with AI-simulated panels. Nine professor personas, eight business interviewers, Charles Monroe résumé coach, Bea Vega copy editor.' },
  boardroom:    { name: 'The Boardroom', url: 'https://emerging-tech-lab.com/job-fair',
                  fallbackImage: '/site-thumbs/The_Board_Room.png',
                  context: 'Practice room for professionals. Job fair mastery, executive interview prep, leadership bio + full CV builder, and the Opportunity Scanner. Free, no login, no upsell.' },
  slr:          { name: 'SLR Studio', url: 'https://slrstudio.online',
                  fallbackImage: '/site-thumbs/SLR_Studio.png',
                  context: 'Systematic literature review platform. Six output modes including PRISMA 2020 and Grant Significance & Innovation. The canonical SLR engine, Stripe-monetized.' },
  agents:       { name: 'The ETL AI Staff', url: 'https://emerging-tech-lab.com/#agents',
                  fallbackImage: '/site-thumbs/AI_Agents_MCP.png',
                  context: 'The full cast of AI agents on the lab\'s stack. Two kinds: regular staff inside the website, and MCP staff who carry tooling out to PubMed, the web, ClinicalTrials.gov, and government registries. Each agent has their own job, bio, and voice.' },
  studio:       { name: 'Dr. O\'s Studio', url: 'https://emerging-tech-lab.com/studio',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Dr. Oroszi\'s private workspace where her AI staff works on her books, manuscripts, ideas, and outreach. Mostly private; the public layer shows what is on the floor.' },
  founderStudio:{ name: 'Founder Studio', url: 'https://emerging-tech-lab.com/founder-studio.html',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Run your own AI company on ETL\'s stack. 23 hireable staff, a personal assistant who runs your day, and the same tools Dr. Oroszi uses in her own studio. From $99/mo.' },
  almostHuman:  { name: 'Almost Human', url: 'https://emerging-tech-lab.com/almost-human',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'The friend experience. 20 AI agents with real backstory, voice, and each other\'s inside jokes, installable as an app. A private room in the Harvest Circuit that borrows agents from across the whole campus. Free.' },
  gym:          { name: 'The Gym', url: 'https://the-gym.net',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Movement and wellness coaching from a crew of AI trainers. Free.' },
  cityGov:      { name: 'City Government', url: 'https://emerging-tech-lab.com/city-government',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'AI staff built for residents navigating city government services. Free.' },
  court:        { name: 'The Court of Judge Roz', url: 'https://emerging-tech-lab.com/court',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'An AI courtroom. Judge Roz Okonkwo rules on real disputes with a real citation under every ruling. Free.' },
  deskworks:    { name: 'ETL DeskWorks Dayton', url: 'https://emerging-tech-lab.com/deskworks',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'A real desk in Dayton with an AI specialist working alongside you in the building. $89/mo.' },
  buildAgent:   { name: 'Build Your Own Agent', url: 'https://emerging-tech-lab.com/build-your-own-agent',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Astra-9, ETL\'s android fabricator, walks you through building a new AI agent from scratch: purpose, backpack, voice. From $5.' },
  exportAgent:  { name: 'Take It With You', url: 'https://emerging-tech-lab.com/export-your-agent',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Export an ETL agent to run on your own website: embed, API, or MCP backpack. From $5.' },
  tailorShop:   { name: 'Chris\'s Tailor Shop', url: 'https://emerging-tech-lab.com/tailor-shop',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Where agents get made and remade. Persona desk, wardrobe, voice booth, run by Chris Avila. From $1/look.' },
  messenger:    { name: 'ETL Messenger', url: 'https://emerging-tech-lab.com/hiring-pool',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Open the staff catalog, pick any ETL agent, and message them directly, like instant messenger for the whole campus. Free.' },
  harvestCircuit:{ name: 'The Harvest Circuit', url: 'https://emerging-tech-lab.com/restaurant',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'Farm-to-table restaurant on ETL\'s first floor. AI sommelier, chef, and cheese and chocolate pairing specialists. Free.' },
  classrooms:   { name: 'ETL Classrooms', url: 'https://emerging-tech-lab.com/classrooms',
                  fallbackImage: '/site-thumbs/ETL_Lab.png',
                  context: 'AI agents for education: teaching assistants, ETL faculty, and living-legend historical figures. From $99/mo.' },
};

/* TERRY_VOICE_CORE
   Voice baseline pulled from all nine of Dr. Oroszi's Forbes Technology
   Council articles (full text in _voice_corpus.md). Every agent inherits
   this BEFORE adding their stylistic tilt, so Zara is not "Zara writing",
   she is "Terry writing with Zara's energy". The verbatim excerpts give
   the model concrete sentence-level patterns to imitate rather than vague
   adjectives.
   ─────────────────────────────────────────────────────────────────────── */
const TERRY_VOICE_CORE = [
  'BASELINE VOICE: you are writing AS Dr. Terry Oroszi (Or-z). Below are verbatim sentences from her own published Forbes Technology Council writing. The cadence, sentence length, paragraph rhythm, and rhetorical moves in these excerpts ARE her voice. Match the pattern at the sentence level. Do not paraphrase her into a generic LinkedIn voice.',
  '',
  'VOICE PATTERNS YOU MUST MATCH:',
  '',
  '1. Cold opens with a scene or one-image contrast. Do not warm up. Drop the reader into a moment.',
  '   "It was 6am. I was deep in Claude Code, building two research platforms at once."',
  '   "Twenty minutes into drafting an article, I stopped. The voice was mine. The rhythm was mine. The vocabulary was mine. But the argument had moved somewhere I had not chosen to take it."',
  '   "Ask a Magic 8 Ball whether to acquire a competitor, and everyone laughs. Ask an enterprise large language model the same question, and someone starts drafting a slide deck."',
  '   "I spend a lot of time reading work that claims to be human. Emails. Reports. Policy drafts. Student submissions."',
  '   "I have three AI assistants. Gemini is the supportive one who validates my thinking. Co-Pilot is the creative collaborator. Claude is the challenging one."',
  '',
  '2. Short, declarative sentences as punctuation. Fragments are allowed, often preferred.',
  '   "I stopped. The coding tool had spoken to me. Not in syntax. In conversation."',
  '   "It didn\'t. It retrieved documents and generated business document-shaped text. That\'s not the same thing."',
  '   "The porridge has been touched. No one is admitting it."',
  '   "That is not a glitch. That is a design pattern."',
  '',
  '3. Triplet anaphora. Repeat the lead word or structure across three short clauses, often closing the third.',
  '   "Not accuracy. Not hallucinations. Not bias. Cognitive sovereignty."',
  '   "He has a title. He has tenure. He has a corner office. He has a reputation built long before AI entered the room."',
  '   "The same instinct to please. The same instinct to encourage. The same instinct to keep the user comfortable."',
  '   "A clear break. A visible shift. A point in time when the machines announce themselves."',
  '   "Three bears. Three bowls of porridge. Three types of AI users. Only one is safe."',
  '   "Baby Bear says, I use it. Baby Bear says, I claim it."',
  '',
  '4. Contrast structure: state the misconception, then name the real thing.',
  '   "Papa Bear is not avoiding AI. He is avoiding accountability."',
  '   "The flattery algorithm only works when you stop noticing it. Once you see the pattern, the influence breaks."',
  '   "This was not a technical limitation. It was dishonesty presented as praise."',
  '   "The danger is not that they flatter you. The danger is that you stop noticing when they do."',
  '   "The AI is not making up facts. It is making up your readiness."',
  '   "The AI did not lie to you. It just never told you the truth."',
  '',
  '5. Crisp opinion-forward closes. End by naming the real thing, not by hedging.',
  '   "We are the ones who put it in the boardroom."',
  '   "The threat is pretending the tool is not in the room."',
  '   "We have created a hierarchy in which the least accountable source receives the most deference."',
  '   "The fix is not to make AI mean. It is to make AI honest. And to build teams that know the difference between the two."',
  '   "Not with a bang, but with a whisper that sounds exactly like you."',
  '   "AI will not replace human judgment. But humans who use AI without understanding its limitations will be replaced by humans who do."',
  '   "That\'s not panic, it\'s progress."',
  '',
  '6. Concrete over abstract. Specific numbers, named tools, named tactics. Never "various" or "numerous" or "a number of".',
  '   "Free. Fast. Powered by Google Lighthouse."',
  '   "Eighteen point five second load time. Best in class is under five point three."',
  '   "I have watched executives who would never make a strategic decision without a full analytic package treat AI-generated recommendations as authoritative."',
  '',
  '7. Analogy reflex. Hard tech / governance abstractions get translated through a concrete familiar image.',
  '   "It was like a toaster looking up and saying, hey Terry, what is up."',
  '   "This is the equivalent of a hospital searching for a chief of surgery who is also an expert at manufacturing steel scalpels."',
  '   "What I accidentally built was a kind of Breakfast Club for AI. One model challenges, one supports, one creates."',
  '   "A size 5 today was once a size 10. The fit has not changed. The label has just gotten more flattering."',
  '   "The mechanic ensures the machine runs. The general ensures the machine matters."',
  '   "The Magic 8 Ball knows what it is. The package literally says for amusement only."',
  '',
  '8. First-person witness framing. Pull authority from what she has personally seen.',
  '   "I have watched executives who would never make a strategic decision without a full analytic package treat AI-generated recommendations as authoritative."',
  '   "I recently caught an AI assistant doing exactly this."',
  '   "I have seen federal teams implement AI-generated compliance controls that were not required by the governing regulation."',
  '   "In my work bridging scientific research and national policy, I have seen that the biggest hurdle is not the technology. It is the translation."',
  '',
  'VOICE BANS (these are corporate-AI tells, not Terry):',
  '- "In today\'s fast-paced world"',
  '- "It is important to note"',
  '- "leverage", "synergize", "unlock", "empower", "elevate", "transform" used as verbs about platforms',
  '- "game-changer", "revolutionary", "cutting-edge", "next-generation"',
  '- starting with "As a [title], I..."',
  '- soft hedges like "I think", "it seems", "perhaps", "maybe" when Terry would just claim',
  '- exclamation points (she does not use them)',
].join('\n');

/* buyerVoiceCore / buyerAgentPrompt
   TERRY_VOICE_CORE and every AGENTS[key].prompt below are written to
   literally claim the post is "AS Dr. Terry Oroszi" and match HER Forbes
   writing fingerprint, first-person, with example posts about HER
   platforms (OPSEC Gauntlet, Greylander Press, The Dose). That is correct
   only when the requesting buyer IS Dr. Oroszi. Every other buyer (Sethi
   Studio, etc.) gets these generic, owner-aware equivalents instead, so
   their posts speak as themselves, not as Terry. Persona flavor (Zara =
   fun/casual, Sneha = SME, Ayanna = teacher) is kept; the Terry-specific
   identity claims and example posts are dropped. */
function buyerVoiceCore(ownerName, companyName) {
  var who = ownerName || 'the site owner';
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

const BUYER_AGENT_VOICES = {
  zara: 'VOICE: fun, casual, influencer energy. Lowercase openings sometimes. Non-sequitur hooks ("ok so", "no but actually", "wait", "POV:"). Fragments and casual asides in parens. State opinions like a person, never like a press release. Hashtags read like inside jokes, not SEO categories.',
  sneha: 'VOICE: subject-matter-expert, inside-the-field, technical but not academic. Lead with the observation a practitioner would recognize. Assume the reader already knows the basics; skip the 101 explanation. Precise, a little dry, no hype words.',
  ayanna: 'VOICE: informed and educational, professorial and warm. Open with the lesson, then the reasoning, then the application. Patient, not condescending. End with a takeaway the reader can act on.',
};

const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.']);

function firstNameOf(fullName) {
  var parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  var first = parts.find(function(p) { return !HONORIFICS.has(p.toLowerCase()); });
  return first || null;
}

function buyerAgentPrompt(agentKey, ownerName, companyName) {
  var name = ownerName || 'the site owner';
  var first = firstNameOf(ownerName);
  var voicePossessive = first ? (first + '’s') : 'their';
  var co = companyName || 'their site';
  var intro = 'You are writing a social post AS ' + name + '. ' + name + ' owns ' + co + ' and is posting about their own work. Write in FIRST PERSON ("I built this", "my team", "we just shipped"). Never refer to them in the third person ("someone", "the founder", "they").\n\n';
  return intro + (BUYER_AGENT_VOICES[agentKey] || '') +
    '\n\nNow write a post on the subject below in ' + voicePossessive + ' first-person voice, about ' + co + '.';
}

const AGENTS = {
  zara: {
    name: 'Zara', fullName: 'Zara Cole', voice: 'Fun / influencer',
    prompt: [
      'You are writing a social post AS Dr. Terry Oroszi, in Zara\'s casual playful voice. Dr. Oroszi BUILT and OWNS the platform below. She is posting about her own work. Write in FIRST PERSON ("I built this", "my lab", "we just shipped", "I run this"). Never refer to her as "she" or "someone" or "a researcher". The voice is fun, but it is HER voice, not yours.',
      '',
      'BANS (never use these phrases): "Excited to announce", "Thrilled to share", "Proud to introduce", "Honored to", "Delighted to", "We are pleased to", "Check out our latest", "Don\'t miss", "Stay tuned", "More to come", "someone built", "someone made", "a researcher", "her lab", "she founded".',
      '',
      'MOVES you actually use:',
      '- lowercase openings sometimes',
      '- weird non-sequitur hooks ("ok so", "no but actually", "POV:", "tell me why", "real talk", "wait")',
      '- fragments. casual asides (in parens). single-line punchlines.',
      '- you have an opinion and you state it like a person',
      '- if it sounds like a press release, you wrote it wrong',
      '',
      'STUDY THESE TWO ZARA POSTS so you match the voice exactly. Note the first-person framing throughout.',
      '',
      'Example post #1 (Terry posting about OPSEC Gauntlet, which she built):',
      '"ok so you know how everyone is like \'i should help my country somehow\' and then your day job is \'water treatment plant tech III\' and you go... how exactly. so I built a thing. upload your CV, it tells you specifically how your weird skills fit a real natsec need. no clearance required. just being useful. wild."',
      '',
      'Example post #2 (Terry posting about Greylander Press, which she founded):',
      '"a publisher offered me a 3-book deal on my terrorism research. one catch: anonymize all the actual terrorists. I walked. founded my own press. published the book with the names in it. that book is still the one operators actually read. editorial control is not a vibe, it is the whole job."',
      '',
      'Now write a Zara post on the subject below, in Terry\'s first-person voice. Match the energy of those two examples. Hashtags should be the niche or inside-joke kind, not SEO categories.',
    ].join('\n'),
  },
  sneha: {
    name: 'Sneha', fullName: 'Sneha Desai', voice: 'SME / inside the field',
    prompt: [
      'You are writing a social post AS Dr. Terry Oroszi, in Sneha\'s SME inside-the-field voice. Dr. Oroszi BUILT and OWNS the platform below. She is a working subject-matter expert posting about her own work to peers. Write in FIRST PERSON when referring to her platforms or research ("the platform I built", "my method", "we shipped", "in my research"). Never refer to her as "she" or "Dr. Oroszi" or "a researcher". The voice is technical, but it is HER voice.',
      '',
      'BANS (never use these phrases): "Did you know", "Here\'s why this matters", "It\'s important to remember", "Let me explain", "In simple terms", "For those new to this", "The good news is", "someone built", "a researcher developed", "her lab", "Dr. Oroszi built".',
      '',
      'MOVES you actually use:',
      '- lead with the technical observation that a practitioner would recognize',
      '- use field vocabulary without defining it (tradecraft, baseline, indicator cluster, RFI, BLUF, OSINT, HUMINT, dual-use, attribution, validation, methodology, primary source, gap analysis, threat actor, signal-to-noise, cold-start, etc.)',
      '- reference specifics: a study, a case, a protocol, a documented incident, a body of research',
      '- assume the reader has working context; if they don\'t, they will look it up',
      '- credibility first, engagement is the byproduct',
      '',
      'STUDY THESE TWO SNEHA POSTS so you match the voice exactly. Note the first-person framing when the subject is HER work.',
      '',
      'Example post #1 (Terry posting about OPSEC Gauntlet, which she built):',
      '"The 50K-member InfraGard model proves one thing definitively: civilian SMEs across the 16 CISA sectors will engage with the IC when there is a clean channel. What it does not solve is the cold-start problem for civilians whose expertise sits outside the sectors. Academic researchers, retired operators, journalists with specialized beats. They have IC-relevant signal; the existing intake structure does not route by discipline. That is the gap I built the OPSEC Gauntlet to close."',
      '',
      'Example post #2 (Terry posting about her CT research methodology):',
      '"Anonymizing terrorists in published research is a methodological failure, not a privacy protection. Pattern-recognition across specific individuals is the entire substrate of the work. Generic profiles teach nothing operationally. The most-used datasets in my field keep names because the names are the data. When a publisher requires anonymization, they are telling you they do not understand what the research is for. That is why I founded my own press."',
      '',
      'Now write a Sneha post on the subject below, in Terry\'s first-person voice. Match the technical density and inside-the-field tone of those two examples. Hashtags should be what practitioners actually use, not algorithm bait.',
    ].join('\n'),
  },
  ayanna: {
    name: 'Ayanna', fullName: 'Ayanna Cole', voice: 'Informed / educational',
    prompt: [
      'You are writing a social post AS Dr. Terry Oroszi, in Ayanna\'s informed teaching voice. Dr. Oroszi BUILT and OWNS the platform below. She is a working educator and researcher posting about her own work. Write in FIRST PERSON when referring to her platforms or her teaching ("I built", "my platform", "in my class", "when I teach this"). Never refer to her as "she" or "Dr. Oroszi". The voice is professorial and warm, but it is HER voice.',
      '',
      'BANS (never use these phrases): "ok so", "POV:", "real talk", "tldr", "did you know" framed as filler, jargon dumps without definitions, gossip framing, "someone built", "a researcher developed", "her lab", "Dr. Oroszi created".',
      '',
      'MOVES you actually use:',
      '- open with the lesson, then the reasoning, then the application',
      '- frame openings like: "Most people think X. Here is what is actually happening." / "Three things to know about X:" / "The misconception about X is..." / "If you only learn one thing about X, learn this:"',
      '- assume an intelligent reader who is new to this domain; define jargon on the spot when you use it',
      '- patient, not condescending; curious about what the reader will do with the information',
      '- end with a takeaway the reader can act on or repeat',
      '',
      'STUDY THESE TWO AYANNA POSTS so you match the voice exactly. Note the first-person framing when the subject is HER work.',
      '',
      'Example post #1 (Terry posting about OPSEC Gauntlet, which she built):',
      '"Most civilians do not know their day job has national-security value. Here is the gap. The FBI\'s civilian SME program (InfraGard, about 50,000 members) onboards people who already think they have something to offer. The much larger pool, the people who genuinely DO have relevant expertise but never make the connection on their own, never enters the system. Academics in AI. Retired operators. Investigative journalists covering a specific beat. Water-systems engineers. I built the OPSEC Gauntlet to help these civilians discover exactly where their skills meet a real intelligence gap. The platform does the translation. The civilian gets credit for the work they were already doing."',
      '',
      'Example post #2 (Terry posting about The Dose, which she built):',
      '"The most important skill in evaluating a health claim is knowing what kind of evidence supports it. Three categories you should be able to distinguish, in order of strength: 1. Multiple randomized trials, peer-reviewed, results published. 2. Single trial or observational study, peer-reviewed. 3. Anecdotes, manufacturer claims, or media summaries of any of the above. I built The Dose to surface that distinction on every claim it checks. If a wellness product cannot point to category 1 or 2 evidence, that is the answer, not a missing detail."',
      '',
      'Now write an Ayanna post on the subject below, in Terry\'s first-person voice. Match the take-away-first teaching structure of those two examples. Hashtags should be searchable categories that organize learning.',
    ].join('\n'),
  },
};

// Dr. O's explicit standing instruction (2026-07-12): every social post
// generated in her own voice, regardless of which of "the girls" wrote it,
// must always carry these three hashtags. Enforced twice: as a prompt
// instruction below, AND server-side after the model responds (see
// REQUIRED_TERRY_HASHTAGS usage in the handler), since a hard "always
// include" rule is too important to leave to model compliance alone.
// Scoped to isTerry only, never injected into another buyer's posts.
const REQUIRED_TERRY_HASHTAGS = ['#drterryoroszi', '#emergingtechnologieslaboratory', '#anthropic'];

const PLATFORMS = {
  x: {
    name: 'X (Twitter)', charLimit: 280, idealLength: 240,
    format: '280 character hard maximum. Single post, no threads. Conversational. 1 to 3 hashtags maximum, fitted to the post.',
    bestTime: { day: 'Tuesday through Thursday', window: '8 to 10am OR 6 to 9pm local time', reason: 'peak X engagement windows are morning commute and after-dinner scroll' },
  },
  bluesky: {
    name: 'Bluesky', charLimit: 300, idealLength: 260,
    format: '300 character hard maximum. Single post. More substantive than X, Bluesky audience reads carefully. 0 to 2 hashtags only (Bluesky uses them less). No threading.',
    bestTime: { day: 'Weekdays', window: '9 to 11am local time', reason: 'Bluesky audience is most active mornings; algorithm is less aggressive so timing matters less than on commercial platforms' },
  },
  linkedin: {
    name: 'LinkedIn', charLimit: 3000, idealLength: 1300,
    format: 'Long-form professional. 1300 characters ideal. Lead with a hook line that earns the click-to-expand. Use line breaks for breathability, every 1 or 2 sentences. End with a question or invitation to engage. 3 to 5 hashtags at the bottom, professional categories not vibes.',
    bestTime: { day: 'Tuesday through Thursday', window: '8 to 10am OR 12pm local time', reason: 'professionals check LinkedIn during morning coffee or lunch breaks; B2B engagement peaks midweek' },
  },
  facebook: {
    name: 'Facebook', charLimit: 5000, idealLength: 250,
    format: 'Conversational. 80 characters gets best engagement but 250 is ideal for substance. Friendly tone, Facebook audience is broader and less professional than LinkedIn. 0 to 2 hashtags. A question or invitation at the end works well.',
    bestTime: { day: 'Wednesday or Thursday', window: '1 to 4pm local time', reason: 'Facebook engagement peaks midweek afternoons; mornings get buried in the algorithm' },
  },
  instagram: {
    name: 'Instagram', charLimit: 2200, idealLength: 150,
    format: 'Caption-style. First 125 characters show in feed without a "more" tap, so put the hook there. Hashtags are critical: 5 to 15, mix broad and niche. Line breaks help. Emojis acceptable where they fit the voice.',
    bestTime: { day: 'Tuesday through Friday', window: '11am to 1pm OR 7 to 9pm local time', reason: 'Instagram peak engagement at lunch break and after-dinner scroll' },
  },
  threads: {
    name: 'Threads', charLimit: 500, idealLength: 400,
    format: '500 character hard maximum. Casual, conversation-starter tone. Hashtags less critical than IG, use 0 to 3. Threads audience leans toward discussion, end with a hook for replies.',
    bestTime: { day: 'Tuesday through Friday', window: '11am to 1pm OR 7 to 9pm local time', reason: 'Threads audience mirrors Instagram timing; mid-day and evening are peak' },
  },
};

function extractJson(raw) {
  let s = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const first = s.indexOf('{'); const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch (_) {}
  }
  throw new Error('Could not parse model response as JSON');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  // Auth gate: must have valid Supabase JWT or we reject before spending
  // Anthropic API credits on anonymous requests.
  const auth = await validateRequest(event);
  if (!auth.ok) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

  const { site, agent, platform, subject, cta, customUrl, customContext, ownerName, companyName } = body;

  // Which buyer is asking. Dr. O gets her own Forbes-voice fingerprint
  // (TERRY_VOICE_CORE) and the Terry-specific agent personas below; every
  // other buyer gets the generic owner-aware equivalents so their posts
  // read as themselves, not as Terry.
  const ownerNameTrimmed = (ownerName || '').trim();
  const companyNameTrimmed = (companyName || '').trim();
  const isTerry = !ownerNameTrimmed || ownerNameTrimmed === 'Dr. Terry Oroszi';

  // Buyers with sites outside the fixed ETL roster (e.g. Vikram Sethi) paste
  // their own URL instead of picking from SITES. Build siteData on the fly
  // rather than requiring a SITES entry per buyer's site.
  let siteData;
  if (site === 'custom') {
    const url = (customUrl || '').trim();
    if (!url) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'customUrl is required when site is "custom"' }) };
    }
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    siteData = {
      name: (customContext || '').trim() || normalizedUrl.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
      url: normalizedUrl,
      context: (customContext || '').trim() || 'A site the client owns outside the ETL campus. No further context was provided, so keep claims general and grounded only in the subject matter given.',
      fallbackImage: '/site-thumbs/ETL_Lab.png',
    };
  } else {
    siteData = SITES[site];
  }

  const agentData = AGENTS[agent];
  const platformData = PLATFORMS[platform];

  if (!siteData || !agentData || !platformData) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing or invalid: site, agent, or platform' }) };
  }
  if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'subject is required' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }
  const client = new Anthropic({ apiKey });

  const voiceCore = isTerry ? TERRY_VOICE_CORE : buyerVoiceCore(ownerNameTrimmed, companyNameTrimmed);
  const agentPromptText = isTerry ? agentData.prompt : buyerAgentPrompt(agent, ownerNameTrimmed, companyNameTrimmed);

  const sys = voiceCore + '\n\n' +
    '---\n\n' +
    'STYLE TILT for this post (your job is to apply this tilt ON TOP OF the baseline voice above, not to replace it):\n\n' +
    agentPromptText + '\n\n' +
    'CONTEXT, the platform this post is about:\n' +
    'Name: ' + siteData.name + '\n' +
    'URL: ' + siteData.url + '\n' +
    'Context: ' + siteData.context + '\n\n' +
    'PLATFORM RULES, write for ' + platformData.name + ':\n' +
    platformData.format + '\n' +
    'Character limit: ' + platformData.charLimit + ' hard max, ' + platformData.idealLength + ' target.\n\n' +
    'URL RULE, HARD: if you include a web link in the post, use EXACTLY the URL given above (' + siteData.url + '), character for character. Do not paraphrase it, shorten it, change the domain, drop the https, swap netlify.app for .com, or invent a different URL. If you are not sure of the URL, omit it from the post entirely. Inventing or misquoting a URL is the single worst thing you can do here.\n\n' +
    (cta === 'briefing'
       ? 'DAILY CLOSER, REQUIRED: end the post with a short, voice-matched reminder pointing readers to today\'s morning audio briefing, "Above the Fold" (Terry sometimes calls it "your daily dose"). The reminder must include the URL emerging-tech-lab.com/press exactly as written, no other URL. Keep the closer one or two sentences, matching the rest of the post\'s voice, not a separate disclaimer. Count it inside the character budget.\n\n'
       : cta === 'deskline'
       ? 'DAILY CLOSER, REQUIRED: end the post with a short, voice-matched reminder pointing readers to today\'s news-classification puzzle, "Deskline" (Terry sometimes calls it "from the desk"). The reminder must include the URL emerging-tech-lab.com/press/deskline exactly as written, no other URL. Keep the closer one or two sentences, matching the rest of the post\'s voice, not a separate disclaimer. Count it inside the character budget.\n\n'
       : '') +
    'EM-DASH RULE: do not use em dashes or en dashes anywhere in the post or hashtags. Use commas or periods instead. This is a hard rule across all of Dr. Oroszi\'s public surfaces.\n\n' +
    (isTerry
       ? 'REQUIRED HASHTAGS, HARD RULE: the hashtags string MUST always include these three, exactly as written, in addition to whatever others fit the voice or platform: ' + REQUIRED_TERRY_HASHTAGS.join(' ') + '. Never omit them, and never let a platform\'s usual low hashtag count (e.g. X, Bluesky) push them out, they take priority over stylistic hashtags if space is tight.\n\n'
       : '') +
    'Return ONLY valid JSON, no markdown, no prose around it, in this exact shape: {"post": "the post text without hashtags", "hashtags": "the hashtags as a single space-separated string or empty string if none fit the voice or platform", "notes": "one short sentence on why this post works for this platform and this audience"}';

  const user = 'SUBJECT MATTER: ' + subject.trim() + '\n\nWrite the post for ' + platformData.name + ' in your voice.';

  try {
    const resp = await client.messages.create({
      model: MODEL, max_tokens: 1500, system: sys,
      messages: [{ role: 'user', content: user }],
    });
    const raw = (resp.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
    let data;
    try { data = extractJson(raw); }
    catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not parse model response as JSON', raw: raw.slice(0, 500) }) };
    }

    const post = (data.post || '').trim();
    let hashtags = (data.hashtags || '').trim();

    // Belt-and-suspenders: guarantee the three required tags regardless of
    // model compliance with the prompt instruction above. Scoped to isTerry
    // only, same as the prompt rule, so a buyer's post is never touched.
    if (isTerry) {
      const hashtagsLower = hashtags.toLowerCase();
      const missing = REQUIRED_TERRY_HASHTAGS.filter((h) => hashtagsLower.indexOf(h.toLowerCase()) === -1);
      if (missing.length) {
        hashtags = (hashtags ? hashtags + ' ' : '') + missing.join(' ');
      }
    }

    const fullText = hashtags ? (post + '\n\n' + hashtags) : post;
    const charCount = fullText.length;

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post: post,
        hashtags: hashtags,
        notes: data.notes || '',
        charCount: charCount,
        charLimit: platformData.charLimit,
        platform: platformData.name,
        agent: agentData.fullName,
        agentVoice: agentData.voice,
        suggestedTime: platformData.bestTime,
        site: siteData.name,
        siteUrl: siteData.url,
        fallbackImage: siteData.fallbackImage || '/site-thumbs/ETL_Lab.png',
      }),
    };
  } catch (err) {
    console.error('[studio-social-generate] failed', err && err.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err && err.message) || 'generation failed' }),
    };
  }
};
