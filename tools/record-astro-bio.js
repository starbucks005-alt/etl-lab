#!/usr/bin/env node
/* record-astro-bio: speaks Astro's bio in his voice and saves it as an mp3, so a visitor can hear him
   on his panel and Dr. O can hear whether he sounds like a child.

   Written for Dr. O, 2026-10-31. Nothing here is run by the site. You run it on your own computer.
   It reads the words from al-panel/robots.json (the "bio" text of the robot called astro), so the page and
   the recording always say the same thing. The voice is Teddy, the ElevenLabs voice Dr. O made for him
   (kqf3165btzkiiwqxmo1q). An Azure voice still works: give --voice azure:en-US-Name:DragonHDFlashLatestNeural.

   Usage (PowerShell, in the repository folder)
     $env:ELEVENLABS_API_KEY = "your key"     # typed by you, in your own window; never saved in a file
     node tools/record-astro-bio.js --dry     # shows the words and the voice, spends nothing
     node tools/record-astro-bio.js           # records one file: audio/robots/astro-voice_v2.mp3
     (for an Azure voice instead: set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, and pass --voice azure:...)

   Options  --voice VOICEID or azure:en-US-NameNeural   speak with another voice (this is how to try a different one)
            --version 3                      make astro-voice_v3.mp3 and keep the old files (default 2: v1 is the old words)
            --model eleven_turbo_v2_5        the ElevenLabs model
            --out dir                        where to save (default audio/robots)

   Cost: one short recording is one request. Replaying the saved file costs nothing.
   Not tried against the real services from here. Teddy's voice id was not checked on your ElevenLabs account. */
const fs = require('fs');
const path = require('path');
const { azureVoiceName, azureSpeak } = require('../netlify/functions/_azure-tts.js');

const ROOT = path.join(__dirname, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const dry = process.argv.includes('--dry');

const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'al-panel', 'robots.json'), 'utf8'));
const astro = (roster.robots || []).find((r) => r.id === 'astro');
if (!astro || !astro.bio || !astro.bio.text) { console.error('No bio text found for astro in al-panel/robots.json.'); process.exit(1); }

const voiceId = arg('voice', 'kqf3165btzkiiwqxmo1q');
const isAzure = String(voiceId).startsWith('azure:');
const voice = isAzure ? azureVoiceName(voiceId) : voiceId;
if (!voice) { console.error('That is not an Azure voice id. It must look like azure:en-US-Name:DragonHDFlashLatestNeural'); process.exit(1); }
const model = arg('model', 'eleven_turbo_v2_5');
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true }; // same as the other bio tool

async function speak(text) {
  if (isAzure) { return azureSpeak(text, voice); }
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

const version = parseInt(arg('version', '2'), 10) || 1;
const outDir = path.resolve(ROOT, arg('out', 'audio/robots'));
const outFile = path.join(outDir, 'astro-voice_v' + version + '.mp3');

console.log('Words (' + astro.bio.text.length + ' characters):\n  ' + astro.bio.text + '\n');
console.log('Voice: ' + (isAzure ? 'Azure ' : 'ElevenLabs ') + voice + '\nFile:  ' + outFile);
if (dry) { console.log('\nDry run: nothing was sent and nothing was saved.'); process.exit(0); }
if (fs.existsSync(outFile)) { console.error('\n' + outFile + ' already exists. Use --version ' + (version + 1) + ' to make a new file and keep it.'); process.exit(1); }

(async () => {
  try {
    const mp3 = await speak(astro.bio.text, voice);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, mp3);
    console.log('\nSaved ' + mp3.length + ' bytes. Open it and listen. If it is not right, run again with --voice and the next --version.');
  } catch (e) {
    console.error('\nCould not record: ' + e.message + (e.message === 'no_azure_key' ? ' (set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in this window first)' : e.message === 'no_elevenlabs_key' ? ' (set ELEVENLABS_API_KEY in this window first)' : ''));
    process.exit(1);
  }
})();
