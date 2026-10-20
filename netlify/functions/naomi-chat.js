/* naomi-chat: talk to Naomi Baptiste, the standardized patient expert, and ask her advice. Added 2026-10-20, Dr. O
   ("I want to talk to Naomi (audio and text) on the site. Ask advice.").
   POST { messages: [{ role: 'user'|'assistant', content }] }  ->  { ok, answer, source }
   Runs on the Azure OpenAI deployment first (_azure.js chat), so it uses the Azure credits. Until those settings exist in
   Netlify it answers on Claude with ETL_API_KEY, the key the Prep Room uses, so she is not silent in the meantime.
   Her persona is her entry in data/studio-staff-registry.json, the same one sp-case.js uses. Her voice is naomi-voice.js. */

const azure = require('./_azure.js');
const { VOICE_LAW_CHAT, houseTypography } = require('./_etl-voice-law.js');
const { loadPersona } = require('./sp-case.js');

const CLAUDE_MODEL = 'claude-sonnet-5';
const MAX_TURNS = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function reply(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

const CHAT_MODE = [
  'RIGHT NOW: somebody is talking with you on the ETL site, by text or out loud, to ask your advice about standardized patient cases,',
  'simulation teaching, scoring, or the robot patients. This is a conversation, not a written review. Answer the question they asked,',
  'in a few short sentences a person would say out loud, then stop. Use the review format only when they hand you a case to review.',
].join(' ');

function systemPrompt(persona) {
  return [persona, CHAT_MODE, VOICE_LAW_CHAT].join('\n\n');
}

/* keep only well formed turns, newest last, ending on the user */
function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  const out = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }))
    .slice(-MAX_TURNS);
  while (out.length && out[0].role !== 'user') out.shift();
  return out.length && out[out.length - 1].role === 'user' ? out : [];
}

async function claudeChat(system, messages, deps) {
  const apiKey = (deps.env || process.env).ETL_API_KEY;
  if (!apiKey) return null;
  const Anthropic = deps.Anthropic || require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey });
  const r = await client.messages.create({ model: CLAUDE_MODEL, max_tokens: 700, system, messages });
  const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return text || null;
}

async function handler(event, deps) {
  const d = deps || {};
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { ok: false, error: 'bad_json' }); }
  const messages = cleanMessages(body.messages);
  if (!messages.length) return reply(400, { ok: false, error: 'Say something to Naomi first.' });

  const persona = loadPersona();
  if (!persona) return reply(500, { ok: false, error: 'Naomi Baptiste is missing from the staff registry' });
  const system = systemPrompt(persona);

  let answer = null;
  let source = 'azure';
  try {
    answer = await (d.azureChat || azure.chat)([{ role: 'system', content: system }].concat(messages), { maxTokens: 700, temperature: 0.6 });
  } catch (_) { answer = null; }
  if (!answer) {
    source = 'claude';
    try { answer = await claudeChat(system, messages, d); } catch (e) { console.error('[naomi-chat] claude failed:', e && e.message); answer = null; }
  }
  if (!answer) return reply(503, { ok: false, error: 'Naomi is not set up to talk yet. The Azure model settings, or ETL_API_KEY, are needed in Netlify.' });
  return reply(200, { ok: true, answer: houseTypography(answer), source });
}

exports.handler = (event) => handler(event);
module.exports.run = handler;
module.exports.cleanMessages = cleanMessages;
module.exports.systemPrompt = systemPrompt;
