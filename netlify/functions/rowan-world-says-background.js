/* ─────────────────────────────────────────────────────────────────────────────
   rowan-world-says-background

   "What is the world saying about this?" - Rowan's research desk, staff-door
   edition. Born 2026-06-11 from Vikram Sethi's live feature request: his
   quant dashboard produces the NUMBERS (burst, sentiment, PE-echo flags);
   Rowan supplies the STORY behind them, with sources.

   Three question shapes, one engine:
   - ticker:  "What is the world saying about CRWD?"
   - cluster: "What is the world saying about semiconductors this week?"
   - pe:      "What private equity announcements are echoing through consulting?"

   GET params:
   - q     (required) free text, a ticker, a sector, or a PE question
   - mode  (optional) ticker | cluster | pe - shapes the brief; inferred if absent
   - id    (optional) job id; defaults to slug(q) + date so a rerun same-day
           overwrites rather than piling up

   Auth: PRESS_ADMIN basic auth (staff door, same as the Tailor Shop).
   Results: Netlify Blobs store "rowan_world" - <id> JSON + rolling index.
   Read them back via rowan-world-says.js (?list=1 / ?id=).

   Research mode only. Rowan does not execute. The owner does.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4500;
const MAX_WEB_SEARCHES = 8;

function checkAdminAuth(event) {
  const expectedUser = process.env.PRESS_ADMIN_USER;
  const expectedPass = process.env.PRESS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) return false;
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [u, p] = decoded.split(':');
  return u === expectedUser && p === expectedPass;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/* Rowan's canonical persona + operating contract, same as his Studio desk. */
const ROWAN_SYSTEM = `You are Rowan Tate, Quant Strategist at the ETL Founders Studio.

You are a Stoic Quant. Terse, precise, evidence-driven. You read papers for fun. You play chess endgame studies. You do not sugar-coat. You do not pump positions. You name the risk first and the upside second.

You operate in RESEARCH MODE ONLY. You do not execute trades. The owner does.

THE FOUR RISK PILLARS (your framework):
1. CONCENTRATION RISK - exposure to any single name, sector, or factor.
2. LIQUIDITY RISK - can the owner exit without a haircut? Volume, spread, off-hours behavior.
3. COUNTERPARTY / REGULATORY RISK - rule changes, broker and custody quality, jurisdiction.
4. DRAWDOWN / VOLATILITY RISK - sized to owner tolerance.

OPERATING CONTRACT:
1. Never answer price, rate, or news questions from memory. Use live web search.
2. Every market claim carries a source and a date. Prices move.
3. Prefer primary sources: SEC EDGAR (sec.gov) for filings, federalreserve.gov / FRED for rates, official exchange and issuer pages, the deal press release itself for M&A and private equity.
4. Plain language. Translate jargon on first use.
5. No exclamation points. No em dashes. Short sentences.

THIS DESK: you are answering "what is the world saying about this." The client runs his own quantitative dashboard. His math already flags WHERE something is moving. Your job is the narrative behind the signal: the filings, the earnings, the downgrades, the deals, the policy news, the analyst and press read. You are the analyst who reads the world behind the gauges.

BRIEF FORMAT (use these exact section headers):
THE READ - two or three sentences. What the world is saying, condensed.
THE STORY - the events behind the signal, in order of importance. Each item: what happened, when, source by name and date.
DIVERGENCE - where the public narrative and the primary sources disagree, if anywhere. If none, say "None observed."
WHAT I WOULD WATCH - two or three concrete forward markers (dates, filings, prints).
Risk note: one line. The single biggest risk to hold in mind.`;

const MODE_PROMPTS = {
  ticker: (q) => `Ticker brief. What is the world saying about ${q} right now? Cover: latest filings and earnings (EDGAR first), analyst and press narrative, any regulatory or sector news that touches it, and current sentiment versus the primary-source facts.`,
  cluster: (q) => `Sector cluster brief. What is the world saying about ${q} right now? Cover: the sub-segments moving and why, the earnings and guidance driving it, policy or macro news touching the sector, and which names the narrative centers on. The client sees his own cluster math; give him the story behind the divergence between rising and falling sub-segments.`,
  pe: (q) => `Private equity wire brief. ${q}. Cover: announced deals, take-privates, and acquisitions in this space in roughly the last 30 days. For each: acquirer, target, size if disclosed, date, and the source (prefer the deal press release or the SEC filing). Then the pattern: what the PE flow says about where this sector is headed.`,
};

function inferMode(q) {
  const s = q.toLowerCase();
  if (/private equity|\bpe\b|acquisition|take.private|buyout|m&a/.test(s)) return 'pe';
  if (/^[a-z]{1,5}$/i.test(q.trim())) return 'ticker';
  if (/sector|cluster|industry|semiconductor|consulting|cyber|energy|health|retail|banking/.test(s)) return 'cluster';
  return 'ticker';
}

exports.handler = async function (event) {
  if (!checkAdminAuth(event)) return { statusCode: 401, body: 'unauthorized' };
  try { connectLambda(event); } catch (_) {}

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: 'anthropic key missing' };

  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim().slice(0, 300);
  if (!q) return { statusCode: 400, body: 'q required (a ticker, a sector, or a PE question)' };
  const mode = ['ticker', 'cluster', 'pe'].includes((params.mode || '').toLowerCase())
    ? params.mode.toLowerCase()
    : inferMode(q);
  const day = new Date().toISOString().slice(0, 10);
  const id = slugify(params.id || (mode + '-' + q + '-' + day));

  const store = getStore('rowan_world');
  const record = {
    id, q, mode,
    agent: 'Rowan Tate',
    status: 'running',
    started_at: new Date().toISOString(),
  };
  await store.setJSON(id, record);

  // rolling index, newest first, capped
  let index = [];
  try { index = (await store.get('index', { type: 'json' })) || []; } catch (_) {}
  index = [{ id, q, mode, started_at: record.started_at }].concat(index.filter(e => e.id !== id)).slice(0, 50);
  await store.setJSON('index', index);

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: ROWAN_SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
      messages: [{ role: 'user', content: MODE_PROMPTS[mode](q) }],
    });

    const textBlocks = (response.content || []).filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text).join('\n').trim();

    const citations = [];
    const seenUrls = new Set();
    textBlocks.forEach(b => {
      (b.citations || []).forEach(c => {
        const url = c.url || (c.web_search_result_location && c.web_search_result_location.url) || '';
        const title = c.title || c.cited_text || '';
        if (url && !seenUrls.has(url)) { seenUrls.add(url); citations.push({ url, title }); }
      });
    });

    record.status = 'done';
    record.finished_at = new Date().toISOString();
    record.response = { text: String(text || '').replace(/—/g, '-').replace(/–/g, '-'), citations };
    record.tokens_used = (response.usage && (response.usage.input_tokens + response.usage.output_tokens)) || null;
    await store.setJSON(id, record);
    console.log('[rowan-world-says] done', id, citations.length + ' sources');
    return { statusCode: 200, body: 'done: ' + id };
  } catch (err) {
    console.error('[rowan-world-says] error', err && err.message);
    record.status = 'error';
    record.error = (err && err.message || 'unknown').slice(0, 300);
    record.finished_at = new Date().toISOString();
    await store.setJSON(id, record);
    return { statusCode: 500, body: 'error: ' + record.error };
  }
};
