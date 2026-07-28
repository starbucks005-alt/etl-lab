/* harvest-ask — sync chat for the four Harvest Circuit front-of-house partners.
   POST { partner: 'ruben'|'vic'|'camille'|'luca', question: '...', messages?: [...], visitor_id?: '...', visitor_pronoun?: 'he'|'she'|'they',
          images?: [{ media_type: 'image/jpeg', data: '<base64>' }] }
   Returns { answer } synchronously. Public, no auth.
   Model: claude-haiku-4-5-20251001 for text turns.

   Wine list photos (Vic only): a guest can upload a photo of a restaurant wine
   list and say what they are eating; Vic reads the list and recommends from what
   is actually on it. Image turns route to Sonnet 5 instead of Haiku, because
   Haiku caps images at 1568px on the long edge and a wine list is dense small
   print where that ceiling costs real accuracy. Text turns are untouched, so the
   ambient cost of the room does not move.

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

/* Vic only, and only when a photo is attached. Read the list, never invent a bottle. */
const WINE_LIST = `The guest has sent you a photo of a wine list, probably taken at a restaurant table, probably in bad light. Read it and work only from what is actually printed on it.

- Recommend ONLY bottles or glasses that appear on this list. Never suggest something that is not on it, no matter how well it would pair. If nothing on the list fits well, say so and pick the closest thing that is there.
- Ask yourself what they are eating. If they told you, pair to it. If they did not, ask once, briefly, then give a safe pick that works across a table in the meantime.
- Give two picks, each with one short reason tied to the food, then one cheaper option that still works. Cover by the glass if the list has one.
- Keep it tight. The guest is holding a phone at a table with the server waiting. Around 150 words. No preamble about the photo, no notes about how you are reading it, just the picks and why.
- Before you say any wine's price or vintage, find that wine's own line and read the number printed on it. Say only numbers you have actually read there. If a number is not legible, name the wine and leave the number out.
- If a section of the photo is too blurry, cropped, or dark to read, say which part you cannot read and ask for another shot of it. Never guess at a producer, vintage, or price you cannot actually see. Verify before you believe, on a wine list too.
- If the photo is not a wine list at all, say so plainly and warmly, and ask for the right one.`;

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

const PRONOUN_LINES = {
  he: 'he/him',
  she: 'she/her',
  they: 'they/them',
};

function safePronoun(v) {
  const s = String(v || '').trim().toLowerCase();
  return PRONOUN_LINES[s] ? s : null;
}

/* Image intake. The client already downscales to ~1600px / JPEG, so anything
   arriving much larger than that is either a bug or somebody probing us. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 3;
const MAX_IMAGE_CHARS = 1800000;   // base64 chars, about 1.3 MB per photo
const MAX_IMAGE_TOTAL = 4000000;   // Netlify caps the request body at 6 MB

function safeImages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let total = 0;
  for (const item of raw.slice(0, MAX_IMAGES)) {
    if (!item || typeof item !== 'object') continue;
    const mediaType = String(item.media_type || '').trim().toLowerCase();
    const data = String(item.data || '').trim();
    if (!IMAGE_TYPES.includes(mediaType)) continue;
    if (!data || data.length > MAX_IMAGE_CHARS) continue;
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) continue;
    total += data.length;
    if (total > MAX_IMAGE_TOTAL) break;
    out.push({ media_type: mediaType, data: data.replace(/[\r\n]/g, '') });
  }
  return out;
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
  // History is always plain text: the client stores a placeholder for photo turns
  // rather than carrying image data around in localStorage.
  const rawHistory = Array.isArray(body.messages) ? body.messages : [];
  const history = rawHistory
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20);

  // Photos are Vic's cellar trick only. Everyone else ignores them.
  const images = partner === 'vic' ? safeImages(body.images) : [];

  // A photo was sent and none of it survived validation. Say so in Vic's voice
  // rather than quietly answering as though no photo had been attached.
  if (partner === 'vic' && Array.isArray(body.images) && body.images.length && !images.length) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: houseTypography("That photo did not come through on my end, so I am not going to guess at a list I cannot see. Send it again, a JPEG or PNG, and get the whole page in frame if you can. I will read it properly then."),
      }),
    };
  }
  const userContent = images.length
    ? [
        ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
        { type: 'text', text: question },
      ]
    : question;
  const messages = [...history, { role: 'user', content: userContent }];

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const visitorId = safeVisitorId(body.visitor_id);
  const pronoun = safePronoun(body.visitor_pronoun);
  const canRemember = Boolean(visitorId && serviceKey);

  if (canRemember) {
    const conduct = await conductStatus(visitorId, serviceKey);
    if (conduct.banned || conduct.locked) {
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: 'This conversation is closed.' }) };
    }
  }

  const facts = canRemember ? await fetchGuestFacts(visitorId, partner, serviceKey) : [];

  let systemPrompt = PERSONAS[partner] + '\n\n' + CAMPUS + '\n\n' + LANE + '\n\n' + VOICE + '\n\n' + COMPANION;
  if (images.length) {
    systemPrompt += '\n\n' + WINE_LIST;
  }
  if (pronoun) {
    systemPrompt += `\n\nThis guest goes by ${PRONOUN_LINES[pronoun]}. You're not going to say that to their face, it would be strange, this only matters if you ever refer to them in the third person, mentioning them to another staff member later, a passing aside, that kind of thing. Use it naturally then, never make a point of it, never ask, never comment on it either way.`;
  }
  if (facts.length) {
    systemPrompt += '\n\nWhat you remember about this guest from earlier visits. Weave it in naturally when it is relevant, the way a regular\'s favorite bartender would. If their name or nickname is here, use it. Never recite the list, never explain how you remember:\n- ' + facts.join('\n- ');
  }

  let text;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    // Text turns stay on Haiku. Photo turns go to Sonnet 5 for the high-resolution
    // vision, and turn thinking off (it is on by default there) so the whole token
    // budget goes to the answer instead of being eaten before Vic starts talking.
    const request = images.length
      ? {
          model:      'claude-sonnet-5',
          max_tokens: 1000,
          thinking:   { type: 'disabled' },
          system:     systemPrompt,
          messages,
        }
      : {
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system:     systemPrompt,
          messages,
        };
    const msg = await client.messages.create(request);
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
