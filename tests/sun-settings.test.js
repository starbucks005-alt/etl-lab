/* sun-settings.test.js: plain node, `node tests/sun-settings.test.js`. A stand-in store; nothing touches the network. */
const assert = require('assert');
const sun = require('../netlify/functions/_sun.js');
const settings = require('../netlify/functions/sun-settings.js');
const morning = require('../netlify/functions/sun-morning.js');
const base = require('../rising-sun/personas.json');
(async () => {
  const mem = {}; const store = { get: async (k) => mem[k] || null, setJSON: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
  const call = (method, key, body) => settings.handler({ httpMethod: method, headers: { 'x-sun-key': key }, body: body ? JSON.stringify(body) : '' }, {}, { env: { SUN_DEVICE_KEY: 'k' }, store });
  assert.strictEqual((await settings.handler({ httpMethod: 'GET', headers: {} }, {}, { env: {}, store })).statusCode, 503);
  assert.strictEqual((await call('GET', 'nope')).statusCode, 401);
  let r = JSON.parse((await call('GET', 'k')).body).settings;
  assert.strictEqual(r.wake_hour, 7); assert.strictEqual(r.sunrise_minutes, 30); assert.strictEqual(r.calendar_set, false);
  r = JSON.parse((await call('POST', 'k', { wake_hour: 6, wake_min: 45, sunrise_minutes: 40, zone: 'pacific' })).body).settings;
  assert.strictEqual(r.wake_hour, 6); assert.strictEqual(r.wake_min, 45); assert.strictEqual(r.tz, 'PST8PDT,M3.2.0,M11.1.0');
  r = JSON.parse((await call('POST', 'k', { wake_hour: 99, sunrise_minutes: 2, zone: 'mars', evil: 1 })).body).settings;     // out of range or unknown: ignored, nothing else gets in
  assert.strictEqual(r.wake_hour, 6); assert.strictEqual(r.sunrise_minutes, 40); assert.strictEqual(r.zone, 'pacific'); assert(!('evil' in r));
  r = JSON.parse((await call('POST', 'k', { calendar_url: 'webcal://example.com/private/cal.ics' })).body);
  assert.strictEqual(r.settings.calendar_set, true); assert(!JSON.stringify(r).includes('example.com'));                     // the link is kept, never sent back
  assert.strictEqual(mem.settings.calendar_url, 'https://example.com/private/cal.ics');
  await call('POST', 'k', { calendar_url: 'http://insecure.example/cal.ics' });
  assert.strictEqual(mem.settings.calendar_url, 'https://example.com/private/cal.ics');                                       // not https: refused
  await call('POST', 'k', { fairies: { sparks: { name: 'Sparks', greeting: 'Wake up, sleepyhead.', ask: 'What shall it be?', manner: 'warm and teasing', backstory: '', voice: 'azure:en-US-JennyNeural' } }, fairy: 'sparks' });
  assert.strictEqual(mem.settings.fairy, 'sparks');
  const merged = sun.mergePersonas(base, mem.settings);
  assert.strictEqual(merged.sparks.greeting, 'Wake up, sleepyhead.'); assert.strictEqual(merged.chosen, 'sparks');
  assert.strictEqual(merged.velvet.greeting, 'Good morning, human.');                                                          // the shipped one stays
  const w = await morning.step({ step: 'wake' }, { personas: merged });
  assert(w.say.startsWith('Wake up, sleepyhead.'));
  assert(/warm and teasing/.test(morning.fairyPrompt(merged.sparks)));
  await call('POST', 'k', { fairies: { velvet: { greeting: 'Behold.' } } });                                                  // changing the shipped fairy keeps her other lines
  const m2 = sun.mergePersonas(base, mem.settings);
  assert.strictEqual(m2.velvet.greeting, 'Behold.'); assert(m2.velvet.ask.includes('news'));
  await call('POST', 'k', { delete_fairy: 'sparks' });
  assert.strictEqual(mem.settings.fairy, 'velvet'); assert(!mem.settings.fairies.sparks);                                     // deleting the chosen one falls back
  await call('POST', 'k', { delete_fairy: 'poppy' });
  await call('POST', 'k', { fairies: { poppy: { greeting: 'Hi.' } } });
  await call('POST', 'k', { delete_fairy: 'poppy' });
  assert(mem.settings.fairies.poppy);                                                                                       // the shipped ones cannot be deleted
  r = JSON.parse((await call('POST', 'k', { reminders: ['Take your morning pills.', '  ', 'x'.repeat(500), 'a', 'b', 'c', 'd'] })).body).settings;
  assert.strictEqual(r.reminders.length, 5); assert.strictEqual(r.reminders[0], 'Take your morning pills.'); assert.strictEqual(r.reminders[1].length, 200);   // blanks dropped, long ones cut, five at most
  r = JSON.parse((await call('POST', 'k', { reminders: [] })).body).settings;
  assert.deepStrictEqual(r.reminders, []);
  r = JSON.parse((await call('POST', 'k', { bedrock_key: 'ABSKQmVkcm9ja0FQSUtleS1leGFtcGxlLWV4YW1wbGU' })).body);
  assert.strictEqual(r.settings.bedrock_set, true); assert(!JSON.stringify(r).includes('ABSKQmVkcm9')); assert(mem.settings.bedrock_key.startsWith('ABSK'));   // kept, never sent back
  await call('POST', 'k', { bedrock_key: 'short' });
  assert(mem.settings.bedrock_key.startsWith('ABSK'));                                                                                          // too short to be a key: refused
  await call('POST', 'k', { bedrock_key: '' });
  assert.strictEqual(mem.settings.bedrock_key, '');
  const dash = sun.cleanPatch({ fairies: { x: { greeting: 'Hello \u2014 there', voice: '../x' } } }).fairies.x;
  assert(!/\u2014/.test(dash.greeting) && !('voice' in dash));
  const got = JSON.parse((await call('GET', 'k')).body);
  assert.deepStrictEqual(Object.keys(got.fairies).filter((k) => got.fairies[k].ships), ['poppy', 'velvet', 'ember', 'flint']);
  assert.strictEqual(got.fairies.flint.voice, '');   // no voice id yet
  assert.strictEqual(got.fairies.velvet.voice, 'sZXgk6vPj5VwF6GvqUUu'); assert(!('chosen' in got.fairies) && !('_note' in got.fairies));
  await call('POST', 'k', { fairies: { velvet: { image: 'velvet_v1.png' } } });
  assert.strictEqual(JSON.parse((await call('GET', 'k')).body).fairies.velvet.image, 'velvet_v1.png');
  await call('POST', 'k', { fairies: { velvet: { image: '../../secret.png' } } });                                      // a path out of the folder is refused
  assert.strictEqual(JSON.parse((await call('GET', 'k')).body).fairies.velvet.image, 'velvet_v1.png');
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
