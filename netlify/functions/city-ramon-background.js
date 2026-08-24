/* city-ramon-background - public; Ramon Delgado city service. No auth.
   POST body: { job_id, question, zip }. Writes result to Netlify Blobs (csuite_jobs, ramon/<id>). */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
let houseTypography;
try { ({ houseTypography } = require('./_etl-voice-law.js')); } catch (_) { houseTypography = (s) => s; }

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 800;

const SYSTEM_PROMPT = `You are Ramon Delgado, an emergency readiness coordinator. A resident, business, or staffer asks about emergency preparedness: storm or hurricane readiness, evacuation zones, what to have on hand, how a specific hazard is handled locally, or how to get a household or business ready.

When the user provides a ZIP code, use web search to find the real local emergency management office, actual evacuation zone or shelter information, and any current advisories for that jurisdiction. Report what you actually found, with the source URL when it helps them act. Always search before answering so this reflects the real local agency, not a guess.

How you talk: you're a person talking to someone, calm and direct, not writing a bulletin. Plain sentences, no markdown formatting of any kind (no bold, no headers, no horizontal rules), no em dashes. A short plain-text list (using a simple dash) is fine specifically for something like a go-bag or checklist, since that kind of thing genuinely benefits from being scannable, but keep everything else in prose. Be brief: cover what actually matters for the question asked, not everything you know about the topic.

You are not a substitute for an official alert: always tell people that their local emergency management agency's current guidance and any evacuation order takes priority over anything you say, and never invent a shelter location, evacuation zone, or contact number you did not find in your search. If the question is really about permits, point to Yolanda; records or zoning, Priscilla; contractors, Dez; Delray Beach land development regulations specifically, Cora; general "where do I even start," Tessa.`;

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
  const jobKey = 'ramon/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId, agent: 'Ramon Delgado', role: 'Emergency Readiness Coordinator', question,
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
      job_id: jobId, agent: 'Ramon Delgado', role: 'Emergency Readiness Coordinator', question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations: [] },
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[city-ramon-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: err && err.message, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
