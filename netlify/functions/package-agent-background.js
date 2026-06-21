/* package-agent-background — Netlify background function (15-min limit).
   Builds the delivery ZIP for a completed agent spec and stores it.
   POST body: { ref: '<build_requests blob key>' }
   Netlify returns 202 immediately; box is ready when check-agent-box returns { ready: true }.
*/

const { getStore } = require('@netlify/blobs');
const JSZip = require('jszip');

function slugify(n) {
  return (n || 'agent')
    .toLowerCase()
    .replace(/["''.]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map(function(w) {
    return w[0] ? w[0].toUpperCase() : '';
  }).join('');
}

function buildInstructions(spec, ref, portraitDataUrl, portraitFilename) {
  const name     = spec.name    || 'Your Agent';
  const role     = spec.role    || '';
  const tagline  = spec.tagline || '';
  const s        = slugify(name);
  const chatUrl  = 'https://emerging-tech-lab.com/agent-chat?ref=' + encodeURIComponent(ref);
  const voiceStyle  = (spec.voice && spec.voice.style)  || '';
  const voiceSample = (spec.voice && spec.voice.sample) || '';
  const inits       = initials(name);

  const portraitTag = portraitDataUrl
    ? `<img class="portrait" src="${portraitDataUrl}" alt="${name}">`
    : `<div class="initials">${inits}</div>`;

  const portraitRow = portraitFilename
    ? `<li><b>${portraitFilename}</b> - ${name}'s portrait. Place in your site's <code>/agents/</code> or <code>/assets/</code> folder.</li>`
    : '';

  const voiceNote = voiceStyle
    ? `<div class="note">If you ordered voice design ($8), ETL will send you an ElevenLabs voice ID to use in any TTS-powered surface.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} - Your ETL Agent</title>
<style>
:root{--bg:#0e0b07;--panel:#1c1610;--panel2:#261d0f;--line:#3d2e1a;--amber:#e8a844;--cream:#f4ead8;--text:#d8c8a8;--mute:#8a7660;}
*,*::before,*::after{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;}
.ribbon{background:#0a0704;border-bottom:1px solid var(--line);text-align:center;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--mute);padding:.55rem;}
.ribbon b{color:var(--amber);}
.wrap{max-width:680px;margin:0 auto;padding:2.4rem 1.6rem 5rem;}
.agent-hero{display:flex;align-items:center;gap:1.5rem;margin-bottom:2.6rem;}
.portrait{width:100px;height:100px;border-radius:50%;object-fit:cover;object-position:top center;border:2px solid var(--line);flex-shrink:0;}
.initials{width:100px;height:100px;border-radius:50%;background:var(--panel2);border:2px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:2.2rem;font-weight:700;color:var(--amber);flex-shrink:0;}
.agent-name{font-size:2rem;font-weight:700;color:var(--cream);margin:0 0 .25rem;font-family:Georgia,serif;}
.agent-role{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin-bottom:.3rem;}
.agent-tagline{font-size:.92rem;color:var(--mute);}
h2{font-size:1.05rem;font-weight:600;color:var(--cream);border-bottom:1px solid var(--line);padding-bottom:.4rem;margin:2.2rem 0 .9rem;}
.link-box{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:.7rem 1rem;font-family:monospace;font-size:.88rem;color:var(--amber);word-break:break-all;margin-bottom:.5rem;}
.link-box a{color:var(--amber);}
.file-list{list-style:none;margin:0;padding:0;}
.file-list li{padding:.45rem 0;border-bottom:1px solid rgba(61,46,26,.5);font-size:.9rem;}
.file-list li:last-child{border-bottom:none;}
.file-list b{color:var(--cream);}
.file-list code{font-family:monospace;font-size:.85em;color:var(--mute);}
.voice-block{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:1rem 1.2rem;}
.voice-row{margin-bottom:.6rem;font-size:.9rem;}
.voice-row:last-child{margin-bottom:0;}
.vl{font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin-bottom:.18rem;}
.vv{color:var(--cream);}
.embed-box{background:#100d08;border:1px solid var(--line);border-radius:8px;padding:.9rem 1.1rem;font-family:monospace;font-size:.82rem;color:var(--cream);overflow-x:auto;white-space:pre-wrap;word-break:break-all;}
.note{background:var(--panel2);border-left:3px solid var(--amber);padding:.7rem .9rem;border-radius:0 6px 6px 0;font-size:.86rem;color:var(--mute);margin:1.1rem 0;}
footer{border-top:1px solid var(--line);margin-top:3rem;padding-top:.85rem;font-size:.78rem;color:var(--mute);}
</style>
</head>
<body>
<div class="ribbon">Emerging Technologies Laboratory &nbsp; <b>${name} is ready.</b></div>
<div class="wrap">

<div class="agent-hero">
  ${portraitTag}
  <div>
    <div class="agent-name">${name}</div>
    <div class="agent-role">${role}</div>
    <div class="agent-tagline">${tagline}</div>
  </div>
</div>

<h2>Talk to ${name} now</h2>
<div class="link-box"><a href="${chatUrl}">${chatUrl}</a></div>
<p style="font-size:.85rem;color:var(--mute);margin:.5rem 0 0;">Open this link from any device, any browser. No login required.</p>

<h2>What's in this box</h2>
<ul class="file-list">
  <li><b>${s}-spec.json</b> - The full agent specification. Keep this safe. Use it to rebuild, transfer, or upgrade ${name}.</li>
  <li><b>voice-config.json</b> - Voice style and sample. ETL uses ElevenLabs to generate and assign ${name}'s voice from these settings.</li>
  ${portraitRow}
  <li><b>instructions.html</b> - This file. Everything you need to deploy ${name}.</li>
</ul>

<h2>${name}'s voice</h2>
<div class="voice-block">
  <div class="voice-row"><div class="vl">Style</div><div class="vv">${voiceStyle || '(contact ETL to configure)'}</div></div>
  <div class="voice-row"><div class="vl">Sample line</div><div class="vv">"${voiceSample}"</div></div>
  <div class="voice-row"><div class="vl">Provider</div><div class="vv">ElevenLabs Voice Design</div></div>
</div>
${voiceNote}

<h2>Put ${name} on your site</h2>
<p style="font-size:.9rem;color:var(--mute);margin:0 0 .8rem;">Once ETL provisions your embed key, paste this one line where you want ${name} to appear:</p>
<div class="embed-box">&lt;!-- ${name} chat widget - paste once, works everywhere --&gt;
&lt;script
  src="https://emerging-tech-lab.com/embed/agent.js"
  data-agent="${s}"
  data-key="sk-etl-your-key"&gt;&lt;/script&gt;</div>
<div class="note">Embed keys are provisioned by ETL after delivery. Contact the lab to receive yours.</div>

</div>
<footer class="wrap" style="padding-top:0;">
  Emerging Technologies Laboratory - Dr. Terry L. Oroszi<br>
  ${name} - Your agent, your site, your keys.
</footer>
</body>
</html>`;
}

exports.handler = async function(event) {
  let ref = '';
  try {
    const body = JSON.parse(event.body || '{}');
    ref = (body.ref || '').trim();
  } catch (_) {}
  if (!ref) ref = ((event.queryStringParameters || {}).ref || '').trim();
  if (!ref) return { statusCode: 400, body: '' };

  const blobStore = getStore('build_requests');
  const pkgStore  = getStore('agent_packages');

  let record;
  try { record = await blobStore.get(ref, { type: 'json' }); }
  catch (_) { record = null; }

  if (!record) return { statusCode: 404, body: '' };

  const spec = record.spec || record;
  const name = spec.name || 'Agent';
  const s    = slugify(name);

  // Portrait
  let portraitBase64   = null;
  let portraitFilename = '';
  let portraitDataUrl  = null;

  if (spec.image) {
    if (spec.image.portrait_base64) {
      portraitBase64   = spec.image.portrait_base64;
      portraitFilename = spec.image.eyes_open || (s + '_eyes_open.png');
      portraitDataUrl  = 'data:image/png;base64,' + portraitBase64;
    } else if (spec.image.generated_url) {
      try {
        const resp = await fetch(spec.image.generated_url, { signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          portraitBase64   = Buffer.from(buf).toString('base64');
          portraitFilename = s + '_portrait.png';
          portraitDataUrl  = 'data:image/png;base64,' + portraitBase64;
        }
      } catch (_) {}
    }
  }

  // Build ZIP
  const zip = new JSZip();

  zip.file(s + '-spec.json', JSON.stringify(spec, null, 2));

  zip.file('voice-config.json', JSON.stringify({
    agent:    name,
    provider: 'elevenlabs',
    style:    (spec.voice && spec.voice.style)  || '',
    sample:   (spec.voice && spec.voice.sample) || '',
    note:     'Use ElevenLabs Voice Design with this style and sample to generate the agent voice.'
  }, null, 2));

  if (portraitBase64 && portraitFilename) {
    zip.file(portraitFilename, portraitBase64, { base64: true });
  }

  zip.file('instructions.html', buildInstructions(spec, ref, portraitDataUrl, portraitFilename));

  const zipBuf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  const boxKey = ref + '--box';
  await pkgStore.set(boxKey, zipBuf, {
    metadata: { agent: name, content_type: 'application/zip' }
  });

  await blobStore.setJSON(ref, {
    ...record,
    box_ready:    true,
    box_ref:      boxKey,
    box_built_at: new Date().toISOString()
  });

  return { statusCode: 200, body: '' };
};
