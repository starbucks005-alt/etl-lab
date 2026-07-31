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
  let verdict;
  try {
    verdict = await credits.check(event, body);
  } catch (e) {
    // The credit layer failing shut would take a public page down over
    // bookkeeping. Let the brief through and say so in the log.
    console.error('[etl-design-ask] credit check failed, allowing through:', e && e.message);
    verdict = { ok: true, kind: 'guest', guestId: credits.newGuestId(), remaining: null };
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
        concept_image: conceptImage,
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
    console.error('[etl-design-ask] credit spend failed (work already started):', e && e.message);
  }

  return json(200, {
    ok: true,
    job_id: jobId,
    kind: verdict.kind,
    // Handed back so the browser can keep using the same guest identity. A
    // new id every visit would hand out unlimited free briefs.
    guest_id: verdict.guestId || null,
    remaining: spent.remaining,
  });
};
