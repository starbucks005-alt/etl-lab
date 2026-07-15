/* ─────────────────────────────────────────────────────────────────────────────
   studio-meditation-status

   Polled by the Studio's Zen meditation card to check whether a background
   render has completed. Ported from THE_DOSE's meditation-status.js, own
   Blobs namespace (see studio-meditation-start.js for why).

   GET /.netlify/functions/studio-meditation-status?jobId=v1_jaque_3
   Auth: Supabase JWT, same gate as every other Studio function.

   Returns:
     { status: 'pending' }
     { status: 'complete', audioBase64: '...' }
     { status: 'failed', error: '...', detail: '...' }
   ───────────────────────────────────────────────────────────────────────────── */

const { connectLambda, getStore } = require('@netlify/blobs');

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

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout at ${ms}ms`)), ms)),
  ]);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return json(401, { status: 'failed', error: 'unauthorized', reason: auth.reason });
  }

  try {
    connectLambda(event);
  } catch (err) {
    return json(500, { status: 'failed', error: 'Blobs context unavailable', detail: err.message });
  }

  const jobId = String((event.queryStringParameters || {}).jobId || '').trim();
  if (!jobId) return json(400, { error: 'jobId required' });

  const statusStore = getStore('studio-meditation-status');
  const audioStore = getStore('studio-meditation-audio');

  const audioBuf = await withTimeout(audioStore.get(jobId, { type: 'arrayBuffer' }), 15000, 'audioStore.get')
    .catch(() => null);
  if (audioBuf) {
    const buf = Buffer.from(audioBuf);
    return json(200, { status: 'complete', audioBase64: buf.toString('base64') });
  }

  const statusRaw = await withTimeout(statusStore.get(jobId), 10000, 'statusStore.get').catch(() => null);
  if (!statusRaw) return json(404, { status: 'unknown', error: 'No job with that id' });

  let parsed;
  try { parsed = JSON.parse(statusRaw); }
  catch { return json(500, { status: 'failed', error: 'Corrupt status record' }); }

  if (parsed.status === 'pending') return json(200, { status: 'pending' });
  if (parsed.status === 'failed') return json(200, { status: 'failed', error: parsed.error, detail: parsed.detail });
  if (parsed.status === 'complete') {
    const completedAt = parsed.completedAt ? new Date(parsed.completedAt).getTime() : 0;
    const ageMs = Date.now() - completedAt;
    if (ageMs < 30000) return json(200, { status: 'pending' });
    await withTimeout(statusStore.delete(jobId), 10000, 'statusStore.delete').catch(() => null);
    return json(200, { status: 'failed', error: 'Audio missing for completed job — try again' });
  }
  return json(200, parsed);
};

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
