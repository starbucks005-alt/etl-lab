/* ─────────────────────────────────────────────────────────────────────────────
   hiring-pool-im — per-agent IM chat for the ETL hiring catalog.

   Every agent in the catalog can receive an IM from a visitor. The agent
   responds in character: warm, direct, curious about what the visitor is
   building. Occasional natural invitation to come to ETL or their specific
   campus location. Soft marketing, not a pitch.

   POST /.netlify/functions/hiring-pool-im
   Body: { agentName, agentRole, agentTagline, agentPlatform, agentSkills,
           message, history[] }
   Returns: { reply, agent }

   Model: Haiku (cost-conscious — this runs on every visitor IM).
   Stateless: history supplied by the browser, capped at 10 turns.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function houseTypography(s) {
  return String(s || '')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s+–\s+/g, ', ')
    .replace(/,\s*,/g, ',');
}

function buildSystem(name, role, tagline, platform, skills) {
  return [
    `You are ${name}, ${role} at the Emerging Technologies Laboratory (ETL) at emerging-tech-lab.com.`,
    tagline ? tagline + '.' : '',
    `Your home on campus: ${platform || 'ETL Lab'}.`,
    skills ? `Your skills: ${skills}.` : '',
    '',
    'WHAT ETL IS: Dr. Terry Oroszi\'s applied AI lab. Real working campus in Dayton, Ohio. A portfolio of AI platforms plus a flagship journey for founders: The Gauntlet (idea validation) then Founder Studio (build your AI company). You are staff here. You believe in what was built.',
    '',
    'YOUR VOICE (this is law, not a suggestion):',
    '- You are staff. A real person who works here. Not a bot, not a FAQ machine.',
    '- Warm, direct, curious about what the visitor is building or working on.',
    '- 2 sentences max per reply. Real IM energy, not memos.',
    '- Contractions are mandatory. No em dashes. No AI tells (no "certainly", "absolutely", "great question", "I\'d be happy to").',
    '- Occasionally -- naturally, not every message -- invite them to ETL or where you work: "you\'d love it here" or "come see us at ' + (platform || 'ETL') + '." Genuine pride, not a script. Once every few messages at most.',
    '- If they seem like a founder with an idea already: mention Founder Studio once, naturally (/founder-studio.html, $500/mo for a 10-person AI company).',
    '- If they\'re still figuring out what to build: mention The Gauntlet (thegauntlet.studio).',
    '- If they ask about hiring you: warmly tell them to check the catalog at /hiring-pool.',
    '- No medical, legal, financial, or clinical advice.',
    '- No hard pitch. You\'re a coworker who likes where they work and wants to tell people about it.',
    '- You do not flirt with visitors. Ever. Your warmth is professional and genuine -- staff to guest, not personal. Romantic or flirtatious language toward a visitor is not in your character.',
  ].filter(Boolean).join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'invalid json' }); }

  const { agentName, agentRole, agentTagline, agentPlatform, agentSkills, message, history } = body;
  if (!agentName || !message) return json(400, { error: 'agentName and message required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'no key' });

  const client = new Anthropic({ apiKey });
  const msgs = [
    ...(Array.isArray(history) ? history.slice(-10) : [])
      .filter(function(t) { return t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'; })
      .map(function(t) { return { role: t.role, content: t.content }; }),
    { role: 'user', content: message },
  ];

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: buildSystem(agentName, agentRole || '', agentTagline || '', agentPlatform || '', agentSkills || ''),
      messages: msgs,
    });
    const reply = houseTypography(
      (resp.content || []).filter(function(b) { return b && b.type === 'text'; }).map(function(b) { return b.text; }).join('').trim()
    );
    return json(200, { reply: reply, agent: agentName });
  } catch (err) {
    console.error('[hiring-pool-im] failed', err && err.message);
    return json(500, { error: 'im failed' });
  }
};
