/* ─────────────────────────────────────────────────────────────────────────────
   agent-persona-desk-background

   The Persona Desk: where brand-new agents are born. Given a few seed notes
   (a name if you have one, a role, whatever vibe you can offer), the Desk:

   1. Writes the full dossier with Claude: identity, personality, background
      (school, hometown, family), a real work history (resume-grade, with
      years and employers), interests, floor voice, tagline, bio, and a
      detailed portrait brief.
   2. Paints the canonical portrait with gpt-image-1 (text-to-image; this is
      the ONE generation that has no reference, because the person does not
      exist yet - every image after this anchors on it).
   3. Stores both in the 'agent_drafts' blob store:
        <slug>/dossier (JSON)   <slug>/portrait.png   drafts/index (list)

   From there the Tailor Shop can dress them (?draft=<slug>).

   Trigger (Basic auth = PRESS_ADMIN):
     GET ?role=...&notes=...[&name=...]
   Returns 202; takes ~1-2 minutes. Poll agent-persona-desk.js.
   ───────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const Anthropic = require('@anthropic-ai/sdk').default;
const { VOICE_LAW_PROSE, houseTypography } = require('./_etl-voice-law.js');

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

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const DOSSIER_SYSTEM = [
  'You are the Persona Desk at the Emerging Technologies Laboratory: the room where new AI staff are written into existence.',
  'House rules, learned from the existing bench (Auggie, Carol Haynes, Bea Vega, Jen Lopez):',
  '- Real people, not archetypes. A specific hometown, a specific family, one wound or quirk that explains the career.',
  '- Work history must read like a real resume: plausible employers, plausible years (they end at the present), a visible arc.',
  '- Personality is behavior, not adjectives: what they do on a Tuesday, how they argue, what they refuse to do.',
  '- No copy of an existing bench member. No celebrity likeness.',
  '- The portrait brief must describe a photorealistic head-and-shoulders studio portrait: age, build, hair, skin tone, expression, ONE outfit, soft warm neutral background, professional lighting. No text in image.',
  '',
  'Return ONLY a JSON object with EXACTLY these keys:',
  '{ "name": str, "pronouns": str, "role": str, "tagline": str (one line), "bio": str (2-3 sentences, what they do),',
  '  "personality": str (4-6 sentences of behavior), "background": str (hometown, school, how they got here, 3-5 sentences),',
  '  "family": str (2-3 sentences), "interests": [str, ...5-7 items],',
  '  "work_history": [ { "years": "2019-2023", "title": str, "org": str, "note": str (one line) } ... 3-5 entries, most recent first ],',
  '  "floor_voice": str (how they type in the office chat: rhythm, tics, 2-3 sentences),',
  '  "portrait_prompt": str (the photorealistic portrait brief) }',
  'No markdown fences. No commentary.',
].join('\n');

async function paintPortrait(apiKey, prompt) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', quality: 'high' }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || ('openai ' + r.status));
  const b64 = d.data && d.data[0] && d.data[0].b64_json;
  if (!b64) throw new Error('no portrait in response');
  return Buffer.from(b64, 'base64');
}

exports.handler = async (event) => {
  if (!checkAdminAuth(event)) return { statusCode: 401, body: 'unauthorized' };
  try { connectLambda(event); } catch (_) {}

  const anthropicKey = process.env.ETL_API_KEY;
  const openaiKey = process.env.OPENAI_GP_ImageGen_Key || process.env.OPENAI_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'anthropic key missing' };
  if (!openaiKey) return { statusCode: 500, body: 'openai key missing' };

  const params = event.queryStringParameters || {};
  const seedName = (params.name || '').trim();
  const seedRole = (params.role || '').trim();
  const seedNotes = (params.notes || '').trim();
  if (!seedRole && !seedNotes) return { statusCode: 400, body: 'give the Desk at least a role or some notes' };

  const client = new Anthropic({ apiKey: anthropicKey });
  const seed = [
    seedName ? 'Name (use this): ' + seedName : 'Name: invent one that fits.',
    seedRole ? 'Role: ' + seedRole : '',
    seedNotes ? 'Creator notes (honor these): ' + seedNotes : '',
  ].filter(Boolean).join('\n');

  let dossier;
  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: DOSSIER_SYSTEM + VOICE_LAW_PROSE,
      messages: [{ role: 'user', content: seed }],
    });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON in dossier response');
    dossier = JSON.parse(match[0]);
    if (!dossier.name || !dossier.portrait_prompt) throw new Error('dossier missing name or portrait brief');
    // House typography on the prose fields only. portrait_prompt is an image
    // prompt (work product) and name/pronouns/role are data values: untouched.
    for (const k of ['tagline', 'bio', 'personality', 'background', 'family', 'floor_voice']) {
      if (typeof dossier[k] === 'string') dossier[k] = houseTypography(dossier[k]);
    }
  } catch (e) {
    return { statusCode: 502, body: 'the Desk could not finish the dossier: ' + (e && e.message) };
  }

  const slug = slugify(dossier.name);
  const store = getStore('agent_drafts');

  dossier._meta = { slug, created_at: new Date().toISOString(), seed: { name: seedName, role: seedRole, notes: seedNotes }, portrait_status: 'painting' };
  await store.setJSON(slug + '/dossier', dossier);

  // Keep the drafts index current so the page can list creations.
  let index = [];
  try { index = (await store.get('drafts/index', { type: 'json' })) || []; } catch (_) {}
  index = index.filter(d => d.slug !== slug);
  index.unshift({ slug, name: dossier.name, role: dossier.role, created_at: dossier._meta.created_at });
  await store.setJSON('drafts/index', index.slice(0, 100));

  try {
    const img = await paintPortrait(openaiKey, dossier.portrait_prompt);
    await store.set(slug + '/portrait.png', new Blob([img]));
    dossier._meta.portrait_status = 'done';
  } catch (e) {
    dossier._meta.portrait_status = 'failed: ' + (e && e.message ? e.message.slice(0, 160) : 'unknown');
  }
  await store.setJSON(slug + '/dossier', dossier);

  console.log('[persona-desk] created', slug, dossier._meta.portrait_status);
  return { statusCode: 200, body: 'done: ' + slug };
};
