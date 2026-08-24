/* prep-room-ask — free AI passthrough for Prep Room and BYOA help widget.
   No auth. Caps tokens at 600. No web search. */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 600;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json(400, { error: 'messages required' });

  const apiKey = process.env.ETL_API_KEY;
  if (!apiKey) return json(500, { error: 'config' });

  const client = new Anthropic({ apiKey });
  try {
    const params = {
      model: MODEL,
      max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
      messages: messages,
    };
    const system = String(body.system || '').trim();
    if (system) params.system = system;

    const resp = await client.messages.create(params);
    return json(200, resp);
  } catch (err) {
    return json(500, { error: 'service error', message: err && err.message });
  }
};
