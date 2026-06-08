/* ─────────────────────────────────────────────────────────────────────────────
   studio-jax-report

   Returns a saved Jax SEO report by ID. Used by:
     - The /studio/jax-reports.html page to render the report
     - Any future polling client wanting to know if the background scan is done

   GET ?id=<job_id>
   Returns:
     - 200 with { id, status, ...report } if found
     - 404 if not found yet (caller should poll)
   Auth: Supabase JWT in Authorization header. Reports are auth-gated because
   they may contain notes about Dr. O's private digital footprint.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

/* ── JWT validation against Supabase (same as other studio functions) ──── */
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'method not allowed' };
  }

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  // Accept id via query string (GET) or body (POST). Also accept "list" mode
  // to return the recent-reports index.
  let id = '';
  let listMode = false;
  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    id = (qs.id || '').trim();
    listMode = qs.list === '1' || qs.list === 'true';
  } else {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    id = (body.id || '').trim();
    listMode = body.list === true;
  }

  try { connectLambda(event); } catch (_) {}

  if (listMode) {
    try {
      const idx = await getStore('jax_reports_index').get('latest', { type: 'json' });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: Array.isArray(idx) ? idx : [] }),
      };
    } catch (e) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      };
    }
  }

  if (!id) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'id required (or list=true)' }),
    };
  }

  try {
    const report = await getStore('jax_reports').get(id, { type: 'json' });
    if (!report) {
      return {
        statusCode: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'report not found', id }),
      };
    }
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    };
  } catch (e) {
    console.error('[jax-report] read failed', e && e.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'could not read report', detail: e && e.message }),
    };
  }
};
