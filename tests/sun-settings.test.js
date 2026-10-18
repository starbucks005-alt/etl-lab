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
  await call('POST', 'k', { fairies: { ember: { name: 'Ember', greeting: 'Wake up, sleepyhead.', ask: 'What shall it be?', manner: 'warm and teasing', backstory: '', voice: 'azure:en-US-JennyNeural' } }, fairy: 'ember' });
  assert.strictEqual(mem.settings.fairy, 'ember');
  const merged = sun.mergePersonas(base, mem.settings);
  assert.strictEqual(merged.ember.greeting, 'Wake up, sleepyhead.'); assert.strictEqual(merged.chosen, 'ember');
  assert.strictEqual(merged.arrogant.greeting, 'Are you ready to basque in my glory?');                                       // the shipped ones stay
  const w = await morning.step({ step: 'wake' }, { personas: merged });
  assert(w.say.startsWith('Wake up, sleepyhead.'));
  assert(/warm and teasing/.test(morning.fairyPrompt(merged.ember)));
  await call('POST', 'k', { fairies: { arrogant: { greeting: 'Behold.' } } });                                                // changing a shipped fairy keeps her other lines
  const m2 = sun.mergePersonas(base, mem.settings);
  assert.strictEqual(m2.arrogant.greeting, 'Behold.'); assert(m2.arrogant.ask.includes('news'));
  await call('POST', 'k', { delete_fairy: 'ember' });
  assert.strictEqual(mem.settings.fairy, 'default'); assert(!mem.settings.fairies.ember);                                     // deleting the chosen one falls back
  await call('POST', 'k', { delete_fairy: 'arrogant' });
  assert(mem.settings.fairies.arrogant);                                                                                       // the shipped ones cannot be deleted
  const dash = sun.cleanPatch({ fairies: { x: { greeting: 'Hello \u2014 there', voice: '../x' } } }).fairies.x;
  assert(!/\u2014/.test(dash.greeting) && !('voice' in dash));
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
