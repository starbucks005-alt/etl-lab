/* ─────────────────────────────────────────────────────────────────────────────
   studio-jax-trigger

   Fires the Jax background scan and returns a job_id + report_url immediately
   so Auggie's chat can hand the link to Ms. Terry before the scan finishes.

   The background function (studio-jax-scan-background.js) does the actual
   work — fetches the target page, parses SEO elements, builds findings,
   generates Jax's voice summary, saves the report to blob storage.

   POST body: { target_url, scope?, requested_by? }
   Returns: { job_id, report_url, status: 'queued' }
   Auth: Supabase JWT in Authorization header. Same gate as other Studio
   functions. Anonymous requests refused.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

/* ── JWT validation against Supabase ────────────────────────────────────── */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/* Generate an opaque, sortable job_id: yyyy-mm-dd plus 6 random chars.
   Sortable by date prefix; collision-resistant enough for our scale. */
function generateJobId() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  const date = `${get('year')}${get('month')}${get('day')}`;
  // 6 chars of base36 randomness — plenty for our volume
  const rand = Math.floor(Math.random() * 0x7fffffff).toString(36).slice(0, 6).padStart(6, '0');
  return `jax-${date}-${rand}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

  let targetUrl = (body.target_url || '').trim();
  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'target_url required' }),
    };
  }
  // Add scheme if missing — Terry may pass "emerging-tech-lab.com"
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
  // Validate
  try { new URL(targetUrl); } catch (e) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid target_url' }),
    };
  }
  const scope = (body.scope || 'homepage').trim();
  const requestedBy = (body.requested_by || 'Ms. Terry via Studio chat').trim();

  const jobId = generateJobId();
  // Absolute URL so it's clickable when surfaced in chat (linkify only
  // matches http(s) URLs, not relative paths). Falls back to a path if
  // we somehow can't determine the origin — better than crashing.
  const reqOrigin = (process.env.URL || '').replace(/\/$/, '')
    || ('https://' + ((event.headers && event.headers.host) || ''));
  const reportUrl = (reqOrigin || '') + '/studio/jax-reports.html?id=' + encodeURIComponent(jobId);

  // Write a "queued" placeholder so the report page renders a scanning state
  // immediately, even before the background function picks up the work.
  try { connectLambda(event); } catch (_) {}
  try {
    await getStore('jax_reports').setJSON(jobId, {
      id: jobId,
      target_url: targetUrl,
      scope,
      createdAt: new Date().toISOString(),
      status: 'queued',
      requested_by: requestedBy,
    });
  } catch (e) {
    console.warn('[jax-trigger] placeholder write failed (non-fatal)', e && e.message);
  }

  // Fire the background function. Netlify routes -background functions by
  // path; we call our own deploy's URL fire-and-forget.
  const base = process.env.URL || ('https://' + (event.headers && event.headers.host) || '');
  const bgUrl = base.replace(/\/$/, '') + '/.netlify/functions/studio-jax-scan-background';

  // Invoke the background function. MUST be awaited — Netlify background
  // functions return 202 immediately, so awaiting adds no real latency,
  // but the previous fire-and-forget pattern let the lambda exit before
  // the fetch even left the local network stack. That's why the polling
  // saw "queued" forever — the background function was never actually
  // called.
  try {
    const bgRes = await fetch(bgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        target_url: targetUrl,
        scope,
        requested_by: requestedBy,
      }),
    });
    console.log('[jax-trigger] bg invoke status', bgRes.status, 'for', jobId);
    // 202 = accepted (background queued). Anything else means the
    // background function did not pick up the work — surface the failure
    // to the report blob so the report page shows a real error instead
    // of polling for 3 minutes.
    if (bgRes.status !== 202 && bgRes.status !== 200) {
      const failBody = await bgRes.text().catch(() => '<no body>');
      console.error('[jax-trigger] bg invoke non-2xx', bgRes.status, failBody.slice(0, 200));
      try {
        await getStore('jax_reports').setJSON(jobId, {
          id: jobId, target_url: targetUrl, scope,
          createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
          status: 'failed',
          error: 'background function returned ' + bgRes.status + ' (' + failBody.slice(0, 120) + ')',
          requested_by: requestedBy,
        });
      } catch (e2) {
        console.warn('[jax-trigger] fail-state write failed', e2 && e2.message);
      }
    }
  } catch (e) {
    console.error('[jax-trigger] bg fetch failed', e && e.message);
    // Write a failed status to blob so the polling shows a real error
    // instead of waiting 3 minutes for nothing.
    try {
      await getStore('jax_reports').setJSON(jobId, {
        id: jobId, target_url: targetUrl, scope,
        createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        status: 'failed',
        error: 'could not start the scan: ' + (e && e.message || 'unknown'),
        requested_by: requestedBy,
      });
    } catch (e2) {
      console.warn('[jax-trigger] fail-state write failed', e2 && e2.message);
    }
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'could not queue scan', detail: e && e.message }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: jobId,
      report_url: reportUrl,
      status: 'queued',
      target_url: targetUrl,
    }),
  };
};
