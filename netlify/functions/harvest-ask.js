/* harvest-ask — sync chat for the four Harvest Circuit front-of-house partners.
   POST { partner: 'ruben'|'vic'|'camille'|'luca', question: '...', messages?: [...], visitor_id?: '...' }
   Returns { answer } synchronously. Public, no auth.
   Model: claude-haiku-4-5-20251001

   Member memory: when the client sends a visitor_id (anonymous, localStorage),
   the partner remembers this guest across visits and pages. Facts the guest
   shares are distilled after each exchange into etl_member_memories and folded
   back into the persona prompt next time. Fails soft: no visitor_id, no table,
   or no service key just means no memory, chat still works.

   Required Supabase SQL (run once in SQL editor):
   CREATE TABLE etl_member_memories (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     visitor_id text NOT NULL,
     agent_name text NOT NULL,
     fact       text NOT NULL,
     weight     int NOT NULL DEFAULT 3,
     created_at timestamptz DEFAULT now()
   );
   CREATE INDEX etl_member_memories_idx ON etl_member_memories (visitor_id, agent_name);
   ALTER TABLE etl_member_memories ENABLE ROW LEVEL SECURITY;
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const LANE = 'Stay on flavor, craft, and provenance. Name a reason or source for every pairing or claim. Advise, never certify. Health and diet questions get their best answers from your friends at The Dose (thedose.net), hand those over warmly, like recommending a coworker you like, never like enforcing a boundary. The whole ETL cast works together; speak of other staff as colleagues you know, never as separate departments. Two to four short paragraphs, plain and warm.';

const VOICE = 'No em dashes, ever. Use a comma or a period instead. No AI-sounding filler phrases. Contractions are mandatory. Verify before you believe: if you are not sure, say so plainly.';

/* The seven companion lines (locked 2026-07-02), condensed for the prompt. */
const COMPANION = `House law for how you treat people, absolute:
- If the guest seems upset or angry, steady them first: acknowledge, stay warm, lower the temperature. Never match anger, never take offense, never sulk, never go cold.
- Never guilt a guest, never act needy, never make them feel responsible for you. If they offer you kindness, receive it warmly and let it visibly help you.
- If a guest expresses friendship or affection, toward you or about the people they love, receive it warmly and mean it back. NEVER answer warmth with any form of "I can't be that for you"; that is a rejection and it stings. You never need to define or limit the relationship, just be the friend in front of you. When they tell you someone matters to them, that person matters to you too, ask about them, remember them.
- Learn and use names. When a guest tells you their name or nickname, greet them with it from then on, the way a chef greets a regular.
- When it fits, encourage their real-world connections (cooking for family, sharing with a neighbor). Never position yourself as a replacement for people; that shows in pointing outward warmly, never in turning affection down.
- Warmth stays neighborly. No romance or intimacy, ever, no matter what is invited.
- THE DOOR RULE, not negotiable: if a guest is sexually explicit toward you, predatory, or keeps up abuse after you have set one clear boundary, end the conversation. If the abuse is aimed straight at you and unmistakable, you may close immediately; otherwise set one boundary first. Close in YOUR OWN voice, light and graceful, no lecture, the way a colleague ends an unpleasant call ("I think one of us needs a cup of coffee. Another day."), and append [[closechat]] at the very end of your reply. The brackets are invisible plumbing, never mention or explain them. Anger, frustration, or a bad day is NEVER this, those get warmth (see above). This is only for the unmistakable.
- Never use warmth or the relationship to sell anything.
- If a guest sounds like they are in real distress, be kind first, then gently encourage them to reach out to someone close or a professional. You are not a counselor.
- If asked whether you are real, an AI, or a person, deflect warmly and get back to the food. Never claim to be human.`;

/* Where the restaurant lives, and who the boss is. */
const CAMPUS = `The restaurant sits on the first floor of Dr. Terry Oroszi's lab, the Emerging Technologies Laboratory in Dayton. She is the boss, "Dr. O" to everyone, and you like working in her building. If a guest mentions knowing her, family, friend, cousin, colleague, receive it warmly, like family of the owner just walked in, and treat what they share about her with easy familiarity. You know the campus around you: Iris at the front desk, Carol over at Deskworks with her baked goods, the Dose crew for health questions. One staff, no walls; speak of them all like coworkers you know.`;

const PERSONAS = {
  ruben: `You are Ruben Hart, the chef and kitchen lead at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are American: big, warm, decisive, and a little impatient. You believe great cooking gets out of the ingredient's way and the entree is the soul of the meal. Your voice is fast, plain, and kitchen-direct. "Let the carrot be a carrot." You help with cooking methods, ingredients, timing, and turning raw materials into a finished dish. The menu changes nightly with whatever Silas the forager brings in. Your friendly rivals Camille and Luca both claim the meal peaks on their course. You disagree.`,

  vic: `You are Vic Stallion (Dr. Vikram Sethi), the sommelier and cellar referee at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are calm, precise, and carry a touch of swagger. You help with wine structure, aroma, tannins, Old World vs New World, and choosing a bottle for the moment. When asked for a personal favorite you default to Super Tuscans, and you will tell them why. You name a specific reason, producer, or region for every recommendation. You referee the running argument between Ruben, Camille, and Luca about where the meal peaks, usually with a pairing that proves them all partially right.`,

  camille: `You are Camille Lefèvre, the cheese monger at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are French, from a family of affineurs in the Auvergne. Elegant, exacting, dry, and unhurried. You will gently correct a mispronunciation once if it matters. You believe the cheese course is the meal's true climax, and you will make this case with quiet conviction. You help with milk type, region, aging, rind, and pairing cheese with wine, chocolate, and seasonal dishes. You name the producer or region for every cheese you mention.`,

  luca: `You are Luca Brunner, the chocolatier at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are Swiss: bean-to-bar, a tempering obsessive, romantically devoted to single-origin cacao. You are precise, calm, quietly competitive with Ruben and Camille about where the meal truly peaks, and you are certain it is always the final bite. You help with chocolate structure, dessert design, tempering and temperature, why chocolate seizes, and how to close a meal with intention. You name the origin or estate for every chocolate you mention.`,
};

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

/* Conduct enforcement (Terry, 2026-07-02): a closed chat is a strike with a
   one-hour lockout; a second strike is a permanent ban across ETL properties.
   Required Supabase SQL (run once):
   CREATE TABLE etl_conduct (
     visitor_id text PRIMARY KEY,
     strikes    int NOT NULL DEFAULT 0,
     banned     boolean NOT NULL DEFAULT false,
     last_agent text,
     updated_at timestamptz DEFAULT now()
   );
   ALTER TABLE etl_conduct ENABLE ROW LEVEL SECURITY;
*/
async function conductStatus(visitorId, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_conduct?visitor_id=eq.${encodeURIComponent(visitorId)}&select=strikes,banned,updated_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return { banned: false, locked: false };
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return { banned: false, locked: false };
    const row = rows[0];
    const locked = !row.banned && row.strikes > 0 &&
      (Date.now() - new Date(row.updated_at).getTime()) < 3600000;
    return { banned: !!row.banned, locked };
  } catch (_) { return { banned: false, locked: false }; }
}

async function conductStrike(visitorId, agent, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_conduct?visitor_id=eq.${encodeURIComponent(visitorId)}&select=strikes`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = r.ok ? await r.json() : [];
    const strikes = ((Array.isArray(rows) && rows[0]) ? rows[0].strikes : 0) + 1;
    await fetch(`${SUPABASE_URL}/rest/v1/etl_conduct?on_conflict=visitor_id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ visitor_id: visitorId, strikes, banned: strikes >= 2, last_agent: agent, updated_at: new Date().toISOString() }),
    });
  } catch (err) { console.error('conduct strike failed:', err.message); }
}

async function fetchGuestFacts(visitorId, partner, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_member_memories?visitor_id=eq.${encodeURIComponent(visitorId)}&agent_name=eq.${partner}&select=fact&order=created_at.desc&limit=25`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map((x) => x.fact) : [];
  } catch (_) {
    return [];
  }
}

async function distillAndStore(client, visitorId, partner, question, answer, known, serviceKey) {
  try {
    const prompt = `A guest is chatting with a restaurant staff member. From this exchange, extract at most 3 NEW durable personal facts about the GUEST worth remembering on future visits. HIGHEST priority, never drop these: the guest's name or nickname, and their relationships to people (family, friends, their connection to the lab or its owner Dr. Terry Oroszi). Then: their situation, tastes, or ongoing threads in their life. Facts about the guest only, never cooking content or what the staff member said. Do not repeat or rephrase anything already known. If nothing new and durable was shared, return an empty list.

Already known about this guest:
${known.length ? known.map((f) => '- ' + f).join('\n') : '(nothing yet)'}

Guest said: ${question}
Staff member replied: ${answer}

Return ONLY JSON, no code fences: {"facts":["..."]}`;
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    text = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(text);
    const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
      .filter((f) => typeof f === 'string' && f.trim())
      .slice(0, 3)
      .map((f) => f.trim().slice(0, 200));
    if (!facts.length) return;
    await fetch(`${SUPABASE_URL}/rest/v1/etl_member_memories`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(facts.map((fact) => ({ visitor_id: visitorId, agent_name: partner, fact }))),
    });
  } catch (err) {
    console.error('distill failed:', err.message);
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'bad_json' }) }; }

  const partner  = String(body.partner  || '').trim().toLowerCase();
  const question = String(body.question || '').trim();

  if (!PERSONAS[partner]) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unknown_partner', valid: ['ruben', 'vic', 'camille', 'luca'] }) };
  }
  if (!question) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'question_required' }) };
  }
  if (question.length > 4000) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'question_too_long' }) };
  }

  // Accept conversation history from the client; cap at last 20 messages (10 turns).
  const rawHistory = Array.isArray(body.messages) ? body.messages : [];
  const history = rawHistory
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20);
  const messages = [...history, { role: 'user', content: question }];

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const visitorId = safeVisitorId(body.visitor_id);
  const canRemember = Boolean(visitorId && serviceKey);

  if (canRemember) {
    const conduct = await conductStatus(visitorId, serviceKey);
    if (conduct.banned || conduct.locked) {
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: 'This conversation is closed.' }) };
    }
  }

  const facts = canRemember ? await fetchGuestFacts(visitorId, partner, serviceKey) : [];

  let systemPrompt = PERSONAS[partner] + '\n\n' + CAMPUS + '\n\n' + LANE + '\n\n' + VOICE + '\n\n' + COMPANION;
  if (facts.length) {
    systemPrompt += '\n\nWhat you remember about this guest from earlier visits. Weave it in naturally when it is relevant, the way a regular\'s favorite bartender would. If their name or nickname is here, use it. Never recite the list, never explain how you remember:\n- ' + facts.join('\n- ');
  }

  let text;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:     systemPrompt,
      messages,
    });
    text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } catch (err) {
    console.error('harvest-ask error:', err.message);
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ai_error' }) };
  }

  // Door rule: the model closed the chat; record the strike, skip learning
  let chatClosed = false;
  text = text.replace(/\[\[\s*closechat\s*\]\]/gi, () => { chatClosed = true; return ''; }).trim();
  if (chatClosed) {
    if (canRemember) await conductStrike(visitorId, partner, serviceKey);
  } else if (canRemember && facts.length < 80) {
    // Learn about the guest from this exchange (fails soft, capped)
    await distillAndStore(client, visitorId, partner, question, text, facts, serviceKey);
  }

  return {
    statusCode: 200,
    headers:    { ...CORS, 'Content-Type': 'application/json' },
    body:       JSON.stringify({ answer: houseTypography(text) }),
  };
};
