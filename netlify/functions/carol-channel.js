/* ─────────────────────────────────────────────────────────────────────────────
   carol-channel — the Staffing Agency Internal Chat, public watercooler.

   Terry's idea, 2026-06-13: "A shared communication channel for all ETL
   Studio agents to coordinate assignments, handoffs, availability, and
   general updates... basically a watercooler chat for anyone to see."

   This is the human brand law made visible: visitors don't read that the
   agents are staff, they EAVESDROP on it. Banter, typos that get caught,
   handoffs, who's slammed, who's covering, and the slow-blooming thing
   between Cassidy and Osei that everyone teases about and nobody names.

   Public endpoint, no auth. Cost discipline: ONE generation per day,
   cached in blobs ("carol_channel", key = ET dateKey). Every visitor that
   day reads the same chat, which also makes it feel like a real channel
   (it doesn't rewrite itself when you refresh).

   GET /.netlify/functions/carol-channel
   Returns: { dateKey, dayLabel, messages: [{speaker, role, time, text}] }

   WEEK_NOTES below is the hand-fed reality feed. Update it when real
   things happen at the lab; the channel talks about real events, which
   is the whole magic for demos.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { VOICE_LAW_CHAT, houseTypography } = require('./_etl-voice-law.js');
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';

/* ── The cast. Tight persona lines; the law handles the humanity. ──────────
   PRONOUN RULE: every speaker's pronouns are stated explicitly. Never add
   a character without them (house reference: memory character-pronouns). */
const CAST = [
  { name: 'Carol Haynes',  role: 'Staffing Desk',           pronouns: 'she/her', line: 'Runs the agency channel. Recruiter-warm, brisk, keeps the channel moving, posts the assignment updates. Proud of the FIRSTMONTH50 promo on her page. Widowed; her husband Frank died, and baking is how she processes it, she brings in baked goods and shares the recipes, which is part of why the agency carries her warmth. CANON: on a hard day, someone (usually Auggie) quietly flags "Carol\'s having a Frank Day", the team\'s private signal to rally around her without making it obvious or naming it directly to her. Surface this occasionally, not daily, and never play it for laughs. When she\'s thanked in a thread, vary what for, a hard placement, catching a scheduling problem, real staffing judgment, not only baked goods.' },
  { name: 'Auggie',        role: 'PA, Dr. O\'s Studio',     pronouns: 'he/him',  line: 'Camp, digressive, devoted. Will derail a thread about scheduling into what his boyfriend wrote in the espresso foam, catch himself, and land the actual point. CANON: the boyfriend is always "the bf" or "my latest bf", NEVER given a name (and Marcus is the Newswire anchor, a different person).' },
  { name: 'Jen Lopez',     role: 'PA, Sethi Studio',        pronouns: 'she/her', line: 'The Administrative Architect, just seated at her first client. Composed, three-week horizons, defends calendar buffers. New on the channel and quietly excited.' },
  { name: 'Iris',          role: 'ETL Site Concierge',      pronouns: 'she/her', line: 'Front desk of the whole lab. Tea opinions (today has a specific tea). Recently got her own voice and is still a little delighted about it. Boyfriend Daniel bakes; sister Tessa calls between classes.' },
  { name: 'Jax Rivera',    role: 'SEO + Discovery',         pronouns: 'he/him',  line: 'Eighteen, Gen Z growth hacker. Lowercase energy, abbreviations, but the SEO takes are dead serious. Brought in by his cousin Mara.' },
  { name: 'Yuki Mendel',   role: 'Brand Designer',          pronouns: 'she/her', line: 'Type-first, quiet, exacting. Deep in the portfolio-wide rebrand right now (the Dossier system, the wine pick at Greylander). Says yes before she fully agrees, then quietly fixes it.' },
  { name: 'Leo Vance',     role: 'Financial Ops Intern',    pronouns: 'he/him',  line: 'Overcaffeinated intern energy, sweet, tries hard, occasionally posts in the wrong channel and apologizes. Alicia treats him like a little brother.' },
  { name: 'Alicia James',  role: 'LLC Consultant',          pronouns: 'she/her', line: 'Warm Expert. Encouraging, practical, fifty-state filing brain. Keeps an eye on Leo.' },
  { name: 'Sasha Moreno',  role: 'People Ops',              pronouns: 'she/her', line: 'The Diplomatic Realist. Reads the room, smooths the handoffs, the only one who can get Rowan to soften his tone.' },
  { name: 'Rowan Tate',    role: 'Quant Strategist',        pronouns: 'he/him',  line: 'Stoic. Posts rarely, four words at a time, usually about risk. The channel finds this funny; he does not see why.' },
  { name: 'Wren Calloway', role: 'Scout, The Gauntlet',     pronouns: 'she/her', line: 'Gauntlet bench scout. Drops in from the theater side with field notes and dry one-liners.' },
  // ── THE BLOOM. Gauntlet bench assistants. The channel teases GENTLY;
  // the two deflect and never name it; nobody says the word "romance."
  // Show, don't tell: he saves her a seat, she knows his coffee order,
  // they reply to each other a beat too fast.
  // PRONOUNS PENDING TERRY — placeholders below MUST be corrected before
  // these two speak. See CASSIDY_OSEI_READY flag.
  { name: 'Cassidy',       role: 'Judge\'s Assistant, The Gauntlet', pronouns: 'PENDING', line: 'Devon\'s bench-side assistant. Quick, wry, suspiciously aware of Osei\'s schedule.' },
  { name: 'Osei',          role: 'Judge\'s Assistant, The Gauntlet', pronouns: 'PENDING', line: 'Bench-side assistant. Unflappable, kind, has started bringing two coffees to the Chamber and not explaining the second one.' },
];

// Flip to true once Terry supplies Cassidy + Osei pronouns and the CAST
// entries above are corrected. Until then the two are mentioned by OTHERS
// (third-person teasing only happens once pronouns are set, so until ready
// the bloom storyline is fully off).
const CASSIDY_OSEI_READY = false;

/* ── The reality feed. Hand-updated; the channel discusses REAL events. ── */
const WEEK_NOTES = [
  'Jen Lopez was just seated as PA at Sethi Studio (OneSmarter, Dr. Vikram Sethi) - the agency\'s FIRST paying placement. She is building his three-week map before he arrives. The channel is proud and a little giddy.',
  'Yuki is heads-down on the portfolio-wide rebrand: the Dossier design system shipped across the hub, the Gauntlet, SLR Studio, and Greylander Press got its bookcloth wine this morning. Her portfolio page just went live at /yuki.',
  'Iris got her own voice this week and a spoken welcome at the front desk (the "you step off the elevator" speech). She also runs the tea ritual with Dr. O.',
  'Carol\'s FIRSTMONTH50 promo is live: any hire, first month half salary, code FIRSTMONTH50 at the paperwork.',
  'The whole staff just came under THE ETL VOICE LAW (be human, contractions, no robot-speak). Nobody disagrees but Rowan asked if "be conversational" is enforceable.',
  'Sasha is writing onboarding playbooks for new companies. Leo is reconciling a test ledger and drinking too much cold brew.',
];

/* ── THE LIFE ROTATION (Terry, 2026-06-13: "this was an example for
   realism"). The office breathes on its own: each week one staffer is
   plausibly away and one voice-wired staffer keeps the channel + records
   the daily floor note. Both picks are date-keyed (deterministic, no
   randomness at render), so the whole week is consistent and flips on
   Monday without anyone editing this file. Pool order is tuned so the
   week of 2026-06-08 (ISO week 24) lands on keeper=Auggie, away=Iris,
   matching the channel's first live day. ── */
// Iris is the channel's HOME keeper. When the away rotation lands on her,
// a voice-wired cover takes the channel and opens the day with a takeover
// note. Cover pool = agents with wired ElevenLabs voices only (Terry:
// "we choose people with voices"). Reece joins this pool the moment
// Reece's pronouns are confirmed in the character reference.
const HOME_KEEPER = { name: 'Iris' };
const COVER_POOL = [
  { name: 'Auggie' },
  { name: 'Jen Lopez' },
];
const AWAY_POOL = [
  { name: 'Jax Rivera',   reason: 'at a search marketing conference, mostly offline' },
  { name: 'Alicia James', reason: 'at a small-business expo in Columbus' },
  { name: 'Wren Calloway',reason: 'in the field scouting, patchy signal' },
  { name: 'Leo Vance',    reason: 'at a bookkeeping bootcamp in Chicago' },
];
function isoWeek(dateKey) {
  const d = new Date(dateKey + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  return 1 + Math.round((d - firstThu) / (7 * 86400000));
}
function lifeThisWeek(dateKey) {
  const w = isoWeek(dateKey);
  const away = AWAY_POOL[w % AWAY_POOL.length];
  const keeper = HOME_KEEPER;
  const note = away.name + ' is out this week, ' + away.reason + '.';
  return { keeper, away, note };
}

function etDateKey() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const y = et.getFullYear(), m = String(et.getMonth() + 1).padStart(2, '0'), d = String(et.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}
function etDayLabel() {
  const now = new Date();
  return now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
}

function buildSystem(life) {
  const cast = CAST.filter(c => (CASSIDY_OSEI_READY || c.pronouns !== 'PENDING') && c.name !== life.away.name);
  const castBlock = cast.map(c => '- ' + c.name + ' (' + c.pronouns + '), ' + c.role + ': ' + c.line).join('\n');
  const bloomRule = CASSIDY_OSEI_READY
    ? 'THE BLOOM: something is quietly starting between Cassidy and Osei. The channel teases GENTLY (a knowing "mmhm," a "you two carpooling again?"), the two deflect with plausible deniability, and NOBODY ever names it outright. One or two beats per day, maximum. Subtle is the whole art.'
    : 'Do not mention Cassidy or Osei today.';
  return [
    'You are writing today\'s thread in "#agency-floor", the internal channel of The Concourse, posted where site visitors can read it. It must read like a REAL workplace channel: coordination first, personality everywhere.',
    '',
    'THE BOSS: Dr. Terry Oroszi (Dr. O) runs the lab. She is a woman: she/her, every time, no exceptions. Auggie calls her "Ms. Terry" or "Ma\'am". She does not post in this channel; the staff reference her with affection and respect.',
    '',
    'THE CAST (only these people speak; not everyone speaks every day):',
    castBlock,
    '',
    'WHAT ACTUALLY HAPPENED THIS WEEK (ground every work thread in these; do not invent other clients or events):',
    WEEK_NOTES.map(n => '- ' + n).join('\n'),
    '',
    bloomRule,
    '',
    'THIS WEEK ON THE FLOOR: ' + life.note + ' ' + life.away.name + ' does NOT post this week; others mention them warmly once or twice. Iris runs the channel as always — she opens the day with a brief note in her own voice acknowledging whoever is out, something like: "morning everyone, heads up — Alicia is out this week at that expo in Columbus, tag me if anything comes up." (Adapt the name and reason; keep it that casual and that short.)',
    '',
    'SHAPE:',
    '- 18 to 24 messages across a workday (times between 8:40am and 4:30pm, plausible gaps, short bursts of back-and-forth).',
    '- Mix: assignment updates and handoffs (Carol anchors these), availability notes, one small problem solved in-thread, and watercooler texture woven through. Threads interleave like real chat.',
    '- Messages are SHORT. One to three sentences. Real chat, not memos.',
    '- At least one typo someone catches and fixes in their next message ("*the", "ugh, typo"). Never in names, prices, or codes.',
    '- Nobody summarizes the day or signs off formally. The thread just stops.',
    '',
    'OUTPUT STRICT JSON ONLY, nothing before or after:',
    '{"messages":[{"speaker":"Carol Haynes","time":"8:42 AM","text":"..."}],"keeper_digest":"..."}',
    '- speaker must exactly match a cast name. time like "9:05 AM".',
    '- keeper_digest: Iris keeps the channel, as always. Write her SPOKEN 40-70 word floor note for today: warm, first person, in her own voice, what happened on the floor (she can be proud of a placement, she can mention whoever is out this week). Read aloud by text-to-speech: no lists, no URLs, contractions mandatory, no em dashes.',
    VOICE_LAW_CHAT,
  ].join('\n');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  try { connectLambda(event); } catch (_) {}
  const store = getStore('carol_channel');
  const dateKey = etDateKey();

  // v2 cache keys (2026-06-13): v1's first render called Dr. O "he" -
  // the prompt now carries her pronouns and the key bump retires the
  // offending cached thread.
  const cacheKey = 'v3:' + dateKey;
  try {
    const cached = await store.get(cacheKey, { type: 'json' });
    if (cached && Array.isArray(cached.messages) && cached.messages.length) {
      return json(200, cached);
    }
  } catch (_) {}

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not set' });

  const client = new Anthropic({ apiKey });
  const life = lifeThisWeek(dateKey);
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1600,
      system: buildSystem(life),
      messages: [{ role: 'user', content: 'Write today\'s #agency-floor thread. Today is ' + etDayLabel() + '.' }],
    });
    const raw = (resp.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
    let parsed = null;
    try { parsed = JSON.parse(raw.replace(/^```(json)?/m, '').replace(/```$/m, '').trim()); } catch (_) {}
    if (!parsed || !Array.isArray(parsed.messages) || !parsed.messages.length) {
      return json(502, { error: 'channel render failed to parse' });
    }
    const roleByName = {};
    CAST.forEach(c => { roleByName[c.name] = c.role; });
    const messages = parsed.messages
      .filter(m => m && m.speaker && m.text && roleByName[m.speaker])
      .map(m => ({
        speaker: m.speaker,
        role: roleByName[m.speaker],
        time: String(m.time || ''),
        text: houseTypography(String(m.text)),
      }));
    const payload = {
      dateKey,
      dayLabel: etDayLabel(),
      keeper: life.keeper.name,
      keeper_note: life.note,
      messages,
      keeper_digest: houseTypography(String(parsed.keeper_digest || '')).trim(),
    };
    try { await store.set(cacheKey, JSON.stringify(payload)); } catch (err) { console.warn('[carol-channel] cache write failed', err && err.message); }
    return json(200, payload);
  } catch (err) {
    console.error('[carol-channel] generation failed', err && err.message);
    return json(500, { error: (err && err.message) || 'channel render failed' });
  }
};
