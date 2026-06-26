/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-brief-trigger — manual "generate a brief now" endpoint.

   POST /.netlify/functions/studio-auggie-brief-trigger
   Auth: Supabase JWT (Terry-only).

   Forwards to studio-auggie-brief-background using admin basic auth from
   server-side env vars (never exposed to the browser). Returns 202
   immediately; the actual work runs for 60-90 seconds in the background
   function. The Studio UI tells the user to refresh in ~90s to see it.

   Use case: demos, missed mornings, or when Terry wants Auggie to do a
   fresh sweep on demand. The daily cron at 11 UTC still runs independently.
   ───────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' }; { const _ok = require('./_owner-auth.js').ownerUser(token); if (_ok) return { ok: true, user: _ok }; }
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  // JWT gate (browser is Terry-only via Supabase magic link).
  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  // Admin creds: server-side env only. Never returned to the browser.
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'admin creds missing' }) };
  }
  const basic = Buffer.from(`${user}:${pass}`).toString('base64');
  const base = process.env.URL || 'https://emerging-tech-lab.com';

  // Owner vs buyer. Dr. O triggers her global brief (empty body, cron shape).
  // Any other signed-in owner triggers a brief ABOUT THEM: we forward a target
  // built from their validated user_id plus the owner context the Studio sent.
  let reqBody = {};
  try { reqBody = JSON.parse(event.body || '{}'); } catch (_) {}
  const OWNER_EMAIL = 'starbucks005@gmail.com';
  const isOwner = (auth.user.email || '').toLowerCase() === OWNER_EMAIL;
  // Landlord preview ("generate this client's test brief"): the owner passes
  // preview_as=<client email> plus that client's identity. Write to a
  // preview-<email> namespace so it never touches the client's real
  // (login-keyed) brief, and the landlord reads it back via ?as=.
  const previewAs = isOwner ? String(reqBody.preview_as || '').toLowerCase().trim() : '';
  const clientFields = {
    owner_name: reqBody.owner_name || '',
    company_name: reqBody.company_name || '',
    owner_context: reqBody.owner_context || '',
    owner_site: reqBody.owner_site || '',
    address_form: reqBody.owner_address_form || '',
    pa_first_name: reqBody.pa_first_name || '',
  };
  let forwardBody;
  if (previewAs) {
    forwardBody = { target: Object.assign({ user_id: 'preview-' + previewAs, skip_audio: true }, clientFields) };
  } else if (isOwner) {
    forwardBody = {};
  } else {
    forwardBody = { target: Object.assign({ user_id: auth.user.id }, clientFields) };
  }

  try {
    const res = await fetch(`${base}/.netlify/functions/studio-auggie-brief-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basic}`,
      },
      body: JSON.stringify(forwardBody),
    });
    // Background returns 202 immediately; we just confirm the trigger landed.
    if (res.status >= 200 && res.status < 300) {
      return {
        statusCode: 202,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggered: true,
          message: 'Auggie is generating a fresh brief. Refresh in 60-90 seconds.',
        }),
      };
    }
    const errText = await res.text().catch(() => '<no body>');
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'background rejected: ' + res.status, detail: errText.slice(0, 200) }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'fetch failed: ' + (err && err.message) }),
    };
  }
};
