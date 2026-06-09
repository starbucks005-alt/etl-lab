/* ─────────────────────────────────────────────────────────────────────────────
   studio-routine-list

   Returns the calling user's routines. Used by:
     - The Studio Routines tab (`/studio.html`)
     - Auggie when the user says "show me my routines"

   POST body: {} (or omit)
   Returns:
     { ok: true,
       count: N,
       routines: [{ ... routine objects ... }],
       whitelist: [{ key, label, staff, description, example_human }, ...]  // for the "new routine" picker
     }

   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

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

async function loadWhitelist(event) {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'auggie-routine-targets.json'),
    path.join(process.cwd(), 'data', 'auggie-routine-targets.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && Array.isArray(parsed.targets)) return parsed.targets;
      }
    } catch (_) {}
  }
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (base) {
    try {
      const r = await fetch(base + '/data/auggie-routine-targets.json', { cache: 'no-store' });
      if (r.ok) {
        const parsed = await r.json();
        if (parsed && Array.isArray(parsed.targets)) return parsed.targets;
      }
    } catch (_) {}
  }
  return [];
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

  const store = getStore('routines');
  const idx = (await store.get('index', { type: 'json' })) || { owners: {} };
  const routines = idx.owners[auth.user.id] || [];

  // Strip whitelist down to picker-friendly fields
  const whitelist = await loadWhitelist(event);
  const pickerOptions = whitelist.map(t => ({
    key: t.key,
    staff: t.staff,
    label: t.label,
    description: t.description,
    example_cron: t.example_cron,
    example_human: t.example_human,
    param_schema: t.param_schema || {},
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      count: routines.length,
      routines,
      whitelist: pickerOptions,
      server_now: new Date().toISOString(),
    }),
  };
};
