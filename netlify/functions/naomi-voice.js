/* naomi-voice: Naomi Baptiste's voice, Azure en-US-ShimmerTurboMultilingualNeural, chosen by Dr. O 2026-10-20.
   POST { text }  ->  audio/mpeg
   The Speech key and region come from the private record or the environment, the same place gc-voice.js reads them
   (_gc-config.js azureEnv: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, eastus if not set). Never in the repository.
   Not tried against the real Azure service from here. */

const { azureSpeak } = require('./_azure-tts.js');
const gcConfig = require('./_gc-config.js');

const VOICE = 'en-US-ShimmerTurboMultilingualNeural';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function reply(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function handler(event, deps) {
  const d = deps || {};
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'bad_json' }); }
  const text = String(body.text || '').trim();
  if (!text) return reply(400, { error: 'text_required' });
  if (text.length > 2500) return reply(400, { error: 'text_too_long' });
  try {
    const env = d.env || (await gcConfig.azureEnv(event));
    const buf = await (d.speak || azureSpeak)(text, VOICE, { env });
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    const notSet = e && e.message === 'no_azure_key';
    return reply(notSet ? 503 : 502, { error: notSet ? 'voice_not_set_up' : 'voice_failed' });
  }
}

exports.handler = (event) => handler(event);
module.exports.run = handler;
module.exports.VOICE = VOICE;
