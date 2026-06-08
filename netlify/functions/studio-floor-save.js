/* ─────────────────────────────────────────────────────────────────────────────
   studio-floor-save

   Captures a Floor thread (Workfloor or Watercooler) as a "highlight" for
   marketing / sales use. The buyer can click "save this moment" on the
   Floor; the visible thread is sent here, the function writes it to a
   `floor_highlights` blob keyed by a fresh save_id, and returns the id so
   the UI can confirm the save landed.

   The same thread is ALSO copied to the buyer's clipboard client-side
   (browser API, no backend involved) so they can paste it into a sales
   deck, a Forbes draft, a Founder Studio testimonial section, or a tweet
   right away.

   POST body:
     { mode: 'workfloor' | 'watercooler',
       messages: [{ speaker, text, timestamp }, ...],
       context_note: string  (optional)  }

   Returns:
     { ok: true, save_id: 'flh-YYYYMMDD-XXXX', count: N }

   Auth: Supabase JWT (Studio-gated; this is private staff banter, not
   public). Reuses the same gate as every other studio-* function.
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/* Generate a deterministic-ish save id: YYYYMMDD + 4 random chars. We can't
   use Date.now() inside a workflow (forbidden), but this is a sync function
   so new Date() is fine. */
function makeSaveId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return 'flh-' + y + m + day + '-' + rand;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid json' }) }; }

  const mode = (body.mode === 'watercooler') ? 'watercooler' : 'workfloor';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const contextNote = typeof body.context_note === 'string' ? body.context_note.slice(0, 400) : '';

  if (messages.length === 0) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'no messages to save' }) };
  }

  try { connectLambda(event); } catch (_) {}

  const saveId = makeSaveId();
  const record = {
    save_id: saveId,
    saved_at: new Date().toISOString(),
    saved_by: (auth.user && auth.user.id) || null,
    mode: mode,
    context_note: contextNote,
    message_count: messages.length,
    messages: messages.slice(0, 50).map(m => ({
      speaker: typeof m.speaker === 'string' ? m.speaker.slice(0, 60) : 'staff',
      timestamp: typeof m.timestamp === 'string' ? m.timestamp.slice(0, 20) : '',
      text: typeof m.text === 'string' ? m.text.slice(0, 1200) : '',
    })),
  };

  try {
    const store = getStore('floor_highlights');
    await store.setJSON(saveId, record);

    // Maintain a lightweight index of saves so a future "best of the Floor"
    // curation surface can list them without iterating the entire blob store.
    let idx;
    try { idx = await store.get('index', { type: 'json' }); } catch (_) { idx = null; }
    if (!Array.isArray(idx)) idx = [];
    idx.unshift({
      save_id: saveId,
      saved_at: record.saved_at,
      mode: mode,
      message_count: record.message_count,
      first_speaker: record.messages[0] && record.messages[0].speaker,
      first_text: (record.messages[0] && record.messages[0].text || '').slice(0, 120),
    });
    idx = idx.slice(0, 200);
    await store.setJSON('index', idx);

    console.log('[floor-save] saved', saveId, 'mode=' + mode, 'msgs=' + record.message_count);
  } catch (e) {
    console.error('[floor-save] blob write failed', e && e.message);
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'save failed', detail: e && e.message }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, save_id: saveId, count: messages.length, mode: mode }),
  };
};
