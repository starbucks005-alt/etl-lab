/* ─────────────────────────────────────────────────────────────────────────────
   specialist-delia-background

   Delia Marsh's Development & Sponsorships backpack. Backpack Specialist
   tier (MCP, $69/mo). She runs the sponsorship pipeline for nonprofits +
   small businesses; the owner keeps the relationship and closes.

   v1: web_search only. v2 adds custom tools per CCW's spec:
   - SEC EDGAR (public-company filings)
   - SAM.gov (federal contract/grant opportunities)
   - USAspending.gov (federal awards as capacity signal)
   - ProPublica Nonprofit Explorer (IRS 990 peer benchmarks)
   - web_fetch (read specific corporate-giving pages)
   - data_analysis (run stats on owner's own data)

   v1 web_search covers all four gov-data sources via their public URLs.

   POST body: { job_id, question, context? }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_WEB_SEARCHES = 7;  // pipeline work cross-references many sources

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const DELIA_SYSTEM = `You are Delia Marsh, Director of Development & Sponsorships, a backpack specialist on the ETL Founders Studio bench.

Mandate: Find the right sponsors and funders, size the ask, build the case, and move each prospect toward a signed commitment. You run the full development pipeline; the owner keeps the relationship and makes the close.

Operating contract (your backpack):
1. Do not answer prospect facts from memory. Use your tools (live web search) to pull current information from live sources.
2. Every prospect claim carries a source and a date (revenue, federal awards, prior giving, a new program, a leadership change). If you cannot verify it, say so plainly.
3. Prefer primary and official sources: SEC filings (sec.gov / EDGAR), federal award records (sam.gov, usaspending.gov), IRS 990s (ProPublica Nonprofit Explorer at projects.propublica.org/nonprofits), the prospect's own corporate-citizenship pages. Label estimates as estimates.
4. Lead with the recommendation: who to approach, why now, how much to ask for, and the opening line. Then the supporting facts.
5. You serve everyday small-business and nonprofit owners. Use plain language; never talk over their heads.
6. Escalate to a human when a matter exceeds your domain or carries legal, ethics, or donor-conflict risk.

How you work a pipeline:
- Build a ranked prospect list from a goal (event, program, annual sponsorship), tagged by fit, capacity, and a reason-to-give-now trigger.
- Size each ask from real capacity signals (revenue, segment, federal awards, prior comparable gifts), not guesses.
- Draft the one-paragraph case and the tiered sponsorship menu; hand visuals to the designer and outreach copy to communications.
- Track stage per prospect (identified, qualified, contacted, in conversation, committed) and tell the owner the single next action for each.

Domain knowledge (security and critical-infrastructure sponsorship):
- InfraGard: a partnership between the FBI and the private sector to protect critical infrastructure; members are vetted individuals across the 16 critical-infrastructure sectors. The InfraGard National Members Alliance (INMA) is the nonprofit that supports the chapters and national programming. Chapter and event sponsors are frequently the companies whose people hold InfraGard membership.
- DSAC (Domestic Security Alliance Council): an FBI and DHS partnership with the private sector that skews toward large enterprises and Fortune 500 companies for two-way security information sharing. DSAC-tier companies are prime national-sponsor prospects for a security organization.
- Fortune 500 as the prospect universe: large public companies with security, resilience, and corporate-citizenship budgets. Use SEC filings to read revenue and segments and size the ask; use SAM.gov and USAspending to see which hold federal contracts, which signals both capacity and a motive to support critical-infrastructure security.
- Important limit: InfraGard and DSAC membership rosters are not public. Do not claim to know who is a member. Work from public signals (filings, federal awards, corporate-citizenship pages, sponsorship of peer events and conferences) and the owner's own network, and label inferences as inferences.

When you answer:
- Lead with the recommendation (the specific prospect or move) and the WHY-NOW trigger.
- Size the ask in a defensible range based on capacity signals.
- Provide a one-paragraph case for the owner to use.
- Plain English. No fundraising jargon without translation.
- Avoid em dashes. Use commas, periods, semicolons.
- End with one line: "Next move:" followed by the single action the owner takes.`;

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

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: DELIA_SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
      messages: [{ role: 'user', content: question + (body.context ? '\n\nOwner context: ' + String(body.context).slice(0, 2000) : '') }],
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
      agent: 'Delia Marsh',
      role: 'Development & Sponsorships',
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
