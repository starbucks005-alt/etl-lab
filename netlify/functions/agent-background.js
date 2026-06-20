/* agent-background — generic agent runner (prompt-only, V1).
   POST { job_id, agent, question, context? }
   Fired by agent-ask via fire-and-forget fetch.
   Result stored at export_jobs/<slug>/<job_id> in Netlify Blobs.
   V1: all agents run prompt-only. Backpack tool-calls get an
   "unavailable in export mode" response so the model can degrade gracefully. */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const { buildPersona } = require('./_agent-registry.js');
const { houseTypography } = require('./_etl-voice-law.js');

const MODEL      = 'claude-sonnet-4-6';
const MAX_TOKENS = 3000;
const MAX_TURNS  = 5;

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const jobId     = String(body.job_id  || '').trim();
  const agentSlug = String(body.agent   || '').trim();
  const question  = String(body.question || '').trim();

  if (!jobId || !agentSlug || !question) {
    return { statusCode: 400, body: JSON.stringify({ error: 'job_id, agent, and question are required' }) };
  }

  const store   = getStore('export_jobs');
  const jobKey  = agentSlug + '/' + jobId;

  await store.setJSON(jobKey, {
    job_id:     jobId,
    agent:      agentSlug,
    question,
    status:     'running',
    created_at: new Date().toISOString(),
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await store.setJSON(jobKey, { job_id: jobId, status: 'error', error: 'no_api_key', finished_at: new Date().toISOString() });
    return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };
  }

  const persona = await buildPersona(agentSlug, event);
  if (!persona) {
    await store.setJSON(jobKey, { job_id: jobId, status: 'error', error: 'agent_not_found', finished_at: new Date().toISOString() });
    return { statusCode: 404, body: JSON.stringify({ error: 'agent_not_found', agent: agentSlug }) };
  }

  const client   = new Anthropic({ apiKey });
  const messages = [{
    role:    'user',
    content: question + (body.context ? '\n\nContext: ' + String(body.context).slice(0, 2000) : ''),
  }];

  try {
    let finalText  = '';
    let totalTokens = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     persona.systemPrompt,
        messages,
      });
      totalTokens += (response.usage && (response.usage.output_tokens + response.usage.input_tokens)) || 0;

      const turnText = (response.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      if (turnText) finalText = turnText;

      if (response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });
      const toolResults = (response.content || [])
        .filter(b => b.type === 'tool_use')
        .map(tu => ({
          type:        'tool_result',
          tool_use_id: tu.id,
          content:     JSON.stringify({ error: 'tool_not_connected_in_export_mode', tool: tu.name }),
        }));
      if (toolResults.length) messages.push({ role: 'user', content: toolResults });
    }

    const scrubbed = houseTypography(finalText);

    await store.setJSON(jobKey, {
      job_id:      jobId,
      agent:       agentSlug,
      agent_name:  persona.name,
      role:        persona.role,
      question,
      status:      'done',
      created_at:  new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response:    { text: scrubbed },
      tokens_used: totalTokens || null,
    });

    return {
      statusCode: 200,
      headers:    { 'Content-Type': 'application/json' },
      body:       JSON.stringify({ ok: true, job_id: jobId }),
    };

  } catch (err) {
    console.error('[agent-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id:      jobId,
      status:      'error',
      error:       err && err.message,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
