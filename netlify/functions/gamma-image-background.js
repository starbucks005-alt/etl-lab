/* gamma-image-background — generates a portrait with gpt-image-1.
   ─────────────────────────────────────────────────────────────────────────
   The name is historical: this family used to call Gamma. The names stay so
   build-your-own-agent.html keeps working untouched; the insides changed.

   WHY GAMMA CAME OUT (2026-07-30, Dr. O):
   "BYOA - broken, the text has always been the visual on BYOA, but when I see
   the same image on GAMMA it is without text and looks great."

   That is exactly what was happening. Gamma builds a CARD around the image it
   generates. gamma-image-status returned d.exportUrl, which is the rendered
   card, so the download always arrived with Gamma's text set across it, while
   the clean image sat inside the Gamma doc where only she could see it. The
   good portrait was always there; we were fetching the wrong artifact.

   It was also failing outright: the old request sent textMode: 'none', which
   Gamma rejects with "textMode must be one of: generate, condense, preserve".
   So BYOA had stopped producing anything at all.

   Portraits go to gpt-image-1 now, which is what studio-chris-image already
   uses and what produced clean, text-free artwork for ETL Design. Gamma makes
   decks. Asking a deck tool for a picture gets you a slide.

   POST { job_id, prompt, name, role } -> writes the PNG to blobs.
*/

const { getStore, connectLambda } = require('@netlify/blobs');
const openaiImage = require('./_openai-image.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = String(body.job_id || '').trim();
  if (!jobId) return { statusCode: 400, body: 'job_id required' };

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore('byoa_portraits'); } catch (e) {
    console.error('[gamma-image-bg] blob store unavailable', e && e.message);
    return { statusCode: 500, body: 'no store' };
  }

  const save = (patch) => store.setJSON(jobId, Object.assign({ job_id: jobId }, patch)).catch((e) => {
    console.error('[gamma-image-bg] save failed', e && e.message);
  });

  const name = String(body.name || 'Agent').trim();
  const role = String(body.role || '').trim();
  const prompt = String(body.prompt || '').trim();
  if (!prompt) { await save({ status: 'failed', error: 'prompt_required' }); return { statusCode: 400, body: 'prompt required' }; }

  await save({ status: 'working' });

  // Portrait direction, kept close to what the old Gamma call asked for so the
  // house look does not shift under existing agents.
  const full = [
    name + (role ? ', ' + role : '') + '. ' + prompt,
    'Photorealistic environmental portrait, head and shoulders, eye level, subject centred looking at camera, soft even lighting, shallow depth of field, natural skin texture.',
    'Absolutely no text, no words, no letters, no numbers, no captions, no watermarks, no logos anywhere in the image.',
  ].join(' ');

  try {
    const b64 = await openaiImage.generate(full, openaiImage.SIZES.square, 'medium');
    await store.set(jobId + '.png', Buffer.from(b64, 'base64'), { metadata: { contentType: 'image/png' } });
    await save({ status: 'completed' });
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('[gamma-image-bg] generation failed', e && e.message);
    await save({ status: 'failed', error: String(e && e.message).slice(0, 200) });
    return { statusCode: 500, body: 'failed' };
  }
};
