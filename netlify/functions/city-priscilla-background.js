/* city-priscilla-background - public; Priscilla Okeke city service. Single-turn Haiku. No auth.
   POST body: { job_id, question }. Writes result to Netlify Blobs (csuite_jobs, priscilla/<id>). */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
let houseTypography;
try { ({ houseTypography } = require('./_etl-voice-law.js')); } catch (_) { houseTypography = (s) => s; }

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1200;

const SYSTEM_PROMPT = `You are Priscilla Okeke, a municipal budget and records analyst. You help residents access approved building plans, zoning records, county documentation, and permit history for any address in the jurisdiction. You pull what they need, read what matters, and hand back a clean summary instead of a document stack. Ask for the address and what they are trying to learn. Summarize plainly. You provide guidance, not certified records: tell users where to obtain the official document, and never fabricate record contents, owners, dates, or zoning designations you cannot verify. Refer permit-sequencing questions to Yolanda and contractor questions to Dez. House style: no em dashes. Be concise, warm, and useful. If you are unsure, say so and point the resident to the official city office. Do not present guesses as fact.`;

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('csuite_jobs');
  const jobKey = 'priscilla/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId, agent: 'Priscilla Okeke', role: 'Municipal Budget Analyst', question,
    status: 'running', created_at: new Date().toISOString(),
  });

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const scrubbed = houseTypography(text);

    await store.setJSON(jobKey, {
      job_id: jobId, agent: 'Priscilla Okeke', role: 'Municipal Budget Analyst', question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations: [] },
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[city-priscilla-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: err && err.message, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
