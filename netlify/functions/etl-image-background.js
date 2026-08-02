/* etl-image-background — Chris draws one image, nothing wrapped around it.
   ─────────────────────────────────────────────────────────────────────────
   Gemini first, gpt-image-1 as the fallback, same as the flyer relay. This
   is the model behind the images Dr. O has said she likes ("Gamma uses
   gemini and I love Gamma's images") and it is markedly better than the
   alternative at knowing when not to write.

   THE RULES STILL APPLY. A standalone image is not a licence to produce the
   defects the flyer relay spent a week eliminating: illegible pseudo-script,
   invented product interfaces, hardware the client does not make, and stock
   AI clichés. Those bans are carried over verbatim, because they were each
   learned from a piece that had to be thrown away.

   WHAT IS NOT CARRIED OVER: the register, the layout, the type. Those belong
   to a composed piece. Here the client says what they want and gets it.
*/

const { getStore, connectLambda } = require('@netlify/blobs');
const geminiImage = require('./_gemini-image.js');

// gpt-image-1 lives behind sharp-free code, but the module is loaded lazily
// anyway to match the flyer relay: nothing that can touch sharp may load
// before _design-render sets FONTCONFIG_PATH.
let openaiImage = null;
try { openaiImage = require('./_openai-image.js'); } catch (e) { openaiImage = null; }

/* Learned the hard way, each from a piece that was binned. Kept short here:
   this is a client describing what they want, not a brief being interpreted,
   so the only additions are the ones that stop the model embarrassing us. */
const HOUSE_RULES = [
  'Absolutely NO text, NO words, NO letters, NO numbers, NO logos and NO watermarks anywhere in the image.',
  'NO HANDWRITING and NO SCRIPT OF ANY KIND, including illegible, decorative or background writing. Writing-shaped marks count as text even when they spell nothing.',
  'NO SCREENS SHOWING A USER INTERFACE. No app mockups, no dashboards, no chat windows.',
  'BANNED VISUAL CLICHES, these read as stock AI: circuit boards, glowing brains, neural networks, robots, androids, humanoid machines, holograms, blue neon grids, binary, streaming data, wireframe or polygonal faces.',
  'Photographic or richly illustrated, confident composition, real light, not a flat icon and not clip art.',
].join(' ');

const SIZES = { '1:1': 'square', '4:5': 'portrait', '16:9': 'landscape', '9:16': 'portrait' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = String(body.job_id || '').trim();
  if (!jobId) return { statusCode: 400, body: 'job_id required' };

  try { connectLambda(event); } catch (_) {}
  let store, job;
  try { store = getStore('etl_design_jobs'); }
  catch (e) { return { statusCode: 500, body: 'no store' }; }

  // Blobs is eventually consistent and the dispatcher wrote this moments ago.
  for (let i = 0; i < 6 && !job; i++) {
    if (i) await new Promise(r => setTimeout(r, 400 * i));
    try { job = await store.get(jobId, { type: 'json' }); } catch (_) {}
  }
  if (!job) return { statusCode: 404, body: 'not found' };

  const save = async (patch) => {
    Object.assign(job, patch);
    try { await store.setJSON(jobId, job); } catch (e) { console.error('[etl-image] save failed', e && e.message); }
  };

  try {
    const aspect = job.aspect || '1:1';
    const prompt = String(job.prompt || '').slice(0, 1200) + ' ' + HOUSE_RULES;

    /* EDIT when there is a source, generate when there is not. The edit
       prompt is deliberately different: it says what to CHANGE and insists
       everything unmentioned survives, which is the whole reason someone
       starts from a picture rather than a blank (2026-08-02). */
    let source = null;
    if (job.source_key) {
      try {
        const raw = await store.get(job.source_key, { type: 'text' });
        const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(raw || ''));
        if (m) source = m[1];
      } catch (e) { console.warn('[etl-image] source unreadable', e && e.message); }
    }

    let b64 = null, engine = null, firstError = null;
    try {
      if (source) {
        const editPrompt =
          'Use the supplied image as the starting point. ' + String(job.prompt || '').slice(0, 1200) +
          ' KEEP EVERYTHING ELSE EXACTLY AS IT IS: the same room, the same lighting, the same framing, the same style, the same people unless the change asks otherwise. Change only what was asked for. ' +
          HOUSE_RULES;
        b64 = await geminiImage.edit(source, editPrompt, 'image/jpeg');
      } else {
        b64 = await geminiImage.generate(prompt, aspect);
      }
      engine = geminiImage.MODEL;
    } catch (e) {
      firstError = String((e && e.message) || e).slice(0, 300);
      console.warn('[etl-image] gemini failed, falling back:', firstError);
      if (!openaiImage) throw e;
      b64 = await openaiImage.generate(prompt, openaiImage.SIZES[SIZES[aspect] || 'square'], 'medium');
      engine = 'gpt-image-1';
    }
    if (!b64) throw new Error('no image returned');

    const key = jobId + '.png';
    await store.set(key, Buffer.from(b64, 'base64'), { metadata: { contentType: 'image/png' } });

    await save({
      status: 'done', note: 'Ready.',
      result: { image_key: key, art_engine: engine, art_engine_error: firstError },
    });
    console.log('[etl-image] done', jobId, engine);
    return { statusCode: 200, body: 'ok' };

  } catch (e) {
    console.error('[etl-image] failed', e && e.message);
    await save({ status: 'error', error: String((e && e.message) || e).slice(0, 400) });
    return { statusCode: 200, body: 'error recorded' };
  }
};
