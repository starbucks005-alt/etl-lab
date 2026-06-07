/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-brief-latest — returns metadata for the most recent Auggie
   morning brief: date, transcript, estimated audio length, sources used.

   GET /.netlify/functions/studio-auggie-brief-latest
   Auth: Supabase JWT (this is Terry-personal data, not public).

   Returns: { available, dateKey, generatedAt, transcript, estimatedSeconds,
             audioUrl, sourcesUsed }
   or:      { available: false }
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  try { connectLambda(event); } catch (_) {}

  let meta = null;
  try {
    const metaStore = getStore('auggie_briefs_meta');
    meta = await metaStore.get('latest', { type: 'json' });
  } catch (err) {
    console.error('[auggie-brief-latest] meta read failed', err && err.message);
  }

  if (!meta) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ available: false }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=30' },
    body: JSON.stringify({
      available: true,
      dateKey: meta.dateKey,
      generatedAt: meta.generatedAt,
      transcript: meta.transcript,
      estimatedSeconds: meta.estimatedSeconds,
      audioUrl: '/.netlify/functions/studio-auggie-brief-audio?date=' + encodeURIComponent(meta.dateKey),
      sourcesUsed: meta.sourcesUsed || [],
    }),
  };
};
