/* ─────────────────────────────────────────────────────────────────────────────
   studio-meditation-start

   Kicks off a guided-meditation render for the Studio's Zen skin. Ported
   from THE_DOSE's meditation-start.js (same Claude + ElevenLabs pipeline,
   same lazy-generate-once-then-cache-forever pattern) — but a separate
   Netlify Blobs namespace, since Studio and The Dose are different Netlify
   sites and Blobs don't cross sites. First play of a given (leader, length)
   costs one real Claude + ElevenLabs render; every play after that is a
   free cache hit, same as it already works on The Dose.

   GET /.netlify/functions/studio-meditation-start?leader=jaque&length=3
   Auth: Supabase JWT, same gate as every other Studio function.

   Behavior:
   - Cache hit -> { status: 'complete' } immediately.
   - Render already in progress -> { status: 'pending' }, no duplicate kicked off.
   - Otherwise marks pending and triggers the background render function.
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

// v1: Jaque only (already the established guided-meditation host on his own
// roster bio). Easy to add more leaders later by extending both this list
// and LEADERS in studio-meditation-generate-background.js.
const VALID_LEADERS = ['jaque'];
const VALID_LENGTHS = ['3', '5', '8'];

// Bump when the prompt/voice changes should invalidate cached audio. Old
// blobs at a previous prefix just sit there unreachable; harmless.
const PROMPT_VERSION = 'v1';

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
    return json(401, { error: 'unauthorized', reason: auth.reason });
  }

  try {
    connectLambda(event);
  } catch (err) {
    return json(500, { error: 'Blobs context unavailable', detail: err.message });
  }

  const params = event.queryStringParameters || {};
  const leader = String(params.leader || '').toLowerCase().trim();
  const length = String(params.length || '').trim();

  if (!VALID_LEADERS.includes(leader)) return json(400, { error: `Unknown leader "${leader}"` });
  if (!VALID_LENGTHS.includes(length)) return json(400, { error: `Unknown length "${length}"` });

  const jobId = `${PROMPT_VERSION}_${leader}_${length}`;
  const audioStore = getStore('studio-meditation-audio');
  const statusStore = getStore('studio-meditation-status');

  const existing = await withTimeout(audioStore.getMetadata(jobId), 10000, 'audioStore.getMetadata')
    .catch(() => null);
  if (existing) {
    const bytes = existing.metadata?.bytes || 0;
    const MAX_SERVABLE_BYTES = 4 * 1024 * 1024;
    if (bytes <= MAX_SERVABLE_BYTES) {
      return json(200, { jobId, status: 'complete' });
    }
    await withTimeout(audioStore.delete(jobId), 10000, 'audioStore.delete').catch(() => null);
  }

  const statusRaw = await withTimeout(statusStore.get(jobId), 10000, 'statusStore.get').catch(() => null);
  if (statusRaw) {
    try {
      const parsed = JSON.parse(statusRaw);
      if (parsed.status === 'pending') {
        const startedAt = parsed.startedAt ? new Date(parsed.startedAt).getTime() : 0;
        const ageMs = Date.now() - startedAt;
        if (ageMs > 90000) {
          await withTimeout(statusStore.delete(jobId), 10000, 'statusStore.delete').catch(() => null);
        } else {
          return json(200, { jobId, status: 'pending' });
        }
      }
      if (parsed.status === 'failed' || parsed.status === 'complete') {
        await withTimeout(statusStore.delete(jobId), 10000, 'statusStore.delete').catch(() => null);
      }
    } catch { /* fall through to kick off */ }
  }

  try {
    await withTimeout(
      statusStore.setJSON(jobId, { status: 'pending', startedAt: new Date().toISOString() }),
      10000,
      'statusStore.setJSON'
    );
  } catch (err) {
    return json(500, { error: 'Could not mark job as pending', detail: err.message });
  }

  const bgUrl = `${process.env.URL || ''}/.netlify/functions/studio-meditation-generate-background`;
  fetch(bgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, leader, length: parseInt(length, 10) }),
  }).catch((err) => console.error('[studio-meditation-start] bg trigger failed:', err));

  return json(202, { jobId, status: 'pending' });
};

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
