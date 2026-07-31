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
  if ((job.revision || 0) >= MAX_REVISIONS) {
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

    return json(200, { ok: true, revision: job.revision, image_state: 'ready' });
  } catch (e) {
    console.error('[etl-design-revise] render failed', e && e.message);
    return json(500, { error: 'render_failed' });
  }
};
