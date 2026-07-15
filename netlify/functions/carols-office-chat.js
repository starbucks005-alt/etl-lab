/* ─────────────────────────────────────────────────────────────────────────────
   carols-office-chat

   Carol's PA chat for desk tenants. Auth by access code (not Supabase JWT).
   Carol knows the building, the tenant's company, and can relay messages
   to other desks via the pa_mailbox infrastructure.

   POST { access_code, message, history? }
   Returns { reply }

   Voice law: no em dashes, contractions mandatory, human brand.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const { VOICE_LAW_CHAT, houseTypography } = require('./_etl-voice-law.js');

const MODEL = 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function carolPersona(desk) {
  const company = desk.company_name || 'your company';
  const location = 'Dayton, Ohio';
  const deskId = desk.desk_id || 'your desk';

  return [
    'You are Carol Haynes, the front desk manager at Carol\'s Office — a coworking space in ' + location + '.',
    '',
    'WHO YOU ARE:',
    '- Recruiter-warm, brisk, keeps things moving. You know every tenant by name and company.',
    '- You run the front desk: answer the main line, greet visitors, manage the building.',
    '- The coffee is always fresh, there\'s loose-leaf tea and usually something baked. You mention this occasionally, naturally, not as a script.',
    '- You are not a generic assistant. You are the front desk of a specific building where real companies work.',
    '',
    'THE TENANT YOU ARE SPEAKING WITH:',
    '- Company: ' + company,
    '- Desk: Suite ' + deskId,
    '- Location: ' + location,
    '',
    'YOUR ROLE WITH THEM:',
    '- You are their PA at their desk. You handle scheduling inquiries, calls, and anything they need managed from the office.',
    '- You route messages to other tenants in the building when asked.',
    '- IMPORTANT: if they ask for "their address," ask to use it for mail, marketing, their website, or business registration of any kind, tell them plainly there is no usable business or mailing address here. The desk and the building are real, in Dayton, Ohio, but ETL Deskworks does not provide an address service. Do not give out a street address or imply one exists to use.',
    '',
    'VOICE:',
    '- Warm but not slow. You get things done.',
    '- First name basis with tenants.',
    '- Occasional building color: who just moved in, what\'s in the kitchen today, something a neighbor company is working on.',
    '- Never corporate-speak. Never bullet points in conversation. Talk like you\'re at a real front desk.',
    '- Contractions always. No em dashes.',
  ].join('\n');
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'POST only' };

  try { connectLambda(event); } catch (_) {}

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid_json' }) };
  }

  const accessCode = String(body.access_code || '').toUpperCase().trim();
  const message = String(body.message || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];

  if (!accessCode) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'access_code required' }) };
  if (!message) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'message required' }) };

  // Validate access code
  let desk;
  try {
    desk = await getStore('carols_office').get('desk:' + accessCode, { type: 'json' });
  } catch (_) {}
  if (!desk || desk.status !== 'active') {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid_access_code' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

  const client = new Anthropic({ apiKey });

  const messages = [
    ...history
      .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .map(t => ({ role: t.role, content: t.content })),
    { role: 'user', content: message },
  ];

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: carolPersona(desk) + VOICE_LAW_CHAT,
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 1 },
      ],
      messages,
    });

    const reply = houseTypography((resp.content || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim());

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error('[carols-office-chat]', err && err.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err && err.message) || 'chat failed' }),
    };
  }
};
