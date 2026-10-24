#!/usr/bin/env node
/* record-pack-stories: turns the written dog stories (pack-episodes.json) into
   recorded audio, one mp3 per story, with a different voice for each dog.

   Written for Dr. O, 2026-10-24: "stories as an add-on, prerecorded, the user
   downloads them and plays." Nothing here is run by the site. You run it on
   your own computer.

   What it does
     1. Takes the stories (the six in pack-episodes.json, or a file you give it
        with --file, for example the review export of the saved ones).
     2. Fixes Biscuit's name lines, because a recording cannot say each
        listener's name. The {name} slot becomes "sweet pea" (her own pet name
        for people), or is dropped where the line already says it.
     3. Voices every beat in that dog's voice (Reggie, Biscuit, Mochi), then the
        "later that evening" scene in Biscuit's voice, and joins the pieces with
        a short pause into one mp3 per story.
     4. Writes a manifest.json that lists every story, its length and its file.

   Usage
     node tools/record-pack-stories.js --dry                 plan and cost only, no key needed
     node tools/record-pack-stories.js --only trash          one story
     ELEVENLABS_API_KEY=... node tools/record-pack-stories.js    record all

   Options  --file path.json   --out dir (default recorded-stories)   --pause 0.5
            --model eleven_turbo_v2_5   --only id,id   --dry

   Needs: Node 18 or newer, ffmpeg on the PATH, and an ElevenLabs key. The voice
   ids are the ones already used by Good Company (gc-friend.js). Check that your
   ElevenLabs plan allows selling recordings made with these voices before you
   sell them: that was not checked.

   New files get new names: the output files end in _v1. Do not overwrite a
   recording that is already on the site; bump to _v2 with --version 2. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VOICES = {
  reggie: 'uq0HIbNZKn11Hs5ifEdd',
  biscuit: 'MgqVq3OCTPeVHCEDr4HU',
  mochi: 'I8ERYU9lOxALy2vtIvHd'
};
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true }; /* same as gc-voice.js */
const PER_MILLION_CHARS = 16; /* the neural voice rate quoted in the one-pager, a rough guide only */

/* A recording cannot say the listener's name. Biscuit's own pet name for
   people is "sweet pea", so that is what the slot becomes. Where the same line
   already says "sweet pea" the slot is dropped, so she never says it twice. */
function fixNameSlot(text) {
  return String(text || '').split('\n').map((line) => {
    if (!line.includes('{name}')) return line;
    if (/sweet pea/i.test(line)) {
      return line.replace(/,?\s*\{name\}/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1');
    }
    return line
      .replace(/^(\w+) \{name\}/, '$1, sweet pea')
      .replace(/,\s*\{name\}/g, ', sweet pea')
      .replace(/\s*\{name\}/g, ', sweet pea');
  }).join('\n');
}

function speakable(text) {
  return fixNameSlot(text).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function plan(ep) {
  const parts = [];
  (ep.beats || []).forEach((b, i) => {
    const who = String(b.who || '').toLowerCase();
    if (!VOICES[who]) throw new Error(ep.id + ' beat ' + i + ': unknown speaker ' + who);
    parts.push({ who, text: speakable(b.text) });
  });
  if (ep.evening) parts.push({ who: 'biscuit', text: speakable(ep.evening), evening: true });
  return parts;
}

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

async function tts(key, model, voiceId, text) {
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId), {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS })
  });
  if (!r.ok) throw new Error('ElevenLabs ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return Buffer.from(await r.arrayBuffer());
}

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

async function main() {
  const file = arg('file', path.join(__dirname, '..', 'pack-episodes.json'));
  const out = arg('out', 'recorded-stories');
  const version = String(arg('version', '1'));
  const pause = Number(arg('pause', '0.5'));
  const model = arg('model', 'eleven_turbo_v2_5');
  const only = arg('only', '') ? String(arg('only')).split(',') : null;
  const dry = !!arg('dry', false);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const eps = (data.episodes || data).filter((e) => !only || only.includes(e.id));
  if (!eps.length) { console.error('No stories to record.'); process.exit(1); }

  let chars = 0, wordsTotal = 0;
  const jobs = eps.map((ep) => {
    const parts = plan(ep);
    const c = parts.reduce((n, p) => n + p.text.length, 0);
    const w = parts.reduce((n, p) => n + words(p.text), 0);
    chars += c; wordsTotal += w;
    console.log('%s  "%s"  %d parts, %d words, about %d minutes spoken', ep.id.padEnd(10), ep.place, parts.length, w, Math.round(w / 150));
    return { ep, parts };
  });
  console.log('\nTotal: %d characters, about %d minutes. At roughly $%d per million characters that is about $%s (a guide, not a quote).', chars, Math.round(wordsTotal / 150), PER_MILLION_CHARS, (chars * PER_MILLION_CHARS / 1e6).toFixed(2));

  if (dry) {
    const first = jobs[0].parts.filter((p) => p.who === 'biscuit').slice(0, 2);
    console.log('\nDry run. Sample of Biscuit after the name fix:');
    first.forEach((p) => console.log('  ' + p.text.slice(0, 160) + '...'));
    return;
  }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { console.error('Set ELEVENLABS_API_KEY to record, or use --dry.'); process.exit(1); }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { console.error('ffmpeg is needed to join the pieces.'); process.exit(1); }

  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pack-'));
  const silence = path.join(tmp, 'silence.mp3');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(pause), '-q:a', '9', silence], { stdio: 'ignore' });

  const manifest = [];
  for (const { ep, parts } of jobs) {
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const f = path.join(tmp, ep.id + '-' + String(i).padStart(2, '0') + '.mp3');
      fs.writeFileSync(f, await tts(key, model, VOICES[p.who], p.text));
      files.push(f);
      process.stdout.write('.');
    }
    const list = path.join(tmp, ep.id + '.txt');
    fs.writeFileSync(list, files.map((f) => "file '" + f + "'\nfile '" + silence + "'").join('\n') + '\n');
    const target = path.join(out, 'reggie-biscuit-mochi_' + ep.id + '_v' + version + '.mp3');
    execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', target], { stdio: 'ignore' });
    const bytes = fs.statSync(target).size;
    manifest.push({ id: ep.id, title: ep.place, file: path.basename(target), bytes, voices: Object.keys(VOICES), nameSlot: 'sweet pea' });
    console.log('\n  wrote ' + target + ' (' + Math.round(bytes / 1024) + ' KB)');
  }
  fs.writeFileSync(path.join(out, 'manifest_v' + version + '.json'), JSON.stringify({ made: new Date().toISOString().slice(0, 10), stories: manifest }, null, 2));
  console.log('\nDone. Listen to each one before it goes anywhere.');
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { fixNameSlot, speakable, plan, VOICES };
