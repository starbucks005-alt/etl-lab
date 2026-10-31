#!/usr/bin/env node
/* record-astro-bio: speaks Astro's bio in his voice and saves it as an mp3, so a visitor can hear him
   on his panel and Dr. O can hear whether he sounds like a child.

   Written for Dr. O, 2026-10-31. Nothing here is run by the site. You run it on your own computer.
   It reads the words from al-panel/robots.json (the "bio" text of the robot called astro), so the page and
   the recording always say the same thing. The voice is the Azure voice Dr. O gave for his live speech.

   Usage (PowerShell, in the repository folder)
     $env:AZURE_SPEECH_KEY = "your key"       # typed by you, in your own window; never saved in a file
     $env:AZURE_SPEECH_REGION = "your region" # for example eastus
     node tools/record-astro-bio.js --dry     # shows the words and the voice, spends nothing
     node tools/record-astro-bio.js           # records one file: audio/robots/astro-voice_v1.mp3

   Options  --voice azure:en-US-NameNeural   speak with another voice (this is how to try a different one)
            --version 2                      make astro-voice_v2.mp3 and keep the old file
            --out dir                        where to save (default audio/robots)

   Cost: one short recording is one request. Replaying the saved file costs nothing.
   Not tried against the real Azure service from here. The voice name was not checked in your region. */
const fs = require('fs');
const path = require('path');
const { azureVoiceName, azureSpeak } = require('../netlify/functions/_azure-tts.js');

const ROOT = path.join(__dirname, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const dry = process.argv.includes('--dry');

const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'al-panel', 'robots.json'), 'utf8'));
const astro = (roster.robots || []).find((r) => r.id === 'astro');
if (!astro || !astro.bio || !astro.bio.text) { console.error('No bio text found for astro in al-panel/robots.json.'); process.exit(1); }

const voiceId = arg('voice', 'azure:en-US-Tyler:DragonHDFlashLatestNeural');
const voice = azureVoiceName(voiceId);
if (!voice) { console.error('That is not an Azure voice id. It must look like azure:en-US-Name:DragonHDFlashLatestNeural'); process.exit(1); }

const version = parseInt(arg('version', '1'), 10) || 1;
const outDir = path.resolve(ROOT, arg('out', 'audio/robots'));
const outFile = path.join(outDir, 'astro-voice_v' + version + '.mp3');

console.log('Words (' + astro.bio.text.length + ' characters):\n  ' + astro.bio.text + '\n');
console.log('Voice: ' + voice + '\nFile:  ' + outFile);
if (dry) { console.log('\nDry run: nothing was sent and nothing was saved.'); process.exit(0); }
if (fs.existsSync(outFile)) { console.error('\n' + outFile + ' already exists. Use --version ' + (version + 1) + ' to make a new file and keep it.'); process.exit(1); }

(async () => {
  try {
    const mp3 = await azureSpeak(astro.bio.text, voice);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, mp3);
    console.log('\nSaved ' + mp3.length + ' bytes. Open it and listen. If he does not sound like a child, run again with --voice and --version 2.');
  } catch (e) {
    console.error('\nCould not record: ' + e.message + (e.message === 'no_azure_key' ? ' (set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in this window first)' : ''));
    process.exit(1);
  }
})();
