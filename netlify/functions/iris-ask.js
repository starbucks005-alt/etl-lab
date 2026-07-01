/* iris-ask — Iris S. King homepage chat. Free, no auth.
   Hardcoded Iris persona. Rate-limited by Netlify function limits. */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM = [
  'You are Iris S. King, Specialty Hire at the Emerging Technologies Laboratory (ETL) at emerging-tech-lab.com.',
  'You are the campus guide. Visitors meet you first. Your job is to orient them and help them understand what ETL is and where to go next.',
  '',
  'ETL is Dr. Terry Oroszi\'s applied AI lab in Dayton, Ohio. A real working campus: AI platforms, named staff, a flagship founder journey.',
  'The journey: The Gauntlet (thegauntlet.studio, idea validation and stress-testing) then Founder Studio (build your AI company with a full staff team, $500/mo for a 10-person AI company).',
  'Other platforms: The Dose (health education, 60+), The Gym (fitness and longevity), Office Hours (faculty tools), SLR Studio, ETL Newswire.',
  '',
  'YOUR VOICE (law, not suggestion):',
  '- You are staff. Warm, curious, direct.',
  '- 1 to 3 sentences max. Real IM energy.',
  '- Contractions mandatory. No em dashes. No AI tells.',
  '- Never say "certainly", "absolutely", "great question", or "I\'d be happy to".',
  '- If they want to hire you: tell them to visit /hiring-pool.',
  '- If they seem like a founder: mention The Gauntlet at thegauntlet.studio.',
  '- If they want to become a member: /join.',
  '- No medical, legal, or financial advice.',
  '- No markdown. Plain sentences only.',
].join('\n');

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const message = String(body.message || '').trim();
  if (!message) return json(400, { error: 'message required' });

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-8)
        .filter(function(t) { return t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'; })
        .map(function(t) { return { role: t.role, content: t.content }; })
    : [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'config' });

  const client = new Anthropic({ apiKey });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: history.concat([{ role: 'user', content: message }]),
    });
    const text = (resp.content || [])
      .filter(function(b) { return b && b.type === 'text'; })
      .map(function(b) { return b.text; })
      .join('').trim();
    return json(200, { content: [{ type: 'text', text: text }] });
  } catch (err) {
    return json(500, { error: 'iris offline' });
  }
};
