/* ─────────────────────────────────────────────────────────────────────────────
   studio-chris-wardrobe-background

   Chris's tailor shop. Generates persona-fitted outfit variants of a PA's
   canonical profile photo using gpt-image-1 via the IMAGES/EDITS endpoint:
   the reference photo anchors the identity (same face, same framing), the
   prompt changes ONLY the clothes. This is the consistency trick text-only
   generation cannot do.

   Trigger (Terry, browser or curl, Basic auth = PRESS_ADMIN creds):
     GET /.netlify/functions/studio-chris-wardrobe-background?pa=auggie
     optional: &only=3 (just outfit #3, 1-based)  &quality=high (default medium)

   Returns 202 immediately; runs up to 15 min. Results land in the
   'pa_wardrobe' blob store as <pa>/<n>.png plus <pa>/index (status JSON).
   View/download via studio-chris-wardrobe.js.

   Outfit catalog: data/pa-wardrobe.json (bundled via netlify.toml).
   ───────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

function checkAdminAuth(event) {
  const expectedUser = process.env.PRESS_ADMIN_USER;
  const expectedPass = process.env.PRESS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) return false;
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [u, p] = decoded.split(':');
  return u === expectedUser && p === expectedPass;
}

function loadWardrobe() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'pa-wardrobe.json'),
    path.join(process.cwd(), 'data', 'pa-wardrobe.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return null;
}

const PROMPT_TEMPLATE = (outfit) =>
  'Edit this photo. Keep the SAME person: identical face, hairstyle, skin tone, ' +
  'expression, pose, camera framing, lighting, and the same soft warm background. ' +
  'Change ONLY the clothing to: ' + outfit + '. ' +
  'Photorealistic professional portrait quality. No text, no watermarks, no logos.';

async function editImage(apiKey, refBuf, prompt, quality) {
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', new Blob([refBuf], { type: 'image/png' }), 'reference.png');
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('quality', quality);
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    body: form,
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || ('openai ' + r.status));
  const b64 = d.data && d.data[0] && d.data[0].b64_json;
  if (!b64) throw new Error('no image in response');
  return Buffer.from(b64, 'base64');
}

exports.handler = async (event) => {
  if (!checkAdminAuth(event)) return { statusCode: 401, body: 'unauthorized' };
  try { connectLambda(event); } catch (_) {}

  const apiKey = process.env.OPENAI_GP_ImageGen_Key || process.env.OPENAI_API_KEY;
  if (!apiKey) return { statusCode: 500, body: 'openai key missing' };

  const params = event.queryStringParameters || {};
  const paSlug = (params.pa || '').toLowerCase().trim();
  const only = params.only ? parseInt(params.only, 10) : null;
  const quality = params.quality === 'high' ? 'high' : 'medium';

  const wardrobe = loadWardrobe();
  const pa = wardrobe && wardrobe.pas && wardrobe.pas[paSlug];
  if (!pa) return { statusCode: 400, body: 'unknown pa; catalog has: ' + Object.keys((wardrobe && wardrobe.pas) || {}).join(', ') };

  // Reference photo comes from the live site (single source of truth).
  const refUrl = 'https://emerging-tech-lab.com/agents/' + pa.reference;
  const refResp = await fetch(refUrl);
  if (!refResp.ok) return { statusCode: 502, body: 'reference fetch failed: ' + refUrl };
  const refBuf = Buffer.from(await refResp.arrayBuffer());

  const store = getStore('pa_wardrobe');
  const indexKey = paSlug + '/index';
  const index = { pa: paSlug, name: pa.name, reference: pa.reference, quality, started_at: new Date().toISOString(), outfits: [] };

  for (let i = 0; i < pa.outfits.length; i++) {
    const n = i + 1;
    if (only && n !== only) continue;
    const outfit = pa.outfits[i];
    const entry = { n, outfit, status: 'pending' };
    index.outfits.push(entry);
    try {
      const img = await editImage(apiKey, refBuf, PROMPT_TEMPLATE(outfit), quality);
      await store.set(paSlug + '/' + n + '.png', new Blob([img]));
      entry.status = 'done';
      entry.bytes = img.length;
    } catch (e) {
      entry.status = 'failed: ' + (e && e.message ? e.message.slice(0, 160) : 'unknown');
    }
    entry.finished_at = new Date().toISOString();
    await store.setJSON(indexKey, index); // progress visible mid-run
  }

  index.finished_at = new Date().toISOString();
  await store.setJSON(indexKey, index);
  console.log('[chris-wardrobe] done', paSlug, JSON.stringify(index.outfits.map(o => o.status)));
  return { statusCode: 200, body: 'done' };
};
