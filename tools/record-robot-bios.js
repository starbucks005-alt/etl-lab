#!/usr/bin/env node
/* record-robot-bios: records the first-person bios on the robots page (etl-robots.html)
   in each robot's own voice, so visitors can hear how lifelike they sound.

   Written for Dr. O, 2026-10-25: "we can make new recordings of the bios." Nothing here is
   run by the site. You run it on your own computer. It never guesses a voice: a robot with
   no voice is skipped and the tool says so.

   What it does
     1. Reads each robot's card on etl-robots.html and takes the words in its quote block,
        exactly as visitors read them (Astra-9, Elle, A.L.I.C.E., Reggie, Biscuit, Mochi).
     2. Speaks them in that robot's voice (the ids Good Company already uses).
     3. Saves one mp3 per robot, with _v1 on the name (new name, so it reaches the site).
     4. With --update-page, points that card's Hear button at the new recording and shows it
        (the page keeps the Hear buttons hidden until a recording exists).

   Usage
     node tools/record-robot-bios.js --dry                     the words, length and rough cost, no key needed
     ELEVENLABS_API_KEY=... node tools/record-robot-bios.js    record all
     ELEVENLABS_API_KEY=... node tools/record-robot-bios.js --only alice,reggie --update-page

   Options  --only astra9,astrad,elle,alice,reggie,biscuit,mochi   --out dir (default audio/robots)
            --version 1 (bump to 2 to make a new file and keep the old one)
            --voice astrad=VOICEID   (Astrad and Elle have no voice set here: give one, or they are skipped)
            --model eleven_turbo_v2_5   --update-page   --dry

   Elle, Astra-9, Astrad, A.L.I.C.E. and Reggie: Dr. O recorded their bios herself (audio/robots/elle-voice_v1.mp3,
   astra9-voice_v1.mp3, astrad-voice_v1.mp3, alice-voice_v1.mp3 and reggie-voice_v1.mp3, 2026-10-25; Astrad's is the Azure
   voice Brandon), so run this with --only for the others, for example --only biscuit,mochi. Elle has no voice set here unless you give one.

   Needs: Node 18 or newer and an ElevenLabs key. A voice written azure:en-US-... is spoken
   by Azure (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION). Astrad has no voice set here: give his with --voice astrad=azure:en-US-NameNeural or an
   ElevenLabs id. Check that your ElevenLabs plan allows these recordings to
   be played on a public page: that was not checked. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'etl-robots.html');
const VOICES = {
  astra9: 'weA4Q36twV5kwSaTEL0Q',
  alice: 'gZL79pBTvaNfNPOCXh6n',
  reggie: 'uq0HIbNZKn11Hs5ifEdd',
  biscuit: 'MgqVq3OCTPeVHCEDr4HU',
  mochi: 'I8ERYU9lOxALy2vtIvHd'
};
/* The page heading each robot's card has, to find its quote block. */
const HEADINGS = { astra9: 'Astra-9', astrad: 'Astrad (Ted)', elle: 'Astra-9 Lite', alice: 'A.L.I.C.E.', reggie: 'Reggie', biscuit: 'Biscuit', mochi: 'Mochi' };
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true }; /* same as the story tool */
const PER_MILLION_CHARS = 16; /* a rough guide only */

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const flag = (name) => process.argv.includes('--' + name);

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&rarr;/g, '').replace(/\s+/g, ' ').trim();
}

/* The words in the first <blockquote class="voice"> after the card's heading, paragraph by paragraph. */
function bioFor(html, heading) {
  const re = new RegExp('<h3>(?:<a [^>]*>)?' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:</a>)?</h3>');
  const m = re.exec(html);
  if (!m) return null;
  const rest = html.slice(m.index + m[0].length);
  const nextCard = rest.indexOf('<h3>');
  const scope = nextCard < 0 ? rest : rest.slice(0, nextCard);
  const q = /<blockquote class="voice">([\s\S]*?)<\/blockquote>/.exec(scope);
  if (!q) return null;
  const paras = [...q[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => decode(x[1].replace(/<[^>]+>/g, '')));
  return paras.filter(Boolean);
}

async function tts(key, model, voiceId, text) {
  if (String(voiceId).startsWith('azure:')) {
    const { azureVoiceName, azureSpeak } = require('../netlify/functions/_azure-tts.js');
    const name = azureVoiceName(voiceId);
    if (!name) throw new Error('Not an Azure voice id: ' + voiceId);
    return azureSpeak(text, name);
  }
  if (!key) throw new Error('This voice needs ELEVENLABS_API_KEY: ' + voiceId);
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId), {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS })
  });
  if (!r.ok) throw new Error('ElevenLabs ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const only = String(arg('only', '')).split(',').map((s) => s.trim()).filter(Boolean);
  const out = path.join(ROOT, String(arg('out', 'audio/robots')));
  const version = String(arg('version', '1'));
  const model = String(arg('model', 'eleven_turbo_v2_5'));
  const voices = Object.assign({}, VOICES);
  process.argv.forEach((a, i) => {
    if (a === '--voice') { const [who, id] = String(process.argv[i + 1] || '').split('='); if (who && id) voices[who] = id; }
  });
  const dry = flag('dry');
  const key = process.env.ELEVENLABS_API_KEY;
  if (!dry) fs.mkdirSync(out, { recursive: true });

  let chars = 0, page = html;
  const skipped = [], made = [];
  for (const who of Object.keys(HEADINGS)) {
    if (only.length && !only.includes(who)) continue;
    const paras = bioFor(html, HEADINGS[who]);
    if (!paras) { skipped.push(who + ': no first-person bio on the page'); continue; }
    if (!voices[who]) { skipped.push(who + ': no voice set (give one with --voice ' + who + '=VOICEID)'); continue; }
    const text = paras.join('\n\n');
    chars += text.length;
    const file = who + '-voice_v' + version + '.mp3';
    console.log('\n' + who + '  ' + text.length + ' characters, about ' + Math.round(text.split(/\s+/).length / 2.5) + ' seconds  -> ' + file);
    console.log(text.split('\n\n').map((p) => '  ' + p).join('\n'));
    if (dry) continue;
    const audio = await tts(key, model, voices[who], text);
    fs.writeFileSync(path.join(out, file), audio);
    made.push({ who, file });
    if (flag('update-page')) {
      const rel = '/' + path.relative(ROOT, path.join(out, file)).split(path.sep).join('/');
      /* the card's own button: the first Hear button after this robot's heading */
      const h = new RegExp('<h3>(?:<a [^>]*>)?' + HEADINGS[who].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:</a>)?</h3>').exec(page);
      if (h) {
        const tail = page.slice(h.index);
        const b = /(<button[^>]*class="hearbtn"[^>]*data-src=")([^"]*)(")/.exec(tail);
        const nextH3 = tail.indexOf('<h3>', 10);
        if (b && (nextH3 < 0 || nextH3 > b.index)) {
          /* point the button at the new file and show it (the page keeps it hidden until a recording exists) */
          let fixed = tail.replace(b[0], b[1] + rel + b[3]);
          fixed = fixed.replace('<p class="hear" hidden>', '<p class="hear">');
          page = page.slice(0, h.index) + fixed;
        } else console.log('  (no Hear button found for ' + who + ', page not changed for this one)');
      }
    }
  }
  console.log('\n' + (dry ? 'DRY RUN. ' : '') + chars + ' characters in all, about $' + (chars / 1e6 * PER_MILLION_CHARS).toFixed(2) + ' at the rough rate.');
  if (skipped.length) console.log('Skipped:\n  ' + skipped.join('\n  '));
  if (!dry && made.length) {
    if (flag('update-page')) { fs.writeFileSync(PAGE, page); console.log('etl-robots.html: Hear buttons now point at the new recordings.'); }
    console.log('Written to ' + out + ': ' + made.map((m) => m.file).join(', '));
    console.log('Listen to each one before you commit and push them.');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
