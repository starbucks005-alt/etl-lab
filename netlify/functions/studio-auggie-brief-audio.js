/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-brief-audio — streams the mp3 for a dated Auggie brief.

   GET /.netlify/functions/studio-auggie-brief-audio?date=YYYY-MM-DD
   Auth: Supabase JWT (Terry-personal).

   Returns: audio/mpeg bytes. Falls back to "latest" if no date query.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

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

  // Per-owner namespace: Dr. O serves the global blobs; every other owner
  // serves their own (keyed by user_id), matching the brief background/latest.
  const isOwner = (auth.user.email || '').toLowerCase() === 'starbucks005@gmail.com';
  const keyPfx = isOwner ? '' : ('u/' + auth.user.id + '/');

  const params = event.queryStringParameters || {};
  let dateKey = (params.date || '').trim();

  // Default to whatever "latest" points to if no date specified.
  if (!dateKey) {
    try {
      const metaStore = getStore('auggie_briefs_meta');
      const meta = await metaStore.get(keyPfx + 'latest', { type: 'json' });
      if (meta && meta.dateKey) dateKey = meta.dateKey;
    } catch (err) {
      console.error('[auggie-brief-audio] meta read failed', err && err.message);
    }
  }

  if (!dateKey) {
    return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'no brief available' }) };
  }

  let audioBuf;
  try {
    const audioStore = getStore('auggie_briefs_audio');
    audioBuf = await audioStore.get(keyPfx + dateKey, { type: 'arrayBuffer' });
  } catch (err) {
    console.error('[auggie-brief-audio] read failed', dateKey, err && err.message);
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'audio read failed' }) };
  }

  if (!audioBuf) {
    return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'brief not found for ' + dateKey }) };
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=600',
      'Content-Length': String(audioBuf.byteLength),
    },
    body: Buffer.from(audioBuf).toString('base64'),
    isBase64Encoded: true,
  };
};
