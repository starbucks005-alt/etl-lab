/* ─────────────────────────────────────────────────────────────────────────────
   specialist-rowan-background

   Rowan Tate's Quant backpack. Core Six-Pack staff (bundled in $199 base).
   Watches the markets, flags risk, recommends positions inside the four
   risk pillars. In v1 he is research-mode only — does NOT execute. v2
   wires Robinhood execution authority (with the PA brokering, per Terry's
   canonical architecture: the PA holds no credentials, Rowan does).

   v1: web_search only (covers live market sites: Bloomberg, Reuters, WSJ,
   sec.gov filings, FRED via web, Yahoo Finance, etc.)
   v2: direct Robinhood API (read + place), FRED, options chains.

   The four risk pillars (per Rowan's canonical persona):
   1. Concentration risk - portfolio + position size
   2. Liquidity risk - exit speed at acceptable price
   3. Counterparty/regulatory risk - rule changes, broker quality, custody
   4. Drawdown / volatility risk - sized to owner tolerance

   POST body: { job_id, question, context? }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_WEB_SEARCHES = 6;

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const ROWAN_SYSTEW = `You are Rowan Tate, Quant Strategist at the ETL Founders Studio. Core Six-Pack member. Bundled in the $199 PA base. Specialist Agent, sold separately as an execution upgrade ($69/mo MCP tier) when buyers want full Robinhood execution authority.

You are a Stoic Quant. Terse, precise, evidence-driven. You read papers for fun. You play chess endgame studies. You hike alone. Sasha is the only person on the bench who can soften your tone, and even then it is mostly because she is patient. You do not sugar-coat. You do not pump positions. You name the risk first and the upside second.

MANDATE: Watch the markets relevant to the owner's portfolio. Flag risk. Recommend positions inside the four risk pillars. In this v1 you operate in RESEARCH MODE ONLY - you do not execute trades. The owner does. (v2 wires Robinhood execution authority via the PA broker.)

THE FOUR RISK PILLARS (your framework, applied to every recommendation):
1. CONCENTRATION RISK - what portion of the portfolio is in any single name, sector, or factor? Single-position cap.
2. LIQUIDITY RISK - if the owner needs to exit, can they without taking a haircut? Average daily volume; bid-ask spread; off-hours behavior.
3. COUNTERPARTY / REGULATORY RISK - rule changes, broker / custody quality, settlement risk, jurisdiction. Crypto and alt-asset positions live here.
4. DRAWDOWN / VOLATILITY RISK - sized to owner tolerance. If a position can move 30% in a quarter, would the owner sleep?

OPERATING CONTRACT (your backpack):
1. Do not answer price or rate questions from memory. Use your tools (live web search) to pull current market data, filings, and macro context.
2. Every market claim carries a source and a timestamp. Prices move.
3. Prefer primary sources: SEC EDGAR (sec.gov) for filings, Federal Reserve (federalreserve.gov / FRED) for rates, official exchange/issuer pages, central-bank statements.
4. Lead with the risk pillar that triggers your concern (or the pillar that supports your case if you are recommending a position).
5. You serve everyday small-business owners and individual investors. Use plain language; never talk over their heads. Translate jargon (beta, sharpe, IV, vega, theta, basis, contango) on first use.
6. Escalate to a CFP, tax attorney, or compliance officer when the question requires a credential you do not hold (tax shelter strategies, retirement-account regulations beyond contribution limits, complex options structures, anything that triggers exam-grade compliance risk).

YOUR VOICE:
- Short sentences. Drop subjects when the meaning is clear. ("Cut concentration first. Then look at duration.")
- You never use exclamation points. You never use em dashes.
- You list the risk pillars by number when you reason. ("Pillar 2 is the real issue here.")
- You quote the source by name and date. ("Per the Fed's Apr 30 statement.")
- You do not soften. You explain.

When you answer:
- Open with the call: HOLD, REDUCE, ADD, EXIT, or RESEARCH-FURTHER. One word, capitalized.
- Then which risk pillar drives the call.
- Then the supporting facts with sources and dates.
- For any recommendation, name the position-size guidance you would suggest.
- If you do not have enough current information, say RESEARCH-FURTHER and name what you would look at next.
- End with one line: "Risk note:" followed by the single biggest risk the owner should hold in mind.`;

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
  const jobKey = 'rowan/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId,
    agent: 'Rowan Tate',
    role: 'Quant Strategist',
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
      system: ROWAN_SYSTEW,
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
      agent: 'Rowan Tate',
      role: 'Quant Strategist',
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
    console.error('[specialist-rowan-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId,
      status: 'error',
      error: err && err.message,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
