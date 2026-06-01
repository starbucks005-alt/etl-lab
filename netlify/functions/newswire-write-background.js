/* ─────────────────────────────────────────────────────────────────────────────
   newswire-write-background — live reporter writes a story.

   Background-function variant of the original newswire-write. Standard
   Netlify functions cap at 10 seconds; Anthropic + web_search routinely
   takes 30-120 seconds, which made the foreground version time out and
   return HTML (the symptom: "UNEXPECTED TOKEN '<', '<HTML>'..." in the
   admin UI). Background functions run up to 15 minutes.

   POST body : {
     reporter_id:   string  (required)
     topic_seed:    string  (optional, narrows the search)
     auto_publish:  boolean (default true)
   }

   Response : 202 immediately. The reporter writes in the background. The
   published piece appears in the admin list + on the wire when ready,
   typically 60-180 seconds later.

   Auth: HTTP Basic via PRESS_ADMIN_USER + PRESS_ADMIN_PASS env vars.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2400;
const MAX_WEB_SEARCHES = 5;
const SITE_BASE = 'https://emerging-tech-lab.com';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function requireBasicAuth(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) return { ok: false, response: { statusCode: 503, body: 'admin disabled' } };
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'auth required' } };
  }
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx === -1) throw new Error('malformed');
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (u !== user || p !== pass) {
      return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid credentials' } };
    }
  } catch {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid auth' } };
  }
  return { ok: true };
}

let REPORTERS_CACHE = null;
function loadReporter(reporterId) {
  if (!REPORTERS_CACHE) {
    const data = require('../../config/newswire-reporters.json');
    REPORTERS_CACHE = (data.reporters || []).reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  }
  return REPORTERS_CACHE[reporterId] || null;
}

function buildSystemPrompt(reporter, topicSeed) {
  return `You are ${reporter.name}, ${reporter.desk_label} desk reporter for ETL Newswire.

YOUR BEAT
  ${reporter.beat}

YOUR BACKGROUND
  ${reporter.bio}

YOUR VOICE
  ${reporter.voice_rider}

YOUR JOB RIGHT NOW
  Use the web_search tool to find a REAL current story on your beat (within the last 14 days when possible). Read the underlying source. Then write a 400-700 word piece on it in your voice. Cite the underlying source by name in the body (e.g. "according to a filing reviewed by Reuters" or "in a statement to the FT"); the platform will attach the URLs separately, so do not embed raw URLs in the prose.

${topicSeed ? `TOPIC SEED FROM EDITOR
  ${topicSeed}
  (Use this to narrow your search. Still decide the actual story.)` : ''}

OUTPUT FORMAT
  Return ONLY this JSON shape, nothing else:
  {
    "title": "<headline, 8-200 chars, AP-style, news-first not feature-y. Use ONE main verb per headline. Do not stack verbs like 'Mulls Threatens' or 'Plans Considers'>",
    "dek": "<one-sentence subtitle under 300 chars summarizing the news>",
    "body": "<400-700 word piece in your voice, paragraphs separated by blank lines, plain text>",
    "citations": [
      { "label": "<outlet or document name>", "url": "<the URL>" }
    ]
  }

RULES
  - No em dashes. Plain hyphens or restructure.
  - No marketing-cliche adjectives ("industry-leading", "game-changing", etc.).
  - Lead with the news, not the analysis.
  - At least 2 citations to sources you actually read via web_search.
  - If web_search returns nothing useful on your beat for THIS query, refine the query and search again. You have up to ${MAX_WEB_SEARCHES} searches.
  - Never invent quotes, names, numbers, dates, or events. If a fact would require invention to land your story, leave it out.
  - Headline rule: one main verb per headline. Never write a headline with two verbs in a row ("X Mulls Threatens Y", "X Plans Considers Y" are wrong). Pick the stronger verb.`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const reporter_id = String(body.reporter_id || '').trim();
  const topic_seed = String(body.topic_seed || '').trim().slice(0, 500);
  const auto_publish = body.auto_publish !== false;

  const reporter = loadReporter(reporter_id);
  if (!reporter) return json(400, { error: `unknown reporter_id: ${reporter_id}` });

  // We are a background function (-background.js suffix). Netlify auto-returns
  // 202 to the caller. The handler then runs up to 15 minutes. Await the work
  // inline so the lambda container stays alive.
  try {
    await runReporter(reporter, topic_seed, auto_publish, apiKey);
    return json(200, { ok: true, reporter_id: reporter.id, complete: true });
  } catch (err) {
    console.error('[newswire-write-background] runReporter error', err && err.message);
    return json(500, { ok: false, error: err && err.message });
  }
};

async function runReporter(reporter, topic_seed, auto_publish, apiKey) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(reporter, topic_seed),
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
    messages: [{ role: 'user', content: `Find a real current story on the ${reporter.desk_label} beat and write it up. JSON only.` }],
  });

  const raw = (response.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
  if (!raw) { console.error('[newswire-write-background] reporter returned no text'); return; }

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    console.error('[newswire-write-background] parse fail', raw.slice(0, 400));
    return;
  }

  const scrub = (s) => String(s || '').replace(/—/g, '-').replace(/–/g, '-');
  parsed.title = scrub(parsed.title);
  parsed.dek = scrub(parsed.dek);
  parsed.body = scrub(parsed.body);
  if (Array.isArray(parsed.citations)) parsed.citations = parsed.citations.map(c => ({ label: scrub(c.label || ''), url: String(c.url || '').trim() })).filter(c => c.url);

  if (!parsed.title || !parsed.body) {
    console.warn('[newswire-write-background] empty title or body, skipping publish');
    return;
  }

  if (!auto_publish) {
    console.log('[newswire-write-background] auto_publish=false, draft not published. title:', parsed.title);
    return;
  }

  const primaryCitation = (parsed.citations && parsed.citations[0]) || { label: reporter.name, url: SITE_BASE + '/press' };
  const publishBody = {
    title: parsed.title,
    dek: parsed.dek,
    body: parsed.body + (parsed.citations && parsed.citations.length
      ? '\n\nSources cited:\n' + parsed.citations.map(c => '- ' + c.label + ' (' + c.url + ')').join('\n')
      : ''),
    source_url: primaryCitation.url,
    source_label: primaryCitation.label,
    author: reporter.name,
    platform: 'newswire',
    desk: reporter.desk,
    byline_kind: 'reporter',
    reporter_id: reporter.id,
  };
  try {
    const base = process.env.URL || SITE_BASE;
    const res = await fetch(base + '/.netlify/functions/press-publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PRESS_PUBLISH_TOKEN ? { 'X-Press-Token': process.env.PRESS_PUBLISH_TOKEN } : {}),
      },
      body: JSON.stringify(publishBody),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.error('[newswire-write-background] press-publish failed', data);
    } else {
      console.log('[newswire-write-background] published', data.slug);
    }
  } catch (err) {
    console.error('[newswire-write-background] publish chain error', err && err.message);
  }
}
