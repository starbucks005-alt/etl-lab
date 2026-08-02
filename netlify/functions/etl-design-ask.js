/* etl-design-ask — starts an ETL Design job.
   Public: no account, no login. Someone describes what they want and the
   relay runs. POST { promoting, audience, business_name, business_site,
   platform } -> { ok, job_id }.

   The background function is invoked with await (not fire-and-forget): the
   Lambda runtime freezes the moment this handler returns, so an un-awaited
   fetch is simply abandoned and the job never starts. That exact bug kept
   the morning brief from ever regenerating while the endpoint cheerfully
   reported it had (2026-07-30). Awaiting the INVOCATION is cheap, the
   background returns 202 immediately; we never await the work itself.
*/

const credits = require('./_design-credits.js');
const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Authorization so a signed-in ETL member spends from their membership
  // rather than the guest allowance. Membership buys something here; it has
  // never been required to use the page.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function newJobId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'dsn-' + stamp + '-' + Math.random().toString(36).slice(2, 8);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const promoting = String(body.promoting || '').trim();
  if (!promoting) return json(400, { error: 'promoting_required' });
  if (promoting.length > 1200) return json(400, { error: 'promoting_too_long' });

  // Optional concept image the client uploads for Yuki to work from. The page
  // downscales before sending; this is the backstop. An oversized or
  // malformed one is DROPPED rather than failing the brief, since the relay
  // works perfectly well without it.
  let conceptImage = String(body.concept_image || '');
  if (conceptImage && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(conceptImage)) {
    console.warn('[etl-design-ask] concept image ignored: not an inline image data URL');
    conceptImage = '';
  }
  if (conceptImage.length > 4500000) {          // ~3.3MB decoded
    console.warn('[etl-design-ask] concept image ignored: too large (' + conceptImage.length + ' chars)');
    conceptImage = '';
  }

  /* Credit check BEFORE anything is spent. A brief is three model calls plus
     a gpt-image-1 generation, and this page is linked from the homepage now,
     so it is reachable by anyone. Checking here rather than inside the relay
     means a refusal costs nothing at all. */
  let verdict, creditFault = null;
  try {
    verdict = await credits.check(event, body);
  } catch (e) {
    /* Failing OPEN is deliberate: bookkeeping should not take a public page
       down. But a silent fail-open is indistinguishable from a working gate,
       and that is exactly how this hid across two deploys, waving every
       request through while looking installed. The reason is now returned as
       well as logged, so a broken gate is visible from the outside without
       log access. */
    creditFault = String((e && e.message) || e).slice(0, 200);
    console.error('[etl-design-ask] credit check failed, allowing through:', creditFault);
    verdict = { ok: true, kind: 'guest', guestId: credits.safeGuestId(body && body.guest_id) || credits.newGuestId(), remaining: null };
  }
  if (!verdict.ok) {
    return json(402, {
      error: verdict.reason || 'out_of_credits',
      kind: verdict.kind,
      guest_id: verdict.guestId || null,
      remaining: 0,
    });
  }

  const jobId = newJobId();

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return json(500, { error: 'no_base_url' });

  /* THE IMAGE GOES VIA THE STORE, NOT THROUGH THE INVOKE.
     ─────────────────────────────────────────────────────────────────────
     A background function is an ASYNCHRONOUS Lambda invocation, and those
     cap at 256KB of payload. A downscaled photograph is comfortably past
     that, so the invoke was being dropped before the relay ever ran: the
     caller got a job id and a 200, and the job then did not exist. Silent,
     and indistinguishable from the relay crashing.

     So the upload is written to the job store here and the invoke carries
     only a key. The relay reads it back (2026-08-01). */
  /* The logo is a separate upload and a separate key. It is small, but it
     rides the store for the same reason the concept image does: the invoke
     is an async Lambda call capped at 256KB (2026-08-02). */
  let logoKey = null;
  const logoImage = String(body.logo_image || '');
  let conceptKey = null;
  if (conceptImage) {
    try {
      connectLambda(event);
      const store = getStore('etl_design_jobs');
      await store.set(jobId + '-concept', conceptImage, { metadata: { contentType: 'text/plain' } });
      conceptKey = jobId + '-concept';
    } catch (e) {
      // Survivable: the brief runs without a concept image, which is the
      // normal path for most clients anyway.
      console.error('[etl-design-ask] concept image not stored, continuing without it:', e && e.message);
      conceptKey = null;
    }
  }

  if (logoImage && /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(logoImage) && logoImage.length < 3000000) {
    try {
      connectLambda(event);
      const store = getStore('etl_design_jobs');
      await store.set(jobId + '-logo', logoImage, { metadata: { contentType: 'text/plain' } });
      logoKey = jobId + '-logo';
    } catch (e) {
      console.error('[etl-design-ask] logo not stored, continuing without it:', e && e.message);
    }
  }

  try {
    const r = await fetch(base + '/.netlify/functions/etl-design-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        promoting,
        audience:      String(body.audience || '').trim().slice(0, 400),
        business_name: String(body.business_name || '').trim().slice(0, 160),
        business_site: String(body.business_site || '').trim().slice(0, 300),
        platform:      String(body.platform || 'linkedin').trim(),
        // The assigned visual register, when the brief carries one. Blank
        // leaves Yuki to choose, which is the old behaviour.
        look:          String(body.look || '').trim().slice(0, 60),
        caption_note:  String(body.caption_note || '').trim().slice(0, 400),
        brand_colours: String(body.brand_colours || '').trim().slice(0, 200),
        // 'Use my image, draw nothing.' Explicit, so it does not depend on a
        // heuristic deciding the upload looks photographic (2026-08-02).
        use_upload_as_art: !!body.use_upload_as_art,
        concept_key:   conceptKey,
        logo_key:      logoKey,
      }),
    });
    console.log('[etl-design-ask] background invoke status', r.status, 'job', jobId);
  } catch (e) {
    console.error('[etl-design-ask] background invoke failed', e && e.message);
    return json(502, { error: 'could_not_start' });
  }

  /* Spend only now, once the relay is genuinely running. Spending before the
     background invoke would charge somebody for a job that never started. */
  let spent = { ok: true, remaining: null };
  try {
    spent = await credits.spend(event, verdict);
  } catch (e) {
    if (!creditFault) creditFault = String((e && e.message) || e).slice(0, 200);
    console.error('[etl-design-ask] credit spend failed (work already started):', creditFault);
  }

  return json(200, {
    ok: true,
    job_id: jobId,
    kind: verdict.kind,
    // Handed back so the browser can keep using the same guest identity. A
    // new id every visit would hand out unlimited free briefs.
    guest_id: verdict.guestId || null,
    remaining: spent.remaining,
    // Present only when the credit layer itself broke. Its absence is the
    // evidence the gate actually ran.
    credit_fault: creditFault,
  });
};
