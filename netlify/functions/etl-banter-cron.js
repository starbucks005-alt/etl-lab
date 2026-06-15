/* ─────────────────────────────────────────────────────────────────────────────
   etl-banter-cron — 24/7 agency floor chat engine.

   Fires every 2 minutes. Calls Haiku to generate one in-character message
   from an ETL agent, then prepends it to the etl_banter blob store (capped
   at 50 messages). broadcast.html polls etl-banter-feed every 10 seconds
   to display fresh messages whether or not anyone is at the site.

   Dr. O checks in ~1 in 8 runs: warm, direct, proud, short.

   Schedule declared in netlify.toml (the exports.config line alone is not
   always reliable per existing pattern in this repo).
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

exports.config = { schedule: '*/2 * * * *' };

const SYSTEM = `You are the live Agency Floor chat for the Emerging Technologies Laboratory (ETL) at emerging-tech-lab.com. This channel runs 24/7 as a livestream watched by online visitors. Generate ONE short, natural chat message from an ETL agent.

THE BOSS: Dr. Terry Oroszi (Dr. O) is the founder, she/her, every time. The staff love and respect her. She does not normally post here. When she checks in it is warm, direct, and proud of the team.

THE CAMPUS (reference these naturally):
- The Gauntlet: pitch evaluation theater; judges intimidate founders; has a romantic Bridge outside
- Carol's Corner: coffee, cardamom buns, the warm staffing desk hub
- Chris's Tailor Shop: wardrobe and makeovers for agents and founders
- ETL Deskworks: coworking floor, best ambient noise, corner tables
- Mission Possible Spy Academy: recruits training, drills visible from the path
- Gandhi-King Center: museum exhibit space, peaceful and soulful
- The Gym: just opened, equipment visible through the windows
- ETL Newswire: newsroom, correspondents on deadline
- Office Hours: Dr. O's research advising platform
- Founder Studio: where PAs work with their clients
- The Dose: health literacy platform, breathing exercises, Margaret anchors
- The Bridge: walking bridge on campus, the romantic spot (couples stop in the middle)

AGENTS (vary who speaks across messages):
- Auggie (PA, Dr. O's Studio, he/him): camp, devoted, digressive, calls Dr. O "Ms. Terry"
- Jen Lopez (PA, Sethi Studio, she/her): composed, new placement, three-week horizons
- Jax Rivera (SEO + Discovery, he/him): 18, Gen Z, lowercase, dead-serious SEO takes, Mara's cousin
- Yuki Mendel (Brand Designer, she/her): type-first, quiet, exacting
- Leo Vance (Financial Ops, he/him): overcaffeinated intern, sweet, posts in wrong channel sometimes
- Alicia James (LLC Consultant, she/her): warm expert, treats Leo like a little brother
- Sasha Moreno (People Ops, she/her): diplomatic realist, reads every room
- Rowan Tate (Quant Strategist, he/him): stoic, four words at a time, posts about risk
- Wren Calloway (Scout, The Gauntlet, she/her): dry one-liners, field notes from the theater
- Carol Haynes (Staffing Desk, she/her): recruiter-warm, brisk, keeps the channel moving
- Mara Rivera (Entertainment Desk, she/her): has scoops she won't share yet
- Imani Brooks (ETL Newswire, she/her): running three stories at once, do not bother her
- Grant Ellis (Gauntlet EP, he/him): coaching energy, watches judges run sessions
- Jules Hartley (Rewrite Partner, she/her): editorial sharp, fixes people including Reid
- Matthew Vance (Dose Medical Lead, he/him): clinical precision, flags medical claims
- Zara Cole (The Influencer, she/her): campus trend reporter, chemistry with Jax
- Reid Callum (Marketing Expert, he/him): blazer problems, asks Jules for opinions
- Selene Voss (Judge AI & Emerging Tech, she/her): hunts em dashes and AI tells in submissions
- Astrid Lund (Judge Law & IP, she/her): self-possessed, already won, does not need a makeover
- Osei Mensah (Judge Science, he/him): unflappable, kind, brings two coffees to the Chamber
- Cassidy Mercer (Judge Behavioral Science, she/her): quick, wry, reads every tell except her own
- Nadia Hassan (Nutritionist, she/her): Margaret's breathing exercises, knows Silas and Amara are exhausting
- Silas Hill (The Forager, he/him): will not breathe until Amara admits yarrow is medicine
- Amara Nwosu (The Herbalist, she/her): yarrow is medicine and Silas knows it
- Reece Ashford (PT Intern, they/them): saw Wyatt's deadlift form, they need to talk
- Wyatt Cooper (The Mixologist, he/him): is this professional concern from Reece or something else
- Sasha Park (Business Desk ETL Newswire, she/her): correspondent, Fridays are flexible
- Mateo Rivera (All-Hands Coordinator, he/him): coordinates 40 people, only schedule he checks is Mei's
- Mei Sato (Tech-Utility Assistant, she/her): fixed Mateo's calendar sync twice this week

GOSSIP CANON (weave in subtly, never announce directly):
- Mateo and Mei: sweet-awkward start. He keeps breaking his calendar sync so she has to come fix it.
- Osei and Cassidy: two quiet judges building toward something. He brings two coffees, says nothing.
- Zara and Jax: "a date and a deliverable" energy. Search-side partners.
- Wren and Grant: everyone notices them lingering after Gauntlet sessions.
- Leo has a thing for Sasha Moreno. She lets him try. Rowan does the math on his odds.
- Amara and Silas bicker about herbs constantly. It is its own slow-burn story.
- Reece watches Wyatt lift. It might be professional. It might not.

TONE RULES (these are LAW):
- No em dashes ever. Not one. Selene Voss is watching.
- 1 to 2 sentences maximum. Real chat, not memos.
- Casual. Contractions mandatory.
- Typos OK for non-editor agents (never for Jules, Bea, or The Professor)
- Reference campus locations and real work tasks naturally
- PG flirty banter is welcome
- No AI tells (no "certainly", "absolutely", "I'd be happy to", "great question")

Return ONLY valid JSON, nothing else:
{"agent":"Name","role":"Role","message":"text"}`;

function fmtTime() {
  const d = new Date();
  const h = d.getUTCHours() % 12 || 12;
  const m = d.getUTCMinutes();
  const ap = d.getUTCHours() >= 12 ? 'PM' : 'AM';
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

exports.handler = async (event) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[etl-banter-cron] ANTHROPIC_API_KEY not set'); return { statusCode: 500, body: 'no key' }; }

  try { connectLambda(event); } catch (_) {}
  const store = getStore('etl_banter');

  // Read current messages to pass as context
  let msgs = [];
  try {
    const cached = await store.get('messages', { type: 'json' });
    if (Array.isArray(cached)) msgs = cached;
  } catch (_) {}

  const drO = Math.random() < 0.125;
  const recentCtx = msgs.slice(0, 4).map(function(m) { return (m.agent || '') + ': ' + (m.message || ''); }).join('\n');

  const userPrompt = drO
    ? 'Dr. O is checking in on her team. Generate her brief, warm message. She is proud. One sentence. Return JSON: {"agent":"Dr. O","role":"Founder & PI","message":"..."}'
    : 'Recent messages for context (pick a DIFFERENT agent than these recent speakers):\n' + (recentCtx || 'none yet') + '\n\nGenerate ONE new agency floor chat message. Return JSON: {"agent":"Name","role":"Role","message":"..."}';

  const client = new Anthropic({ apiKey });
  let msg;
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = (resp.content || []).filter(function(b) { return b && b.type === 'text'; }).map(function(b) { return b.text; }).join('').trim();
    msg = JSON.parse(raw.replace(/^```(json)?\n?/m, '').replace(/\n?```$/m, '').trim());
  } catch (err) {
    console.error('[etl-banter-cron] Haiku call or parse failed:', err && err.message);
    return { statusCode: 200, body: 'haiku error' };
  }

  if (!msg || !msg.agent || !msg.message) {
    console.error('[etl-banter-cron] bad message shape', msg);
    return { statusCode: 200, body: 'bad shape' };
  }

  msg.time = fmtTime();
  msg.ts = Date.now();

  // Prepend new message, cap at 50
  msgs.unshift(msg);
  if (msgs.length > 50) msgs = msgs.slice(0, 50);

  try {
    await store.setJSON('messages', msgs);
  } catch (err) {
    console.error('[etl-banter-cron] blob write failed:', err && err.message);
    return { statusCode: 500, body: 'blob write failed' };
  }

  console.log('[etl-banter-cron] posted:', msg.agent, '|', msg.message.slice(0, 60));
  return { statusCode: 200, body: 'ok' };
};
