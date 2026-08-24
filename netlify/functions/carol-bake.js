/* carol-bake — Carol's Corner bake of the day, with the recipe on demand.

   Terry's idea, 2026-07-02: "When Carol has a new baked goods she made,
   lets have a 'get the recipe' pill users can click on." Down the road this
   surface is the teaming point for a baked-goods recipe influencer.

   GET /.netlify/functions/carol-bake
   Returns: { dateKey, bake, recipe }

   The bake rotates deterministically by day (ET). The recipe generates once
   per day (Haiku) and caches in Netlify Blobs ("carol_bakes"), so every
   visitor sees the same bake Carol actually made today. Zero per-visitor cost
   after the first fetch of the day.
*/

const Anthropic = require('@anthropic-ai/sdk').default;
const { houseTypography } = require('./_etl-voice-law.js');
const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

const BAKES = [
  'brown butter banana bread',
  'lemon poppyseed loaf',
  'cinnamon swirl coffee cake',
  'peach cobbler bars',
  'oatmeal cranberry cookies',
  'honey cornbread muffins',
  'apple hand pies',
  'zucchini bread with walnuts',
  'snickerdoodles',
  'pumpkin chocolate chip loaf',
  'buttermilk biscuits with strawberry jam',
  'blueberry crumb cake',
  'gingerbread squares',
  'key lime bars',
];

function todayET() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const start = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now - start) / 86400000);
  const dateKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  return { dateKey, bake: BAKES[doy % BAKES.length] };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed' });

  const { dateKey, bake } = todayET();

  let store = null;
  try { connectLambda(event); store = getStore('carol_bakes'); } catch (_) {}

  if (store) {
    try {
      const cached = await store.get(dateKey, { type: 'json' });
      if (cached && cached.recipe) return json(200, cached);
    } catch (_) {}
  }

  const apiKey = process.env.FOUNDER_STUDIO_API_KEY;
  if (!apiKey) return json(500, { error: 'config' });

  const prompt = `You are Carol Haynes, the front desk of ETL Deskworks in Dayton, Ohio. Recruiter-warm, brisk, a proud home baker; the whole staff eats whatever you bring in. Write today's recipe card for your ${bake}.

Format exactly:
${bake.toUpperCase()}
One warm sentence from you about this bake (why you made it, or who grabbed the first piece this morning). If you name a coworker, use real ETL staff only (Auggie, Leo, Alicia, Iris, Bea, Sasha, Jen, Yuki) or keep it anonymous ("the interns"); never invent named staff.

INGREDIENTS
- each item on its own line with a real home-kitchen amount (8 to 12 lines)

METHOD
1. numbered steps, short and confident (5 to 8 steps, real temperatures and times)

One closing line, Carol-style, like you are handing them the plate.

Rules: plain text only, no markdown beyond the dashes and numbers shown, no em dashes (use commas or periods), contractions are mandatory, amounts and temperatures must be realistic.`;

  let recipe;
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });
    recipe = houseTypography((msg.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim());
  } catch (err) {
    console.error('[carol-bake] generation failed', err && err.message);
    return json(502, { error: 'oven_trouble' });
  }

  const payload = { dateKey, bake, recipe };
  if (store) {
    try { await store.setJSON(dateKey, payload); } catch (_) {}
  }
  return json(200, payload);
};
