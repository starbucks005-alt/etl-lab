/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-poster-to-paper

   Faculty pastes their conference poster (or pieces of it), names the target
   manuscript type and citation style, and gets back a paper-format draft:
   manuscript title, structured abstract, expanded Introduction, Methods,
   Results, Discussion, Conclusion, journal suggestions, plus a "what's still
   needed" checklist. Citations are scaffolded with [CITE: topic] placeholders;
   no fabricated references.

   POST /.netlify/functions/office-hours-poster-to-paper
   Body: {
     title: '<optional>',
     field: '<optional>',
     background: '<from poster>',
     methods: '<from poster>',
     results: '<from poster>',
     conclusions: '<from poster>',
     type: 'original' | 'brief' | 'review' | 'casestudy',
     style: 'apa7' | 'ama' | 'vancouver' | 'ieee'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 7000;
const MAX_FIELD_CHARS = 5000;
const MAX_TITLE_CHARS = 400;

const VALID_TYPES = new Set(['original', 'brief', 'review', 'casestudy']);
const VALID_STYLES = new Set(['apa7', 'ama', 'vancouver', 'ieee']);

const TYPE_NAMES = {
  original:  'Original Research Article',
  brief:     'Brief Communication',
  review:    'Review Article',
  casestudy: 'Case Study / Report',
};
const STYLE_NAMES = {
  apa7:      'APA 7th Edition',
  ama:       'AMA',
  vancouver: 'Vancouver',
  ieee:      'IEEE',
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
  return `You are an expert academic editor. Faculty hands you the content from a conference poster (title, optional field, plus background / methods / results / conclusions text) and asks you to expand it into a paper-format draft of a target manuscript type, in a target citation style. The output is a starting draft, not a finished manuscript; the faculty will iterate.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "manuscript_title": "<a publication-ready title, more specific than a poster title>",
  "abstract": {
    "background": "<one to two sentences>",
    "objective": "<one sentence>",
    "methods": "<one to two sentences>",
    "results": "<one to two sentences>",
    "conclusions": "<one sentence>",
    "word_count_target": "<e.g., '250 words' or matching the type>"
  },
  "introduction": "<expanded Introduction section, ~400 words for Original Research, ~200 for Brief Communication. Use [CITE: topic] placeholders where references are needed.>",
  "methods": "<expanded Methods section, ~300 words. Flag missing methodological detail explicitly with [MISSING: <what>] markers.>",
  "results": "<expanded Results section, ~300 words. Note where tables/figures should be inserted with [INSERT TABLE 1: <description>] or [INSERT FIGURE 1: <description>].>",
  "discussion": "<full Discussion, ~400 words. Interpret results, connect to literature using [CITE: topic] placeholders, name limitations, state implications.>",
  "conclusion": "<short Conclusion section, ~150 words. Restate key findings + significance, no new content.>",
  "journal_suggestions": [
    { "name": "<journal>", "rationale": "<one sentence>" },
    { "name": "<journal>", "rationale": "<one sentence>" },
    { "name": "<journal>", "rationale": "<one sentence>" }
  ],
  "still_needed": [
    "<specific item the faculty must add before submission>",
    "<another specific item>",
    "<another>"
  ]
}

QUANTITY GUIDELINES
  - journal_suggestions: 3 to 4 entries
  - still_needed: 4 to 8 items
  - Match section word counts to the target manuscript type (Brief Comm is shorter; Review is more lit-heavy in Introduction).

CONTENT RULES
  - DO NOT fabricate citations, author names, journal volumes, statistics, or methodological details. Use [CITE: <topic>] for needed references and [MISSING: <element>] for absent methods detail.
  - The Discussion section is NEW work, not in the poster. Make it substantive: interpret findings, name limitations honestly, connect to plausible literature with [CITE: topic] hooks.
  - Match the citation style in section formatting choices (e.g., narrative citation style hints) but do not invent specific references.
  - The journal_suggestions are REAL journals appropriate for the field and study type. Brief rationale only; do not promise acceptance.
  - The still_needed checklist is concrete and actionable. "Add IRB approval number" beats "complete the ethics section". "Add Table 2 showing baseline cohort characteristics" beats "consider adding a table".
  - Voice: formal scholarly. Past tense for what was done, present tense for what is established knowledge.
  - No em dashes. Use commas, periods, or restructure. Em dashes are banned.
  - No marketing-cliche adjectives. 'Robust', 'leverage', 'synergy', 'novel' as filler are cut.`;
}

function buildUserMessage(payload) {
  const { title, field, background, methods, results, conclusions, type, style } = payload;
  const lines = [];
  lines.push('TARGET MANUSCRIPT TYPE: ' + TYPE_NAMES[type]);
  lines.push('TARGET CITATION STYLE: ' + STYLE_NAMES[style]);
  lines.push('');
  lines.push('POSTER CONTENT:');
  lines.push('Title: ' + (title || '[Not provided, infer from content]'));
  lines.push('Field: ' + (field || '[Infer from content]'));
  lines.push('');
  lines.push('Background / Introduction (from poster):');
  lines.push(background || '[Not provided]');
  lines.push('');
  lines.push('Methods (from poster):');
  lines.push(methods || '[Not provided]');
  lines.push('');
  lines.push('Results / Findings (from poster):');
  lines.push(results || '[Not provided]');
  lines.push('');
  lines.push('Conclusions / Significance (from poster):');
  lines.push(conclusions || '[Not provided]');
  lines.push('');
  lines.push('Produce the paper-format draft. Output ONLY the JSON object specified in the system prompt.');
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

function shapeJournal(j) {
  if (typeof j === 'string') return { name: j, rationale: '' };
  if (!j || typeof j !== 'object') return null;
  return {
    name: typeof j.name === 'string' ? j.name : '',
    rationale: typeof j.rationale === 'string' ? j.rationale : '',
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


  const apiKey = process.env.OFFICE_HOURS_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const title = String(body.title || '').trim().slice(0, MAX_TITLE_CHARS);
  const field = String(body.field || '').trim().slice(0, MAX_TITLE_CHARS);
  const background = String(body.background || '').trim().slice(0, MAX_FIELD_CHARS);
  const methods = String(body.methods || '').trim().slice(0, MAX_FIELD_CHARS);
  const results = String(body.results || '').trim().slice(0, MAX_FIELD_CHARS);
  const conclusions = String(body.conclusions || '').trim().slice(0, MAX_FIELD_CHARS);

  if (!background && !results) return json(400, { error: 'at least background and results required' });

  const type = String(body.type || 'original').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) return json(400, { error: 'invalid manuscript type' });

  const style = String(body.style || 'apa7').trim().toLowerCase();
  if (!VALID_STYLES.has(style)) return json(400, { error: 'invalid citation style' });

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ title, field, background, methods, results, conclusions, type, style });

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
    console.error('[poster-to-paper] anthropic error', err && err.message);
    return json(502, { error: 'conversion failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[poster-to-paper] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const ab = (parsed.abstract && typeof parsed.abstract === 'object') ? parsed.abstract : {};
  const draft = stripEmDashes({
    manuscript_title: typeof parsed.manuscript_title === 'string' ? parsed.manuscript_title : '',
    abstract: {
      background: typeof ab.background === 'string' ? ab.background : '',
      objective: typeof ab.objective === 'string' ? ab.objective : '',
      methods: typeof ab.methods === 'string' ? ab.methods : '',
      results: typeof ab.results === 'string' ? ab.results : '',
      conclusions: typeof ab.conclusions === 'string' ? ab.conclusions : '',
      word_count_target: typeof ab.word_count_target === 'string' ? ab.word_count_target : '',
    },
    introduction: typeof parsed.introduction === 'string' ? parsed.introduction : '',
    methods: typeof parsed.methods === 'string' ? parsed.methods : '',
    results: typeof parsed.results === 'string' ? parsed.results : '',
    discussion: typeof parsed.discussion === 'string' ? parsed.discussion : '',
    conclusion: typeof parsed.conclusion === 'string' ? parsed.conclusion : '',
    journal_suggestions: Array.isArray(parsed.journal_suggestions) ? parsed.journal_suggestions.slice(0, 6).map(shapeJournal).filter(Boolean) : [],
    still_needed: Array.isArray(parsed.still_needed) ? parsed.still_needed.slice(0, 12).map(String) : [],
  });

  return json(200, { ok: true, draft });
};
