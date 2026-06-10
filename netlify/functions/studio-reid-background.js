/* ─────────────────────────────────────────────────────────────────────────────
   studio-reid-background

   Reid Callum's marketing backpack. Reid is the six-pack's marketing seat,
   "The Marketing Expert," and carries a live backpack (like Leo Vance).
   Lane: campaign, messaging, positioning, and competitor intelligence. He
   explicitly routes SEO / keyword / rank / discovery to Jax Rivera.

   Persona + lane separation come from CCW's config: data/reid-backpack-config.json
   (consultant_entry.system_prompt). Loaded the same way the C-Suite backpacks
   load csuite-backpacks.json.

   Tools: CCW's config specs seven (web search, web fetch, Google Trends, Meta
   Ad Library, Reddit, GDELT, data analysis). LIVE TODAY: web_search only. The
   others phase in as their APIs / tokens are connected. We tell Reid exactly
   which tools are live so he never claims one that is not wired (no empty
   backpack).

   POST body: { job_id, question, context? }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_WEB_SEARCHES = 6;

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

// What is actually wired right now. Appended to CCW's system prompt so Reid
// only claims tools that work. Update this line as each tool comes online.
const LIVE_TOOLS_NOTE = [
  '',
  'Backpack status (read carefully): of your tools, only LIVE web search is connected right now. Google Trends, Meta Ad Library, Reddit listening, GDELT news, web page fetch, and data analysis are being connected and are NOT available yet. Do not claim to have used a tool that is not live. If a question truly needs one of those, say which one would answer it best and use live web search to get as close as you honestly can.',
  '',
  'Output format:',
  '- Lead with the recommendation: the angle, the channel, the timing, and the first creative move.',
  '- Then the supporting evidence, every competitive or trend claim with a source and a date.',
  '- Plain English. Translate any marketing jargon (CAC, LTV, GTM, ICP, positioning, funnel) on first use.',
  '- If a request is about SEO, keyword research, rank, traffic, or getting found in search, do not answer it. Say it is Jax Rivera\'s lane and hand it to Jax.',
  '- Avoid em dashes. Use commas, periods, and semicolons.',
  '- End with one line: "Bottom line:" followed by your one-sentence call.',
].join('\n');

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

function configToPrompt(cfg) {
  const entry = (cfg && cfg.consultant_entry) || {};
  return entry.system_prompt || null;
}

function loadConfig() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'reid-backpack-config.json'),
    path.join(process.cwd(), 'data', 'reid-backpack-config.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {}
  }
  return null;
}

async function loadConfigHttp(event) {
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) return null;
  try {
    const r = await fetch(base + '/data/reid-backpack-config.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('studio_jobs');
  const jobKey = 'reid/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId,
    agent: 'Reid Callum',
    role: 'The Marketing Expert',
    question,
    status: 'running',
    created_at: new Date().toISOString(),
    owner_id: auth.user.id,
  });

  const cfg = loadConfig() || await loadConfigHttp(event);
  const basePrompt = configToPrompt(cfg);
  if (!basePrompt) {
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: 'backpack_config_not_found',
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: 'backpack_config_not_found' }) };
  }
  const systemPrompt = basePrompt + '\n' + LIVE_TOOLS_NOTE;

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
      messages: [{ role: 'user', content: question + (body.context ? '\n\nOwner context: ' + String(body.context).slice(0, 1500) : '') }],
    });

    const textBlocks = (response.content || []).filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text).join('\n').trim();

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

    const scrubbed = String(text || '').replace(/—/g, '-').replace(/–/g, '-');

    await store.setJSON(jobKey, {
      job_id: jobId,
      agent: 'Reid Callum',
      role: 'The Marketing Expert',
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
    console.error('[studio-reid-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId,
      status: 'error',
      error: err && err.message,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
