/* ─────────────────────────────────────────────────────────────────────────────
   studio-pa-send

   Cross-studio PA messaging. Writes a message into the recipient studio's
   pa_mailbox blob. Used when one PA wants to relay a question or reply to
   another studio's PA on behalf of their owner.

   POST body:
     to_user_id   string  — Supabase user ID of the recipient studio
     to_pa        string  — display name of the recipient PA (e.g. "Jen")
     from_pa      string  — display name of the sending PA (e.g. "Auggie")
     from_owner   string  — display name of the sending owner (e.g. "Dr. O")
     message      string  — the message text (max 1000 chars)
     reply_to_id  string? — if this is a reply, the ID of the original message

   Returns: { ok: true, message_id }

   Auth: Supabase JWT (the sender must be a logged-in Studio user).
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid_json' }) }; }

  const { to_user_id, to_pa, from_pa, from_owner, message, reply_to_id } = body;
  if (!to_user_id || !message) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'to_user_id and message are required' }) };
  }

  try { connectLambda(event); } catch (_) {}

  const store = getStore('pa_mailbox');
  let mailbox = { messages: [] };
  try {
    const existing = await store.get(to_user_id, { type: 'json' });
    if (existing && Array.isArray(existing.messages)) mailbox = existing;
  } catch (_) {}

  const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  mailbox.messages.push({
    id: msgId,
    type: reply_to_id ? 'reply' : 'question',
    from_user_id: auth.user.id,
    from_pa: String(from_pa || 'PA').slice(0, 40),
    from_owner: String(from_owner || 'the other studio').slice(0, 80),
    to_pa: String(to_pa || 'PA').slice(0, 40),
    message: String(message).slice(0, 1000),
    sent_at: new Date().toISOString(),
    reply_to_id: reply_to_id || null,
    surfaced: false,
  });

  // Keep only the last 100 messages so the blob stays bounded.
  if (mailbox.messages.length > 100) mailbox.messages = mailbox.messages.slice(-100);

  await store.setJSON(to_user_id, mailbox);

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, message_id: msgId }),
  };
};
