/* sun-details.test.js: plain node, `node tests/sun-details.test.js`. The little details: kept by the product, said by the fairy on the right morning, available in a chat. Stand-ins only. */
const assert = require('assert');
const sun = require('../netlify/functions/_sun.js');
const settings = require('../netlify/functions/sun-settings.js');
const m = require('../netlify/functions/sun-morning.js');
const personas = require('../rising-sun/personas.json');
(async () => {
  // saving
  const mem = {}; const store = { get: async (k) => mem[k] || null, setJSON: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
  const call = (body) => settings.handler({ httpMethod: 'POST', headers: { 'x-sun-key': 'k' }, body: JSON.stringify(body) }, {}, { env: { SUN_DEVICE_KEY: 'k' }, store });
  let r = JSON.parse((await call({ details: [{ date: '5-14', text: "Mom's birthday" }, { date: '', text: 'Dad likes Moon River' }, { date: '13-40', text: 'bad date kept as text only' }, { text: '   ' }, { date: '02-30x', text: 'x' }] })).body).settings;
  assert.deepStrictEqual(r.details.map((x) => [x.date, x.text]), [['05-14', "Mom's birthday"], ['', 'Dad likes Moon River'], ['', 'bad date kept as text only'], ['', 'x']]);   // dates are checked, blanks dropped
  r = JSON.parse((await call({ details: Array.from({ length: 60 }, (_, i) => ({ text: 'n' + i })) })).body).settings;
  assert.strictEqual(r.details.length, 40);
  // which morning
  const d = [{ date: '05-14', text: "Mom's birthday" }, { date: '', text: 'Dad likes Moon River' }, { date: '12-25', text: 'Christmas' }];
  assert.strictEqual(sun.detailsToday(d, 'eastern', Date.parse('2026-05-14T15:00:00Z')).length, 1);
  assert.strictEqual(sun.detailsToday(d, 'eastern', Date.parse('2026-05-15T15:00:00Z')).length, 0);
  assert.strictEqual(sun.detailsToday(d, 'hawaii', Date.parse('2026-05-15T05:00:00Z')).length, 1);   // 05:00 UTC on the 15th is still the 14th in Hawaii
  assert.strictEqual(sun.detailsToday(d, 'pacific', Date.parse('2026-12-25T04:00:00Z')).length, 0);  // and still the 24th in Pacific time
  // the wake line: a saved date today is said in the fairy's voice, through the model
  let seen;
  const ask = async (sys, text) => { seen = { sys, text }; return "It is your mom's birthday today, and I think she would love a call."; };
  const w = await m.step({ step: 'wake', fairy: 'poppy' }, { personas, details: d, zone: 'eastern', now: Date.parse('2026-05-14T15:00:00Z'), ask });
  assert(w.say.startsWith('Good morning, human. It is your mom') && w.today === 1);
  assert(/Mom's birthday/.test(seen.text) && /Poppy/.test(seen.sys) && /own voice/.test(seen.text));
  // nothing today: the model is not asked at all
  let asked = false;
  const w2 = await m.step({ step: 'wake', fairy: 'poppy' }, { personas, details: d, zone: 'eastern', now: Date.parse('2026-05-15T15:00:00Z'), ask: async () => { asked = true; return 'x'; } });
  assert(!asked && w2.today === 0 && w2.say.startsWith('Good morning, human. Good morning sunshine.'));
  // the model is down: the plain words still go out
  const w3 = await m.step({ step: 'wake' }, { personas, details: d, zone: 'eastern', now: Date.parse('2026-05-14T15:00:00Z'), ask: async () => { throw new Error('down'); } });
  assert(/Today: Mom's birthday\./.test(w3.say));
  // chat: every detail is available to the fairy, dates included
  const mc = (() => { const x = {}; return { load: async (f) => x[f] || [], save: async (f, v) => { x[f] = v; } }; })();
  await m.step({ step: 'chat', fairy: 'poppy', text: 'What is a good song for Dad?' }, { personas, chat: mc, details: d, ask });
  assert(/Dad likes Moon River/.test(seen.sys) && /05-14 Mom's birthday/.test(seen.sys) && /without reading them out as a list/.test(seen.sys));
  // an answer (not chat) does not carry them
  await m.step({ step: 'answer', heard: 'tell me a joke' }, { personas, details: d, ask });
  assert(!/Moon River/.test(seen.sys));
  // Poppy says what she is given and does not claim a memory
  assert(/never claim to remember anything you were not given/.test(m.fairyPrompt(personas.poppy, 'chat', personas.court, d)));
  // Tansy's seasonal gardening line, depending on the time zone and the date
  let tipSeen, calls = 0;
  const askTip = async (sys, text) => { calls++; tipSeen = text; return "It is that time of year to plant garlic, and I expect you to do it properly."; };
  const wt = await m.step({ step: 'wake', fairy: 'tansy' }, { personas, details: [], zone: 'pacific', now: Date.parse('2026-10-18T15:00:00Z'), ask: askTip });
  assert(wt.tip === true && wt.say.startsWith('Are you ready to basque in my glory? It is that time of year to plant garlic'));
  assert(/October 18/.test(tipSeen) && /Pacific time zone/.test(tipSeen) && /never state an exact frost date/.test(tipSeen));
  await m.step({ step: 'wake', fairy: 'tansy' }, { personas, details: [], zone: 'hawaii', now: Date.parse('2026-10-18T15:00:00Z'), ask: askTip });
  assert(/Hawaii/.test(tipSeen));                                                              // the place follows the time zone they chose
  const before = calls;
  const wn = await m.step({ step: 'wake', fairy: 'poppy' }, { personas, details: [], zone: 'eastern', now: Date.parse('2026-10-18T15:00:00Z'), ask: askTip });
  assert(calls === before && wn.tip === false);                                                  // a fairy with no wake_tip adds nothing and costs nothing
  const wd = await m.step({ step: 'wake', fairy: 'tansy' }, { personas, details: [], zone: 'eastern', now: Date.parse('2026-10-18T15:00:00Z'), ask: async () => { throw new Error('down'); } });
  assert(wd.tip === false && wd.say.startsWith('Are you ready to basque in my glory? Good morning sunshine.'));   // the thinking is down: she skips it
  assert(sun.longDate('eastern', Date.parse('2026-01-05T03:00:00Z')) === 'January 4');            // the evening before, in their own time zone
  // Velvet's self-care invitation and Flint's idea for the day, each once a morning, in their own voice
  const seenTips = {};
  const askAny = async (sys, text) => { seenTips.last = text; return 'A line in their voice.'; };
  for (const f of ['velvet', 'flint', 'ash']) {
    seenTips[f] = null;
    const r = await m.step({ step: 'wake', fairy: f }, { personas, details: [], zone: 'central', now: Date.parse('2026-10-18T15:00:00Z'), ask: async (sys, text) => { seenTips[f] = text; return 'A line in their voice.'; } });
    assert.strictEqual(r.tip, f !== 'ash');
  }
  assert(/make today about the two of you/.test(seenTips.velvet) && /staying in bed and watching TV, reading a book/.test(seenTips.velvet) && /no medical advice/i.test(seenTips.velvet));
  assert(/fun thing to do today/.test(seenTips.flint) && /do not rely on the weather/.test(seenTips.flint) && /Central time zone/.test(seenTips.flint));
  assert(seenTips.ash === null);                                                                    // Ash has no daily line of his own: the time is his, and it needs no model call
  const fl = sun.fairyList(personas, {});
  assert.deepStrictEqual(fl.ash.keeps, ['wake', 'reminders']); assert.deepStrictEqual(fl.ember.keeps, ['sunrise']);
  assert.deepStrictEqual(fl.poppy.keeps, ['music', 'details']); assert.deepStrictEqual(fl.blue.keeps, ['calendar']);
  assert.deepStrictEqual(fl.tansy.keeps, ['news']); assert.deepStrictEqual(fl.velvet.keeps, ['selfcare']); assert.deepStrictEqual(fl.flint.keeps, ['fun']);
  assert.strictEqual(fl.ash.title, 'Guardian of time');
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
