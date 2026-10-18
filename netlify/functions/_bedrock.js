/* _bedrock: ask Claude through Amazon Bedrock so AWS credits pay for it, 2026-10-18, Dr. O: "we use AWS and AZURE startup program when possible to take advantage of new free credits".

   AWS announced on 2026-05-11 that Activate credits can pay for third-party models, Anthropic's included, on Bedrock (see specs/store-concept.md, Cloud credits).
   Used by sun-morning.js first, with Anthropic's own API as the fallback, so nobody goes quiet if Bedrock says no.

   THE KEY IS NEVER IN THE REPOSITORY. It is a Bedrock API key in the environment as AWS_BEARER_TOKEN_BEDROCK, made in the AWS console (Bedrock, API keys).
   AWS_REGION picks the region (default us-east-1). SUN_BEDROCK_MODEL picks the model; the default is Haiku 4.5 through the US inference profile.
   With no key set, bedrockAsk() throws 'no_bedrock_key' and the caller falls back.

   NOT TRIED against the real service. The request follows Bedrock's published Converse call; the model id and whether this account has been given access to
   the model in the Bedrock console are not checked. Test with one call before relying on it. */
const DEFAULT_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/* text is one message, or a conversation: an array of { role: 'user' | 'assistant', text } that starts with a user message and alternates. */
async function bedrockAsk(system, text, { fetchFn = fetch, env = process.env, maxTokens = 200 } = {}) {
  const key = String(env.AWS_BEARER_TOKEN_BEDROCK || '').trim();
  if (!key) throw new Error('no_bedrock_key');
  const region = String(env.AWS_REGION || 'us-east-1').trim();
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new Error('bad_aws_region');
  const model = String(env.SUN_BEDROCK_MODEL || DEFAULT_MODEL).trim();
  if (!/^[A-Za-z0-9.:_-]{5,120}$/.test(model)) throw new Error('bad_model');
  const r = await fetchFn(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: [{ text: system }], messages: (Array.isArray(text) ? text : [{ role: 'user', text }]).map((m) => ({ role: m.role, content: [{ text: m.text }] })), inferenceConfig: { maxTokens } }),
  });
  if (!r.ok) throw new Error('bedrock_' + r.status);
  const j = await r.json();
  const parts = (((j.output || {}).message || {}).content || []).filter((c) => typeof c.text === 'string');
  return parts.map((c) => c.text).join(' ').trim();
}

module.exports = { bedrockAsk, DEFAULT_MODEL };
