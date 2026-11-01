// Kit in the box: her written life is copied from her Good Company file, her voice (Azure) is asked for raw 16 kHz sound, her picture and wake name exist.
const fs = require('fs'), path = require('path');
const lines = require('../rising-sun/box-lines.json');
const { elevenPcm } = require('../netlify/functions/box-line.js');
const talk = require('../netlify/functions/box-talk.js');
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const k = lines.companions.kit;
ok(k && k.display === 'Kit', 'Kit is a box companion');
ok(/^azure:en-GB-Ada/.test(k.voiceId), 'her voice is the Azure Ada voice Dr. O picked');
ok(fs.existsSync(path.join(__dirname, '..', k.face)), 'her lid picture exists');
ok(k.wake && k.wake.name === 'Kit' && /^[A-Za-z]+$/.test(k.wake.phoneme), 'she has a wake name');
const gc = fs.readFileSync(path.join(__dirname, '..', 'good-company', 'gc-friend.js'), 'utf8');
ok(gc.includes(k.persona.habit.replace(/'/g, "\\x27")) || gc.includes(k.persona.habit), 'her habit is copied from her Good Company file');
ok(!/[–—]/.test(JSON.stringify(k)), 'no long dashes in what she says');
(async () => {
  let seen = {};
  const buf = await elevenPcm('Hello, boss.', k.voiceId, { env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'eastus' }, fetchFn: async (u, o) => { seen = { u, o }; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }; } });
  ok(seen.o && seen.o.headers['X-Microsoft-OutputFormat'] === 'raw-16khz-16bit-mono-pcm', 'Azure is asked for raw 16 kHz sound');
  ok(/tts\.speech\.microsoft\.com/.test(seen.u) && /Ada/.test(seen.o.body), 'the request goes to Azure with her voice');
  ok(buf.length === 2, 'the sound comes back as it is');
  console.log(bad ? bad + ' check(s) failed' : 'Kit in the box: life, voice, picture and wake name in place');
  process.exit(bad ? 1 : 0);
})();
