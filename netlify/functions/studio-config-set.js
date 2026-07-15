/* ─────────────────────────────────────────────────────────────────────────────
   studio-config-set

   POST a full or partial studio_config update. Writes to the per-user
   studio_config blob keyed by user_id. Used by the in-Studio Settings
   panel (when the buyer renames their company / PA / address pref) and
   eventually by admin provisioning tools.

   POST body: { ...config fields to update }
   Returns: { ok: true, config: <merged config> }

   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const ALLOWED_FIELDS = new Set([
  'company_name', 'owner_name', 'owner_title', 'owner_org', 'owner_context',
  'pa', 'address_pref', 'timezone', 'brief_beat', 'domain_addon', 'hired_staff',
  'cv_provided', 'cv_summary',
  'owner_site', 'website',
  'pa_contacts',
  'theme',
]);

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

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }
  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const store = getStore('studio_config');
  const existing = (await store.get(auth.user.id, { type: 'json' })) || {};

  // Allowlist incoming fields
  const patch = {};
  for (const k of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(k)) patch[k] = body[k];
  }

  const merged = Object.assign({}, existing, patch, {
    user_id: auth.user.id,
    user_email: auth.user.email,
    updated_at: new Date().toISOString(),
  });

  await store.setJSON(auth.user.id, merged);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ok: true, config: merged }),
  };
};
