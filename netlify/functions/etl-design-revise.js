/* etl-design-revise — round two, and every round after.
   ─────────────────────────────────────────────────────────────────────────
   POST { job_id, note } -> { ok, revision, image_state }

   Dr. O's framing, and the reason this exists: "because we say it is a
   marketing and design firm, it implies the art is bespoke and it may take
   some back and forth to get perfection." Revisions are the service, not a
   failure mode. Nobody expects a studio to land it in one pass with no
   conversation; they expect to say "warmer, less text, make the bottle the
   hero" and get a second round.

   Yuki gets her OWN previous SVG back, not a description of it, so a small
   note produces a small change rather than a fresh design nobody asked for.
   That is only possible because the SVG is stored beside the PNG.

   Cost: one Sonnet call and one rasterise, roughly 15 seconds. No new
   artwork, so no image spend. Asking for new artwork is a separate action
   precisely because it is the one revision that costs real money.
*/

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const credits = require('./_design-credits.js');
const geminiImage = require('./_gemini-image.js');
const composeBrief = require('./_design-compose.js');

let renderSvg = null, CANVASES = null, renderLoadError = null;
try {
  ({ renderSvg, CANVASES } = require('./_design-render.js'));
} catch (e) {
  renderLoadError = 'design renderer unavailable: ' + (e && e.message);
  console.error('[etl-design-revise] ' + renderLoadError);
}

const MODEL = 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (renderLoadError) return json(503, { error: 'renderer_unavailable' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const jobId = String(body.job_id || '').trim();
  if (!/^dsn-[0-9a-z-]+$/i.test(jobId)) return json(400, { error: 'job_id_required' });
  /* THREE ROUNDS, THEN STOP.
     Revisions are free and stay free: back and forth IS the service, and
     charging for it on a $4.90 piece would read as nickel-and-diming. But
     unlimited was the only version with an open tail, which was Dr. O's
     worry: "revisions free, if they do not end up costing a lot of $, that
     is my fear." Three rounds is what a small studio gives on a job this
     size, and at roughly 3 cents a round it caps the exposure at 9 cents on
     a $4.90 sale, under 2%.

     Counted AFTER success only, so a failed round costs the client nothing.
     The automatic overflow and collision retries are not revisions: those
     are us fixing our own output before anyone sees it (2026-07-31). */
  const MAX_REVISIONS = 3;

  const note = String(body.note || '').trim().slice(0, 700);
  if (!note) return json(400, { error: 'note_required' });

  try { connectLambda(event); } catch (_) {}

  let store, job, prevSvg;
  try {
    store = getStore('etl_design_jobs');
    job = await store.get(jobId, { type: 'json' });
    if (!job) return json(404, { error: 'not_found' });
    prevSvg = await store.get(jobId + '.svg', { type: 'text' });
  } catch (e) {
    console.error('[etl-design-revise] store read failed', e && e.message);
    return json(500, { error: 'store_unavailable' });
  }
  /* The owner is not a customer. The cap exists to bound what a stranger can
     spend of ours, and Dr. O testing her own product hit it while the page
     underneath still promised "as many rounds as you like". She is the one
     person who needs to iterate without a ceiling (2026-08-02). */
  let isOwner = false;
  try { isOwner = (await credits.check(event, body)).kind === 'owner'; } catch (_) {}

  if (!isOwner && (job.revision || 0) >= MAX_REVISIONS) {
    return json(409, { error: 'revision_limit', limit: MAX_REVISIONS,
      message: 'That is ' + MAX_REVISIONS + ' rounds, which is where we stop on a single piece. Start a new brief and we will take it from the top.' });
  }
  // Jobs rendered before the SVG was kept cannot be revised, only re-run.
  if (!prevSvg) return json(409, { error: 'no_source_to_revise' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'config', missing: 'ANTHROPIC_API_KEY' });

  const r = job.result || {};
  const yuki = r.brand || {};
  const pal = Array.isArray(yuki.palette) ? yuki.palette : [];
  const paletteText = pal.map(p => (p.name || '') + ' ' + (p.hex || '')).join(', ');
  const canvasKey = (CANVASES && CANVASES[job.brief && job.brief.platform]) ? job.brief.platform : 'instagram';
  const canvas = CANVASES[canvasKey];

  // The artwork is reused as-is. It is already embedded in the stored SVG as a
  // data URL, so the revision keeps the same picture unless the note asks Yuki
  // to move or resize it. No image spend on a revision.
  const hasArt = /<image\b/i.test(prevSvg);

  /* PULL THE ARTWORK BACK OUT BEFORE SHOWING YUKI HER OWN FILE.
     ─────────────────────────────────────────────────────────────────────
     The stored SVG carries the picture inline as a base64 data URL, and this
     path was posting the whole thing to the model as the user message. On any
     piece with real artwork that is roughly two megabytes of text, far past
     what the request will take, so it threw and the client saw
     "Could not make that change: revision_failed" (2026-07-31).

     Round one never had this problem: it hands Yuki the literal string
     CONCEPT_IMAGE and the renderer substitutes the picture afterwards. The
     revision path just never did the same. Doing it here fixes the failure
     and makes a revision cost a few cents instead of a fortune in input
     tokens. */
  let artHref = '';
  let svgForModel = prevSvg;
  const dataHref = /href\s*=\s*["'](data:image\/[^"']+)["']/i.exec(prevSvg);
  if (dataHref) {
    artHref = dataHref[1];
    svgForModel = prevSvg.replace(dataHref[1], 'CONCEPT_IMAGE');
  }

  /* A REVISION CAN NOW ASK FOR A DIFFERENT PICTURE.
     ─────────────────────────────────────────────────────────────────────
     Until now every revision reused the stored artwork, so a note saying
     "create a different image" was a request the system could not honour and
     did not say it could not honour. Dr. O, on a fifth round: "you repeated
     this one, and it is just as bad, create a different image that takes up
     the space."

     Detected by intent rather than by a menu, and deliberately narrow: this
     is the one revision that costs real money, about five cents, so it must
     not fire on "make the headline warmer". */
  const WANTS_NEW_ART = /\b(different|new|another|other|fresh|change the|replace the|redo the|re-?draw)\b[^.]{0,30}\b(image|picture|photo|photograph|artwork|graphic|visual|shot)\b|\b(image|picture|photo|artwork|graphic)\b[^.]{0,20}\b(again|repeated|same one|duplicate)\b/i;
  let artRegenerated = false, artRegenError = null;

  if (artHref && WANTS_NEW_ART.test(note)) {
    try {
      const b = job.brief || {};
      const prompt = [
        'Editorial marketing artwork for ' + (b.business_name || b.businessName || 'this business') + '.',
        'Subject: ' + String(b.promoting || '').slice(0, 600) + '.',
        'Mood: ' + (yuki.look || '') + '.',
        // Same fault as the first draw: a palette meant for the layout was
        // being handed to a photographer, which is an instruction to shoot in
        // four inks. It is why every picture came back black and white
        // (2026-08-02).
        'COLOUR: this is a photograph or an illustration, not a design element, so use full natural colour. Real skin, real fabric, real light.',
        'The piece around it is laid out in these colours: ' + paletteText + '. Sit well beside them, sharing a temperature and a tone or two, rather than being built from them.',
        'DO NOT MAKE IT MONOCHROME, black and white, sepia or duotone unless the mood explicitly calls for it.',
        'THE CLIENT HAS REJECTED THE PREVIOUS IMAGE AND ASKED FOR THIS: ' + note,
        'Make something GENUINELY DIFFERENT from a standard portrait or headshot. A different subject, a different distance, a different composition.',
        'Absolutely NO text, NO words, NO letters, NO numbers, NO logos and NO watermarks anywhere in the image.',
        'NO HANDWRITING and NO SCRIPT OF ANY KIND, including illegible or background writing.',
        'NO SCREENS SHOWING A USER INTERFACE.',
        'BANNED, these read as stock AI: circuit boards, glowing brains, neural networks, robots, androids, holograms, blue neon grids, binary, streaming data, wireframe faces.',
        'Photographic or richly illustrated, confident composition, real light, not a flat icon and not clip art.',
      ].join(' ');
      const ASPECT = { instagram: '1:1', facebook: '1:1', linkedin: '4:5', x: '16:9' };
      const b64 = await geminiImage.generate(prompt, ASPECT[canvasKey] || '1:1');
      if (b64) {
        artHref = 'data:image/png;base64,' + b64;
        artRegenerated = true;
        // Kept so the animator can use the new plate rather than the old one.
        try { await store.set(jobId + '-plate.png', Buffer.from(b64, 'base64'), { metadata: { contentType: 'image/png' } }); } catch (_) {}
      }
    } catch (e) {
      // Survivable: the layout revision still happens, with the old picture.
      artRegenError = String((e && e.message) || e).slice(0, 240);
      console.warn('[etl-design-revise] artwork regeneration failed', artRegenError);
    }
  }

  const sys = composeBrief.reviseSystem({ canvas, paletteText, fonts: yuki.fonts, hasArt,
    // Same seed as round one, so a revision keeps the layout it was assigned.
    archetype: composeBrief.chooseArchetype(jobId, hasArt) });
  const user = [
    'THE CLIENT SAYS:', note, '',
    'YOUR PREVIOUS SVG:', svgForModel,
  ].join('\n');

  const client = new Anthropic({ apiKey });
  let svg;
  try {
    const resp = await client.messages.create({
      model: MODEL, max_tokens: 8000, system: sys,
      messages: [{ role: 'user', content: user }],
    });
    svg = (resp.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim()
      .replace(/^```(?:svg|xml|html)?\s*/i, '').replace(/```\s*$/, '').trim();
  } catch (e) {
    console.error('[etl-design-revise] model failed', e && e.message);
    return json(502, { error: 'revision_failed' });
  }
  if (!/^<svg/i.test(svg)) return json(502, { error: 'revision_not_svg' });

  try {
    // The picture goes back in here, exactly as round one does it.
    let out = await renderSvg(svg, canvasKey, artHref);
    if (out.overflow.length) {
      const fixed = await client.messages.create({
        model: MODEL, max_tokens: 8000,
        system: sys + '\n\nYOUR REVISION OVERRAN ITS CONTAINERS. Fix these and return the corrected SVG only:\n' +
                out.overflow.map(o => '- ' + o).join('\n'),
        messages: [{ role: 'user', content: user }],
      });
      const cleaned = (fixed.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim()
        .replace(/^```(?:svg|xml|html)?\s*/i, '').replace(/```\s*$/, '').trim();
      if (/^<svg/i.test(cleaned)) {
        const retry = await renderSvg(cleaned, canvasKey, artHref);
        if (retry.overflow.length <= out.overflow.length) out = retry;
      }
    }

    await store.set(jobId + '.png', out.png, { metadata: { contentType: 'image/png' } });
    await store.set(jobId + '.svg', out.svg, { metadata: { contentType: 'image/svg+xml' } });

    job.revision = (job.revision || 0) + 1;
    job.revision_notes = (job.revision_notes || []).concat([note]).slice(-10);
    job.result = Object.assign(job.result || {}, {
      image_key: jobId + '.png',
      overflow_notes: out.overflow.length ? out.overflow : null,
    });
    await store.setJSON(jobId, job);

    // Say whether the picture was redrawn, so a client who asked for a new
    // one is not left guessing whether it happened.
    return json(200, { ok: true, revision: job.revision, image_state: 'ready',
      artwork: artRegenerated ? 'redrawn' : 'unchanged', artwork_error: artRegenError });
  } catch (e) {
    console.error('[etl-design-revise] render failed', e && e.message);
    return json(500, { error: 'render_failed' });
  }
};
