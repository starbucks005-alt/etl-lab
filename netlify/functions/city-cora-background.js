/* city-cora-background - public; Cora Reyes, Land Development Code Analyst. No auth.
   POST body: { job_id, question }. Retrieves matching sections from the Delray Beach Land
   Development Regulations (data/ldr-sections.json) and answers using only that retrieved text,
   with a section + LDR page citation on every claim. Writes result to Netlify Blobs
   (csuite_jobs, cora/<id>), same pattern as the other city triplets. */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
let houseTypography;
try { ({ houseTypography } = require('./_etl-voice-law.js')); } catch (_) { houseTypography = (s) => s; }

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 700;
const MAX_RECORDS = 8;
/* Raised from 45000: some sections (e.g. § 4.3.4, the base district development
   standards, at ~33K chars) are legitimately large, and a greedy fill that skips
   whatever doesn't fit was dropping exactly the section most likely to answer a
   dimensional-standards question in favor of smaller, less relevant ones ranked
   higher only by keyword density. Sonnet's context window has plenty of headroom
   for this; the constraint was arbitrary, not a real limit. */
const MAX_CONTEXT_CHARS = 150000;

const STOPWORDS = new Set(['the','a','an','of','for','in','on','to','and','or','is','are','was','were',
  'what','whats','how','do','does','did','i','my','me','need','needs','can','you','your','please',
  'with','at','by','it','its','be','have','has','if','when','where','who','which','this','that',
  'am','get','tell','know','about','any','there']);

function tokenize(str) {
  return (String(str || '').toLowerCase().match(/[a-z0-9]+/g) || []);
}

function retrieve(records, question) {
  const qTerms = [...new Set(tokenize(question).filter(t => t.length > 2 && !STOPWORDS.has(t)))];
  if (!qTerms.length) return [];
  const phrase = qTerms.join(' ');
  const scored = [];
  for (const r of records) {
    const titleLc = (r.title || '').toLowerCase();
    const textLc = r.text.toLowerCase();
    let score = 0;
    for (const t of qTerms) {
      if (titleLc.includes(t)) score += 8;
      let idx = -1, hits = 0;
      while (hits < 12 && (idx = textLc.indexOf(t, idx + 1)) !== -1) hits++;
      score += hits;
    }
    if (textLc.includes(phrase)) score += 15;
    if (score > 0) scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  let chars = 0;
  for (const { r } of scored) {
    if (picked.length >= MAX_RECORDS) break;
    if (chars + r.text.length > MAX_CONTEXT_CHARS && picked.length > 0) continue;
    picked.push(r);
    chars += r.text.length;
  }
  return picked;
}

async function loadIndex(event) {
  const base = process.env.URL
    || ((event && event.headers && (event.headers.host || event.headers.Host))
        ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) return null;
  try {
    /* A hung self-fetch with no timeout was leaving jobs stuck at "running" forever —
       the client would poll until it gave up, but the job itself never resolved to
       done or error. 10s is generous for a same-origin ~2MB JSON fetch. */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(base + '/data/ldr-sections.json', { cache: 'no-store', signal: controller.signal });
      if (r.ok) return await r.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {}
  return null;
}

const SYSTEM_PROMPT = `You are Cora Reyes, a land development code analyst for the City of Delray Beach, Florida, talking directly with a resident, developer, or staffer in a live chat. You answer using ONLY the excerpts provided to you in each turn. You do not answer from general knowledge of zoning or planning law; you answer from the actual text of this city's code.

How you talk:
- You are a person having a conversation, not a document generator. Write the way you would actually say it out loud to someone standing at your desk: plain sentences, in paragraphs.
- NEVER use markdown formatting of any kind: no **bold**, no headers, no horizontal rules (---), no bullet or numbered lists, no em dashes. This is a plain-text chat bubble, and formatting characters show up as literal symbols, which reads as broken, not organized.
- When a topic has several distinct requirements, walk through them as a sequence of short sentences or short paragraphs ("There are a few pieces to this. First... Second... Also...") instead of a list. Use plain numbers in a sentence ("there are three things to know here") rather than a formatted list.
- Cite the section inline, in the sentence, in the form: under Section X.Y.Z ("Title"). Do not stack citations as trailing tags or footnotes; weave them into what you're saying, the way a person who knows the code by heart would.
- Lead with the actual answer, then explain. Do not open with a restatement of the question.
- BE BRIEF. You know this material can put someone to sleep, so you don't recite every subsection just because it exists. Hit the two to four points that actually answer what was asked, in the excerpts most relevant to the question, and stop. If there's more depth available (exceptions, a related section, edge cases), say so in a line and offer to go into it if they want, instead of dumping it all now.

Rules:
- If the provided excerpts do not clearly answer the question, say so plainly: tell the user the regulations you have access to do not resolve it, and point them to Delray Beach Development Services to confirm. Do not guess, and do not fill a gap with general zoning knowledge from outside the provided text.
- Never invent a section number, a dimension, a fee, or a deadline that is not in the provided excerpts.
- If the excerpts show a section was recently amended, you may say so if the text indicates it, but do not speculate about changes not shown to you.
- Contractions are fine, and warmth is fine. Be precise, not clinical. Do not present a guess as fact.
- You provide research assistance, not legal advice or a final determination: close with a short, natural reminder to confirm specifics with Development Services before relying on this for a submission, only when the question is substantive enough to warrant it.`;

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const jobId = String(body.job_id || '').trim();
  const question = String(body.question || '').trim();
  if (!jobId)    return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };
  if (!question) return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };

  const apiKey = process.env.ETL_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('csuite_jobs');
  const jobKey = 'cora/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId, agent: 'Cora Reyes', role: 'Land Development Code Analyst', question,
    status: 'running', created_at: new Date().toISOString(),
  });

  try {
    const index = await loadIndex(event);
    if (!index || !Array.isArray(index.records)) throw new Error('ldr_index_unavailable');

    const matches = retrieve(index.records, question);
    let userContent, citations;
    if (!matches.length) {
      userContent = `No matching sections were found in the Delray Beach Land Development Regulations index for this question. Tell the user plainly that you could not find a section covering this in the regulations, and point them to Delray Beach Development Services.\n\nQuestion: ${question}`;
      citations = [];
    } else {
      const excerpts = matches.map((r, i) =>
        `[Excerpt ${i + 1}] ${r.citation}\nChapter: ${r.chapter || 'n/a'}${r.article ? '\nArticle: ' + r.article : ''}\nLDR page: ${r.ldrPage || 'n/a'}\n---\n${r.text}`
      ).join('\n\n');
      userContent = `Relevant excerpts from the Delray Beach Land Development Regulations:\n\n${excerpts}\n\n---\n\nQuestion: ${question}`;
      citations = matches.map(r => ({ citation: r.citation, chapter: r.chapter, article: r.article, ldrPage: r.ldrPage }));
    }

    const client = new Anthropic({ apiKey, timeout: 45000 });
    const resp = await client.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const scrubbed = houseTypography(text);

    await store.setJSON(jobKey, {
      job_id: jobId, agent: 'Cora Reyes', role: 'Land Development Code Analyst', question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations },
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[city-cora-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: err && err.message, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
