/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-coherence-check

   Does your paper's argument actually hang together? Faculty pastes the
   abstract + key sections (intro/methods/results/discussion). Returns a
   structural review:
     1. Thesis clarity (is the central claim crisp and consistent?)
     2. Gaps (where the argument has missing logical links)
     3. Contradictions (claims in one section that conflict with another)
     4. Weak transitions (paragraphs that don't connect)
     5. Overall flow assessment

   Distinct from Pre-submission Check (Jules), which does broad editorial
   scrutiny (journal fit, reviewer-bait, citation hygiene, voice). This
   focuses narrowly on STRUCTURAL COHERENCE of the argument.

   POST /.netlify/functions/office-hours-coherence-check
   Body: {
     abstract: '<required>',
     sections: '<required, intro + methods + results + discussion text>',
     paper_type: 'primary' | 'review' | 'systematic-review' | 'perspective' | 'methods',
     author_concerns: '<optional, what the author is worried about>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 5000;
const MAX_ABSTRACT_CHARS = 4000;
const MAX_SECTIONS_CHARS = 40000;
const MAX_CONCERNS_CHARS = 3000;

const VALID_PAPER_TYPES = new Set(['primary', 'review', 'systematic-review', 'perspective', 'methods']);

const PAPER_TYPE_FRAMING = {
  'primary':           'Primary empirical research article. Coherence check: does the central claim connect cleanly from research question to methods to results to discussion? Are the hypotheses (if any) clearly addressed by the analyses? Do the results sections actually answer the questions posed in the introduction?',
  'review':            'Narrative review. Coherence check: is there a clear organizing thesis? Do the body sections each contribute to that thesis or do they wander? Does the discussion synthesize rather than restate?',
  'systematic-review': 'Systematic review or meta-analysis. Coherence check: do the inclusion criteria, search strategy, and analytic plan line up with the stated research question? Do the results address the question, or do they drift?',
  'perspective':       'Perspective or commentary. Coherence check: is the central argument crisp? Are the supporting points each in service of that argument? Are counterarguments engaged or dismissed?',
  'methods':           'Methods paper. Coherence check: does the paper clearly distinguish what is novel from what is established? Do the validation results support the claims about the method? Is the comparison to existing methods fair and complete?',
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
  return `You are an expert academic editor specializing in argument structure. Faculty hand you a paper's abstract and key sections. Your job is to evaluate whether the argument hangs together as a structural whole. You do NOT evaluate journal fit, citation hygiene, or voice. You focus narrowly on COHERENCE: thesis clarity, logical gaps, internal contradictions, and transitions.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "structural_summary": "<two to three sentence overall read on whether the argument hangs together. Honest. If it doesn't, say so.>",
  "thesis_clarity": {
    "rating": "clear" | "ambiguous" | "missing" | "drifts",
    "stated_thesis": "<what you think the paper is arguing, restated in one sentence>",
    "detail": "<one to two sentences on what makes the thesis clear, ambiguous, missing, or drifting>"
  },
  "gaps": [
    {
      "location": "<e.g., 'Between Introduction paragraph 3 and Methods', 'Discussion paragraph 2'>",
      "issue": "<the missing logical link, e.g., 'paper claims X drives Y but never establishes the mechanism', 'methods do not measure the construct the introduction defines'>",
      "fix": "<one-sentence concrete suggestion>"
    }
  ],
  "contradictions": [
    {
      "location_a": "<where claim A appears>",
      "claim_a": "<the claim>",
      "location_b": "<where claim B appears>",
      "claim_b": "<the contradicting claim>",
      "severity": "minor" | "major",
      "fix": "<one-sentence suggestion to reconcile>"
    }
  ],
  "weak_transitions": [
    {
      "location": "<e.g., 'End of Introduction to start of Methods'>",
      "issue": "<what the transition fails to do, e.g., 'reader has no signal that the methods will answer the question posed'>",
      "suggested_bridge": "<one-sentence suggested transition>"
    }
  ],
  "section_alignment": {
    "abstract_matches_paper": <true or false>,
    "abstract_drift_note": "<one sentence, only if false>",
    "intro_to_methods": "tight" | "loose" | "broken",
    "methods_to_results": "tight" | "loose" | "broken",
    "results_to_discussion": "tight" | "loose" | "broken",
    "discussion_to_conclusion": "tight" | "loose" | "broken"
  },
  "biggest_structural_risk": "<one to two sentences naming the single structural issue most likely to cost the paper a reviewer's confidence>"
}

QUANTITY GUIDELINES
  - gaps: 2 to 6 items (the substantive logical-link gaps)
  - contradictions: 0 to 5 items (only when an actual contradiction exists; if none, return empty array)
  - weak_transitions: 2 to 5 items (the worst ones)

CONTENT RULES
  - Be SPECIFIC. Cite section names, paragraph numbers, or the actual text fragment that's the issue.
  - Do NOT invent content not in the paper. If a section is missing, note its absence as a gap.
  - "Drifts" thesis rating means the paper opens with one argument and closes with another; flag this explicitly.
  - "Tight" / "loose" / "broken" for section_alignment: tight = the next section follows directly from the previous; loose = the reader can fill in the gap with effort; broken = there's a genuine disconnect.
  - The "biggest_structural_risk" is the headline finding. Make it the one thing a reviewer is most likely to write back about.
  - When the author has flagged concerns in author_concerns, address those directly in the analysis.
  - No em dashes. No marketing-cliche filler.
  - Voice: senior peer, candid, structural. Not editorial-warm (that's Jules's job).`;
}

function buildUserMessage(payload) {
  const { abstract, sections, paper_type, author_concerns } = payload;
  const lines = [];
  lines.push('PAPER TYPE: ' + paper_type);
  lines.push('TYPE FRAMING: ' + PAPER_TYPE_FRAMING[paper_type]);
  lines.push('');
  lines.push('-------------------- ABSTRACT --------------------');
  lines.push(abstract);
  lines.push('');
  lines.push('-------------------- KEY SECTIONS --------------------');
  lines.push(sections);
  lines.push('-------------------- END SECTIONS --------------------');
  if (author_concerns) {
    lines.push('');
    lines.push("AUTHOR'S OWN FLAGGED CONCERNS:");
    lines.push(author_concerns);
  }
  lines.push('');
  lines.push('Produce the coherence check. Output ONLY the JSON object specified in the system prompt.');
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

function shapeGap(g) {
  if (!g || typeof g !== 'object') return null;
  return {
    location: typeof g.location === 'string' ? g.location : '',
    issue: typeof g.issue === 'string' ? g.issue : '',
    fix: typeof g.fix === 'string' ? g.fix : '',
  };
}
function shapeContradiction(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    location_a: typeof c.location_a === 'string' ? c.location_a : '',
    claim_a: typeof c.claim_a === 'string' ? c.claim_a : '',
    location_b: typeof c.location_b === 'string' ? c.location_b : '',
    claim_b: typeof c.claim_b === 'string' ? c.claim_b : '',
    severity: (c.severity === 'major' || c.severity === 'minor') ? c.severity : 'minor',
    fix: typeof c.fix === 'string' ? c.fix : '',
  };
}
function shapeTransition(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    location: typeof t.location === 'string' ? t.location : '',
    issue: typeof t.issue === 'string' ? t.issue : '',
    suggested_bridge: typeof t.suggested_bridge === 'string' ? t.suggested_bridge : '',
  };
}
function normalizeAlignment(a) {
  const valid = new Set(['tight', 'loose', 'broken']);
  return valid.has(a) ? a : 'loose';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const abstract = String(body.abstract || '').trim().slice(0, MAX_ABSTRACT_CHARS);
  if (!abstract || abstract.length < 50) return json(400, { error: 'abstract required (min 50 chars)' });

  const sections = String(body.sections || '').trim().slice(0, MAX_SECTIONS_CHARS);
  if (!sections || sections.length < 200) return json(400, { error: 'sections required (min 200 chars)' });

  const paper_type = String(body.paper_type || 'primary').trim().toLowerCase();
  if (!VALID_PAPER_TYPES.has(paper_type)) return json(400, { error: 'invalid paper_type' });

  const author_concerns = String(body.author_concerns || '').trim().slice(0, MAX_CONCERNS_CHARS);

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ abstract, sections, paper_type, author_concerns });

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
    console.error('[coherence-check] anthropic error', err && err.message);
    return json(502, { error: 'check failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[coherence-check] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const validRatings = new Set(['clear', 'ambiguous', 'missing', 'drifts']);
  const tc = (parsed.thesis_clarity && typeof parsed.thesis_clarity === 'object') ? parsed.thesis_clarity : {};
  const sa = (parsed.section_alignment && typeof parsed.section_alignment === 'object') ? parsed.section_alignment : {};

  const result = stripEmDashes({
    paper_type,
    structural_summary: typeof parsed.structural_summary === 'string' ? parsed.structural_summary : '',
    thesis_clarity: {
      rating: validRatings.has(tc.rating) ? tc.rating : 'ambiguous',
      stated_thesis: typeof tc.stated_thesis === 'string' ? tc.stated_thesis : '',
      detail: typeof tc.detail === 'string' ? tc.detail : '',
    },
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 10).map(shapeGap).filter(Boolean) : [],
    contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.slice(0, 8).map(shapeContradiction).filter(Boolean) : [],
    weak_transitions: Array.isArray(parsed.weak_transitions) ? parsed.weak_transitions.slice(0, 8).map(shapeTransition).filter(Boolean) : [],
    section_alignment: {
      abstract_matches_paper: sa.abstract_matches_paper !== false,
      abstract_drift_note: typeof sa.abstract_drift_note === 'string' ? sa.abstract_drift_note : '',
      intro_to_methods: normalizeAlignment(sa.intro_to_methods),
      methods_to_results: normalizeAlignment(sa.methods_to_results),
      results_to_discussion: normalizeAlignment(sa.results_to_discussion),
      discussion_to_conclusion: normalizeAlignment(sa.discussion_to_conclusion),
    },
    biggest_structural_risk: typeof parsed.biggest_structural_risk === 'string' ? parsed.biggest_structural_risk : '',
  });

  return json(200, { ok: true, result });
};
