/* sun-guest: the Rising Sun preview talks for real, within limits, 2026-10-19, Dr. O: "the text, free for so many tries per day, no audio without an account.
   more options if ETL Lab member. discounts if ETL member". No access code needed.

   Who is asking, from the Authorization header (the same ETL sign in the rest of the site uses):
     guest   no sign in    text only, a few a day (counted by the visitor's address, kept only as a fingerprint)
     account signed in     more text, and a few spoken answers a day
     member  signed in and the Lab membership is active    the most text and voice  (the discount at purchase is not built yet)
   The numbers are in LIMITS, one place, to be set by Dr. O. A fairy here is the shipped one with the shipped lore, never an owner's edited version, and she remembers
   only what the visitor's own page sends back (the last few lines), so nothing of a visitor is kept on the site except the count for the day.
   POST { fairy, text, history: [{role, text}], audio }   ->  { say, tier, left: { text, audio }, audio? (base64 mp3), audio_blocked? } or 429 { error: 'limit' } */
const crypto = require('crypto');
const sun = require('./_sun.js');
const morning = require('./sun-morning.js');
const credits = require('./_etl-credits-util.js');
const { azureVoiceName, azureSpeak } = require('./_azure-tts.js');
const gcConfig = require('./_gc-config.js');
const { elevenSpeak, isElevenId } = require('./_eleven.js');

const LIMITS = { guest: { text: 10, audio: 0 }, account: { text: 30, audio: 5 }, member: { text: 100, audio: 30 } };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const FAIRIES = sun.SHIPPED;
let PERSONAS = {};
try { PERSONAS = require('../../rising-sun/personas.json'); } catch (_) {}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
async function memberOf(userId) {
  if (userId === 'owner' || userId === 'owner-master') return true;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  try {
    const r = await fetch(`${credits.SUPABASE_URL}/rest/v1/etl_credits?user_id=eq.${encodeURIComponent(userId)}&select=subscription_active`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] && rows[0].subscription_active === true;
  } catch (_) { return false; }
}

exports.LIMITS = LIMITS;
exports.handler = async function (event, _ctx, deps = {}) {
  const json = (code, o) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(o) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  const fairy = FAIRIES.includes(body.fairy) ? body.fairy : '';
  const text = String(body.text || '').trim().slice(0, 500);
  if (!fairy) return json(400, { error: 'no_fairy' });
  if (!text) return json(400, { error: 'nothing_said' });

  const h = event.headers || {};
  const token = credits.extractToken(h.authorization || h.Authorization);
  const user = token ? await (deps.getUser || credits.getUser)(token) : null;
  const tier = !user ? 'guest' : (await (deps.isMember || memberOf)(user.id) ? 'member' : 'account');
  const ip = String(h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  const who = user ? 'u-' + sha(user.id).slice(0, 16) : 'ip-' + sha(ip).slice(0, 16);
  const day = new Date(deps.now || Date.now()).toISOString().slice(0, 10);

  const root = deps.store || (await sun.openStore(event));
  const limits = deps.limits || LIMITS;
  const lim = limits[tier];
  const used = (await root.get('guest:' + who + ':' + day, { type: 'json' })) || { text: 0, audio: 0 };
  if (used.text >= lim.text) {
    return json(429, { error: 'limit', tier, message: tier === 'guest' ? 'That is all the free messages for today. Sign in to ETL to keep talking, and to hear the fairies.' : 'That is all the messages for today. They will be back tomorrow.' });
  }
  used.text++;

  const hist = (Array.isArray(body.history) ? body.history : []).slice(-10)
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, 500) }));
  while (hist.length && hist[0].role !== 'user') hist.shift();
  let saved = {};
  try { saved = { bedrock_key: (await sun.loadSettings(root)).bedrock_key || '' }; } catch (_) {}     // ETL's own key, the AWS credits first, never shown
  const out = await morning.step({ step: 'chat', fairy, text }, {
    personas: PERSONAS, saved, ask: deps.ask, now: deps.now, details: [], reminders: [], zone: 'eastern',
    chat: { load: async () => hist, save: async () => {} },
  });
  if (out.error === 'brain_failed') return json(502, { error: 'brain_failed', say: out.say });
  const res = { say: out.say, tier };

  if (body.audio) {
    if (lim.audio === 0) res.audio_blocked = 'sign_in';
    else if (used.audio >= lim.audio) res.audio_blocked = 'limit';
    else {
      const voice = String((PERSONAS[fairy] || {}).voice || '').trim();
      const speak = deps.speak || (async (t, v) => (azureVoiceName(v) ? azureSpeak(t, azureVoiceName(v), { env: await gcConfig.azureEnv(event) }) : elevenSpeak(t, v)));
      if (azureVoiceName(voice) || isElevenId(voice)) {
        try { res.audio = (await speak(out.say, voice)).toString('base64'); used.audio++; } catch (_) { res.audio_error = true; }
      }
    }
  }
  await root.setJSON('guest:' + who + ':' + day, used);
  res.left = { text: Math.max(0, lim.text - used.text), audio: Math.max(0, lim.audio - used.audio) };
  return json(200, res);
};
