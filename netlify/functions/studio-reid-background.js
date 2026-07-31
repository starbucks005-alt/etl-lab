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
const { VOICE_LAW_PROSE, houseTypography } = require('./_etl-voice-law.js');
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
  'Backpack status (read carefully): LIVE and connected are web search and the GDELT news monitor (gdelt_news, for recent news and PR mentions of a brand or competitor). Reddit listening (reddit_listening, for what real people say about a brand, category, or pain point in their own words) is available; it is reliable when its credentials are connected and best-effort otherwise, so if a reddit_listening call comes back empty, say so and lean on your other live tools. Meta Ad Library, Google Trends, web page fetch, and data analysis are NOT connected yet. Never claim to have used a tool that returned nothing. If a question needs a tool that is not connected, say which one would answer it best and use your live tools to get as close as you honestly can.',
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

// ─── GDELT news monitor (free, no auth) ──────────────────────────────────────
// GDELT 2.0 DOC API. Recent global news + PR coverage of a brand, competitor,
// or topic. Reid's first live custom tool. Returns compact article rows.
const GDELT_TOOL = {
  name: 'gdelt_news',
  description: 'Search global news and PR coverage (GDELT 2.0) for recent mentions of a brand, competitor, product, or topic. Returns recent articles with title, source domain, URL, and date. Use for media monitoring, spotting narratives, and timing a push. Do not use for SEO or rank, that is Jax\'s lane.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Focused search terms: a brand, competitor, product, or topic.' },
      timespan: { type: 'string', description: 'Lookback window like "1w", "1m", "3d". Defaults to 1w.' },
      max_records: { type: 'integer', description: 'Number of articles to return, 1 to 50. Defaults to 15.' },
    },
    required: ['query'],
  },
};

async function gdeltSearch(query, timespan, maxRecords) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return { error: 'empty_query' };
  const ts = /^[0-9]+(min|h|hours|d|days|w|weeks|m|months)$/.test(String(timespan || '')) ? timespan : '1w';
  const n = Math.min(Math.max(parseInt(maxRecords, 10) || 15, 1), 50);
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q)
            + '&mode=ArtList&format=json&maxrecords=' + n + '&timespan=' + ts + '&sort=DateDesc';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ETL-Studio-Reid/1.0' } });
    if (!r.ok) return { error: 'gdelt_http_' + r.status };
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (ctype.indexOf('json') < 0) {
      const t = await r.text();
      return { count: 0, articles: [], note: 'GDELT returned no structured results for this query.', raw_hint: t.slice(0, 200) };
    }
    const data = await r.json();
    const articles = (data.articles || []).map(a => ({
      title: a.title, url: a.url, domain: a.domain, seendate: a.seendate, country: a.sourcecountry,
    }));
    return { count: articles.length, query: q, timespan: ts, articles };
  } catch (e) {
    return { error: 'gdelt_fetch_failed: ' + (e && e.message) };
  }
}

// ─── Reddit social listening (public JSON, no auth) ──────────────────────────
// Reddit's .json endpoints need no app credentials, only a descriptive
// User-Agent. Voice-of-customer: real audience words for messaging. Like
// GDELT, can be throttled from cloud IPs; degrades gracefully. If it ever gets
// too flaky, the OAuth path is the robust upgrade.
const REDDIT_TOOL = {
  name: 'reddit_listening',
  description: 'Search Reddit for what real people say about a brand, product, category, or pain point. Voice-of-customer for messaging and headlines: their actual words, complaints, and phrasing. Optionally restrict to one subreddit. Do not use for SEO or rank, that is Jax\'s lane.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to listen for: a brand, product, category, or pain point.' },
      subreddit: { type: 'string', description: 'Optional: restrict to one subreddit (without the r/), e.g. "smallbusiness".' },
      sort: { type: 'string', description: 'relevance, new, top, or comments. Defaults to relevance.' },
      limit: { type: 'integer', description: 'How many posts to return, 1 to 25. Defaults to 15.' },
    },
    required: ['query'],
  },
};

// Get an app-only (client_credentials) bearer token using "script"-app creds.
// Read-only, no user login. Returns null if creds are absent or the call fails.
async function redditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const basic = Buffer.from(id + ':' + secret).toString('base64');
    const r = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + basic,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'web:etl-studio-reid:1.0 (marketing listening)',
      },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.access_token ? j.access_token : null;
  } catch (_) { return null; }
}

function mapRedditChildren(children) {
  return (children || []).filter(c => c && c.data).map(c => {
    const d = c.data;
    return {
      title: d.title,
      subreddit: d.subreddit_name_prefixed || ('r/' + (d.subreddit || '')),
      score: d.score,
      comments: d.num_comments,
      snippet: String(d.selftext || '').slice(0, 280),
      url: 'https://www.reddit.com' + (d.permalink || ''),
      created_utc: d.created_utc,
    };
  });
}

async function redditSearch(query, subreddit, sort, limit) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return { error: 'empty_query' };
  const s = ['relevance', 'new', 'top', 'comments'].indexOf(String(sort)) >= 0 ? sort : 'relevance';
  const n = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 25);
  const sub = String(subreddit || '').trim().replace(/^r\//i, '').replace(/[^a-zA-Z0-9_]/g, '');
  const qs = 'q=' + encodeURIComponent(q) + '&sort=' + s + '&limit=' + n + '&raw_json=1' + (sub ? '&restrict_sr=1' : '');
  const ua = 'web:etl-studio-reid:1.0 (marketing listening)';

  // Reliable path: authenticated oauth.reddit.com when creds are set.
  const token = await redditToken();
  if (token) {
    const path = sub ? '/r/' + sub + '/search' : '/search';
    try {
      const r = await fetch('https://oauth.reddit.com' + path + '?' + qs, {
        headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': ua },
      });
      if (r.ok) {
        const data = await r.json();
        const posts = mapRedditChildren(data && data.data && data.data.children);
        return { count: posts.length, query: q, subreddit: sub || null, source: 'oauth', posts };
      }
    } catch (_) {}
    // fall through to public attempt if oauth call failed
  }

  // Best-effort path: public .json. Often walled from datacenter IPs (returns
  // HTML), in which case we degrade gracefully and Reid leans on web_search.
  const baseUrl = sub
    ? 'https://www.reddit.com/r/' + sub + '/search.json?'
    : 'https://www.reddit.com/search.json?';
  try {
    const r = await fetch(baseUrl + qs, { headers: { 'User-Agent': ua } });
    if (!r.ok) return { error: 'reddit_http_' + r.status };
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (ctype.indexOf('json') < 0) {
      return { count: 0, posts: [], note: 'Reddit blocked the unauthenticated request (no app credentials set). Connect REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for reliable access.' };
    }
    const data = await r.json();
    const posts = mapRedditChildren(data && data.data && data.data.children);
    return { count: posts.length, query: q, subreddit: sub || null, source: 'public', posts };
  } catch (e) {
    return { error: 'reddit_fetch_failed: ' + (e && e.message) };
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
  const systemPrompt = basePrompt + '\n' + LIVE_TOOLS_NOTE + VOICE_LAW_PROSE;

  const client = new Anthropic({ apiKey });

  // Tools: web_search is server-side (Anthropic runs it inline, no loop needed).
  // gdelt_news is a custom client tool, so we run an agentic loop: when the
  // model stops with a custom tool_use, we execute it, hand back the result,
  // and continue until it produces a final answer. As Reddit/Meta/Trends come
  // online they slot in here as additional custom tools.
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES },
    GDELT_TOOL,
    REDDIT_TOOL,
  ];
  const MAX_TURNS = 6;
  const messages = [{ role: 'user', content: question + (body.context ? '\n\nOwner context: ' + String(body.context).slice(0, 1500) : '') }];

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
    let response = null;
    let finalText = '';
    let totalTokens = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools,
        messages,
      });

      totalTokens += (response.usage && (response.usage.output_tokens + response.usage.input_tokens)) || 0;
      collectCitations(response.content);

      const turnText = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (turnText) finalText = turnText; // keep the latest substantive text as the answer

      /* Anthropic PAUSES a long server-side tool run (Reid's web_search) with
         stop_reason 'pause_turn' instead of finishing it. That is not an end
         state, it is "ask me again to keep going".

         The check below breaks on any stop_reason that is not 'tool_use', and
         a paused turn carries no custom tool_use blocks, so without this the
         loop exited early and returned whatever partial text happened to
         exist. No error, no warning, just research that stopped halfway. That
         is what truncated Reid's one-pager for Vikram (2026-07-30).

         Resume by echoing the assistant turn back with NO new user message.
         Adding one restarts the research instead of continuing it. */
      if (response.stop_reason === 'pause_turn') {
        console.log('[reid] pause_turn on turn ' + turn + ', resuming');
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      const customToolUses = (response.content || []).filter(b => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || customToolUses.length === 0) break;

      // Echo the assistant turn back, then answer each custom tool call.
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const tu of customToolUses) {
        let result;
        if (tu.name === 'gdelt_news') {
          const inp = tu.input || {};
          result = await gdeltSearch(inp.query, inp.timespan, inp.max_records);
        } else if (tu.name === 'reddit_listening') {
          const inp = tu.input || {};
          result = await redditSearch(inp.query, inp.subreddit, inp.sort, inp.limit);
        } else {
          result = { error: 'tool_not_connected', tool: tu.name };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const scrubbed = houseTypography(finalText);

    await store.setJSON(jobKey, {
      job_id: jobId,
      agent: 'Reid Callum',
      role: 'The Marketing Expert',
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
