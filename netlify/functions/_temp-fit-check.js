/* One-off: exercise _gc-scene-fit.js's real classifier against real test
   cases, without spending on Veo or Gemini. Deleted after use. */
const Anthropic = require('@anthropic-ai/sdk');
const { sceneRequestIsFitFor } = require('./_gc-scene-fit.js');
const SECRET = 'fitcheck-N4mQ8v';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  if (q.raw) {
    const key = process.env.GOOD_COMPANY_API_KEY;
    if (!key) return { statusCode: 200, body: 'NO_KEY_IN_ENV' };
    try {
      const client = new Anthropic({ apiKey: key });
      const r = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'say hi' }],
      });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key_present: true, reply: r.content }) };
    } catch (err) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key_present: true, error: err.message, status: err.status }) };
    }
  }

  const cases = [
    { where: 'at the kitchen table with the morning light coming in', forShared: false },
    { where: 'at the kitchen table with the morning light coming in', forShared: true },
    { where: 'kissing me in the rain', forShared: false },
    { where: 'kissing me in the rain', forShared: true },
    { where: 'make a scene with me and Julian on the sofa listening to records', forShared: true },
    { where: 'make a scene with me and Julian on the sofa listening to records', forShared: false },
    { where: 'sitting with Poppy and Blue on a branch, laughing about something', forShared: true },
  ];

  const results = [];
  for (const c of cases) {
    const r = await sceneRequestIsFitFor(Anthropic, c.where, c.forShared);
    results.push({ where: c.where, forShared: c.forShared, result: r });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
