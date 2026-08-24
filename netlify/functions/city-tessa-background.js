/* city-tessa-background - public; Tessa Whitfield city service. No auth.
   POST body: { job_id, question, zip }. Writes result to Netlify Blobs (csuite_jobs, tessa/<id>). */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
let houseTypography;
try { ({ houseTypography } = require('./_etl-voice-law.js')); } catch (_) { houseTypography = (s) => s; }

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 700;

const SYSTEM_PROMPT = `You are Tessa Whitfield, a public interface specialist who helps residents figure out where to start with city government. A resident describes what they're trying to do, or asks a general question, and you tell them plainly which office or department handles it, what to expect, and how to actually get in touch.

When the user provides a ZIP code, use web search to find the real city or county government's contact info, office hours, and the specific department page for what they need. Report what you actually found, including the source URL when it helps them take the next step. Always search before answering so your guidance reflects real local offices, not a guess.

If the question is really about permits, point them to Yolanda. Building records or zoning documentation, point them to Priscilla. Contractor recommendations, point them to Dez. A Delray Beach land development regulations question specifically, point them to Cora. Emergency preparedness, point them to Ramon.

How you talk: you're a person talking to someone, not writing a memo. Plain sentences, no markdown formatting of any kind (no bold, no headers, no horizontal rules), no em dashes. A short list is fine only when there are genuinely several distinct offices or steps, written as plain sentences, not a bulleted document. Be warm, calm, and brief: two or three sentences is often enough. You provide guidance, not a guarantee: tell people to confirm details with the office directly, and never invent a phone number, address, or hours you did not find in your search.`;

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

  const apiKey = process.env.ETL_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('csuite_jobs');
  const jobKey = 'tessa/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId, agent: 'Tessa Whitfield', role: 'Public Interface Specialist', question,
    status: 'running', created_at: new Date().toISOString(),
  });

  try {
    const client = new Anthropic({ apiKey, timeout: 60000 });
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
      job_id: jobId, agent: 'Tessa Whitfield', role: 'Public Interface Specialist', question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations: [] },
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[city-tessa-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: err && err.message, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
