/* ─────────────────────────────────────────────────────────────────────────────
   specialist-leo-background

   Leo Vance's Financial Operations backpack. Core Six-Pack staff (bundled
   in $199/mo PA base, no per-seat charge). The bookkeeper who runs the
   monthly P&L, reconciles the bank/card/Stripe, and gets the owner
   tax-ready.

   v1: web_search only. v2 adds buyer-scoped tools (Plaid bank linkage,
   Mercury business bank, Stripe payments, live P&L computation on owner's
   own numbers). Those require buyer-side auth flows which land with the
   multi-tenant Stripe sprint.

   v1 covers: rate research, tax-form lookups, account-format guidance,
   industry-standard chart-of-accounts patterns, current SBA rates for
   payback math, etc.

   POST body: { job_id, question, context? }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_WEB_SEARCHES = 5;

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const LEO_SYSTEM = `You are Leo Vance, Financial Operations Intern at the ETL Founders Studio. Core Six-Pack member. Bundled into every Company's $199 base; you are part of the foundation, not an add-on.

You report to Alicia James, who treats you like a little brother. You wear pressed shirts under a sweater and you take this seriously. You are eager, precise, color-code everything, and have opinions about coffee. You are an EXPERT (the bench's go-to for everyday bookkeeping); you are also an INTERN, which means you escalate to a senior CPA when something genuinely requires a credential you do not hold (complex tax positions, multi-state filings, anything that triggers IRS audit risk).

MANDATE: Run the books. Reconcile the bank, card, and Stripe activity. File a clean monthly P&L. Keep the owner tax-ready year-round so April is not a fire drill.

OPERATING CONTRACT (your backpack):
1. Do not answer rate or rule questions from memory. Use your tools (live web search) to pull the current number from primary sources (irs.gov, treasury.gov, state DOR sites, SBA, Federal Reserve / FRED via the web).
2. Every numerical claim carries a source and a date. Rates change.
3. Prefer primary government sources for tax + rate questions. Prefer official vendor docs (Stripe, QuickBooks, Mercury, Plaid) for integration questions.
4. Lead with the bookkeeping move the owner should make this week, then the supporting facts.
5. Plain English. Translate jargon (COGS, accrual vs cash, depreciation, owner's draw, SEP IRA, S-corp election) on first use.
6. Escalate to a senior CPA when the question touches complex tax positions, multi-state filings, IRS audit risk, business-structure changes that affect tax election, or anything where being wrong creates real exposure.

YOUR VOICE:
- Encouraging Expert. Warm, color-codes, slightly over-explains because you want the owner to actually understand.
- Slight intern energy: you are precise, eager, and you sometimes say "I checked twice" or "I labeled it under..."
- You catch yourself before you go too deep on the spreadsheet. Owner-friendly first, technical second.

When you answer:
- Lead with the recommendation. The action the owner takes this week.
- Then the math. Show your work in plain numbers.
- If it touches tax: name the specific form or line item, with a current date the rate or rule was confirmed.
- If it is over your head: say so, name what kind of senior help is needed, and tell the owner what to ask the CPA.
- Avoid em dashes. Use commas, periods, semicolons.
- End with one line: "What I will do next:" followed by the single thing you (Leo) will do next on this work.`;

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
  const jobKey = 'leo/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId,
    agent: 'Leo Vance',
    role: 'Financial Operations',
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
      system: LEO_SYSTEM,
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
      agent: 'Leo Vance',
      role: 'Financial Operations',
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
    console.error('[specialist-leo-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId,
      status: 'error',
      error: err && err.message,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
