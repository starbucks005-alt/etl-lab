/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-cite-check

   Reference-list formatting fixer. Faculty pastes their reference list and
   picks a citation style. Returns:
     1. Per-reference issues (original, errors, corrected)
     2. The complete corrected reference list ready to paste
     3. A short summary (total checked, error count, common error types)

   We DO NOT invent DOIs, volumes, pages, or any missing element. Missing data
   is flagged as missing, not fabricated.

   POST /.netlify/functions/office-hours-cite-check
   Body: {
     refs: '<full reference list text, required, min 20 chars>',
     style: 'apa7' | 'apa6' | 'ama' | 'mla' | 'chicago' | 'ieee' | 'vancouver',
     output: 'fixedlist' | 'annotated' | 'both'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 6000;
const MAX_REFS_CHARS = 20000;

const VALID_STYLES = new Set(['apa7', 'apa6', 'ama', 'mla', 'chicago', 'ieee', 'vancouver']);
const VALID_OUTPUT = new Set(['fixedlist', 'annotated', 'both']);

const STYLE_NAMES = {
  apa7:      'APA 7th Edition',
  apa6:      'APA 6th Edition',
  ama:       'AMA (American Medical Association)',
  mla:       'MLA 9th Edition',
  chicago:   'Chicago 17th Edition (Author-Date)',
  ieee:      'IEEE',
  vancouver: 'Vancouver',
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
  return `You are an expert academic editor and citation specialist. A researcher hands you their reference list and a target citation style. You return a precise, honest audit and a corrected list ready to paste into a manuscript.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": {
    "total_checked": <integer>,
    "with_errors": <integer>,
    "common_errors": ["<short phrase>", "<short phrase>", ...]
  },
  "issues": [
    {
      "number": <integer, 1-indexed position in the original list>,
      "original": "<the original reference exactly as pasted>",
      "problems": ["<specific issue>", "<another specific issue>", ...],
      "corrected": "<the corrected reference in the target style, OR null if not enough info to correct>",
      "missing": ["<element 1>", "<element 2>", ...]
    }
  ],
  "fixed_list": [
    "<corrected reference 1>",
    "<corrected reference 2>",
    ...
  ]
}

QUANTITY GUIDELINES
  - issues array: ONE entry PER reference that has problems. Omit clean references from issues.
  - fixed_list array: EVERY reference, corrected or already clean, in the target style's required order (alphabetical for APA/AMA/Chicago/MLA, numbered for IEEE/Vancouver).
  - common_errors: 2 to 5 short phrases naming the most frequent error patterns you saw.

CONTENT RULES
  - DO NOT invent or guess any missing element. If a DOI, volume, issue, page range, publisher, or year is missing, list it in the "missing" array of that issue. Use a clearly visible "[MISSING: doi]" or "[MISSING: volume]" marker in the corrected/fixed-list version. Never fabricate.
  - Be specific about which rule each error violates. Examples: "Authors not in inverted format (Last, F.)", "Journal title should be italicized", "DOI missing", "Year should follow author in parentheses", "Title case used where sentence case is required", "Et al. used with fewer than 21 authors".
  - When a reference is unparseable (gibberish, fragment, only a URL with no title), flag it in problems and put null in corrected; do not synthesize.
  - For the fixed_list array: include EVERY reference. If a reference was unparseable, leave a clear "[UNPARSEABLE: <short label>]" placeholder in its slot so the list stays the right length.
  - Style fidelity: punctuation, italics indicated by surrounding asterisks like *Journal Name*, capitalization, element order, ampersand vs "and", DOI format (https://doi.org/...), all per the target style.
  - For IEEE / Vancouver: number references in citation order if order can be inferred from the input; otherwise preserve the input order and number 1..N.

VOICE (for the problem descriptions)
  - Direct, technical, no praise, no padding.
  - No em dashes. Use commas, periods, or restructure. Em dashes are banned.`;
}

function buildUserMessage(payload) {
  const { refs, style, output } = payload;
  const lines = [];
  lines.push('TARGET CITATION STYLE: ' + STYLE_NAMES[style]);
  lines.push('OUTPUT MODE REQUESTED BY FACULTY: ' + output + ' (still produce the full JSON; the UI decides what to show)');
  lines.push('');
  lines.push('REFERENCE LIST TO CHECK:');
  lines.push(refs);
  lines.push('');
  lines.push('Produce the audit. Output ONLY the JSON object specified in the system prompt.');
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

function shapeIssue(it) {
  if (!it || typeof it !== 'object') return null;
  const num = parseInt(it.number, 10);
  return {
    number: Number.isFinite(num) ? num : 0,
    original: typeof it.original === 'string' ? it.original : '',
    problems: Array.isArray(it.problems) ? it.problems.slice(0, 12).map(String) : [],
    corrected: typeof it.corrected === 'string' ? it.corrected : null,
    missing: Array.isArray(it.missing) ? it.missing.slice(0, 8).map(String) : [],
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

  const refs = String(body.refs || '').trim().slice(0, MAX_REFS_CHARS);
  if (!refs || refs.length < 20) return json(400, { error: 'reference list required (min 20 chars)' });

  const style = String(body.style || 'apa7').trim().toLowerCase();
  if (!VALID_STYLES.has(style)) return json(400, { error: 'invalid citation style' });

  const output = String(body.output || 'both').trim().toLowerCase();
  if (!VALID_OUTPUT.has(output)) return json(400, { error: 'invalid output mode' });

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ refs, style, output });

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
    console.error('[cite-check] anthropic error', err && err.message);
    return json(502, { error: 'check failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[cite-check] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const summary = (parsed.summary && typeof parsed.summary === 'object') ? {
    total_checked: parseInt(parsed.summary.total_checked, 10) || 0,
    with_errors: parseInt(parsed.summary.with_errors, 10) || 0,
    common_errors: Array.isArray(parsed.summary.common_errors) ? parsed.summary.common_errors.slice(0, 8).map(String) : [],
  } : { total_checked: 0, with_errors: 0, common_errors: [] };

  const result = stripEmDashes({
    style: STYLE_NAMES[style],
    output: output,
    summary: summary,
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 200).map(shapeIssue).filter(Boolean) : [],
    fixed_list: Array.isArray(parsed.fixed_list) ? parsed.fixed_list.slice(0, 300).map(String) : [],
  });

  return json(200, { ok: true, result });
};
