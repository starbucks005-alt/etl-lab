/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-journal-finder

   Faculty pastes a manuscript title + abstract, sets study type, target impact
   tier, approximate word count, and field. Returns six ranked journal matches
   with fit score, scope match, impact tier, word limit, turnaround, open-access
   status, per-journal submission notes, caution, plus a submission sequence
   and a first-paragraph cover-letter hook for the top match.

   POST /.netlify/functions/office-hours-journal-finder
   Body: {
     title: '<manuscript title, optional>',
     abstract: '<abstract or summary text, required, min 50 chars>',
     type: 'empirical' | 'review' | 'theoretical' | 'qualitative' | 'mixed' | 'casestudy' | 'brief',
     impact: 'high' | 'mid' | 'accessible' | 'open',
     words: 'under3000' | '3000-5000' | '5000-8000' | 'over8000',
     field: '<discipline, optional>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 5000;
const MAX_TITLE_CHARS = 400;
const MAX_ABSTRACT_CHARS = 8000;
const MAX_FIELD_CHARS = 200;

const VALID_TYPES = new Set(['empirical', 'review', 'theoretical', 'qualitative', 'mixed', 'casestudy', 'brief']);
const VALID_IMPACT = new Set(['high', 'mid', 'accessible', 'open']);
const VALID_WORDS = new Set(['under3000', '3000-5000', '5000-8000', 'over8000']);

const TYPE_NAMES = {
  empirical:   'empirical original research',
  review:      'systematic review or meta-analysis',
  theoretical: 'theoretical or conceptual paper',
  qualitative: 'qualitative study',
  mixed:       'mixed methods study',
  casestudy:   'case study',
  brief:       'brief report',
};
const IMPACT_NAMES = {
  high:       'high-impact Q1 or Q2 journals',
  mid:        'mid-tier Q2 or Q3 journals',
  accessible: 'accessible journals suitable for a first publication',
  open:       'open-access journals',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function buildSystemPrompt() {
  return `You are an expert academic publishing consultant with deep current knowledge of journals across all academic fields. Faculty hand you a manuscript title, abstract, study type, field, target tier, and approximate word count. You recommend the six journals most likely to give this manuscript a fair, fast, on-fit read.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": "<one or two sentences: the headline judgment on where this manuscript should land and any cross-cutting caveat>",
  "journals": [
    {
      "name": "<exact journal name>",
      "fit_score": <integer 1 to 10>,
      "publisher": "<publisher>",
      "scope_match": "<two or three sentences on why this journal fits THIS specific manuscript, naming the methods, population, or framing alignment>",
      "impact": "<approximate current IF and quartile, e.g., 'IF ~4.2, Q1'. Note 'approximate' if uncertain.>",
      "word_limit": "<typical full-article word limit, e.g., '6,000 words including refs'>",
      "turnaround": "<typical first decision timeline, e.g., '6 to 10 weeks'>",
      "open_access": "Yes" | "No" | "Hybrid" | "Optional",
      "submission_notes": "<one or two sentences: what this journal looks for, what to emphasize in the cover letter, any known editorial preference>",
      "caution": "<one sentence: a reason this might not be the best fit or a known rejection pattern. Use 'No known caution' if truly none.>"
    }
  ],
  "submission_strategy": "<two to four sentences: recommended submission sequence (first, second, third) with rationale and rough wait time before moving on>",
  "cover_letter_hook": "<the first paragraph of a cover letter that would work for the top recommended journal, specific to this manuscript, written for the editor of that journal>"
}

QUANTITY
  - EXACTLY 6 journals in the journals array.
  - Order from best fit to acceptable fit. fit_score should reflect that ordering (top entry highest).

CONTENT RULES
  - Recommend real journals you know well. If uncertain on current impact factors, say 'approximate' in the impact field rather than guessing precisely.
  - Prioritize FIT over PRESTIGE. A Q3 journal with perfect scope alignment beats a Q1 with weak fit.
  - Match the manuscript word count to the journal's typical article length. Don't recommend a journal that caps at 3,000 words for a 7,500-word manuscript.
  - When the target tier is 'open', only recommend journals that are fully open access OR have a strong open-access option, and note APC ranges in submission_notes when known.
  - When the target tier is 'accessible' (first publication), favor journals with high acceptance rates, supportive editorial review, or clear scope for early-career authors.
  - The cover_letter_hook is one paragraph, three to five sentences, opening with the title of the manuscript and the manuscript type, then naming the central finding, then the journal-specific fit reasoning. Sign-off and full body NOT included; this is only the opening paragraph.

VOICE
  - Direct, professional, no marketing-cliche adjectives.
  - No em dashes. Use commas, periods, or restructure. Em dashes are banned.
  - 'Robust', 'leverage', 'synergy' are filler; cut them.`;
}

function buildUserMessage(payload) {
  const { title, abstract, type, impact, words, field } = payload;
  const lines = [];
  lines.push('MANUSCRIPT TITLE: ' + (title || '[Not provided]'));
  lines.push('FIELD / DISCIPLINE: ' + (field || '[Infer from abstract]'));
  lines.push('STUDY TYPE: ' + TYPE_NAMES[type]);
  lines.push('APPROXIMATE WORD COUNT: ' + words.replace('under', 'under ').replace('over', 'over ').replace('-', ' to ') + ' words');
  lines.push('TARGET TIER: ' + IMPACT_NAMES[impact]);
  lines.push('');
  lines.push('ABSTRACT / SUMMARY:');
  lines.push(abstract);
  lines.push('');
  lines.push('Recommend six journals and produce the submission strategy and cover-letter hook. Output ONLY the JSON object specified in the system prompt.');
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
  if (!j || typeof j !== 'object') return null;
  const fitNum = parseInt(j.fit_score, 10);
  return {
    name: typeof j.name === 'string' ? j.name : '',
    fit_score: Number.isFinite(fitNum) ? Math.max(1, Math.min(10, fitNum)) : 5,
    publisher: typeof j.publisher === 'string' ? j.publisher : '',
    scope_match: typeof j.scope_match === 'string' ? j.scope_match : '',
    impact: typeof j.impact === 'string' ? j.impact : (typeof j.impact_factor === 'string' ? j.impact_factor : ''),
    word_limit: typeof j.word_limit === 'string' ? j.word_limit : '',
    turnaround: typeof j.turnaround === 'string' ? j.turnaround : '',
    open_access: typeof j.open_access === 'string' ? j.open_access : '',
    submission_notes: typeof j.submission_notes === 'string' ? j.submission_notes : '',
    caution: typeof j.caution === 'string' ? j.caution : '',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const title = String(body.title || '').trim().slice(0, MAX_TITLE_CHARS);
  const abstract = String(body.abstract || '').trim().slice(0, MAX_ABSTRACT_CHARS);
  if (!abstract || abstract.length < 50) return json(400, { error: 'abstract required (min 50 chars)' });

  const type = String(body.type || 'empirical').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) return json(400, { error: 'invalid study type' });

  const impact = String(body.impact || 'mid').trim().toLowerCase();
  if (!VALID_IMPACT.has(impact)) return json(400, { error: 'invalid target tier' });

  const words = String(body.words || '5000-8000').trim().toLowerCase();
  if (!VALID_WORDS.has(words)) return json(400, { error: 'invalid word count' });

  const field = String(body.field || '').trim().slice(0, MAX_FIELD_CHARS);

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ title, abstract, type, impact, words, field });

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
    console.error('[journal-finder] anthropic error', err && err.message);
    return json(502, { error: 'finder failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[journal-finder] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const result = stripEmDashes({
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    journals: Array.isArray(parsed.journals) ? parsed.journals.slice(0, 6).map(shapeJournal).filter(Boolean) : [],
    submission_strategy: typeof parsed.submission_strategy === 'string' ? parsed.submission_strategy : '',
    cover_letter_hook: typeof parsed.cover_letter_hook === 'string' ? parsed.cover_letter_hook : '',
  });

  return json(200, { ok: true, result });
};
