/* boardroom-ask — credit-gated AI endpoint for The Boardroom (professionals).
   Requires Lab Member auth. Deducts 1 credit per call (studio_pass holders exempt). */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken, deductCredit } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 600;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Auth + credit gate
  const token = extractToken(event.headers.authorization);
  if (!token) return json(401, { error: 'no_token', message: 'Sign in at /member-login to use The Boardroom.' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json(500, { error: 'config' });
  const user = await getUser(token);
  if (!user) return json(401, { error: 'invalid_token', message: 'Your session has expired. Sign in again at /member-login.' });
  const credit = await deductCredit(user.id, serviceKey);
  if (!credit.ok) {
    const msg = credit.reason === 'no_credits'
      ? "You're out of credits for this month. Your balance tops up on your monthly renewal date."
      : 'No credit account found. Subscribe at /member-login.';
    return json(402, { error: credit.reason, message: msg });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json(400, { error: 'messages required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
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
