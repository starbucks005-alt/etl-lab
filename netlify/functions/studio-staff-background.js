/* studio-staff-background — generic staff dispatch background runner.
   Receives { job_id, staff_id, brief, owner_site?, owner_name?, owner_context?, user_id }
   Loads the staff registry, finds the entry, optionally fetches the owner's site,
   runs Anthropic with the staff persona, stores result in studio_jobs/staff/{job_id}. */

const Anthropic = require('@anthropic-ai/sdk').default;
const { VOICE_LAW_PROSE } = require('./_etl-voice-law.js');
const { getStore, connectLambda } = require('@netlify/blobs');
const path = require('path');
const fs = require('fs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2500;

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

function loadRegistry() {
  const candidates = [
    path.join(__dirname, 'data', 'studio-staff-registry.json'),
    path.join(process.cwd(), 'data', 'studio-staff-registry.json'),
    path.join(__dirname, '..', '..', 'data', 'studio-staff-registry.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {}
  }
  return {};
}

async function fetchSiteText(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ETL-Studio/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    let html = await r.text();
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    const text = html
      .replace(/<\/(p|div|li|h[1-6]|section|article|header|footer|nav)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text.slice(0, 8000);
  } catch (_) {
    return null;
  }
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

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const jobId = String(body.job_id || '').trim();
  const staffId = String(body.staff_id || '').trim();
  const brief = String(body.brief || '').trim();
  if (!jobId || !staffId || !brief) {
    return { statusCode: 400, body: JSON.stringify({ error: 'job_id_staff_id_and_brief_required' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const registry = loadRegistry();
  const entry = registry[staffId];
  if (!entry) {
    return { statusCode: 404, body: JSON.stringify({ error: 'staff_not_found', staff_id: staffId }) };
  }

  const jobs = getStore('studio_jobs');
  const jobKey = 'staff/' + jobId;
  const userId = body.user_id || auth.user.id;

  try {
    await jobs.setJSON(jobKey, {
      job_id: jobId,
      staff_id: staffId,
      agent: entry.name,
      status: 'running',
      owner_site: body.owner_site || null,
      user_id: userId,
      created_at: new Date().toISOString(),
    });
  } catch (blobErr) {
    console.error('[studio-staff-background] blob running write failed:', staffId, blobErr && blobErr.message);
  }

  try {
    const ownerSite = body.owner_site || null;
    const siteText = (entry.fetch_site && ownerSite) ? await fetchSiteText(ownerSite) : null;

    const parts = [];
    if (body.owner_name) parts.push('Owner: ' + body.owner_name);
    if (body.owner_context) parts.push('Context: ' + body.owner_context);
    if (ownerSite) parts.push('Site: ' + ownerSite);
    parts.push('Brief: ' + brief);
    if (siteText) {
      parts.push('\nSite content (stripped HTML, for your assessment):\n---\n' + siteText + '\n---');
    } else if (ownerSite && entry.fetch_site) {
      parts.push('Note: site fetch returned no content. Work from the brief and context alone.');
    }

    const userMsg = parts.join('\n');

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: entry.persona + '\n\n' + VOICE_LAW_PROSE,
      messages: [{ role: 'user', content: userMsg }],
    });

    const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) {
      await jobs.setJSON(jobKey, {
        job_id: jobId, staff_id: staffId, agent: entry.name,
        status: 'error', error: 'empty_response',
        user_id: userId, finished_at: new Date().toISOString(),
      });
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'empty_response' }) };
    }

    await jobs.setJSON(jobKey, {
      job_id: jobId,
      staff_id: staffId,
      agent: entry.name,
      status: 'done',
      text,
      owner_site: ownerSite,
      user_id: userId,
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, job_id: jobId }),
    };
  } catch (err) {
    console.error('[studio-staff-background] error', staffId, err && err.message);
    await jobs.setJSON(jobKey, {
      job_id: jobId, staff_id: staffId, agent: entry.name,
      status: 'error', error: err && err.message,
      user_id: userId, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
