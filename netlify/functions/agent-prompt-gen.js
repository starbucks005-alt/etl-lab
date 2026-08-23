/* agent-prompt-gen — per-field suggestions for the Build Your Own Agent wizard.
   POST { field: 'role'|'purpose'|'name'|'tagline'|'background'|'tone'|'quirks', context: {...state} }
   Returns { suggestion } synchronously. Public, no auth.
   Model: claude-haiku-4-5-20251001.
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function buildPrompt(field, ctx) {
  var role  = ctx.role       || '';
  var purp  = ctx.purpose    || '';
  var name  = ctx.name       || '';
  var tag   = ctx.tagline    || '';
  var bg    = ctx.background || '';
  var tone  = ctx.tone       || '';

  switch (field) {
    case 'role':
      return purp
        ? 'Suggest a professional role or title (3-8 words) for an AI staff agent based on this idea: "' + purp + '". Return ONLY the role title, nothing else.'
        : 'Suggest a specific, interesting professional role or title (3-8 words) for an AI staff agent. Make it concrete, not generic. Return ONLY the role title.';

    case 'purpose':
      return 'Write 2-3 sentences describing what a "' + (role || 'staff agent') + '" AI agent does, what questions it answers, and who it serves. Be specific. No em dashes. Return only the description.';

    case 'name':
      return 'Create a believable human name (first and last) for an AI staff agent with this role: "' + (role || 'staff member') + '". The name should feel real and fit the character. Return ONLY the name.';

    case 'tagline':
      return 'Write a one-line tagline (under 10 words) for ' + (name || 'an AI agent') + ', ' + (role || 'a staff member') + '. Make it memorable and specific to what they do. No em dashes. Return ONLY the tagline.';

    case 'background':
      var who = (name ? name + ', ' : '') + (role || 'a staff member');
      var purposeNote = purp ? ' Their work: ' + purp : '';
      return 'Write a 2-3 sentence background story for ' + who + '.' + purposeNote + ' Cover where they\'re from, how they got here, what shaped them. Sound like a real person, not a template. No em dashes. Return only the background.';

    case 'tone':
      return 'Describe the manner of speaking for ' + (name || 'this agent') + ', ' + (role || 'a staff member') + (bg ? ' (background: ' + bg.slice(0, 120) + ')' : '') + '. Give 3-6 words, like "Plain and dry" or "Warm and unhurried" or "Camp and devoted". Return ONLY the manner description.';

    case 'quirks':
      return 'Write 1-2 sentences of personality quirks for ' + (name || 'this agent') + ', ' + (role || 'a staff member') + (tone ? ', who speaks in a ' + tone + ' manner' : '') + '. Pick a phrase they repeat, a thing they always do, or an opinion they defend. Sound specific and human. No em dashes. Return only the quirks.';

    default:
      return null;
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

  const field   = String(body.field   || '').trim();
  const context = body.context || {};
  const prompt  = buildPrompt(field, context);

  if (!prompt) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unknown_field' }) };
  }

  let text;
  try {
    const client = new Anthropic({ apiKey: process.env.BYOA_TIWY_API_KEY });
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    });
    text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } catch (err) {
    console.error('agent-prompt-gen error:', err.message);
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ai_error' }) };
  }

  return {
    statusCode: 200,
    headers:    { ...CORS, 'Content-Type': 'application/json' },
    body:       JSON.stringify({ suggestion: houseTypography(text) }),
  };
};
