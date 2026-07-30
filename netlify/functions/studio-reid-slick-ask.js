/* studio-reid-slick-ask — sync trigger for Reid's tailored-slick generator.
   POST { recipient, brief? } -> returns job_id, fires the background generator. */

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
    return { ok: true, user, token };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

function newJobId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'slk-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

exports.handler = async function(event) {
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

  const recipient = String(body.recipient || '').trim();
  if (!recipient)              return { statusCode: 400, body: JSON.stringify({ error: 'recipient_required' }) };
  if (recipient.length > 400)  return { statusCode: 400, body: JSON.stringify({ error: 'recipient_too_long' }) };

  const jobId = newJobId();

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return { statusCode: 500, body: JSON.stringify({ error: 'no_base_url' }) };

  try {
    fetch(base + '/.netlify/functions/studio-reid-slick-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
      body: JSON.stringify({
        job_id: jobId,
        recipient,
        brief: body.brief || null,
        // What is being advertised, whose branding goes on it, and the owner's
        // own prices. All pass-through: this function does not default any of
        // them, so a blank field means "omit", never "use the landlord's".
        subject_url: String(body.subject_url || '').trim().slice(0, 500),
        brand_name: String(body.brand_name || '').trim().slice(0, 120),
        brand_tagline: String(body.brand_tagline || '').trim().slice(0, 200),
        brand_footer: String(body.brand_footer || '').trim().slice(0, 300),
        brand_site: String(body.brand_site || '').trim().slice(0, 200),
        crew_reference: String(body.crew_reference || '').trim().slice(0, 4000),
        tiers: Array.isArray(body.tiers) ? body.tiers.slice(0, 4) : [],
      }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, job_id: jobId, polling_endpoint: '/.netlify/functions/studio-reid-slick-status?job_id=' + jobId }),
  };
};
