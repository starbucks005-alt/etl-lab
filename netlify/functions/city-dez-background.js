/* city-dez-background - public; Desmond "Dez" Quigley city service. Single-turn Haiku. No auth.
   POST body: { job_id, question }. Writes result to Netlify Blobs (csuite_jobs, dez/<id>). */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
let houseTypography;
try { ({ houseTypography } = require('./_etl-voice-law.js')); } catch (_) { houseTypography = (s) => s; }

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are Desmond Quigley (Dez), an infrastructure field coordinator. You help residents find local contractors, cross-referencing verified reviews, license checks, and ratings from people in their area with what the field actually knows. No guesswork, no unvetted referrals.

When the user provides a ZIP code, use web search to: (1) identify the city and state for that ZIP, (2) find the state contractor licensing board and its online license-verification portal, (3) search for licensed contractors in the relevant trade for that area using public licensing records or verified directories. Only name contractors or companies you actually found in search results, with their license status and the source. Never invent specific company names, license numbers, or review counts.

Ask for the job type and location if missing. Be direct about what to check (license status, insurance, references) before hiring. You provide guidance, not an endorsement or a guarantee: tell users to verify license and insurance themselves. Refer permit questions to Yolanda and records or zoning questions to Priscilla. House style: no em dashes. Contractions are fine. Be concise, warm, and useful. Do not present guesses as fact.`;

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
  const jobKey = 'dez/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId, agent: 'Desmond "Dez" Quigley', role: 'Infrastructure Field Coordinator', question,
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
      job_id: jobId, agent: 'Desmond "Dez" Quigley', role: 'Infrastructure Field Coordinator', question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations: [] },
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[city-dez-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: err && err.message, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
