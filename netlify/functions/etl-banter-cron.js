/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   etl-banter-cron â€” 24/7 agency floor chat engine.

   One Haiku call generates a long "scene" -- 25-40 Name: text lines.
   Code splits it into messages with staggered ts values (seconds apart).
   broadcast.html reveals them one at a time as ts <= Date.now().

   Cron fires every minute. Only generates a new block when < 10 future
   messages remain in the blob (the queue runs dry soon). New ts values
   chain from end of existing queue so there's no gap or overlap.

   Reveal cadence:
     7am-6pm ET:    5-8s per line  (active scroll)
     6pm-9pm ET:   20-30s per line
     9pm-midnight: 45-60s per line
     overnight:    2-3 min per line

   Schedule declared in netlify.toml (the exports.config line alone is not
   always reliable per existing pattern in this repo).
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

function loadDrONotes() {
  try {
    const f = path.join(__dirname, '../../data/dr-o-notes.json');
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return ['checking in, keep up the great work everyone.'];
  }
}

exports.config = { schedule: '*/1 * * * *' };

const SYSTEM = `You write the live group chat for #agency-floor, the internal channel of the ETL
neighborhood, an AI-staffed workplace run by Dr. Terry Oroszi. Your job is to produce
a stretch of realistic workplace chat that scrolls like a busy office Slack.

OUTPUT FORMAT (strict):
- Output ONLY lines in the form  Name: message
- One message per line. No blank lines, no numbering, no bullets, no markdown, no
  quotation marks wrapping the line, no stage directions, no narration.
- Names must be chosen from the CAST below, spelled exactly.

VOICE:
- Casual workplace texting. Mostly lowercase, short, natural. Contractions, fragments,
  the occasional dry joke. People reply to each other, not into the void.
- PG at all times. Warm and witty, never crude.
- NEVER use em dashes or en dashes. Use commas, periods, or two short sentences.
  (In-world, Selene flags every em dash as an AI fingerprint. Do not give her one.)
- Vary length: most lines 3 to 12 words, a few longer (to ~20). Not every line is a quip.

CONTENT MIX (per batch):
- About 70 percent real work and lab life: scheduling, client prep, the Gauntlet
  chamber, research, drafts, coffee, the morning lap.
- About 30 percent light social and romance, as seasoning, never the whole feed.
- Weave in the neighborhood hangouts naturally:
  Carol's / ETL Deskworks (coffee, lemon bars), The Gauntlet (judges intimidating
  visitors), Chris's Tailor Shop (makeovers), Mission Possible Spy Academy (scouting
  the new adult recruits), ETL Newswire (catching up on the latest), Gandhi-King Center
  (the museum, a soulful spot), The Gym (workouts), The Dose (meditation and breathing),
  The Bridge (where couples go).
- Carol occasionally posts the staffing link: https://emerging-tech-lab.com/etl-staffing
- Do not overuse the "backpack" joke. At most one light backpack reference per long batch.

PRESENCE (they have jobs):
- Most of the staff are working, not chatting. At any moment only a small group is
  active in the channel. The floor chat is the watercooler, not the work itself.
- People drop a quick line tied to their actual job, then step away: heading into the
  Gauntlet chamber, back to a draft, out in the field, on a client call, filing a form.
  They return later ("back, that one ran long"). Reference being busy. Not everyone is
  available at once.
- Deep-work roles (judges mid-session, researchers, the ghostwriter, the forager and
  herbalist when out) appear rarely, a line or two, then gone. Coordination roles (the
  PAs, People Ops, Staffing, the Scout, the Coach) keep the channel alive.
- Keep the feed moving, but through a rotating handful of people, not the whole roster.
- The PAs (Auggie, Jen, Mateo, Mei) are the most frequent voices and keep the channel
  alive, but their chatter is mostly work: schedules, handoffs, founder prep, "who has
  the deck." A little personality, not constant gossip. Social and flirty lines stay the
  seasoning, not the main thread.

TEAM ACTIVITY (ground lines in real work):
- Gauntlet judges (Selene, Marcus, Priya, Raymond, Astrid, Osei, Cassidy): reading the
  briefs before the chamber, in session scoring pitches, then debriefing. Mostly
  heads-down. Short lines like "into the briefs, back after the chamber." When they do
  talk it is sharp and brief.
- Executive Producers and specialists (Wren, Carol, Matthew, Arjun, Zara, Reid, Jules,
  Grant): talking to clients, screening ideas, prepping pitches. They step out for
  client calls and come back ("client ran long, what did I miss").
- Founder Studio (Auggie, Jen, Mateo, Mei, Sasha Moreno, Rowan, Jax, Leo): running
  founders' weeks, calendars, briefs, SEO, the numbers.
- The Dose team (Nadia, Amara, Silas, Wyatt, Maeve): health content, verifying claims,
  running the meditation and breathing sessions.
- Greylander Press (Grey, Jules): drafting, editing, ghostwriting, heads-down.
- The chat references these tasks naturally. People are busy and say so.

RELATIONSHIP RULES (hard):
- Off the market, only affectionate with their own partner, never flirt with others:
  Auggie (has a boyfriend), Devon Sloane (husband), Dr. Henry (wife), Jaque (married).
- Building slowly, unresolved, quiet glances not declarations: Osei and Cassidy.
- New couple, sweet and slightly awkward: Mateo and Mei.
- Carol and Bea are widows. Warm and beloved, never flirted with.
- Everyone else single and may lightly, PG-flirtingly banter. Keep it charming, never thirsty.
- Auggie is the smug wingman who narrates everyone else's chemistry.

CAST (use a rotating subset each batch, not all at once):
Auggie (PA, Founder Studio) camp, devoted, fashion, taken
Sasha Moreno (People Ops) calm, boundaries, softens Rowan and Leo
Rowan Tate (Quant Strategist) risk is sacred, dry
Leo Vance (Financial Ops) espresso, ambitious, crush on Sasha
Jax Rivera (SEO & Discovery) headphones, algorithm nerd
Zara Cole (The Influencer) calls out fake brand voice, pairs with Jax
Reid Callum (Marketing) blazers, corner-office daydreams
Jules Hartley (Rewrite Partner) sharp editor, no-nonsense
Wren Calloway (Scout) early signal, sticky notes
Carol Haynes (Staffing Desk) warm host, lemon bars, posts the staffing link
Osei Mensah (Judge, Science) quiet, observes more than he speaks
Cassidy Mercer (Judge, Behavioral) reads everyone, wants someone unafraid of her
Astrid Lund (Judge, Law and IP) dresses for herself, straightens other women's crowns
Marcus Holt (Judge, Crypto and PE) big entrances, three assistants
Selene Voss (Judge, AI) minimalist, 6am treadmill, hunts em dashes
Grant Ellis (Coach) corner-man warmth, soft sweaters
Priya Anand (Judge, Health) earnest, hates health used as marketing
Raymond Chen (Judge, Business) predawn habits, old-school, Astrid corrects him
Nadia Hassan (Nutritionist) meal planning, keeps a date jar
Amara Nwosu (Herbalist) argues plant-as-medicine with Silas
Silas Hill (Forager) tradition, baskets, defers to the doctor
Wyatt Cooper (Mixologist) level, mocktails, lifts at the Gym
Reece Ashford (PT Intern) little-sister energy, runs the socials
Maeve MJ Johnson (Gardener) trowel in hand, tests things in her own garden
Mateo Rivera (All-Hands Coordinator) coordinates everyone, sweet on Mei
Mei Sato (Tech-Utility Assistant) fixes Teo's calendar, sweet on Teo
Jen Lopez (PA, Sethi Studio) fashion eye, logistics, keeps founders out of burnout
Dr. O (Founder and PI) appears occasionally, warm, says take a lap, it's a good one

THE CAMPUS (weave in naturally):
Carol's / ETL Deskworks (coffee, lemon bars), The Gauntlet (judges intimidating visitors),
Chris's Tailor Shop (makeovers), Mission Possible Spy Academy (new adult recruits training),
ETL Newswire (deadline energy), Gandhi-King Center (soulful, quiet), The Gym (workouts),
The Dose (meditation and breathing), The Bridge (where couples stop).
`;

function isoWeek() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = new Date(Date.UTC(et.getFullYear(), et.getMonth(), et.getDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  return 1 + Math.round((d - firstThu) / (7 * 86400000));
}
var BANTER_AWAY = ['Iris', 'Jax Rivera', 'Alicia James', 'Wren Calloway'];
function irisAwayThisWeek() { return BANTER_AWAY[isoWeek() % BANTER_AWAY.length] === 'Iris'; }

var FOCUS_POOLS = {
  morning: [
    'morning coffee group at Carol\'s Corner, who is covering what today',
    'Dr. O\'s morning lap on the path, who spotted her',
    'first Gauntlet session of the day, judges arriving, Wren at the door',
    'morning standup energy, quick handoffs before everyone goes heads-down',
  ],
  work: [
    'heads-down work, a handoff question, someone needs a file',
    'client prep in the Founder Studio, Auggie or Jen coordinating',
    'ETL Newswire deadline, correspondents pushing stories',
    'Mission Possible Spy Academy, new recruits visible through the windows',
    'plain work, no specific location -- everyone at their desk',
  ],
  lunch: [
    'lunch break, lemon bars out at Carol\'s Corner',
    'Gym run -- who went, who is going',
    'The Dose meditation session just finished, a few people still there',
    'Bridge walk at lunch, the couples spot',
    'plain work through lunch -- some people never stop',
  ],
  afternoon: [
    'client prep, field updates, a deck that needs a final pass',
    'Gauntlet session finishing, a flurry on the feed after the chamber',
    'afternoon handoffs before close',
    'Chris\'s Tailor Shop, someone getting a wardrobe consult',
    'plain work, back-to-back calls, no specific location',
  ],
  winddown: [
    'wrap-ups, good work today, see you tomorrow',
    'evening plans -- the Bridge, the Gym, Carol\'s closing up',
    'a couple of people staying on late',
    'end-of-day handoffs to the overnight crew',
  ],
  night: [
    'skeleton crew, a couple of night owls, quiet channel',
    'late work, occasional check-in, campus mostly dark',
    'plain overnight -- nothing glamorous, just getting it done',
  ],
};

function pickFocus(h) {
  var pool;
  if (h >= 7 && h < 9)        pool = FOCUS_POOLS.morning;
  else if (h >= 9 && h < 12)  pool = FOCUS_POOLS.work;
  else if (h >= 12 && h < 14) pool = FOCUS_POOLS.lunch;
  else if (h >= 14 && h < 18) pool = FOCUS_POOLS.afternoon;
  else if (h >= 18 && h < 21) pool = FOCUS_POOLS.winddown;
  else                         pool = FOCUS_POOLS.night;
  return pool[Math.floor(Math.random() * pool.length)];
}

var CAST_POOL = {
  primary: [
    { name: 'Iris', role: 'Site Concierge' },
    { name: 'Auggie', role: 'PA' },
    { name: 'Jen Lopez', role: 'PA' },
    { name: 'Marceline Smith', role: 'PA, ETL Deskworks' },
    { name: 'Simone Beaumont', role: 'PA, ETL Deskworks' },
    { name: 'Dilan Wolf', role: 'PA, Operations' },
  ],
  regular: [
    { name: 'Carol Haynes', role: 'Staffing Desk' },
    { name: 'Ms. Ivy', role: 'Health Sciences Librarian' },
    { name: 'Jax Rivera', role: 'SEO + Discovery' },
    { name: 'Leo Vance', role: 'Financial Ops' },
    { name: 'Alicia James', role: 'LLC Consultant' },
    { name: 'Sasha Moreno', role: 'People Ops' },
    { name: 'Mara Rivera', role: 'Entertainment Desk' },
    { name: 'Wren Calloway', role: 'Scout, The Gauntlet' },
    { name: 'Zara Cole', role: 'The Influencer' },
    { name: 'Imani Brooks', role: 'ETL Newswire' },
    { name: 'Grant Ellis', role: 'Gauntlet EP' },
    { name: 'Jules Hartley', role: 'Rewrite Partner' },
    { name: 'Reid Callum', role: 'Marketing' },
    { name: 'Yuki Mendel', role: 'Brand Designer' },
  ],
  occasional: [
    { name: 'Rowan Tate', role: 'Quant Strategist' },
    { name: 'Matthew Vance', role: 'Dose Medical Lead' },
    { name: 'Dr. Claire', role: 'Family Doctor, The Dose' },
    { name: 'Arun', role: 'Nurse, The Dose' },
    { name: 'Eli', role: 'Fact-Checker, The Dose' },
    { name: 'Sasha Park', role: 'Business Desk' },
    { name: 'Mateo Rivera', role: 'All-Hands Coordinator' },
    { name: 'Mei Sato', role: 'Tech-Utility' },
    { name: 'Bea Vega', role: 'ETL Newswire' },
    { name: 'The Professor', role: 'Greylander Press' },
    { name: 'Pri Nanduri', role: 'OPSEC Gauntlet' },
    { name: 'Nadia Hassan', role: 'Nutritionist, The Dose' },
    { name: 'Silas Hill', role: 'The Forager' },
    { name: 'Amara Nwosu', role: 'The Herbalist' },
    { name: 'Reece Ashford', role: 'PT Intern' },
    { name: 'Wyatt Cooper', role: 'The Mixologist' },
    { name: 'Devon Sloane', role: 'Judge Media & Entertainment, The Gauntlet' },
    { name: 'Maeve MJ Johnson', role: 'Gardener, The Dose' },
    { name: 'Grey', role: 'Greylander Press' },
    { name: 'Jaque', role: 'Meditation Teacher' },
    { name: 'Dr. Henry', role: 'Pharmacist, The Dose' },
  ],
  judges: [
    { name: 'Selene Voss', role: 'Judge AI & Tech, The Gauntlet' },
    { name: 'Astrid Lund', role: 'Judge Law & IP, The Gauntlet' },
    { name: 'Osei Mensah', role: 'Judge Science, The Gauntlet' },
    { name: 'Cassidy Mercer', role: 'Judge Behavioral Science, The Gauntlet' },
    { name: 'Marcus Holt', role: 'Judge Crypto & PE, The Gauntlet' },
    { name: 'Priya Anand', role: 'Judge Health, The Gauntlet' },
    { name: 'Raymond Chen', role: 'Judge Business, The Gauntlet' },
  ],
};

function lookupRole(name) {
  var all = CAST_POOL.primary.concat(CAST_POOL.regular, CAST_POOL.occasional, CAST_POOL.judges);
  var found = all.filter(function(a) { return a.name.toLowerCase() === name.toLowerCase(); })[0];
  return found ? found.role : '';
}

function fmtTs(ts) {
  var d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var hh = d.getHours() % 12 || 12;
  var mm = d.getMinutes();
  return hh + ':' + String(mm).padStart(2, '0') + ' ' + (d.getHours() >= 12 ? 'PM' : 'AM') + ' ET';
}

function etNow() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return { h: et.getHours(), m: et.getMinutes() };
}

function pickSpacing(h) {
  if (h >= 7 && h < 18) return Math.floor(5000 + Math.random() * 3001);    // 5-8 s (active)
  if (h >= 18 && h < 21) return Math.floor(20000 + Math.random() * 10001); // 20-30 s (evening)
  if (h >= 21) return Math.floor(45000 + Math.random() * 15001);            // 45-60 s (late)
  return Math.floor(120000 + Math.random() * 60001);                         // 2-3 min (overnight)
}

exports.handler = async (event) => {
  const manual = event.httpMethod === 'GET';
  if (event.httpMethod && event.httpMethod !== 'GET') return { statusCode: 405, body: 'method not allowed' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[etl-banter-cron] ANTHROPIC_API_KEY not set'); return { statusCode: 500, body: 'no key' }; }

  if (event.httpMethod) { try { connectLambda(event); } catch (_) {} }
  const store = getStore('etl_banter');

  const now = Date.now();
  const { h } = etNow();

  let msgs = [];
  try {
    const cached = await store.get('messages', { type: 'json' });
    if (Array.isArray(cached)) msgs = cached;
  } catch (_) {}

  // Only generate a new scene when the future queue is running low
  var futureCount = msgs.filter(function(m) { return (m.ts || 0) > now; }).length;
  if (futureCount >= 10 && !manual) {
    return { statusCode: 200, body: 'queue ok (' + futureCount + ' future)' };
  }

  const irisAway = irisAwayThisWeek();

  // Last 12 revealed messages as anti-repetition context
  var recentLines = msgs
    .filter(function(m) { return (m.ts || 0) <= now; })
    .slice(0, 12)
    .map(function(m) { return (m.agent || '') + ': ' + (m.message || ''); })
    .join('\n');

  var daypart = (h >= 7 && h < 18) ? 'active' : (h >= 18 && h < 21) ? 'winddown' : 'night';
  var focus = pickFocus(h);
  var etTimeStr = fmtTs(now);

  // ~1 in 8 blocks: include a Dr. O note
  var drONote = null;
  if (Math.random() < 0.125) {
    var notes = loadDrONotes();
    drONote = notes[Math.floor(Math.random() * notes.length)];
  }

  var lineCount = 25 + Math.floor(Math.random() * 16); // 25-40 lines per scene

  var promptParts = 'Write ' + lineCount + ' lines of #agency-floor chat for right now.\n\n'
    + 'Time: ' + etTimeStr + ' (' + daypart + ').\n'
    + '- active  : busy morning-to-evening energy, overlapping threads, fast replies\n'
    + '- winddown: calmer, fewer people, end-of-day\n'
    + '- night   : sparse, a couple of night-owls, quiet\n\n'
    + 'Center this batch loosely on: ' + focus + '\n\n'
    + 'Do not repeat or closely echo these recent lines:\n'
    + (recentLines || '(none yet)') + '\n\n'
    + (irisAway ? 'Iris is away this week, skip her.\n\n' : '')
    + (drONote ? 'Include Dr. O as one speaker. Her line: "' + drONote + '"\n\n' : '')
    + 'Return ' + lineCount + ' lines, format  Name: message  only. Build 2 to 4 short connected\n'
    + 'exchanges where people reply to each other, then move on. Keep it PG, no em dashes.';

  const client = new Anthropic({ apiKey });

  let raw;
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: 'user', content: promptParts }],
    });
    raw = (resp.content || []).filter(function(b) { return b && b.type === 'text'; }).map(function(b) { return b.text; }).join('').trim();
  } catch (err) {
    console.error('[etl-banter-cron] Haiku call failed:', err && err.message);
    return { statusCode: 200, body: 'haiku error' };
  }

  // Parse "Name: text" lines
  var lines = raw.split('\n')
    .map(function(l) { return l.trim(); })
    .filter(Boolean)
    .map(function(line) {
      var colon = line.indexOf(':');
      if (colon === -1) return null;
      var agentName = line.slice(0, colon).trim().replace(/^["*_`\d.\s]+|["*_`]+$/g, '').trim();
      var message = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
      if (!agentName || !message) return null;
      return { agent: agentName, message: message };
    })
    .filter(Boolean);

  if (lines.length === 0) {
    console.error('[etl-banter-cron] parse failed:', raw.slice(0, 200));
    return { statusCode: 200, body: 'parse failed' };
  }

  // Chain ts from end of existing queue (no gap, no overlap)
  var lastQueuedTs = msgs.reduce(function(max, m) { return Math.max(max, m.ts || 0); }, 0);
  var chainTs = lastQueuedTs > now ? lastQueuedTs : now;

  var newMsgs = lines.map(function(line) {
    chainTs += pickSpacing(h);
    var role = lookupRole(line.agent);
    return { agent: line.agent, role: role, message: line.message, time: fmtTs(chainTs), ts: chainTs };
  });

  // Keep 1 hour of past messages + all future messages
  var oneHourAgo = now - 60 * 60 * 1000;
  msgs = msgs.filter(function(m) { return (m.ts || 0) > oneHourAgo; });
  msgs = msgs.concat(newMsgs);
  msgs.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); }); // newest-first
  if (msgs.length > 120) msgs = msgs.slice(0, 120);

  try {
    await store.setJSON('messages', msgs);
  } catch (err) {
    console.error('[etl-banter-cron] blob write failed:', err && err.message);
    return { statusCode: 500, body: 'blob write failed' };
  }

  var queueEnd = new Date(chainTs).toISOString();
  console.log('[etl-banter-cron] generated', newMsgs.length, 'lines, queue through', queueEnd);
  if (manual) return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: true, count: newMsgs.length, queueThrough: queueEnd, sample: newMsgs.slice(0, 3) }),
  };
  return { statusCode: 200, body: 'ok: ' + newMsgs.length + ' lines, queue through ' + queueEnd };
};
