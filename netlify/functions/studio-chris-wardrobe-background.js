/* ─────────────────────────────────────────────────────────────────────────────
   studio-chris-wardrobe-background

   Chris's Tailor Shop engine. Generates persona-fitted outfit variants of an
   agent's canonical portrait using gpt-image-1 via the IMAGES/EDITS endpoint:
   the reference photo anchors the identity (same face, same framing), the
   prompt changes ONLY the clothes.

   Two ways in (Basic auth = PRESS_ADMIN creds):
     ?pa=auggie                      -> curated catalog entry (data/pa-wardrobe.json)
     ?agent=Jen%20Lopez              -> ANY roster agent with a portrait.
                                        Chris (they/them) READS the persona from
                                        the roster profile and WRITES the 7
                                        outfits themself (Terry's rule: the
                                        closet IS the character), then sews.
     optional: &only=3  &quality=high (default medium)  &count=7

   Returns 202 immediately; runs up to 15 min. Results land in the
   'pa_wardrobe' blob store as <slug>/<n>.png plus <slug>/index.
   View via studio-chris-wardrobe.js or the Build-Your-Agent page.
   ───────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const Anthropic = require('@anthropic-ai/sdk').default;
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

function loadJson(rel) {
  const candidates = [
    path.join(__dirname, '..', '..', rel),
    path.join(process.cwd(), rel),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return null;
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const PROMPT_TEMPLATE = (outfit) =>
  'Edit this photo. Keep the SAME person: identical face, hairstyle, skin tone, ' +
  'expression, pose, camera framing, lighting, and the same background. ' +
  'Change ONLY the clothing to: ' + outfit + '. ' +
  'Photorealistic professional portrait quality. No text, no watermarks, no logos.';

/* Photoreal remake mode (for portraits that came out too painterly, e.g. the
   Dose cast): step 1 reshoots the painterly reference as a photograph; step 2
   closes the eyes ON STEP 1'S OUTPUT so the blink pair matches exactly. */
const RESTYLE_OPEN_PROMPT =
  'Recreate this exact portrait as a photorealistic professional photograph of the same person: ' +
  'identical face structure, hairstyle, skin tone, expression, pose, framing, clothing, and background composition. ' +
  'Natural skin texture, true-to-life lighting, shot on a professional camera. Eyes open. ' +
  'Remove all painterly, illustrated, or stylized rendering. No text, no watermarks.';
const RESTYLE_CLOSED_PROMPT =
  'Edit this photograph. The ONLY change: the eyes are now gently closed in a soft natural blink. ' +
  'Everything else stays exactly identical: face, hair, clothing, lighting, background, framing. No text, no watermarks.';

/* Chris writes the closet from the persona. they/them.
   The assignment (Terry's spec): work pieces + weekend pieces + maybe an
   evening look, with a dress code steering the work register. Returns
   [{category, outfit}, ...]. */
async function chrisWritesOutfits(agent, mix, code) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('anthropic key missing for outfit writing');
  const client = new Anthropic({ apiKey });
  const persona = [
    'Name: ' + (agent.name || ''),
    'Role: ' + (agent.role || ''),
    'Tagline: ' + (agent.tagline || ''),
    'Bio: ' + (agent.bio || ''),
    'Background: ' + (agent.background || ''),
    'Backstory: ' + (agent.backstory || ''),
    'Personality: ' + (agent.personality || ''),
    'Floor voice: ' + (agent.floor || agent.floor_voice || ''),
    'Interests: ' + (Array.isArray(agent.interests) ? agent.interests.join('; ') : (agent.interests || '')),
  ].filter(l => l.split(': ')[1]).join('\n');

  const total = mix.work + mix.weekend + mix.evening;
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1100,
    system: [
      'You are Chris Avila (they/them), the artist on the ETL bench. You are dressing a colleague.',
      'THE RULE (Terry, locked): the clothes MUST fit the personality. The closet IS the character. Never a generic rack.',
      '',
      'THE ASSIGNMENT:',
      '- ' + mix.work + ' WORK pieces. The workplace dress code is "' + code + '" - interpret that register THROUGH this person\'s taste, not as a uniform.',
      (mix.weekend ? '- ' + mix.weekend + ' WEEKEND pieces. Off the clock, errands, brunch, the hobby in their file.' : ''),
      (mix.evening ? '- ' + mix.evening + ' EVENING piece. Dinner out, an event, a date; their version of dressed up.' : ''),
      '',
      'Each outfit must be visible in a head-and-shoulders portrait: tops, jackets, collars, knitwear, scarves, jewelry, glasses. No pants talk, no shoes, no costumes unless the persona demands it.',
      'Each description is one line, concrete and paintable (colors, fabrics, cut).',
      'Return ONLY a JSON array of exactly ' + total + ' objects, work pieces first, then weekend, then evening:',
      '[{"category":"work","outfit":"..."}, ...]',
      'No commentary, no markdown fences.',
    ].filter(Boolean).join('\n'),
    messages: [{ role: 'user', content: persona }],
  });
  const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('chris returned no outfit list');
  const arr = JSON.parse(match[0]);
  if (!Array.isArray(arr) || !arr.length) throw new Error('chris outfit list empty');
  return arr.slice(0, total).map(o => ({ category: String(o.category || 'work'), outfit: String(o.outfit || o) }));
}

async function editImage(apiKey, refBuf, refMime, prompt, quality) {
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', new Blob([refBuf], { type: refMime || 'image/png' }), 'reference.png');
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

  const openaiKey = process.env.OPENAI_GP_ImageGen_Key || process.env.OPENAI_API_KEY;
  if (!openaiKey) return { statusCode: 500, body: 'openai key missing' };

  const params = event.queryStringParameters || {};
  const only = params.only ? parseInt(params.only, 10) : null;
  const quality = params.quality === 'high' ? 'high' : 'medium';
  // The assignment: work,weekend,evening counts (Terry's default: 5,2,1)
  const mixParts = String(params.mix || '5,2,1').split(',').map(n => Math.min(Math.max(parseInt(n, 10) || 0, 0), 7));
  const mix = { work: mixParts[0] || 0, weekend: mixParts[1] || 0, evening: mixParts[2] || 0 };
  if (mix.work + mix.weekend + mix.evening === 0) mix.work = 5;
  const CODES = ['formal', 'business', 'semiformal', 'smart casual', 'casual', 'creative'];
  const code = CODES.includes((params.code || '').toLowerCase()) ? params.code.toLowerCase() : 'business';

  let slug = null, displayName = null, refUrl = null, refBuf = null, refMime = 'image/png', outfits = null, source = null;
  const draftsStore = getStore('agent_drafts');

  if (params.draft) {
    // A brand-new agent from the Persona Desk. Reference portrait + persona
    // both live in the agent_drafts store.
    const dSlug = params.draft.toLowerCase().trim();
    const dossier = await draftsStore.get(dSlug + '/dossier', { type: 'json' });
    if (!dossier) return { statusCode: 404, body: 'no draft dossier: ' + dSlug };
    const buf = await draftsStore.get(dSlug + '/portrait.png', { type: 'arrayBuffer' });
    if (!buf) return { statusCode: 400, body: 'draft has no portrait yet; the Desk is still painting' };
    slug = dSlug;
    displayName = dossier.name;
    refUrl = 'draft:' + dSlug;
    refBuf = Buffer.from(buf);
    source = 'persona-desk-draft';
    try {
      outfits = await chrisWritesOutfits(dossier, mix, code);
    } catch (e) {
      return { statusCode: 502, body: 'chris could not write the closet: ' + (e && e.message) };
    }
  } else if (params.agent) {
    // Any roster agent. Chris reads the persona and writes the closet.
    const roster = loadJson('roster.json');
    if (!Array.isArray(roster)) return { statusCode: 500, body: 'roster unavailable' };
    const wanted = params.agent.trim().toLowerCase();
    const agent = roster.find(a => a && a.name && a.name.toLowerCase() === wanted)
      || roster.find(a => a && a.name && a.name.toLowerCase().includes(wanted));
    if (!agent) return { statusCode: 404, body: 'agent not found in roster: ' + params.agent };
    if (!agent.image_url) return { statusCode: 400, body: agent.name + ' has no portrait in the roster; the tailor needs a reference photo' };
    slug = slugify(agent.name);
    displayName = agent.name;
    refUrl = agent.image_url;
    source = 'persona';
    try {
      outfits = await chrisWritesOutfits(agent, mix, code);
    } catch (e) {
      return { statusCode: 502, body: 'chris could not write the closet: ' + (e && e.message) };
    }
  } else {
    // Curated catalog path (pa-wardrobe.json).
    const paSlug = (params.pa || '').toLowerCase().trim();
    const wardrobe = loadJson('data/pa-wardrobe.json');
    const pa = wardrobe && wardrobe.pas && wardrobe.pas[paSlug];
    if (!pa) return { statusCode: 400, body: 'unknown pa; catalog has: ' + Object.keys((wardrobe && wardrobe.pas) || {}).join(', ') + '. Or use ?agent=<roster name>.' };
    slug = paSlug;
    displayName = pa.name;
    refUrl = 'https://emerging-tech-lab.com/agents/' + pa.reference;
    outfits = pa.outfits.map(o => ({ category: null, outfit: o }));
    source = 'catalog';
  }

  if (!refBuf) {
    const refResp = await fetch(refUrl);
    if (!refResp.ok) return { statusCode: 502, body: 'reference fetch failed: ' + refUrl };
    refMime = (refResp.headers.get('content-type') || 'image/png').split(';')[0];
    refBuf = Buffer.from(await refResp.arrayBuffer());
  }

  // ── PHOTOREAL REMAKE MODE ─────────────────────────────────────────────
  // ?mode=restyle: ignore the wardrobe assignment; produce a matched
  // eyes-open + eyes-closed photoreal pair from the (painterly) reference.
  if ((params.mode || '') === 'restyle') {
    const store2 = getStore('pa_wardrobe');
    const indexKey2 = slug + '/index';
    const idx = { pa: slug, name: displayName, reference: refUrl, source: 'photoreal-remake', quality, started_at: new Date().toISOString(), outfits: [
      { n: 1, outfit: 'photoreal remake, eyes open', category: 'restyle', status: 'pending' },
      { n: 2, outfit: 'photoreal remake, eyes closed (matched blink pair)', category: 'restyle', status: 'pending' },
    ] };
    await store2.setJSON(indexKey2, idx);
    let openBuf = null;
    try {
      openBuf = await editImage(openaiKey, refBuf, refMime, RESTYLE_OPEN_PROMPT, quality);
      await store2.set(slug + '/1.png', new Blob([openBuf]));
      idx.outfits[0].status = 'done'; idx.outfits[0].bytes = openBuf.length;
    } catch (e) {
      idx.outfits[0].status = 'failed: ' + (e && e.message ? e.message.slice(0, 160) : 'unknown');
      idx.outfits[1].status = 'skipped: open version failed';
    }
    idx.outfits[0].finished_at = new Date().toISOString();
    await store2.setJSON(indexKey2, idx);
    if (openBuf) {
      try {
        const closedBuf = await editImage(openaiKey, openBuf, 'image/png', RESTYLE_CLOSED_PROMPT, quality);
        await store2.set(slug + '/2.png', new Blob([closedBuf]));
        idx.outfits[1].status = 'done'; idx.outfits[1].bytes = closedBuf.length;
      } catch (e) {
        idx.outfits[1].status = 'failed: ' + (e && e.message ? e.message.slice(0, 160) : 'unknown');
      }
      idx.outfits[1].finished_at = new Date().toISOString();
    }
    idx.finished_at = new Date().toISOString();
    await store2.setJSON(indexKey2, idx);
    console.log('[chris-wardrobe] restyle done', slug);
    return { statusCode: 200, body: 'done' };
  }

  const store = getStore('pa_wardrobe');
  const indexKey = slug + '/index';
  const index = { pa: slug, name: displayName, reference: refUrl, source, quality, code, mix, started_at: new Date().toISOString(), outfits: [] };

  for (let i = 0; i < outfits.length; i++) {
    const n = i + 1;
    if (only && n !== only) continue;
    const item = outfits[i];
    const entry = { n, outfit: item.outfit, category: item.category, status: 'pending' };
    index.outfits.push(entry);
    await store.setJSON(indexKey, index);
    try {
      const img = await editImage(openaiKey, refBuf, refMime, PROMPT_TEMPLATE(item.outfit), quality);
      await store.set(slug + '/' + n + '.png', new Blob([img]));
      entry.status = 'done';
      entry.bytes = img.length;
    } catch (e) {
      entry.status = 'failed: ' + (e && e.message ? e.message.slice(0, 160) : 'unknown');
    }
    entry.finished_at = new Date().toISOString();
    await store.setJSON(indexKey, index);
  }

  index.finished_at = new Date().toISOString();
  await store.setJSON(indexKey, index);
  console.log('[chris-wardrobe] done', slug, JSON.stringify(index.outfits.map(o => o.status)));
  return { statusCode: 200, body: 'done' };
};
