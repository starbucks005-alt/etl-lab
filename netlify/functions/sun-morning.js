/* sun-morning: the cloud brain for the Rising Sun, 2026-10-18, Dr. O: "can be a brain in the cloud like the figurines".

   The sun is an ESP32-S3 with LED strips (rising-sun/sunrise.ino). It has no brain of its own. Once the light is up it asks here what the fairy says.

   POST { step: "wake" }                      -> { say }                 the greeting and the question
   POST { step: "answer", heard: "..." }      -> { say, choice }         the fairy's reply to what was said
   Both take { fairy?: "poppy" | "velvet" | "ember" | an id the owner made } and { audio?: true }, and answer with { audio } (base64 mp3) when asked and her voice speaks (an ElevenLabs voice id, or azure:<name>).
   Every call needs the header x-sun-key to equal SUN_DEVICE_KEY, because each answer can spend Azure and Anthropic credits. With no key set it answers 503.
   The fairies are the shipped ones (rising-sun/personas.json) with whatever the panel saved laid over them (sun-settings.js), so the owner can change a greeting or add a fairy.

   REMINDERS: lines the owner wrote on the panel are spoken as written after the greeting and before the question, "Dr. O, 2026-10-18: reminder to take your meds". She adds nothing and advises nothing.

   THE NEWS is Above the Fold, ETL Newswire's daily briefing (Dr. O, 2026-10-18). "News" answers { say, news: { audio_url, headlines, duration_label, generated_at } }: she says one line
   and the device plays audio_url, the multi-voice briefing already recorded. If today's has not come out she says so and offers the last one. If none can be read she says that.

   WHAT IS NOT CONNECTED, and she says so out loud instead of making anything up: the calendar (AL's calendar reader is Python, not ported), and speech to
   text (the device sends the words, or a later version sends audio). "Something else" goes to Claude with the fairy's own lines and her written backstory, which is
   empty until Dr. O writes it.

   KEYS: the only new environment variable is SUN_DEVICE_KEY. The site is at its limit of them, so the Azure key is read the way gc-voice reads it (private record, then environment, see _gc-config.js),
   the Anthropic key is the one the site already has, and the Bedrock key is saved from the panel into the sun's private record.

   CREDITS: her voice is Azure (the Azure credits pay). Her thinking tries Claude on Amazon Bedrock first (the AWS credits pay; see _bedrock.js), then Anthropic's own API.

   NOT TRIED against the real Azure, Bedrock or Anthropic services, or from the device. The tests run with stand-ins. */
const { azureVoiceName, azureSpeak } = require('./_azure-tts.js');
const sun = require('./_sun.js');
const { bedrockAsk } = require('./_bedrock.js');
const gcConfig = require('./_gc-config.js');
const { elevenSpeak, isElevenId } = require('./_eleven.js');

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
    (p.manner ? ' Your manner: ' + String(p.manner).replace(/[.\s]+$/, '') + '.' : '');
}

async function step(body, deps = {}) {
  const personas = deps.personas || PERSONAS;
  const p = personas[body.fairy] || personas[personas.chosen] || personas.velvet;
  if (!p) return { say: '', error: 'no_fairy' };
  if (body.step === 'wake') {
    const rem = (deps.reminders || []).filter(Boolean);
    return { say: [p.greeting].concat(rem, [p.ask]).join(' '), reminders: rem.length };
  }
  if (body.step !== 'answer') return { say: '', error: 'bad_step' };
  const choice = pick(body.heard);
  if (choice === 'nothing') return { say: 'I did not catch that. Try me again.', choice };
  if (choice === 'news') {
    let news = null;
    try { news = deps.news !== undefined ? deps.news : await sun.loadNews(deps.event, deps); } catch (_) {}
    if (!news) return { say: 'I cannot reach the news right now.', choice };
    const day = news.generated_at ? new Date(news.generated_at).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }) : '';
    const old = news.hours_old !== null && news.hours_old > 36;
    const len = news.duration_label ? ', ' + news.duration_label + ' long' : '';
    return {
      say: (old ? 'Above the Fold has not come out yet today. This is the one from ' + day + len + '.' : 'Here is Above the Fold from ETL Newswire' + len + '.'),
      choice,
      news,
    };
  }
  if (choice === 'calendar') return { say: 'I cannot see your calendar yet.', choice };
  /* AWS credits first (Claude on Bedrock), Anthropic's own API if Bedrock is not set up or says no. */
  const ask = deps.ask || (async (system, text) => {
    try {
      const env = Object.assign({}, process.env, deps.saved && deps.saved.bedrock_key ? { AWS_BEARER_TOKEN_BEDROCK: deps.saved.bedrock_key } : {});
      const b = await bedrockAsk(system, text, { fetchFn: deps.fetchFn || fetch, env });
      if (b) return b;
    } catch (_) {}
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
  let saved = deps.saved;
  if (!saved) {
    saved = {};
    try { saved = await sun.loadSettings(deps.store || (await sun.openStore(event))); } catch (_) {}   // no saved settings is fine: the shipped fairies are used
  }
  const personas = deps.personas || sun.mergePersonas(PERSONAS, saved);
  deps = Object.assign({}, deps, { personas, saved, reminders: deps.reminders || saved.reminders || [] });
  const out = await step(body, Object.assign({ event }, deps));
  if (out.error === 'bad_step' || out.error === 'no_fairy') return json(400, out);
  if (body.audio && out.say) {
    const p = personas[body.fairy] || personas[personas.chosen] || personas.velvet;
    const voice = String((p && p.voice) || '').trim();
    const azName = azureVoiceName(voice);
    const speak = deps.speak || (async (t, v) => (azureVoiceName(v)
      ? azureSpeak(t, azureVoiceName(v), { env: await gcConfig.azureEnv(event) })
      : elevenSpeak(t, v)));
    if (azName || isElevenId(voice)) {
      try { out.audio = (await speak(out.say, voice)).toString('base64'); } catch (_) { out.audio_error = true; }   // the words still go out
    }
  }
  return json(200, out);
};
