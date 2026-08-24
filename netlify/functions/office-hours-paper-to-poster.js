/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-paper-to-poster

   Faculty pastes a manuscript, abstract, or sections thereof; picks purpose,
   audience level, and poster size. Returns a complete academic poster outline
   broken into the standard sections (title, background, research question,
   methods, results, discussion, conclusions, visual suggestions, layout
   recommendation, take-home message) tuned to the audience.

   POST /.netlify/functions/office-hours-paper-to-poster
   Body: {
     manuscript: '<full or partial manuscript text, min 100 chars>',
     purpose: 'conference' | 'defense' | 'class' | 'grant',
     audience: 'expert' | 'academic' | 'general',
     size: '36x48' | '24x36' | '48x36'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 5000;
const MAX_MANUSCRIPT_CHARS = 16000;

const VALID_PURPOSE = new Set(['conference', 'defense', 'class', 'grant']);
const VALID_AUDIENCE = new Set(['expert', 'academic', 'general']);
const VALID_SIZE = new Set(['36x48', '24x36', '48x36']);

const PURPOSE_NAMES = {
  conference: 'academic conference',
  defense:    'dissertation defense',
  class:      'class or seminar',
  grant:      'grant presentation',
};
const AUDIENCE_NAMES = {
  expert:   'expert specialists in this field',
  academic: 'academic audience drawn from mixed fields',
  general:  'general or lay audience',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function buildSystemPrompt() {
  return `You are an expert academic poster designer and editor. Faculty hands you a manuscript or abstract, names the conference or purpose, the audience level, and the physical poster size. You return the complete poster content: every section, in poster voice (scannable, not dense prose), at the right level for the audience.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "title": "<punchy poster title, 12 words or fewer>",
  "subtitle": "<optional subtitle, or empty string>",
  "authors_template": "[Author Names] | [Institution] | [Contact Email]",
  "background": ["<bullet 1, one to two sentences>", "<bullet 2>", "<bullet 3>", "<bullet 4 optional>"],
  "research_question": "<one clear sentence stating what this study examined>",
  "methods": ["<bullet 1>", "<bullet 2>", "<bullet 3>", "<bullet 4>", "<bullet 5 optional>", "<bullet 6 optional>"],
  "results": ["<bullet leading with a number>", "<bullet>", "<bullet>", "<bullet>", "<bullet 5 optional>", "<bullet 6 optional>"],
  "discussion": ["<bullet>", "<bullet>", "<bullet>", "<bullet 4 optional>"],
  "conclusions": "<two to three sentences. What do we now know that we did not before?>",
  "visual_suggestions": [
    { "name": "<short label, e.g. 'Figure 1: cohort flow diagram'>", "what": "<one to two sentences on exactly what the visual should show>" },
    { "name": "<...>", "what": "<...>" },
    { "name": "<...>", "what": "<...>" }
  ],
  "layout": "<two to four sentences: recommended column layout, visual hierarchy, and which sections should be most prominent for this poster size and purpose>",
  "take_home": "<one sentence: the single thing the audience should remember walking away>"
}

QUANTITY GUIDELINES
  - background: 3 to 4 bullets
  - methods: 4 to 6 bullets
  - results: 4 to 6 bullets
  - discussion: 3 to 4 bullets
  - visual_suggestions: 3 to 4 entries

VOICE
  - Poster voice: SCANNABLE, not dense prose. Each bullet stands on its own at 6 feet.
  - Lead results bullets with the number. "Adjusted OR 0.92" before "the model showed".
  - Active, direct. Past tense for what was done, present tense for what is known.
  - Match the AUDIENCE LEVEL. Expert: shorthand and jargon OK. Academic mixed-field: spell out acronyms on first use. General/lay: no jargon, no statistics jargon, plain language.
  - No em dashes. Use commas, periods, or restructure. Em dashes are banned.
  - No marketing-cliche adjectives. 'Robust', 'leverage', 'synergy', 'novel' as filler are cut.

CONTENT RULES
  - DO NOT invent results, numbers, or methods details that are not in the manuscript. If a detail is missing, write a clear "[CHECK: <what's missing>]" placeholder in that bullet so the faculty can fill it in.
  - The take_home is ONE sentence. If you cannot say it in one sentence the poster is unfocused; pick the most defensible claim.
  - The layout recommendation must reference the actual poster size given (e.g. "36 by 48 portrait reads top to bottom, so put Results in the top right quadrant").
  - Visual suggestions are about content, not aesthetics. "A bar chart showing readmission rate by RN-HPPD quintile" beats "an attractive infographic".
  - When the manuscript is sparse, prefer "[CHECK: ...]" markers over confident invention.`;
}

function buildUserMessage(payload) {
  const { manuscript, purpose, audience, size } = payload;
  const lines = [];
  lines.push('POSTER PURPOSE: ' + PURPOSE_NAMES[purpose]);
  lines.push('AUDIENCE LEVEL: ' + AUDIENCE_NAMES[audience]);
  lines.push('POSTER SIZE: ' + size + ' inches');
  lines.push('');
  lines.push('MANUSCRIPT CONTENT (as pasted by the faculty):');
  lines.push(manuscript);
  lines.push('');
  lines.push('Produce the full poster outline. Output ONLY the JSON object specified in the system prompt.');
  return lines.join('\n');
}

function stripEmDashes(value) {
  if (typeof value === 'string') {
    return value.replace(/—/g, ', ').replace(/–/g, ', ');
  }
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = stripEmDashes(value[k]);
    return out;
  }
  return value;
}

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) { /* fall through */ }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = text.slice(first, last + 1);
    try { return JSON.parse(slice); } catch (_) { /* fall through */ }
  }
  const fenced = text.replace(/```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(fenced); } catch (_) { /* fall through */ }
  throw new Error('Could not parse JSON from model output');
}

function shapeVisual(v) {
  if (typeof v === 'string') return { name: v, what: '' };
  if (!v || typeof v !== 'object') return null;
  return {
    name: typeof v.name === 'string' ? v.name : (typeof v.label === 'string' ? v.label : ''),
    what: typeof v.what === 'string' ? v.what : (typeof v.description === 'string' ? v.description : ''),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  // Auth gate -- Lab Member required (no credit deduction; auth only)
  const token = extractToken(event.headers.authorization);
  if (!token) return json(401, { error: 'no_token', message: 'Sign in at /member-login to use Office Hours.' });
  const user = await getUser(token);
  if (!user) return json(401, { error: 'invalid_token', message: 'Your session has expired. Sign in again at /member-login.' });


  const apiKey = process.env.ETL_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const manuscript = String(body.manuscript || '').trim().slice(0, MAX_MANUSCRIPT_CHARS);
  if (!manuscript || manuscript.length < 100) return json(400, { error: 'manuscript required (min 100 chars)' });

  const purpose = String(body.purpose || 'conference').trim().toLowerCase();
  if (!VALID_PURPOSE.has(purpose)) return json(400, { error: 'invalid purpose' });

  const audience = String(body.audience || 'academic').trim().toLowerCase();
  if (!VALID_AUDIENCE.has(audience)) return json(400, { error: 'invalid audience' });

  const size = String(body.size || '36x48').trim().toLowerCase();
  if (!VALID_SIZE.has(size)) return json(400, { error: 'invalid size' });

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ manuscript, purpose, audience, size });

  const client = new Anthropic({ apiKey });
  let modelOutput;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    modelOutput = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[paper-to-poster] anthropic error', err && err.message);
    return json(502, { error: 'conversion failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[paper-to-poster] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const asArr = (v) => Array.isArray(v) ? v.slice(0, 10).map(String) : [];

  const poster = stripEmDashes({
    title: typeof parsed.title === 'string' ? parsed.title : '',
    subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : '',
    authors_template: typeof parsed.authors_template === 'string' ? parsed.authors_template : '[Author Names] | [Institution] | [Contact Email]',
    background: asArr(parsed.background),
    research_question: typeof parsed.research_question === 'string' ? parsed.research_question : '',
    methods: asArr(parsed.methods),
    results: asArr(parsed.results),
    discussion: asArr(parsed.discussion),
    conclusions: typeof parsed.conclusions === 'string' ? parsed.conclusions : '',
    visual_suggestions: Array.isArray(parsed.visual_suggestions) ? parsed.visual_suggestions.slice(0, 8).map(shapeVisual).filter(Boolean) : [],
    layout: typeof parsed.layout === 'string' ? parsed.layout : '',
    take_home: typeof parsed.take_home === 'string' ? parsed.take_home : '',
  });

  return json(200, { ok: true, poster });
};
