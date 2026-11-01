// Every companion in the box is built the way she should be: she speaks as herself, only the fairies are fairies, her own words are in her prompt, and she has a voice, a picture and the two fixed lines.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { handler } = require('../netlify/functions/box-talk.js');
const gc = require('../netlify/functions/_gc-config.js');
const FILE = require('../rising-sun/box-lines.json');

(async () => {
  const KEY = 'k1', cfg = async () => ({ sun_key_hash: gc.hash(KEY) });
  const mem = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
  const FAIRIES = ['tansy', 'blue', 'poppy', 'ash', 'velvet', 'ember', 'flint'];
  let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
  const ids = Object.keys(FILE.companions);
  ok(ids.length >= 28, 'the box has its companions, found ' + ids.length);
  for (const id of FAIRIES) ok(FILE.companions[id], id + ' is in the box (a fairy)');
  for (const id of ids) {
    const c = FILE.companions[id];
    ok(c.display && c.voiceId, id + ' has a name and a voice');
    ok(c.lines && c.lines.didnt_hear !== undefined, id + ' has her fixed lines');
    ok(c.face && fs.existsSync(path.join(__dirname, '..', c.face)), id + ' has a picture on disk');
    ok(!/[–—]/.test(JSON.stringify(c)) && !/plainly/i.test(JSON.stringify(c)), id + ' has no long dash and no "plainly" in what she says');
    let sys = '';
    const r = await handler({ httpMethod: 'POST', headers: { 'x-sun-key': KEY }, queryStringParameters: { companion: id }, body: Buffer.alloc(20000, 1).toString('base64'), isBase64Encoded: true },
      { env: {}, loadCfg: cfg, lines: FILE, store: mem(), lineStore: mem(), saved: {}, now: () => new Date('2026-11-01T12:00:00Z'), listen: async () => 'hello there',
        ask: async (s) => { sys = s; return 'Hello.'; }, speak: async () => Buffer.from([1, 2]) });
    ok(r.statusCode === 200, id + ' answers (got ' + r.statusCode + ')');
    const isFairy = FAIRIES.indexOf(id) >= 0;
    ok(isFairy ? /a fairy/.test(sys) : !/, a fairy,/.test(sys), id + (isFairy ? ' is spoken as a fairy' : ' is not spoken as a fairy'));
    ok(new RegExp('You are ' + (c.persona ? c.persona.name : c.display).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(sys) || isFairy, id + ' speaks as herself or himself');
    if (c.persona && c.persona.habit) ok(sys.indexOf(c.persona.habit.slice(0, 40)) >= 0, id + ': her written habit is in her prompt');
  }
  console.log(bad ? bad + ' check(s) failed' : 'box companions: ' + ids.length + ' built and spoken as themselves');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
