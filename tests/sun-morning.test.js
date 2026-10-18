/* sun-morning.test.js: plain node, `node tests/sun-morning.test.js`. Stand-ins for Anthropic and Azure; nothing here touches the network. */
const assert = require('assert');
const m = require('../netlify/functions/sun-morning.js');
const personas = require('../rising-sun/personas.json');
assert(!personas.arrogant && personas.chosen === 'velvet' && personas.poppy && personas.ember && personas.ash && personas.flint);   // five fairies, Velvet chosen
function ev2(key, body) { return { httpMethod: 'POST', headers: { 'x-sun-key': key }, body: JSON.stringify(body) }; }
(async () => {
  assert.strictEqual(m.pick('check my calendar please'), 'calendar');
  assert.strictEqual(m.pick('the news'), 'news');
  assert.strictEqual(m.pick('what is a rainbow'), 'else');
  assert.strictEqual(m.pick('  '), 'nothing');
  assert((await m.step({ step: 'wake' }, { personas })).say.startsWith('Good morning, human.'));
  assert((await m.step({ step: 'wake', fairy: 'ember' }, { personas })).say.includes('news, check your calendar, or something else'));
  const wr = await m.step({ step: 'wake' }, { personas, reminders: ['Take your morning pills.', 'Drink some water.'] });
  assert(wr.say.startsWith('Good morning, human. Take your morning pills. Drink some water. Good morning sunshine.') && wr.reminders === 2);   // her words, between the greeting and the question
  const fresh = { audio_url: 'https://emerging-tech-lab.com/.netlify/functions/newswire-briefing-audio?episode=episode-2026-10-18', generated_at: '2026-10-18T10:00:00Z', hours_old: 5, duration_label: '4:58', headlines: ['A', 'B'] };
  const n1 = await m.step({ step: 'answer', heard: 'the news' }, { personas, news: fresh });
  assert(n1.say.startsWith('Here is Above the Fold from ETL Newswire, 4:58 long') && n1.news.audio_url === fresh.audio_url);
  const n2 = await m.step({ step: 'answer', heard: 'the news' }, { personas, news: Object.assign({}, fresh, { hours_old: 60, generated_at: '2026-10-16T10:00:00Z' }) });
  assert(/has not come out yet today/.test(n2.say) && /Friday/.test(n2.say));            // an old one is called old
  assert((await m.step({ step: 'answer', heard: 'the news' }, { personas, news: null })).say.includes('cannot reach the news'));   // none: says so, makes none up
  const sunMod = require('../netlify/functions/_sun.js');
  const got = await sunMod.loadNews({}, { loadMeta: async () => ({ audio_url: '/.netlify/functions/newswire-briefing-audio?episode=episode-2026-10-18', generated_at: '2026-10-18T10:00:00Z', duration_label: '4:58', pieces: [{ title: 'One' }, { title: 'Two' }] }), now: Date.parse('2026-10-18T15:00:00Z') });
  assert.strictEqual(got.hours_old, 5); assert.deepStrictEqual(got.headlines, ['One', 'Two']); assert(got.audio_url.startsWith('https://emerging-tech-lab.com/'));
  assert.strictEqual(await sunMod.loadNews({}, { loadMeta: async () => null }), null);
  let sys;
  const r = await m.step({ step: 'answer', heard: 'where did you go to school' }, { personas, ask: async (s) => { sys = s; return 'I do not know that one.'; } });
  assert.strictEqual(r.choice, 'else');
  assert(/do not know that one/.test(sys) && /not a human/.test(sys));       // empty backstory: the prompt says nothing is written
  assert(!/\u2014/.test(sys));
  assert((await m.step({ step: 'answer', heard: 'tell me a joke' }, { personas, ask: async () => { throw new Error('x'); } })).error === 'brain_failed');
  assert.strictEqual((await m.step({ step: 'nope' }, { personas })).error, 'bad_step');
  const ev = (key, body) => ({ httpMethod: 'POST', headers: { 'x-sun-key': key }, body: JSON.stringify(body) });
  assert.strictEqual((await m.handler(ev('k', { step: 'wake' }), {}, { env: {} })).statusCode, 503);        // no key set: closed
  assert.strictEqual((await m.handler(ev('bad', { step: 'wake' }), {}, { env: { SUN_DEVICE_KEY: 'k' } })).statusCode, 401);
  const ok = await m.handler(ev('k', { step: 'wake', audio: true }), {}, { env: { SUN_DEVICE_KEY: 'k' }, personas: { velvet: Object.assign({}, personas.velvet, { voice: 'abcdefghij1234' }), chosen: 'velvet' }, speak: async () => Buffer.from('mp3') });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(JSON.parse(ok.body).audio, Buffer.from('mp3').toString('base64'));
  // Bedrock first, Anthropic after. Stand-in network; no keys are real.
  const { bedrockAsk } = require('../netlify/functions/_bedrock.js');
  let seen;
  const fetchOk = async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ output: { message: { content: [{ text: 'Hello from Bedrock.' }] } } }) }; };
  assert.strictEqual(await bedrockAsk('sys', 'hi', { fetchFn: fetchOk, env: { AWS_BEARER_TOKEN_BEDROCK: 'k', AWS_REGION: 'us-east-1' } }), 'Hello from Bedrock.');
  assert(seen.url.startsWith('https://bedrock-runtime.us-east-1.amazonaws.com/model/') && seen.url.endsWith('/converse'));
  assert.strictEqual(seen.o.headers.Authorization, 'Bearer k');
  assert.strictEqual(JSON.parse(seen.o.body).system[0].text, 'sys');
  await assert.rejects(bedrockAsk('s', 't', { fetchFn: fetchOk, env: {} }), /no_bedrock_key/);
  await assert.rejects(bedrockAsk('s', 't', { fetchFn: fetchOk, env: { AWS_BEARER_TOKEN_BEDROCK: 'k', AWS_REGION: 'evil.com/x' } }), /bad_aws_region/);
  await assert.rejects(bedrockAsk('s', 't', { fetchFn: async () => ({ ok: false, status: 403 }), env: { AWS_BEARER_TOKEN_BEDROCK: 'k' } }), /bedrock_403/);
  let usedKey;
  const fetchSpy = async (u, o) => { usedKey = o.headers.Authorization; return fetchOk(u, o); };
  const viaBedrock = await m.step({ step: 'answer', heard: 'tell me about the sun' }, { personas, fetchFn: fetchSpy, saved: { bedrock_key: 'fromrecord' } });   // the key from the panel's private record, no environment variable
  assert.strictEqual(usedKey, 'Bearer fromrecord');
  assert.strictEqual(viaBedrock.say, 'Hello from Bedrock.');
  const fp = m.fairyPrompt(personas.velvet);
  assert(/fire fairy/.test(fp) && /not a human/.test(fp) && !/\u2014/.test(fp) && !/plainly/i.test(fp));   // the character is in the prompt, with no invented life
  assert(!/\.\.\s/.test(fp));
  // ElevenLabs: her voice. Stand-in network.
  const { elevenSpeak, isElevenId } = require('../netlify/functions/_eleven.js');
  let elCall;
  const fetchEl = async (u, o) => { elCall = { u, o }; return { ok: true, arrayBuffer: async () => Buffer.from('mp3') }; };
  assert.strictEqual((await elevenSpeak('Hello.', 'abcdefghij1234', { fetchFn: fetchEl, env: { ELEVENLABS_API_KEY: 'k' } })).toString(), 'mp3');
  assert(elCall.u.endsWith('/v1/text-to-speech/abcdefghij1234') && elCall.o.headers['xi-api-key'] === 'k');
  await assert.rejects(elevenSpeak('x', 'abcdefghij1234', { fetchFn: fetchEl, env: {} }), /no_eleven_key/);
  await assert.rejects(elevenSpeak('x', '../bad', { fetchFn: fetchEl, env: { ELEVENLABS_API_KEY: 'k' } }), /bad_voice_id/);
  await assert.rejects(elevenSpeak('x', 'abcdefghij1234', { fetchFn: async () => ({ ok: false, status: 401 }), env: { ELEVENLABS_API_KEY: 'k' } }), /eleven_401/);
  assert(isElevenId('thfYL0Elyru2qqTtNQsE') && !isElevenId('azure:en-US-AriaNeural') && !isElevenId(''));
  // the handler asks for her voice only when one is set, and keeps the words if the voice fails
  const withVoice = { velvet: Object.assign({}, personas.velvet, { voice: 'abcdefghij1234' }), chosen: 'velvet' };
  const heard = [];
  const o1 = JSON.parse((await m.handler(ev2('k', { step: 'wake', audio: true }), {}, { env: { SUN_DEVICE_KEY: 'k' }, personas: withVoice, speak: async (t, v) => { heard.push(v); return Buffer.from('mp3'); } })).body);
  assert.strictEqual(heard[0], 'abcdefghij1234'); assert(o1.audio);
  const o2 = JSON.parse((await m.handler(ev2('k', { step: 'wake', audio: true }), {}, { env: { SUN_DEVICE_KEY: 'k' }, personas: withVoice, speak: async () => { throw new Error('x'); } })).body);
  assert(o2.audio_error && !o2.audio && o2.say.startsWith('Good morning, human.'));
  const o3 = JSON.parse((await m.handler(ev2('k', { step: 'wake', audio: true }), {}, { env: { SUN_DEVICE_KEY: 'k' }, personas: { velvet: Object.assign({}, personas.velvet, { voice: '' }), chosen: 'velvet' }, speak: async () => { throw new Error('should not be asked'); } })).body);
  assert(!o3.audio && !o3.audio_error);                                                                                        // no voice chosen yet: words only
  // each of the three speaks with her own voice; none is Velvet by accident
  const seenVoice = [];
  for (const f of ['poppy', 'velvet', 'ember', 'ash', 'flint']) {
    await m.handler(ev2('k', { step: 'wake', fairy: f, audio: true }), {}, { env: { SUN_DEVICE_KEY: 'k' }, personas, speak: async (tx, v) => { seenVoice.push(v); return Buffer.from('x'); } });
  }
  assert.deepStrictEqual(seenVoice, ['VJFN2gyaDzoKekQ8ZuKB', 'sZXgk6vPj5VwF6GvqUUu', 'L6Qa01yqWMO8K86PvToq', 'iqp2mz1khslpMZ4XfrPv', '4INSaS2X3PwDueCjvPjm']);
  assert(/Hushed, soft/.test(m.fairyPrompt(personas.ember)) && /Bright, quick/.test(m.fairyPrompt(personas.poppy)));
  assert(/mischievous/.test(m.fairyPrompt(personas.flint)) && /husky/.test(m.fairyPrompt(personas.ash)));   // the two male fairies keep their own manners
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
