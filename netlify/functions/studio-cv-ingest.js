/* ─────────────────────────────────────────────────────────────────────────────
   studio-cv-ingest — the owner hands their PA a CV / résumé so the PA KNOWS them.

   Claude (Sonnet) reads the document, extracts a tight profile + topics worth
   tracking, and saves it to the owner's studio_config `owner_context`. That
   field is ALREADY read by the PA chat (studio-auggie-chat) and the morning
   brief's web sweep (studio-auggie-brief-*), so an uploaded CV immediately makes
   the PA address the owner by who they are and search the web for what fits them.

   POST  { document: { mediaType:'application/pdf', base64, name } }   (PDF)
      or { text: '<résumé text>' }                                     (pasted/plain text)
   Auth: Supabase JWT, or the owner master key (_owner-auth).
   Returns: { ok, saved, profile }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

// Sonnet, not Haiku (Haiku is broadcast-chat only) and cheaper than Opus. Reading
// a CV into a profile is a one-time, non-demo-facing call.
const MODEL = 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' }; { const _ok = require('./_owner-auth.js').ownerUser(token); if (_ok) return { ok: true, user: _ok }; }
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY } });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) { return { ok: false, reason: 'fetch_failed', error: e && e.message }; }
}

const SYSTEM = [
  'You read a CV or résumé and produce a tight PROFILE that the person\'s AI chief of staff will use to know them and to search the web for things that fit them.',
  'Output plain text, no preamble, no markdown headers beyond the labels below, in exactly this shape:',
  'WHO: one or two sentences — name, role, field, seniority.',
  'EXPERTISE: 4-8 short comma-separated areas.',
  'CURRENT FOCUS: one or two sentences on what they are working on or known for now.',
  'TRACK: 6-10 web-search topics worth monitoring for them (their name, employers, niche terms, named projects, key collaborators).',
  'Keep the whole thing under 180 words. Use only facts supported by the document; do not invent.',
].join('\n');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try { connectLambda(event); } catch (_) {}

  const auth = await validateRequest(event);
  if (!auth.ok) return json(401, { error: 'unauthorized', reason: auth.reason });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  const doc = body.document;
  const text = (body.text || '').trim();
  if (!doc && !text) return json(400, { error: 'no_cv', message: 'Attach a PDF or send text.' });
  if (doc && doc.mediaType !== 'application/pdf') return json(415, { error: 'unsupported_type', message: 'PDF or text only for now.' });
  if (doc && doc.base64 && doc.base64.length > 11 * 1024 * 1024) return json(413, { error: 'too_big', message: 'CV is too large (max ~8MB).' });

  const apiKey = process.env.FOUNDER_STUDIO_API_KEY;
  if (!apiKey) return json(500, { error: 'anthropic_key_missing' });
  const client = new Anthropic({ apiKey });

  const content = [];
  if (doc && doc.base64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } });
  content.push({ type: 'text', text: text ? ('Here is the résumé text:\n\n' + text.slice(0, 40000)) : 'Build the profile from the attached CV.' });

  let profile = '';
  try {
    const resp = await client.messages.create({ model: MODEL, max_tokens: 700, system: SYSTEM, messages: [{ role: 'user', content }] });
    profile = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } catch (e) {
    return json(502, { error: 'extract_failed', detail: e && e.message });
  }
  if (!profile) return json(502, { error: 'empty_profile' });

  // Persist into the owner's per-user config. owner_context is read by the PA
  // chat and the brief web sweep; merge so other saved fields survive.
  try {
    const store = getStore('studio_config');
    const existing = (await store.get(auth.user.id, { type: 'json' })) || {};
    const merged = Object.assign({}, existing, {
      user_id: auth.user.id,
      owner_context: profile,
      cv_provided: true,
      cv_ingested_at: new Date().toISOString(),
    });
    await store.setJSON(auth.user.id, merged);
  } catch (e) {
    return json(500, { error: 'save_failed', detail: e && e.message });
  }

  return json(200, { ok: true, saved: true, profile });
};
