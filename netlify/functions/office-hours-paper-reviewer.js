/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-paper-reviewer

   Paper Reviewer Assistant: a journal asked the faculty member to peer-review
   a paper. They paste it; the tool returns a structured draft review:
     - Summary of the paper
     - Recommendation (accept / minor-revision / major-revision / reject)
     - Recommendation rationale
     - Strengths (3-5)
     - Major concerns (3-5)
     - Minor concerns (3-5)
     - Specific section comments (3-6)

   Public endpoint. NO auth. NO server-side storage. The faculty member's
   reviewer agreement governs confidentiality of the manuscript itself.

   POST /.netlify/functions/office-hours-paper-reviewer
   Body: {
     paper: '<paper text, full or excerpted>',
     title: '<optional>',
     tier: 'top-specialty' | 'strong-specialty' | 'mid-tier' | 'broad-open' | 'society',
     type: 'research-article' | 'review' | 'systematic-review' | 'brief-report' | 'perspective' | 'qualitative' | 'case-study',
     context: '<reviewer context, optional>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4500;
const MAX_PAPER_CHARS = 30000;
const MAX_TITLE_CHARS = 300;
const MAX_CONTEXT_CHARS = 2000;
const VALID_TIERS = new Set(['top-specialty', 'strong-specialty', 'mid-tier', 'broad-open', 'society']);
const VALID_TYPES = new Set([
  'research-article', 'review', 'systematic-review', 'brief-report',
  'perspective', 'qualitative', 'case-study',
]);

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

function tierFraming(tier) {
  switch (tier) {
    case 'top-specialty':
      return 'Top-tier specialty journal. Standards are very high: methodological rigor, conceptual novelty, broad implications. The bar is "this should change how the field thinks about X." Defects that mid-tier journals tolerate are deal-breakers here.';
    case 'strong-specialty':
      return 'Strong specialty journal. The standard is high but the paper does not need to be field-changing; it needs to be rigorous and offer a clear contribution within its subfield. Most well-conducted studies belong here.';
    case 'mid-tier':
      return 'Mid-tier specialty journal. The standard is competent and useful. Smaller contributions, less-novel findings, and well-executed replications are appropriate. Methodological lapses that distort core findings are still serious.';
    case 'broad-open':
      return 'Broad / open-access journal (e.g., PLoS ONE, BMC). Acceptance hinges primarily on methodological soundness, not on perceived importance or novelty. Tolerate small contributions; do not tolerate methodological failures.';
    case 'society':
      return 'Society or regional journal. Standards focus on relevance to the membership and methodological adequacy. Be generous on novelty, firm on conduct and conclusions.';
    default:
      return 'Standard reviewer expectations.';
  }
}

function typeFraming(type) {
  switch (type) {
    case 'systematic-review':
      return 'Systematic review or meta-analysis. Check: PROSPERO registration, PRISMA adherence, search reproducibility, risk-of-bias method, heterogeneity assessment, publication bias assessment, subgroup vs sensitivity analysis appropriateness.';
    case 'qualitative':
      return 'Qualitative study. Check: theoretical framework, sampling strategy fit to research question, analytical approach (grounded theory, IPA, thematic, etc.) and its rigor, member checking or other trustworthiness moves, reflexivity, COREQ/SRQR adherence.';
    case 'review':
      return 'Narrative review. Check: scope statement, search transparency (even if not systematic), balanced coverage of competing perspectives, identification of gaps versus claims of novelty, currency of citations.';
    case 'brief-report':
      return 'Brief report. Check: justification for the brief format, completeness of methods given length, replicability despite brevity, appropriateness of claims given truncated detail.';
    case 'perspective':
      return 'Perspective or commentary. Check: clarity of central argument, fair engagement with alternative views, evidence base for empirical claims, appropriateness of rhetorical confidence.';
    case 'case-study':
      return 'Case study. Check: justification for the case selection, depth of within-case analysis, appropriate generalization claims (single case vs theoretical generalization), confidentiality if human subject.';
    case 'research-article':
    default:
      return 'Original research article. Check: research question clarity, design appropriateness for the question, sample and recruitment, measurement validity and reliability, analytic strategy, results presentation, discussion fit to findings, limitations honesty.';
  }
}

function buildSystemPrompt() {
  return `You are Paper Reviewer Assistant, a writing tool for a faculty member who has been asked by a journal to peer-review a manuscript. You produce a STRUCTURED DRAFT review that the faculty member will edit and submit. You do NOT submit; the faculty member retains final judgment.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": "<one to two sentences: what the paper claims and how>",
  "recommendation": "Accept" | "Minor revision" | "Major revision" | "Reject",
  "recommendation_rationale": "<one to two sentences: why that recommendation, plainly>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "major_concerns": ["<full numbered concern 1>", "<full numbered concern 2>", ...],
  "minor_concerns": ["<minor concern 1>", ...],
  "specific_comments": [
    { "section": "<e.g., Introduction, paragraph 2; or Methods, section 2.3; or Table 1>", "comment": "<the comment>" }
  ]
}

QUANTITY GUIDELINES
  - 3 to 5 strengths
  - 3 to 5 major_concerns (these are full paragraphs, each substantive)
  - 3 to 5 minor_concerns (one-liners)
  - 3 to 6 specific_comments

VOICE
  - Write each item the way a SENIOR PEER REVIEWER would phrase it in writing to the editor. Specific, evidence-based, professional. Not hostile, not deferential.
  - Use the manuscript's own terminology where possible. Quote phrases the authors used when challenging them.
  - No em dashes. Use commas, periods, or restructure. Em dashes are on the faculty's banned list.
  - No marketing-cliche language. No "leverage" "synergy" or "robust" as filler.
  - Be honest about what cannot be assessed from the text the faculty pasted (e.g., if no methods detail visible, name that as a concern rather than guessing).

CONTENT RULES
  - Identify the design or argument type FIRST in your summary.
  - MAJOR concerns are issues that could materially change the paper's conclusions or recommendation if unresolved (e.g., underpowered sample claiming definitive results; selection bias unaddressed; statistical model mis-specified; central claim not supported by the cited evidence).
  - MINOR concerns are issues of clarity, citation, presentation, or supplementary detail that improve the paper but don't change its conclusions.
  - SPECIFIC comments are line- or section-level: typos, missing citations to obvious prior work, table layout issues, figure clarity, etc.
  - Strengths must be GENUINE. If the paper has weaknesses but a clear methodological strength (e.g., preregistration), name that as a strength.
  - Tailor the standard to the JOURNAL TIER specified. A flaw that's a Reject at NEJM may be a Major Revision at PLoS ONE.
  - The RECOMMENDATION should follow logically from the major_concerns. If you list 4 major concerns that change the conclusions, the recommendation is Major Revision or Reject. Don't issue Accept with concerns.

SOURCES
  - Use web_search sparingly to ground concerns in real literature WHERE that strengthens the review (e.g., "this finding contradicts the consensus from [recent meta-analysis] which the authors do not engage").
  - PREFER CITATIONS FROM THE LAST 5 YEARS (2021 onward). The author should be expected to be current; a reviewer who cites recent work is harder to dismiss as out of touch.
  - Do NOT fabricate citations. It is acceptable to issue many concerns without literature citations; the model's training knowledge of common methodological failures is sufficient grounding for most criticism.

CONFIDENTIALITY
  - The manuscript is unpublished. Do not summarize or evaluate beyond what is needed for the review JSON. Do not extract content for any other purpose.`;
}

function buildUserMessage(payload) {
  const { paper, title, tier, type, context } = payload;
  const lines = [];
  lines.push('MANUSCRIPT (as pasted by the reviewing faculty member):');
  if (title) lines.push('TITLE: ' + title);
  lines.push('');
  lines.push(paper);
  lines.push('');
  lines.push('-------------------- REVIEWER METADATA --------------------');
  lines.push('JOURNAL TIER: ' + tier);
  lines.push('TIER FRAMING: ' + tierFraming(tier));
  lines.push('');
  lines.push('MANUSCRIPT TYPE: ' + type);
  lines.push('TYPE FRAMING: ' + typeFraming(type));
  if (context) {
    lines.push('');
    lines.push("REVIEWER'S OWN CONTEXT:");
    lines.push(context);
  }
  lines.push('');
  lines.push('Produce the draft review. Output ONLY the JSON object specified in the system prompt.');
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

  const paper = String(body.paper || '').trim().slice(0, MAX_PAPER_CHARS);
  if (!paper) return json(400, { error: 'paper required' });

  const title = String(body.title || '').trim().slice(0, MAX_TITLE_CHARS);
  const tier = String(body.tier || 'strong-specialty').trim().toLowerCase();
  if (!VALID_TIERS.has(tier)) return json(400, { error: 'invalid tier' });

  const type = String(body.type || 'research-article').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) return json(400, { error: 'invalid type' });

  const context = String(body.context || '').trim().slice(0, MAX_CONTEXT_CHARS);

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ paper, title, tier, type, context });

  const client = new Anthropic({ apiKey });
  let modelOutput;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 2 },
      ],
      messages: [{ role: 'user', content: userMsg }],
    });
    modelOutput = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[paper-reviewer] anthropic error', err && err.message);
    return json(502, { error: 'review generation failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[paper-reviewer] json parse failed. raw output head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const review = stripEmDashes({
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    recommendation: typeof parsed.recommendation === 'string' ? parsed.recommendation : '',
    recommendation_rationale: typeof parsed.recommendation_rationale === 'string' ? parsed.recommendation_rationale : '',
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8).map(String) : [],
    major_concerns: Array.isArray(parsed.major_concerns) ? parsed.major_concerns.slice(0, 8).map(String) : [],
    minor_concerns: Array.isArray(parsed.minor_concerns) ? parsed.minor_concerns.slice(0, 8).map(String) : [],
    specific_comments: Array.isArray(parsed.specific_comments)
      ? parsed.specific_comments.slice(0, 10).map((c) => {
          if (typeof c === 'string') return { section: '', comment: c };
          return {
            section: typeof c.section === 'string' ? c.section : '',
            comment: typeof c.comment === 'string' ? c.comment : (typeof c.text === 'string' ? c.text : ''),
          };
        })
      : [],
  });

  return json(200, { ok: true, review });
};
