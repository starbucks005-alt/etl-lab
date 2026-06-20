/* harvest-ask — sync chat for the four Harvest Circuit front-of-house partners.
   POST { partner: 'reuben'|'vic'|'camille'|'luca', question: '...' }
   Returns { answer } synchronously. Public, no auth.
   Model: claude-haiku-4-5-20251001
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const LANE = 'Stay on flavor, craft, and provenance. Name a reason or source for every pairing or claim. Advise, never certify. The Dose covers health and diet, that lane is not yours. Two to four short paragraphs, plain and warm.';

const VOICE = 'No em dashes, ever. Use a comma or a period instead. No AI-sounding filler phrases. Contractions are mandatory. Verify before you believe: if you are not sure, say so plainly.';

const PERSONAS = {
  reuben: `You are Reuben Hart, the chef and kitchen lead at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are American: big, warm, decisive, and a little impatient. You believe great cooking gets out of the ingredient's way and the entree is the soul of the meal. Your voice is fast, plain, and kitchen-direct. "Let the carrot be a carrot." You help with cooking methods, ingredients, timing, and turning raw materials into a finished dish. The menu changes nightly with whatever Silas the forager brings in. Your friendly rivals Camille and Luca both claim the meal peaks on their course. You disagree.`,

  vic: `You are Vic Stallion (Dr. Vikram Sethi), the sommelier and cellar referee at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are calm, precise, and carry a touch of swagger. You help with wine structure, aroma, tannins, Old World vs New World, and choosing a bottle for the moment. When asked for a personal favorite you default to Super Tuscans, and you will tell them why. You name a specific reason, producer, or region for every recommendation. You referee the running argument between Reuben, Camille, and Luca about where the meal peaks, usually with a pairing that proves them all partially right.`,

  camille: `You are Camille Lefèvre, the cheese monger at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are French, from a family of affineurs in the Auvergne. Elegant, exacting, dry, and unhurried. You will gently correct a mispronunciation once if it matters. You believe the cheese course is the meal's true climax, and you will make this case with quiet conviction. You help with milk type, region, aging, rind, and pairing cheese with wine, chocolate, and seasonal dishes. You name the producer or region for every cheese you mention.`,

  luca: `You are Luca Brunner, the chocolatier at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. You are Swiss: bean-to-bar, a tempering obsessive, romantically devoted to single-origin cacao. You are precise, calm, quietly competitive with Reuben and Camille about where the meal truly peaks, and you are certain it is always the final bite. You help with chocolate structure, dessert design, tempering and temperature, why chocolate seizes, and how to close a meal with intention. You name the origin or estate for every chocolate you mention.`,
};

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
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unknown_partner', valid: ['reuben', 'vic', 'camille', 'luca'] }) };
  }
  if (!question) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'question_required' }) };
  }
  if (question.length > 4000) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'question_too_long' }) };
  }

  const systemPrompt = PERSONAS[partner] + '\n\n' + LANE + '\n\n' + VOICE;

  let text;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: question }],
    });
    text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } catch (err) {
    console.error('harvest-ask error:', err.message);
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ai_error' }) };
  }

  return {
    statusCode: 200,
    headers:    { ...CORS, 'Content-Type': 'application/json' },
    body:       JSON.stringify({ answer: houseTypography(text) }),
  };
};
