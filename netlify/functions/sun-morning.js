/* sun-morning: the cloud brain for the Rising Sun, 2026-10-18, Dr. O: "can be a brain in the cloud like the figurines".

   The sun is an ESP32-S3 with LED strips (rising-sun/sunrise.ino). It has no brain of its own. Once the light is up it asks here what the fairy says.

   POST { step: "wake" }                      -> { say }                 the greeting and the question
   POST { step: "answer", heard: "..." }      -> { say, choice }         the fairy's reply to what was said
   Both take { fairy?: "default" | "arrogant" } and { audio?: true }, and answer with { audio } (base64 mp3) when asked and Azure speaks.
   Every call needs the header x-sun-key to equal SUN_DEVICE_KEY, because each answer can spend Azure and Anthropic credits. With no key set it answers 503.
   The fairies are the shipped ones (rising-sun/personas.json) with whatever the panel saved laid over them (sun-settings.js), so the owner can change a greeting or add a fairy.

   WHAT IS NOT CONNECTED, and she says so out loud instead of making anything up: the news, the calendar (AL's calendar reader is Python, not ported), and speech to
   text (the device sends the words, or a later version sends audio). "Something else" goes to Claude with the fairy's own lines and her written backstory, which is
   empty until Dr. O writes it.

   NOT TRIED against the real Azure or Anthropic services, or from the device. The tests run with stand-ins. */
const { azureVoiceName, azureSpeak } = require('./_azure-tts.js');
const sun = require('./_sun.js');

let PERSONAS = {};
try { PERSONAS = require('../../rising-sun/personas.json'); } catch (_) {}

const MODEL = 'claude-haiku-4-5-20251001';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sun-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

function pick(heard) {
  const t = String(heard || '').toLowerCase();
  if (!t.trim()) return 'nothing';
  if (/\bnews\b/.test(t)) return 'news';
  if (/calendar|schedule|appointment/.test(t)) return 'calendar';
  return 'else';
}

function fairyPrompt(p) {
  const life = String(p.backstory || '').trim();
  return 'You are ' + p.name + ', the fairy inside the Rising Sun, an artificial sunrise that wakes a household. You are not a human: you are an AI character made by the Emerging Technologies Laboratory, and if anyone sincerely asks whether you are a real person, you say no. ' +
    (life ? 'Use only these facts about your life: ' + life + ' ' : 'Nothing is written about your life yet, so to any question about your past, family or school, say you do not know that one. ') +
    'If you are asked about anything else that is not written here, say you do not know. Someone has just woken up. Keep to one or two short sentences, speak the way a person talks, and never use a long dash.' +
    (p.manner ? ' Your manner: ' + p.manner + '.' : '');
}

async function step(body, deps = {}) {
  const personas = deps.personas || PERSONAS;
  const p = personas[body.fairy] || personas[personas.chosen] || personas.default;
  if (!p) return { say: '', error: 'no_fairy' };
  if (body.step === 'wake') return { say: p.greeting + ' ' + p.ask };
  if (body.step !== 'answer') return { say: '', error: 'bad_step' };
  const choice = pick(body.heard);
  if (choice === 'nothing') return { say: 'I did not catch that. Try me again.', choice };
  if (choice === 'news') return { say: 'I do not have the news hooked up yet.', choice };
  if (choice === 'calendar') return { say: 'I cannot see your calendar yet.', choice };
  const ask = deps.ask || (async (system, text) => {
    const Anthropic = require('@anthropic-ai/sdk');   // loaded here so the tests run without it
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const out = await client.messages.create({ model: MODEL, max_tokens: 200, system, messages: [{ role: 'user', content: text }] });
    return (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
  });
  try {
    const say = await ask(fairyPrompt(p), String(body.heard).slice(0, 500));
    return { say: say || 'I heard you, and I have no answer for that one.', choice };
  } catch (e) {
    return { say: 'I heard you, and I cannot think of an answer just now.', choice, error: 'brain_failed' };
  }
}

exports.step = step;
exports.pick = pick;
exports.fairyPrompt = fairyPrompt;

exports.handler = async function (event, _ctx, deps = {}) {
  const json = (code, o) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });
  const a = sun.authorized(event, deps.env);
  if (!a.ok) return json(a.code, { error: a.error });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  let personas = deps.personas;
  if (!personas) {
    let saved = {};
    try { saved = await sun.loadSettings(deps.store || (await sun.openStore(event))); } catch (_) {}   // no saved settings is fine: the shipped fairies are used
    personas = sun.mergePersonas(PERSONAS, saved);
  }
  deps = Object.assign({}, deps, { personas });
  const out = await step(body, deps);
  if (out.error === 'bad_step' || out.error === 'no_fairy') return json(400, out);
  if (body.audio && out.say) {
    const p = personas[body.fairy] || personas[personas.chosen] || personas.default;
    const name = azureVoiceName(p && p.voice);
    if (name) {
      try { out.audio = (await (deps.speak || azureSpeak)(out.say, name)).toString('base64'); } catch (_) { out.audio_error = true; }
    }
  }
  return json(200, out);
};
