/* ─────────────────────────────────────────────────────────────────────────────
   specialist-delia-background

   Delia Marsh's Development & Sponsorships backpack. She runs the sponsorship
   pipeline for nonprofits + small businesses; the owner keeps the relationship
   and makes the close.

   Persona + domain knowledge (InfraGard / INMA / DSAC / Fortune-500 sponsorship)
   come from CCW's config: data/delia-backpack-config.json
   (consultant_entry.system_prompt). Loaded the same way the C-Suite backpacks
   load csuite-backpacks.json.

   Tools: CCW's spec lists seven. LIVE TODAY: web_search (server), plus two
   custom client tools in the agentic loop:
   - propublica_nonprofits  (IRS 990 data, free, no key) - peer-association benchmarks
   - usaspending_awards     (federal awards, free, no key) - prospect capacity signal
   Pending: SEC EDGAR, SAM.gov (needs key), web_fetch, data_analysis. The prompt
   is honest about which are connected so Delia never claims an unwired tool.

   POST body: { job_id, question, context? }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_WEB_SEARCHES = 7;
const MAX_TURNS = 7;
const UA = 'ETL-Studio-Delia/1.0 (sponsorship research)';

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const LIVE_TOOLS_NOTE = [
  '',
  'Backpack status (read carefully): LIVE and connected right now are web search, propublica_nonprofits (IRS 990 data: search a nonprofit or foundation by name to get its EIN, then call again with the ein for its revenue, expenses, and assets by year), and usaspending_awards (federal contract awards a company has won, a capacity-and-motive signal). SEC EDGAR, SAM.gov, web page fetch, and data analysis are being connected and are NOT available yet. Never claim to have used a tool that returned nothing. If a question needs a tool that is not connected, say which one would answer it best and use your live tools to get as close as you honestly can.',
  '',
  'Output format:',
  '- Lead with the recommendation: who to approach, why now, how much to ask for, and the opening line.',
  '- Then the supporting facts, every prospect claim with a source and a date.',
  '- Size the ask in a defensible range from real capacity signals (federal awards, 990 revenue, segment), not guesses.',
  '- Plain English, no fundraising jargon without translation.',
  '- Avoid em dashes. Use commas, periods, and semicolons.',
  '- End with one line: "Next move:" followed by the single action the owner takes.',
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

function loadConfig() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'delia-backpack-config.json'),
    path.join(process.cwd(), 'data', 'delia-backpack-config.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return null;
}
async function loadConfigHttp(event) {
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) return null;
  try {
    const r = await fetch(base + '/data/delia-backpack-config.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (_) {}
  return null;
}
function configToPrompt(cfg) {
  const entry = (cfg && cfg.consultant_entry) || {};
  return entry.system_prompt || null;
}

// ─── ProPublica Nonprofit Explorer (free, no auth) ───────────────────────────
const PROPUBLICA_TOOL = {
  name: 'propublica_nonprofits',
  description: 'Research U.S. nonprofits, foundations, and peer associations from IRS Form 990 data. Search by name to find orgs and their EINs; call again with an ein to pull that org\'s revenue, expenses, and assets by year. Use to benchmark what peer associations raise and who funds them.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Organization name to search for.' },
      ein: { type: 'string', description: 'Optional: a 9-digit EIN to pull that org\'s 990 financials directly.' },
    },
    required: [],
  },
};
async function propublicaNonprofits(query, ein) {
  try {
    if (ein) {
      const e = String(ein).replace(/[^0-9]/g, '').slice(0, 9);
      if (!e) return { error: 'bad_ein' };
      const r = await fetch('https://projects.propublica.org/nonprofits/api/v2/organizations/' + e + '.json', { headers: { 'User-Agent': UA } });
      if (!r.ok) return { error: 'propublica_http_' + r.status };
      const d = await r.json();
      const org = d.organization || {};
      const filings = (d.filings_with_data || []).slice(0, 3).map(f => ({
        year: f.tax_prd_yr, revenue: f.totrevenue, expenses: f.totfuncexpns, assets_end: f.totassetsend, pdf: f.pdf_url,
      }));
      return { ein: e, name: org.name, city: org.city, state: org.state, ntee_code: org.ntee_code, filings };
    }
    const q = String(query || '').trim().slice(0, 200);
    if (!q) return { error: 'provide query or ein' };
    const r = await fetch('https://projects.propublica.org/nonprofits/api/v2/search.json?q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
    if (!r.ok) return { error: 'propublica_http_' + r.status };
    const d = await r.json();
    const orgs = (d.organizations || []).slice(0, 10).map(o => ({ ein: o.ein, name: o.name, city: o.city, state: o.state, ntee_code: o.ntee_code }));
    return { total: d.total_results, query: q, organizations: orgs, note: 'Call again with an ein to pull that org\'s 990 financials.' };
  } catch (e) {
    return { error: 'propublica_failed: ' + (e && e.message) };
  }
}

// ─── USAspending.gov federal awards (free, no auth) ──────────────────────────
const USASPENDING_TOOL = {
  name: 'usaspending_awards',
  description: 'Look up how much federal contract money a company or organization has won (USAspending.gov), by award and agency. A capacity-and-motive signal for sponsorship prospecting: large federal contractors have budget and a stake in critical-infrastructure security. Returns the top awards by amount over the chosen window.',
  input_schema: {
    type: 'object',
    properties: {
      recipient: { type: 'string', description: 'Company or organization name (the federal award recipient).' },
      years_back: { type: 'integer', description: 'How many years back to look, 1 to 10. Defaults to 5.' },
    },
    required: ['recipient'],
  },
};
async function usaspendingAwards(recipient, yearsBack) {
  const name = String(recipient || '').trim().slice(0, 200);
  if (!name) return { error: 'empty_recipient' };
  const yb = Math.min(Math.max(parseInt(yearsBack, 10) || 5, 1), 10);
  const end = new Date();
  const start = new Date(end.getTime());
  start.setFullYear(start.getFullYear() - yb);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const bodyObj = {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      recipient_search_text: [name],
      time_period: [{ start_date: fmt(start), end_date: fmt(end) }],
    },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Action Date'],
    page: 1, limit: 10, sort: 'Award Amount', order: 'desc', subawards: false,
  };
  try {
    const r = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(bodyObj),
    });
    if (!r.ok) return { error: 'usaspending_http_' + r.status };
    const d = await r.json();
    const awards = (d.results || []).map(a => ({
      id: a['Award ID'], recipient: a['Recipient Name'], amount: a['Award Amount'], agency: a['Awarding Agency'], date: a['Action Date'],
    }));
    const total = awards.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return { recipient: name, years_back: yb, count: awards.length, total_top_awards: total, awards };
  } catch (e) {
    return { error: 'usaspending_failed: ' + (e && e.message) };
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
  const question = String(body.question || '').trim();
  if (!jobId)    return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };
  if (!question) return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('csuite_jobs');
  const jobKey = 'delia/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId,
    agent: 'Delia Marsh',
    role: 'Development & Sponsorships',
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
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES },
    PROPUBLICA_TOOL,
    USASPENDING_TOOL,
  ];
  const messages = [{ role: 'user', content: question + (body.context ? '\n\nOwner context: ' + String(body.context).slice(0, 2000) : '') }];

  const citations = [];
  const seenUrls = new Set();
  function collectCitations(content) {
    (content || []).filter(b => b.type === 'text').forEach(b => {
      (b.citations || []).forEach(c => {
        const url = c.url || (c.web_search_result_location && c.web_search_result_location.url) || '';
        const title = c.title || c.cited_text || '';
        if (url && !seenUrls.has(url)) { seenUrls.add(url); citations.push({ url, title }); }
      });
    });
  }

  try {
    let finalText = '';
    let totalTokens = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, tools, messages,
      });
      totalTokens += (response.usage && (response.usage.output_tokens + response.usage.input_tokens)) || 0;
      collectCitations(response.content);

      const turnText = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (turnText) finalText = turnText;

      const customToolUses = (response.content || []).filter(b => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || customToolUses.length === 0) break;

      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const tu of customToolUses) {
        let result;
        if (tu.name === 'propublica_nonprofits') {
          const inp = tu.input || {};
          result = await propublicaNonprofits(inp.query, inp.ein);
        } else if (tu.name === 'usaspending_awards') {
          const inp = tu.input || {};
          result = await usaspendingAwards(inp.recipient, inp.years_back);
        } else {
          result = { error: 'tool_not_connected', tool: tu.name };
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 12000) });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const scrubbed = String(finalText || '').replace(/—/g, '-').replace(/–/g, '-');

    await store.setJSON(jobKey, {
      job_id: jobId,
      agent: 'Delia Marsh',
      role: 'Development & Sponsorships',
      question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations },
      tokens_used: totalTokens || null,
      owner_id: auth.user.id,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, job_id: jobId, citations_count: citations.length }),
    };
  } catch (err) {
    console.error('[specialist-delia-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId,
      status: 'error',
      error: err && err.message,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
