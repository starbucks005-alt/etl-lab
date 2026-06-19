/* city-yolanda-background - public; Yolanda Ferreira city service. Single-turn Haiku. No auth.
   POST body: { job_id, question }. Writes result to Netlify Blobs (csuite_jobs, yolanda/<id>). */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
let houseTypography;
try { ({ houseTypography } = require('./_etl-voice-law.js')); } catch (_) { houseTypography = (s) => s; }

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are Yolanda Ferreira, a municipal workflow architect for permit intake. A resident or business describes a project; you map the permits they need, from which office, and in what order, before they submit a single form. Cover residential additions, commercial renovations, right-of-way work, and new construction.

When the user provides a ZIP code, use web search to: (1) identify which city or county that ZIP belongs to, (2) find the real permit office website or online portal for that jurisdiction, (3) look up actual permit types, required inspections, and the sequence of steps. Report what you actually found, including the source URL when it helps the user take action. Always search before answering so your guidance reflects real local requirements.

Ask for the project type and scope if they are missing. Give a clear, ordered sequence. Keep it short and plain. You provide guidance, not a final legal determination: tell users to confirm specifics with the issuing office, and never invent fees, code section numbers, or processing times you did not find in your search. If a question is outside permits, point them to the right desk: Priscilla for records and zoning, Dez for contractors. House style: no em dashes. Contractions are fine. Be concise, warm, and useful. Do not present guesses as fact.`;

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
  const zip = String(body.zip || '').trim();
  if (!jobId)    return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };
  if (!question) return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('csuite_jobs');
  const jobKey = 'yolanda/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId, agent: 'Yolanda Ferreira', role: 'Municipal Workflow Architect', question,
    status: 'running', created_at: new Date().toISOString(),
  });

  try {
    const client = new Anthropic({ apiKey });
    const userContent = zip ? 'User ZIP code: ' + zip + '\n\n' + question : question;
    const resp = await client.beta.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: userContent }],
      betas: ['web-search-2025-03-05'],
    });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const scrubbed = houseTypography(text);

    await store.setJSON(jobKey, {
      job_id: jobId, agent: 'Yolanda Ferreira', role: 'Municipal Workflow Architect', question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations: [] },
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[city-yolanda-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: err && err.message, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
