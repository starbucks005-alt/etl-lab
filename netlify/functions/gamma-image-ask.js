/* gamma-image-ask — starts a portrait generation.
   Public. Only build-your-own-agent.html calls this.
   POST { prompt, name?, role?, model? } -> { ok, generation_id }

   The name is historical: this used to call the Gamma API, and it does not any
   more. The reason is worth keeping. Gamma wraps the image it generates in a
   CARD, and the old status endpoint returned that card's export, so every
   portrait arrived with Gamma's text set across it while the clean image sat
   inside the Gamma doc. Dr. O spotted it from the outside (2026-07-30): "the
   text has always been the visual on BYOA, but when I see the same image on
   GAMMA it is without text and looks great." The good portrait was always
   there; we were downloading the wrong artifact.

   It was also hard-failing by then: the old request sent textMode: 'none',
   which Gamma rejects with "textMode must be one of: generate, condense,
   preserve", so BYOA had stopped producing anything at all.

   Portraits go to gpt-image-1 now, which is what studio-chris-image already
   uses. The endpoint NAMES and the response shape are unchanged, so BYOA is fixed
   without touching the page.

   The background function is invoked with await: the runtime freezes when this
   handler returns, so an un-awaited fetch is abandoned and the job never
   starts. Awaiting the invocation is cheap; we never await the work.
*/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'bad_json' }); }

  const prompt = String(body.prompt || '').trim();
  if (!prompt) return json(400, { error: 'prompt_required' });
  if (prompt.length > 4000) return json(400, { error: 'prompt_too_long' });

  const d = new Date();
  const jobId = 'byoa-' + d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 8);

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return json(500, { error: 'no_base_url' });

  try {
    const r = await fetch(base + '/.netlify/functions/gamma-image-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        prompt,
        name: String(body.name || '').trim().slice(0, 120),
        role: String(body.role || '').trim().slice(0, 160),
      }),
    });
    console.log('[gamma-image-ask] background invoke status', r.status, 'job', jobId);
  } catch (e) {
    console.error('[gamma-image-ask] background invoke failed', e && e.message);
    return json(502, { error: 'could_not_start' });
  }

  return json(200, { ok: true, generation_id: jobId });
};
