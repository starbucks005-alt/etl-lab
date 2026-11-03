#!/usr/bin/env node
/* record-twins-lines: speaks every line in al-panel/twins-lines.json in the right twin's voice and saves one mp3
   per line, so the tablet page (al-panel/twins.html) can replay them for free.

   Written for Dr. O, 2026-11-02. Nothing here is run by the site. You run it on your own computer.
   Voices: Astro is Teddy (kqf3165btzkiiwqxmo1q), Astri is t32lqiRDyoLz0gaRQCGT, both ElevenLabs character
   voices you made. They come from the "voice" field in twins-lines.json.

   Usage (PowerShell, in the repository folder)
     $env:ELEVENLABS_API_KEY = "your key"      # typed by you, in your own window; never saved in a file
     node tools/record-twins-lines.js --dry    # lists every line and file, spends nothing
     node tools/record-twins-lines.js          # records only the lines that have no file yet
     node tools/record-twins-lines.js --only astri   # one twin only

   Options  --only astro|astri   record one twin
            --version 2          make *_v2.mp3 files (new words or a new voice; the page must then point to v2)
            --model eleven_turbo_v2_5

   Files land in audio/robots/twins/<twin>-<line>_v1.mp3. A file that exists is never overwritten or re-recorded,
   so running it twice costs nothing the second time. Cost: one short request per missing line.
   Not tried against the real service from here. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const dry = process.argv.includes('--dry');
const only = arg('only', '');
const version = parseInt(arg('version', '1'), 10) || 1;
const model = arg('model', 'eleven_turbo_v2_5');
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true };

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'al-panel', 'twins-lines.json'), 'utf8'));
const outDir = path.join(ROOT, 'audio', 'robots', 'twins');

const jobs = [];
for (const who of Object.keys(data.twins)) {
  if (only && only !== who) continue;
  const t = data.twins[who];
  for (const key of Object.keys(t.lines)) {
    const file = path.join(outDir, who + '-' + key + '_v' + version + '.mp3');
    jobs.push({ who, key, text: t.lines[key], voice: t.voice, file, have: fs.existsSync(file) });
  }
}
const todo = jobs.filter((j) => !j.have);
const chars = todo.reduce((n, j) => n + j.text.length, 0);
console.log(jobs.length + ' lines, ' + todo.length + ' to record (' + chars + ' characters), ' + (jobs.length - todo.length) + ' already have a file.');
todo.forEach((j) => console.log('  ' + path.basename(j.file) + '  [' + j.voice + ']  ' + j.text));
if (dry || !todo.length) { console.log(dry ? '\nDry run: nothing was sent and nothing was saved.' : '\nNothing to record.'); process.exit(0); }

async function speak(text, voice) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { throw new Error('no_elevenlabs_key'); }
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voice), {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS })
  });
  if (!r.ok) { throw new Error('ElevenLabs ' + r.status + ': ' + (await r.text()).slice(0, 200)); }
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const j of todo) {
    try {
      const mp3 = await speak(j.text, j.voice);
      fs.writeFileSync(j.file, mp3);
      n++;
      console.log('saved ' + path.basename(j.file) + ' (' + mp3.length + ' bytes)');
    } catch (e) {
      console.error('\nStopped at ' + path.basename(j.file) + ': ' + e.message + (e.message === 'no_elevenlabs_key' ? ' (set ELEVENLABS_API_KEY in this window first)' : ''));
      console.error(n + ' saved before the stop. Run it again to continue; saved lines are skipped.');
      process.exit(1);
    }
  }
  console.log('\nDone: ' + n + ' recorded. Listen to them, then tell Claude to commit.');
})();
