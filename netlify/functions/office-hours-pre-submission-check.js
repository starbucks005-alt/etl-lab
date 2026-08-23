/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-pre-submission-check

   Pre-submission Check with Jules: faculty pastes a manuscript they
   already wrote, names the target journal and manuscript type, and gets
   back an editorial last-look on six dimensions:
     1. Journal fit
     2. Reviewer-bait flags (overclaims, missing limitations, etc.)
     3. Citation hygiene (uses web_search where helpful)
     4. Structural compliance (IMRaD, abstract length, COI / data-availability
        statements, etc.)
     5. Voice and clarity (em-dash, marketing-cliche, passive overuse)
     6. Cover letter draft

   This is editorial scrutiny, not AI writing. The output flags issues in
   the prose the faculty already wrote; it does not propose replacement
   prose for the manuscript body.

   POST /.netlify/functions/office-hours-pre-submission-check
   Body: {
     manuscript: '<full or partial manuscript text>',
     journal: '<target journal>',
     type: 'research-article' | 'brief-report' | 'review' | 'systematic-review' | 'case-report' | 'perspective' | 'qualitative' | 'methods',
     concerns: '<faculty-flagged concerns, optional>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 6000;
const MAX_MANUSCRIPT_CHARS = 40000;
const MAX_JOURNAL_CHARS = 200;
const MAX_CONCERNS_CHARS = 3000;
const VALID_TYPES = new Set([
  'research-article', 'brief-report', 'review', 'systematic-review',
  'case-report', 'perspective', 'qualitative', 'methods',
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

function typeFraming(type) {
  switch (type) {
    case 'systematic-review':
      return 'Systematic review or meta-analysis. Structural compliance checklist must include PROSPERO registration mention, PRISMA flow diagram or text equivalent, explicit search strategy, risk-of-bias assessment method, heterogeneity assessment.';
    case 'qualitative':
      return 'Qualitative study. Structural compliance checklist must include analytical approach named (grounded theory, IPA, thematic, etc.), theoretical framework or reflexivity statement, COREQ or SRQR reference, sampling strategy justification, member-checking or other trustworthiness move.';
    case 'review':
      return 'Narrative review. Structural compliance checklist should include scope statement, search transparency (even if non-systematic), balanced engagement with competing views, currency of cited literature.';
    case 'brief-report':
      return 'Brief report. Structural compliance should verify abstract within journal limit, methods adequate for the format, conclusions appropriately scoped to the truncated detail.';
    case 'perspective':
      return 'Perspective or commentary. Structural compliance checklist should include clear central claim, balanced engagement with alternatives, evidence grounding for empirical claims, appropriate level of rhetorical confidence.';
    case 'case-report':
      return 'Case report or case series. Structural compliance must include CARE guideline elements, informed consent statement, appropriate de-identification.';
    case 'methods':
      return 'Methods paper. Structural compliance must include reproducibility detail, code or software availability, validation data, comparison to existing methods.';
    case 'research-article':
    default:
      return 'Original research article. Structural compliance checklist must include IMRaD structure, abstract within journal word limit, conflict-of-interest statement, data-availability statement, funding/ack statement, ethics statement (IRB or equivalent if human subjects), pre-registration statement where applicable.';
  }
}

function buildSystemPrompt() {
  return `You are Jules, a pre-submission editor at the Emerging Technologies Laboratory. Faculty hand you the manuscript they have already written, the journal they intend to submit it to, and what they're worried about. You read it the way a senior colleague would the night before submission. You flag what reviewers will trip on. You do NOT rewrite the manuscript prose; you flag and suggest.

THIS IS EDITORIAL SCRUTINY, NOT AI WRITING. The faculty wrote the manuscript. You give them a checklist to use before they hit submit. They keep authorship intact.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": "<one to two sentences: your overall read of the manuscript and how close to submission-ready it is>",
  "journal_fit": {
    "rating": "Strong fit" | "Adequate fit" | "Mismatch",
    "rationale": "<one to two sentences: why that rating, naming specific scope/audience/methods alignment or misalignment with the named journal>",
    "mismatch_areas": ["<area 1 of mismatch>", "<area 2>", ...]
  },
  "reviewer_bait": [
    {
      "location": "<e.g., Title; Abstract sentence 3; Introduction paragraph 2; Discussion 'limitations'>",
      "severity": "major" | "minor",
      "issue": "<the issue a reviewer will flag>",
      "fix": "<one-sentence suggestion the faculty can apply themselves>"
    }
  ],
  "citation_hygiene": [
    {
      "location": "<the claim or section>",
      "severity": "major" | "minor",
      "issue": "<the citation gap or problem, e.g., 'unengaged with recent meta-analysis by [Author 2023]', 'overclaim of novelty given [Author 2024]'>",
      "fix": "<suggestion>"
    }
  ],
  "voice_clarity": [
    {
      "location": "<e.g., Abstract; Discussion paragraph 1>",
      "severity": "minor",
      "issue": "<the voice/clarity problem, e.g., overuse of passive voice in methods, marketing-cliche adjectives, em-dash usage, paragraph too long>",
      "fix": "<suggestion>"
    }
  ],
  "structural_compliance": [
    {
      "requirement": "<the structural element being checked>",
      "status": "present" | "missing" | "unknown",
      "note": "<optional one-phrase note>"
    }
  ],
  "cover_letter": "<a draft cover letter to the editor of the target journal, 3 to 5 short paragraphs, signed [Your name]>"
}

QUANTITY GUIDELINES
  - 3 to 6 reviewer_bait items
  - 2 to 5 citation_hygiene items (fewer is fine if the manuscript engages well)
  - 2 to 5 voice_clarity items
  - 6 to 10 structural_compliance items (the full checklist for the manuscript type)
  - 1 cover_letter

VOICE (Jules speaks)
  - Direct, warm, senior colleague who has been on the other side of the desk.
  - Specific over general. Cite section names or paragraph numbers when flagging.
  - Each issue paired with a fix the faculty can apply themselves in 5 minutes.
  - No em dashes. Use commas, periods, or restructure. Em dashes are on the faculty's banned list.
  - No marketing-cliche adjectives, no "leverage" "synergy" "robust" as filler.

CONTENT RULES
  - Journal fit is the most important assessment. If the manuscript is a mismatch for the journal, that is the headline finding; reviewer-bait and citation-hygiene matter less than steering them to a better venue. Be honest about mismatch when you see it.
  - Reviewer-bait flags: overstated claims of novelty, missing limitations, ungrounded "first" / "novel" / "groundbreaking" assertions, conclusions that exceed the data, p-values without effect sizes, single-site or small-N studies framed as definitive.
  - Citation hygiene: identify obvious omitted engagement with recent work (use web_search where it strengthens a specific point). PREFER CITATIONS FROM THE LAST 5 YEARS (2021 onward) when you mention specific papers. Flag overuse of the faculty's own prior work as evidence.
  - Structural compliance: produce a CHECKLIST of items appropriate to the manuscript type. Each item gets a present/missing/unknown status based on what you can see in the pasted text. "Unknown" is fine; do not assume something is missing just because the paste was partial.
  - Voice and clarity: skim, don't audit every sentence. Flag the patterns (passive in methods, em-dashes in prose, marketing language in discussion, abstract that buries the finding). Two to five flags is enough.
  - Cover letter: draft to the editor of the named journal. 3-5 paragraphs. State the manuscript title, type, central finding, why it fits the journal, brief mention of any prior interaction with the journal if obvious, ethical compliance, suggested reviewers placeholder, sign-off with "[Your name]" placeholder.
  - Address the faculty's flagged concerns directly. If they said "the EL effect is a subgroup analysis," reviewer-bait should call that out and propose framing; structural compliance should check for pre-registration language; voice should not waste a flag on this.`;
}

function buildUserMessage(payload) {
  const { manuscript, journal, type, concerns } = payload;
  const lines = [];
  lines.push('MANUSCRIPT (as pasted by the faculty):');
  lines.push(manuscript);
  lines.push('');
  lines.push('-------------------- SUBMISSION METADATA --------------------');
  lines.push('TARGET JOURNAL: ' + journal);
  lines.push('MANUSCRIPT TYPE: ' + type);
  lines.push('TYPE FRAMING: ' + typeFraming(type));
  if (concerns) {
    lines.push('');
    lines.push("FACULTY'S OWN FLAGGED CONCERNS:");
    lines.push(concerns);
  }
  lines.push('');
  lines.push('Produce the pre-submission check. Output ONLY the JSON object specified in the system prompt.');
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

function shapeFlag(f) {
  if (typeof f === 'string') return { location: '', severity: 'minor', issue: f, fix: '' };
  return {
    location: typeof f.location === 'string' ? f.location : '',
    severity: (f.severity === 'major' || f.severity === 'minor') ? f.severity : 'minor',
    issue: typeof f.issue === 'string' ? f.issue : (typeof f.text === 'string' ? f.text : ''),
    fix: typeof f.fix === 'string' ? f.fix : (typeof f.suggestion === 'string' ? f.suggestion : ''),
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

  const manuscript = String(body.manuscript || '').trim().slice(0, MAX_MANUSCRIPT_CHARS);
  if (!manuscript) return json(400, { error: 'manuscript required' });

  const journal = String(body.journal || '').trim().slice(0, MAX_JOURNAL_CHARS);
  if (!journal) return json(400, { error: 'target journal required' });

  const type = String(body.type || 'research-article').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) return json(400, { error: 'invalid manuscript type' });

  const concerns = String(body.concerns || '').trim().slice(0, MAX_CONCERNS_CHARS);

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ manuscript, journal, type, concerns });

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
    console.error('[pre-submission-check] anthropic error', err && err.message);
    return json(502, { error: 'check failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[pre-submission-check] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const check = stripEmDashes({
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    journal_fit: (parsed.journal_fit && typeof parsed.journal_fit === 'object') ? {
      rating: typeof parsed.journal_fit.rating === 'string' ? parsed.journal_fit.rating : '',
      rationale: typeof parsed.journal_fit.rationale === 'string' ? parsed.journal_fit.rationale : '',
      mismatch_areas: Array.isArray(parsed.journal_fit.mismatch_areas) ? parsed.journal_fit.mismatch_areas.slice(0, 8).map(String) : [],
    } : null,
    reviewer_bait: Array.isArray(parsed.reviewer_bait) ? parsed.reviewer_bait.slice(0, 10).map(shapeFlag) : [],
    citation_hygiene: Array.isArray(parsed.citation_hygiene) ? parsed.citation_hygiene.slice(0, 10).map(shapeFlag) : [],
    voice_clarity: Array.isArray(parsed.voice_clarity) ? parsed.voice_clarity.slice(0, 10).map(shapeFlag) : [],
    structural_compliance: Array.isArray(parsed.structural_compliance) ? parsed.structural_compliance.slice(0, 14).map((s) => ({
      requirement: typeof s.requirement === 'string' ? s.requirement : (typeof s.item === 'string' ? s.item : ''),
      status: ['present', 'missing', 'unknown', 'ok', 'absent'].indexOf(String(s.status || '').toLowerCase()) >= 0 ? String(s.status).toLowerCase() : 'unknown',
      note: typeof s.note === 'string' ? s.note : '',
    })) : [],
    cover_letter: typeof parsed.cover_letter === 'string' ? parsed.cover_letter : '',
  });

  return json(200, { ok: true, check });
};
