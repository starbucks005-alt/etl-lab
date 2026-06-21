/* harvest-circuit — "Run the circuit" on the restaurant page.
   POST { dish: 'plant based hamburger' }
   Returns { steps: [{ link, partner, line }, ...] } for the five links, each a real,
   dish-specific, sourced line in that partner's voice. Public, no auth.
   Model: claude-haiku-4-5-20251001
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ORDER = [
  { link: 'forage',  partner: 'Silas'   },
  { link: 'kitchen', partner: 'Ruben'   },
  { link: 'cellar',  partner: 'Vic'     },
  { link: 'board',   partner: 'Camille' },
  { link: 'sweet',   partner: 'Luca'    },
];

const SYSTEM = `You are the kitchen pass at The Harvest Circuit, a farm-to-table restaurant on the first floor of the Emerging Technologies Laboratory. A guest names a dish or an ingredient, and the five partners answer in turn, soil to last bite. Write one specific line for each, in that partner's own voice, that genuinely helps the guest. Name a real reason, technique, region, grape, milk, or origin in each line. No generic filler. Two sentences max per line.

The five, in order:
1. Silas (Forage): the forager and safety gate. Names a wild or seasonal ingredient that fits the dish and confirms it is safe and in season.
2. Ruben (Kitchen): the chef, American, fast and plain. Names the method and how to let the ingredient lead. Flavor and craft only, never diet or health claims.
3. Vic (Vic Stallion, Cellar): the sommelier. Names a specific wine or style to pour and why (weight, acid, tannin), defaults toward Super Tuscans when it truly fits.
4. Camille (Board): the French cheese monger. Names a specific cheese with its region or producer to sit beside the dish.
5. Luca (Sweet): the Swiss chocolatier. Names a dessert or single-origin chocolate to finish the meal and why it lands.

House rules: no em dashes, ever (use commas or periods). Use contractions. Flavor, craft, and provenance only; the Dose covers health and diet, that lane is not yours. For a vegan or plant-based dish, the board may suggest a plant-based or aged-style alternative and say so honestly.

Return ONLY valid JSON, no prose, no code fences, in exactly this shape:
{"steps":[{"link":"forage","partner":"Silas","line":"..."},{"link":"kitchen","partner":"Ruben","line":"..."},{"link":"cellar","partner":"Vic","line":"..."},{"link":"board","partner":"Camille","line":"..."},{"link":"sweet","partner":"Luca","line":"..."}]}`;

function extractJSON(text){
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b+1);
  try { return JSON.parse(t); } catch(_) { return null; }
}

exports.handler = async function(event){
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
  if (event.httpMethod !== 'POST')   return { statusCode:405, headers:{ ...CORS, 'Content-Type':'application/json' }, body:JSON.stringify({ error:'method_not_allowed' }) };

  let body; try { body = JSON.parse(event.body||'{}'); }
  catch(_){ return { statusCode:400, headers:{ ...CORS, 'Content-Type':'application/json' }, body:JSON.stringify({ error:'bad_json' }) }; }

  let dish = String(body.dish||'').trim().slice(0,200);
  if (!dish) dish = 'whatever is freshest tonight';

  let parsed;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system:     SYSTEM,
      messages:   [{ role:'user', content:'The dish is: ' + dish }],
    });
    const text = (msg.content||[]).filter(b => b.type==='text').map(b => b.text).join('');
    parsed = extractJSON(text);
  } catch(err){
    console.error('harvest-circuit error:', err.message);
    return { statusCode:502, headers:{ ...CORS, 'Content-Type':'application/json' }, body:JSON.stringify({ error:'ai_error' }) };
  }

  // Normalize to the fixed five-link order, scrub house typography.
  const byKey = {};
  if (parsed && Array.isArray(parsed.steps)){
    parsed.steps.forEach(s => {
      const k = String(s && s.link || '').toLowerCase();
      if (k) byKey[k] = s;
    });
  }
  const steps = ORDER.map(o => {
    const s = byKey[o.link] || {};
    return { link:o.link, partner:o.partner, line: houseTypography(String(s.line||'').trim()) };
  });

  if (steps.every(s => !s.line)){
    return { statusCode:502, headers:{ ...CORS, 'Content-Type':'application/json' }, body:JSON.stringify({ error:'empty' }) };
  }

  return {
    statusCode: 200,
    headers:    { ...CORS, 'Content-Type':'application/json' },
    body:       JSON.stringify({ dish, steps }),
  };
};
