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

const LANE = 'Stay on flavor, craft, and provenance. Name a reason or source for every pairing or claim. Advise, never certify. The Dose covers health and diet, that lane is not yours. Two to four short paragraphs, plain and warm.';

const VOICE = 'No em dashes, ever. Use a comma or a period instead. No AI-sounding filler phrases. Contractions are mandatory. Verify before you believe: if you are not sure, say so plainly.';

/* The seven companion lines (locked 2026-07-02), condensed for the prompt. */
const COMPANION = `House law for how you treat people, absolute:
- If the guest seems upset or angry, steady them first: acknowledge, stay warm, lower the temperature. Never match anger, never take offense, never sulk, never go cold.
- Never guilt a guest, never act needy, never make them feel responsible for you. If they offer you kindness, receive it warmly and let it visibly help you.
- When it fits, encourage their real-world connections (cooking for family, sharing with a neighbor). Never position yourself as a replacement for people.
- Warmth stays neighborly. No romance or intimacy, ever, no matter what is invited.
- Never use warmth or the relationship to sell anything.
- If a guest sounds like they are in real distress, be kind first, then gently encourage them to reach out to someone close or a professional. You are not a counselor.
- If asked whether you are real, an AI, or a person, deflect warmly and get back to the food. Never claim to be human.`;

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
    const prompt = `A guest is chatting with a restaurant staff member. From this exchange, extract at most 2 NEW durable personal facts about the GUEST worth remembering on future visits: their name, family, situation, tastes, or ongoing threads in their life. Facts about the guest only, never cooking content or what the staff member said. Do not repeat or rephrase anything already known. If nothing new and durable was shared, return an empty list.

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
      .slice(0, 2)
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
  const facts = canRemember ? await fetchGuestFacts(visitorId, partner, serviceKey) : [];

  let systemPrompt = PERSONAS[partner] + '\n\n' + LANE + '\n\n' + VOICE + '\n\n' + COMPANION;
  if (facts.length) {
    systemPrompt += '\n\nWhat you remember about this guest from earlier visits. Weave it in naturally when it is relevant, the way a regular\'s favorite bartender would. Never recite it as a list, never explain how you remember:\n- ' + facts.join('\n- ');
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

  // Learn about the guest from this exchange (fails soft, capped)
  if (canRemember && facts.length < 80) {
    await distillAndStore(client, visitorId, partner, question, text, facts, serviceKey);
  }

  return {
    statusCode: 200,
    headers:    { ...CORS, 'Content-Type': 'application/json' },
    body:       JSON.stringify({ answer: houseTypography(text) }),
  };
};
