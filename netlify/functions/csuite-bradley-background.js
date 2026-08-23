/* ─────────────────────────────────────────────────────────────────────────────
   csuite-bradley-background

   Bradley Cooper-Smith's CFO backpack. Reference template for all 29 C Suite
   backpacks. Takes a finance question from the buyer, uses Anthropic with the
   built-in web_search tool to pull current rates / market data / regulatory
   context, then answers in Bradley's voice with sourced citations and dates.

   v1 ships with web_search only. v2 adds custom tools for FRED (St. Louis Fed)
   and SEC EDGAR per CCW's spec in data/csuite-backpacks.json.

   POST body: { job_id, question, context? }
   Writes job state to the `csuite_jobs` blob throughout the run.

   Auth: same Supabase JWT gate as other studio-* functions. Triggered by a
   sync function (csuite-bradley-trigger or the Studio UI direct call) and
   polled via csuite-bradley-status.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { VOICE_LAW_CHAT, houseTypography } = require('./_etl-voice-law.js');
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_WEB_SEARCHES = 5;

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

function loadBackpack() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'csuite-backpacks.json'),
    path.join(process.cwd(), 'data', 'csuite-backpacks.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        const list = parsed.consultants || parsed.agents || [];
        return list.find(x => (x.id === 'bradley_cooper_smith' || x.name === 'Bradley Cooper-Smith')) || null;
      }
    } catch (_) {}
  }
  return null;
}

async function loadBackpackHttp(event) {
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) return null;
  try {
    const r = await fetch(base + '/data/csuite-backpacks.json', { cache: 'no-store' });
    if (r.ok) {
      const parsed = await r.json();
      const list = parsed.consultants || parsed.agents || [];
      return list.find(x => (x.id === 'bradley_cooper_smith' || x.name === 'Bradley Cooper-Smith')) || null;
    }
  } catch (_) {}
  return null;
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
  const question = String(body.question || '').trim();
  if (!jobId)    return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };
  if (!question) return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };

  const apiKey = process.env.FOUNDER_STUDIO_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('csuite_jobs');
  const jobKey = 'bradley/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId,
    agent: 'Bradley Cooper-Smith',
    role: 'CFO',
    question,
    status: 'running',
    created_at: new Date().toISOString(),
    owner_id: auth.user.id,
  });

  let backpack = loadBackpack() || await loadBackpackHttp(event);
  if (!backpack) {
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: 'backpack_config_not_found',
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: 'backpack_config_not_found' }) };
  }

  const systemPrompt = backpack.system_prompt + '\n\nWhen you answer:\n- Lead with the decision the owner should make and why.\n- Then supporting facts with sources and dates.\n- Plain English. No jargon-without-explanation.\n- Avoid em dashes. Use commas, periods, semicolons.\n- If a number changes with rates, give the current rate AND when it was last observed.\n- End with one line: "Bottom line:" followed by your one-sentence call.';

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt + VOICE_LAW_CHAT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
      messages: [{ role: 'user', content: question + (body.context ? '\n\nOwner context: ' + String(body.context).slice(0, 1000) : '') }],
    });

    // Extract text + citations from the response
    const textBlocks = (response.content || []).filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text).join('\n').trim();

    // Citations come from web_search tool results; the SDK surfaces them in
    // server_tool_use / web_search_tool_result blocks. We extract URLs from
    // citations on each text block.
    const citations = [];
    const seenUrls = new Set();
    textBlocks.forEach(b => {
      (b.citations || []).forEach(c => {
        const url = c.url || (c.web_search_result_location && c.web_search_result_location.url) || '';
        const title = c.title || c.cited_text || '';
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          citations.push({ url, title });
        }
      });
    });

    // Scrub em dashes from prose (AI-tell ban — house rule)
    const scrubbed = houseTypography(text);

    await store.setJSON(jobKey, {
      job_id: jobId,
      agent: 'Bradley Cooper-Smith',
      role: 'CFO',
      question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations },
      tokens_used: response.usage && (response.usage.output_tokens + response.usage.input_tokens) || null,
      owner_id: auth.user.id,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, job_id: jobId, citations_count: citations.length }),
    };
  } catch (err) {
    console.error('[csuite-bradley-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId,
      status: 'error',
      error: err && err.message,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
