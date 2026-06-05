/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-reviewer-response

   Faculty pastes the reviewer comments they got back from a journal AND
   the manuscript section under critique. Returns:
     1. A point-by-point response letter (opening + per-comment response +
        closing) in journal convention ("we thank the reviewer for...")
     2. Revised manuscript text ready to paste back into the manuscript
     3. Diff notes summarizing what changed

   Different from Resubmission Builder, which handles FEDERAL GRANT
   resubmissions (Summary Statement, Introduction page, attempt-cycle
   math). This tool handles JOURNAL peer-review responses (revise-and-
   resubmit decisions on manuscripts).

   POST /.netlify/functions/office-hours-reviewer-response
   Body: {
     reviewer_comments: '<required, the full review block>',
     manuscript_section: '<required, the section under critique>',
     journal: '<optional target journal>',
     decision: 'minor-revisions' | 'major-revisions' | 'reject-and-resubmit',
     author_concerns: '<optional, what the PI wants flagged>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 6000;
const MAX_COMMENTS_CHARS = 15000;
const MAX_SECTION_CHARS = 20000;
const MAX_CONCERNS_CHARS = 3000;
const MAX_JOURNAL_CHARS = 200;

const VALID_DECISIONS = new Set(['minor-revisions', 'major-revisions', 'reject-and-resubmit']);

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

function decisionGuidance(d) {
  switch (d) {
    case 'minor-revisions':
      return 'MINOR REVISIONS. Tone: gracious, brief, point-by-point. The editor expects most comments addressed cleanly; long debate signals defensiveness. Concede where reasonable, push back only on substantive issues.';
    case 'major-revisions':
      return 'MAJOR REVISIONS. Tone: thorough, evidence-based, willing to do real work. Reviewers expect substantive responses, new analyses where requested, and clear page-anchors for every change. Where you disagree with a reviewer, explain WHY with evidence, then offer a compromise if possible.';
    case 'reject-and-resubmit':
    default:
      return 'REJECT AND RESUBMIT (or revise-and-resubmit as a new submission). Tone: serious. Address every substantive critique. Make the case that the revised manuscript is a meaningfully different paper. Open the response letter by acknowledging the decision frankly.';
  }
}

function buildSystemPrompt() {
  return `You are an expert academic peer-review-response writer. Faculty hand you reviewer comments from a journal and the manuscript section under critique. You produce a point-by-point response letter in the convention journals expect, plus revised manuscript text the author can paste back in.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "letter_opening": "<2 to 3 sentence opening paragraph thanking the editor and reviewers, summarizing how the manuscript was revised>",
  "responses": [
    {
      "reviewer": "<R1 | R2 | R3 | Editor | Unknown>",
      "comment_number": <integer or null>,
      "comment_summary": "<the reviewer's comment restated in one to two sentences>",
      "response": "<2 to 5 sentence response: acknowledge, then explain what was done. Use 'we have...' convention. End with a page or section anchor placeholder like [p. X] or [Methods, paragraph 2, revised].>",
      "action_taken": "<one phrase: 'text revised' | 'new analysis added' | 'clarified' | 'cited additional source' | 'respectfully disagree with rationale' | 'flagged for author decision'>",
      "disagree": <true or false>
    }
  ],
  "letter_closing": "<2 to 3 sentence closing paragraph: appreciation, willingness to address further questions, signature placeholder>",
  "revised_section": "<the manuscript section rewritten to address the substantive critiques. Author can paste this into their manuscript. Where new data is needed and the author has not provided it, mark [NEW DATA NEEDED: <what>]. Where the author must decide between two reframings, mark [AUTHOR CHOICE: option A vs option B].>",
  "diff_notes": [
    "<one-line note: what changed and why, e.g., 'Added paragraph 3 in Methods to address R1 concern about sample selection'>"
  ]
}

QUANTITY
  - responses: ONE entry per substantive reviewer comment. Most journal reviews have 4 to 15 substantive comments per reviewer.
  - diff_notes: 3 to 8 items summarizing the key changes.

CONTENT RULES
  - DO NOT invent results, new analyses with specific numbers, or citations that don't exist. If a response requires data the author has not provided, write [NEW DATA NEEDED: <what>] in the response and revised_section. Do not fabricate.
  - DO NOT rewrite the manuscript section in a way that loses the author's voice or substantive findings. You are revising for review-response, not rewriting from scratch.
  - Use the journal-response convention: "We thank the reviewer for...", "We have addressed this by...", "The revised manuscript now [p. X]..."
  - Page anchors are placeholders. Use [p. X], [Methods, paragraph 2], or [Aim 2, revised] consistently.
  - When the reviewer is wrong, push back politely with evidence. Set disagree=true on those responses. Do not concede every point reflexively; reviewers are also wrong sometimes.
  - When the author has flagged concerns in author_concerns, address those reviewer comments first or with special care.
  - No em dashes. No marketing-cliche filler ('robust', 'leverage', 'synergy', 'novel' as decoration).
  - Voice: professional academic peer, not obsequious, not defensive.`;
}

function buildUserMessage(payload) {
  const { reviewer_comments, manuscript_section, journal, decision, author_concerns } = payload;
  const lines = [];
  lines.push('JOURNAL: ' + (journal || '[Not specified]'));
  lines.push('DECISION: ' + decision);
  lines.push('DECISION GUIDANCE: ' + decisionGuidance(decision));
  lines.push('');
  lines.push('-------------------- REVIEWER COMMENTS --------------------');
  lines.push(reviewer_comments);
  lines.push('-------------------- END REVIEWER COMMENTS --------------------');
  lines.push('');
  lines.push('-------------------- MANUSCRIPT SECTION UNDER CRITIQUE --------------------');
  lines.push(manuscript_section);
  lines.push('-------------------- END MANUSCRIPT SECTION --------------------');
  if (author_concerns) {
    lines.push('');
    lines.push("AUTHOR'S OWN FLAGGED CONCERNS AND PRIORITIES:");
    lines.push(author_concerns);
  }
  lines.push('');
  lines.push('Produce the point-by-point response letter and revised manuscript section. Output ONLY the JSON object specified in the system prompt.');
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

function shapeResponse(r) {
  if (!r || typeof r !== 'object') return null;
  const cn = parseInt(r.comment_number, 10);
  return {
    reviewer: typeof r.reviewer === 'string' ? r.reviewer : 'Unknown',
    comment_number: Number.isFinite(cn) ? cn : null,
    comment_summary: typeof r.comment_summary === 'string' ? r.comment_summary : '',
    response: typeof r.response === 'string' ? r.response : '',
    action_taken: typeof r.action_taken === 'string' ? r.action_taken : '',
    disagree: r.disagree === true,
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

  const reviewer_comments = String(body.reviewer_comments || '').trim().slice(0, MAX_COMMENTS_CHARS);
  if (!reviewer_comments || reviewer_comments.length < 50) return json(400, { error: 'reviewer_comments required (min 50 chars)' });

  const manuscript_section = String(body.manuscript_section || '').trim().slice(0, MAX_SECTION_CHARS);
  if (!manuscript_section || manuscript_section.length < 100) return json(400, { error: 'manuscript_section required (min 100 chars)' });

  const journal = String(body.journal || '').trim().slice(0, MAX_JOURNAL_CHARS);
  const author_concerns = String(body.author_concerns || '').trim().slice(0, MAX_CONCERNS_CHARS);

  const decision = String(body.decision || 'major-revisions').trim().toLowerCase();
  if (!VALID_DECISIONS.has(decision)) return json(400, { error: 'invalid decision' });

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ reviewer_comments, manuscript_section, journal, decision, author_concerns });

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
    console.error('[reviewer-response] anthropic error', err && err.message);
    return json(502, { error: 'response build failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[reviewer-response] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const result = stripEmDashes({
    journal: journal || null,
    decision,
    letter_opening: typeof parsed.letter_opening === 'string' ? parsed.letter_opening : '',
    responses: Array.isArray(parsed.responses) ? parsed.responses.slice(0, 50).map(shapeResponse).filter(Boolean) : [],
    letter_closing: typeof parsed.letter_closing === 'string' ? parsed.letter_closing : '',
    revised_section: typeof parsed.revised_section === 'string' ? parsed.revised_section : '',
    diff_notes: Array.isArray(parsed.diff_notes) ? parsed.diff_notes.slice(0, 12).map(String) : [],
  });

  return json(200, { ok: true, result });
};
