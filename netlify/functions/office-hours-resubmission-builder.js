/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-resubmission-builder

   Faculty pastes the reviewer Summary Statement from a rejected federal grant,
   optionally pastes parts of the original application, names the mechanism and
   which attempt this resubmission is, and gets back:

     1. Overall assessment: is this rescuable? Or does it need a new submission?
     2. Per-reviewer critique extraction (R1 / R2 / R3 broken into discrete
        bullets) with severity per critique (showstopper / major / minor)
     3. Draft response paragraph per critique in the mechanism's expected
        convention ("We have addressed this by..." + page anchor)
     4. Draft Introduction to Resubmission page in mechanism convention (VA
        requires this; NIH expects a 1-page Introduction; NSF differs)
     5. Revision plan: what new data is needed, what to reframe, what to
        deemphasize, what to concede
     6. Attempts-remaining strategy: tone-aware ("you have 1 attempt left,
        play conservative" vs "2 more attempts, take a bigger swing")

   Supports ~15 federal mechanisms with mechanism-specific resubmission rules
   and conventions.

   POST /.netlify/functions/office-hours-resubmission-builder
   Body: {
     summary_statement: '<required, the reviewer feedback>',
     application_excerpt: '<optional, sections of the original>',
     mechanism: '<one of the supported mechanism keys>',
     attempt_number: 1 | 2 | 3,
     pi_concerns: '<optional, what the PI is worried about>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8000;
const MAX_STATEMENT_CHARS = 30000;
const MAX_APP_CHARS = 20000;
const MAX_CONCERNS_CHARS = 3000;

/* ─── Mechanism matrix ──────────────────────────────────────────────────────
   Per-mechanism rules: max total submissions, what the agency calls the
   resubmission cycle, what the response convention is, what the
   "Introduction" page is called and how long.
   ─────────────────────────────────────────────────────────────────────────── */
const MECHANISMS = {
  /* VA */
  'va-merit': {
    label: 'VA Merit Review (HSR&D / RR&D / BLR&D / CSR&D)',
    agency: 'Department of Veterans Affairs',
    max_attempts: 3,
    intro_label: 'Introduction to the Resubmission',
    intro_pages: 1,
    response_convention: 'VA Merit Review expects an Introduction page that walks reviewer by reviewer through the critiques and your responses. Use the language "The reviewer raised concerns that..." followed by "We have addressed this by..." with a page or section anchor in the revised application. VA reviewers value visible humility and concrete revisions. The Introduction must summarize the most substantive changes, not just list them.',
    quirks: 'VA gives THREE total submissions per project (the initial plus two resubmissions). Significance, Investigators, Innovation, Approach, Environment are each scored, plus Overall Impact. Approach is usually the killer. Veteran relevance must be made explicit.',
  },
  'va-cda': {
    label: 'VA Career Development Award (CDA-1 / CDA-2)',
    agency: 'Department of Veterans Affairs',
    max_attempts: 2,
    intro_label: 'Introduction to the Resubmission',
    intro_pages: 1,
    response_convention: 'VA CDA reviewers focus heavily on the candidate, the mentor team, and the training plan more than the science. Frame responses as growth: what you learned from prior feedback, how the mentor team has been strengthened, and how the training plan now addresses identified gaps.',
    quirks: 'VA CDA allows TWO total submissions (initial plus one resubmission). Mentor strength and institutional commitment are often the make-or-break factors. Veteran population focus must be clear.',
  },

  /* NIH */
  'nih-r01': {
    label: 'NIH R01 (research project grant)',
    agency: 'National Institutes of Health',
    max_attempts: 2,
    intro_label: 'Introduction to Resubmission (A1)',
    intro_pages: 1,
    response_convention: 'NIH expects a 1-page Introduction summarizing the changes made in response to reviewer critiques. Open with a brief framing sentence, then group responses by major theme (not necessarily reviewer by reviewer). End with a 2 to 3 sentence summary of "Substantial changes." Page-anchor every significant revision. NIH reviewers especially value humility about Approach concerns and explicit new preliminary data.',
    quirks: 'NIH currently allows ONE A1 resubmission (TWO total submissions). After the A1 you must submit as a new application with substantial differences. Approach score drives outcomes; Significance and Innovation are secondary. New preliminary data is often the strongest response to Approach critiques.',
  },
  'nih-r21': {
    label: 'NIH R21 (exploratory / developmental)',
    agency: 'National Institutes of Health',
    max_attempts: 2,
    intro_label: 'Introduction to Resubmission (A1)',
    intro_pages: 1,
    response_convention: 'Same 1-page Introduction format as R01. R21 emphasizes high-risk/high-reward science; defend the exploratory nature when reviewers ask for more preliminary data. Be explicit that R21 is not a small R01.',
    quirks: 'ONE A1 resubmission allowed. R21 has stricter page limits than R01 (6 pages Research Strategy). Preliminary data is not required but is increasingly expected.',
  },
  'nih-k': {
    label: 'NIH K award (K01 / K08 / K23 / K99)',
    agency: 'National Institutes of Health',
    max_attempts: 2,
    intro_label: 'Introduction to Resubmission (A1)',
    intro_pages: 1,
    response_convention: 'K awards weight the Candidate, Career Development Plan, Mentors, and Environment heavily. Frame the resubmission around growth and mentor strengthening. Address Candidate concerns directly and visibly; do not deflect.',
    quirks: 'ONE A1 resubmission allowed. The career development plan is often as scrutinized as the science. Mentor team changes between submissions should be highlighted.',
  },
  'nih-f': {
    label: 'NIH F award (F30 / F31 / F32)',
    agency: 'National Institutes of Health',
    max_attempts: 2,
    intro_label: 'Introduction to Resubmission (A1)',
    intro_pages: 1,
    response_convention: 'F awards weight the Fellowship Applicant, Sponsor, and Training Plan. The candidate must demonstrate growth between submissions. Sponsor commitment letters should reflect addressed reviewer concerns.',
    quirks: 'ONE A1 resubmission allowed. Reviewer concerns about the training environment are often resolved by letter, not by rewriting the application. F awards are highly competitive at top institutions.',
  },
  'nih-sbir-sttr': {
    label: 'NIH SBIR / STTR (small business)',
    agency: 'National Institutes of Health',
    max_attempts: 2,
    intro_label: 'Introduction to Resubmission (A1)',
    intro_pages: 1,
    response_convention: 'NIH SBIR/STTR resubmission expects the standard 1-page Introduction. Reviewers care about commercial potential and team capability. Address commercialization concerns directly with letters of support from potential customers, partnerships, or distribution channels where possible.',
    quirks: 'ONE A1 resubmission allowed. Phase I is feasibility; Phase II is commercialization-focused. Reviewers want to see a credible path to market.',
  },

  /* NSF */
  'nsf-standard': {
    label: 'NSF (standard research proposal)',
    agency: 'National Science Foundation',
    max_attempts: 99,
    intro_label: 'Results of Prior NSF Support (and Response to Previous Reviews)',
    intro_pages: 1,
    response_convention: 'NSF does NOT use the NIH-style 1-page Introduction. Reviewer responses are typically woven into the Project Description, with a "Response to Previous Review" section often added voluntarily up front (1 to 2 pages). NSF prizes intellectual merit and broader impacts equally; respond to both with parallel structure.',
    quirks: 'NSF has no formal cap on resubmissions, but program officers signal whether a resubmission is welcome. Always call your program officer before resubmitting. Each submission is technically "new" but reviewers see the prior critique if you flag it.',
  },

  /* DoD */
  'dod-cdmrp': {
    label: 'DoD CDMRP (Congressionally Directed Medical Research)',
    agency: 'Department of Defense',
    max_attempts: 2,
    intro_label: 'Resubmission Introduction',
    intro_pages: 2,
    response_convention: 'CDMRP allows up to a 2-page Introduction. CDMRP reviewers are mix of scientists and consumer reviewers (patients, caregivers, advocates). Responses must work for BOTH audiences: scientific rigor for the peer panel, accessible relevance for the consumer reviewer. Military relevance and impact on the eligible population must be explicit.',
    quirks: 'Most CDMRP programs allow ONE resubmission (TWO total submissions). Consumer reviewers can sink a resubmission if the consumer-facing materials (Public Abstract, Statement of Work for the lay reader) are not improved. Always strengthen these between submissions.',
  },

  /* AHRQ */
  'ahrq-r01': {
    label: 'AHRQ R01 / R18 (health services research)',
    agency: 'Agency for Healthcare Research and Quality',
    max_attempts: 2,
    intro_label: 'Introduction to Resubmission (A1)',
    intro_pages: 1,
    response_convention: 'AHRQ follows the NIH 1-page Introduction format. AHRQ reviewers weight policy and practice relevance more heavily than NIH; responses must show direct line of sight from the science to a healthcare decision-maker.',
    quirks: 'ONE A1 resubmission allowed. AHRQ values implementation feasibility and stakeholder engagement. Patient/clinician advisory inputs strengthen Approach.',
  },

  /* HRSA */
  'hrsa': {
    label: 'HRSA program / training grant',
    agency: 'Health Resources and Services Administration',
    max_attempts: 99,
    intro_label: 'Response to Prior Review',
    intro_pages: 2,
    response_convention: 'HRSA program grants typically allow a Response to Prior Review (1 to 2 pages) within the Project Narrative. Reviewers are mix of programmatic staff and external reviewers; service delivery and community impact dominate the scoring criteria. Letters of support from partner organizations carry real weight.',
    quirks: 'HRSA programs vary widely; check the specific NOFO. Most allow resubmission in subsequent cycles. Workforce and underserved-population focus must be explicit.',
  },

  /* PCORI */
  'pcori': {
    label: 'PCORI (patient-centered outcomes research)',
    agency: 'Patient-Centered Outcomes Research Institute',
    max_attempts: 2,
    intro_label: 'Response to Reviewers',
    intro_pages: 2,
    response_convention: 'PCORI has a structured "Response to Reviewers" template. Stakeholder engagement is a scored criterion; any resubmission should reflect deeper, more authentic engagement. Patient and caregiver partner letters are often more persuasive than scientific consultant letters here.',
    quirks: 'Typically ONE resubmission per cycle. PCORI is distinct from NIH in that comparative effectiveness, patient-centered outcomes, and stakeholder engagement drive scoring. Pure mechanistic science is a poor fit.',
  },

  /* Foundation */
  'foundation': {
    label: 'Private foundation (RWJ / Sloan / Pew / etc.)',
    agency: 'Private foundation',
    max_attempts: 99,
    intro_label: 'Response to Review (foundation-specific)',
    intro_pages: 2,
    response_convention: 'Foundation conventions vary. Most do not have a formal "Introduction" page but expect the resubmission cover letter to address prior critique. Foundations weight fit-with-mission, program-officer relationship, and grantee track record more than federal grants do. Talk to your program officer before drafting the resubmission.',
    quirks: 'No federal-style cap. Many foundations only invite resubmissions after a program officer signals interest. The "is this fundable here at all" question is the first one to answer.',
  },

  'other-federal': {
    label: 'Other federal (DOE / USDA / DOJ / etc.)',
    agency: 'Other federal agency',
    max_attempts: 2,
    intro_label: 'Response to Prior Review',
    intro_pages: 2,
    response_convention: 'Other federal mechanisms vary. Common pattern: a 1 to 2 page Response to Prior Review at the top of the technical narrative. Agency mission alignment is usually weighted; show explicit ties to the agency strategic plan and program priorities.',
    quirks: 'Submission-cycle rules vary by NOFO. Read the specific solicitation for resubmission language.',
  },
};

const VALID_MECHANISMS = new Set(Object.keys(MECHANISMS));
const VALID_ATTEMPTS = new Set([1, 2, 3]);

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

function attemptsRemaining(mech, attemptNumber) {
  const max = mech.max_attempts;
  if (max >= 99) return null; // unlimited; tone neutral
  return Math.max(0, max - attemptNumber);
}

function attemptStrategy(mech, attemptNumber) {
  const remaining = attemptsRemaining(mech, attemptNumber);
  if (remaining === null) {
    return 'No formal cap on submissions for this mechanism. Strategy: substantive resubmission only if the program officer has signaled willingness. Avoid burning the relationship by resubmitting without that signal.';
  }
  if (remaining === 0) {
    return 'THIS IS THE FINAL ALLOWED SUBMISSION. Strategy: conservative. Do not introduce new aims or new methods that re-trigger Approach scrutiny. Address every flagged concern visibly. If a critique is fundamentally unanswerable within scope, consider whether the right move is to submit as a new application next cycle instead.';
  }
  if (remaining === 1) {
    return 'One additional attempt remains after this one. Strategy: address every substantive critique now; do not save responses for the next round. Bigger swings on Significance or Innovation are still defensible because there is a safety net, but do not gamble Approach.';
  }
  return 'Multiple attempts remain. Strategy: this is the swing-bigger round. Substantively rework problem areas rather than patching. Take the bigger reframing if it is defensible.';
}

function buildSystemPrompt() {
  return `You are an expert academic grants consultant. Faculty hand you a reviewer Summary Statement from a federally funded grant that did not score well enough to fund. You read it the way a senior colleague would, the night before they sit down to draft the resubmission. You extract every critique, triage severity, draft response language in the convention the funding mechanism expects, and build the Introduction page the agency requires.

THIS IS GRANT-WRITING ASSISTANCE FROM A PEER, NOT AI-WRITING FROM SCRATCH. The faculty wrote the original application. You help them respond to specific critiques; you do not invent results, new aims, or pilot data they do not have.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "overall_assessment": {
    "rescuable": "yes" | "yes-with-major-rework" | "consider-new-submission",
    "headline": "<one to two sentence read on whether this is salvageable and what it would take>",
    "biggest_risk": "<one sentence: the critique most likely to sink the resubmission if not addressed>"
  },
  "attempt_strategy": "<two to four sentences: how to play this resubmission given how many attempts remain>",
  "critiques": [
    {
      "reviewer": "<R1 | R2 | R3 | Panel | Unknown>",
      "category": "<Significance | Investigators | Innovation | Approach | Environment | Overall Impact | Candidate | Career Development | Mentors | Training Plan | Commercialization | Stakeholder Engagement | Other>",
      "severity": "showstopper" | "major" | "minor",
      "critique": "<the critique restated in one to two sentences, faithful to what the reviewer said>",
      "response_draft": "<a 2 to 4 sentence response paragraph in the mechanism's expected convention. Open with acknowledgment, then the action taken, then a page or section anchor placeholder like [p. X] or [Aim 2, revised].>",
      "action_required": "<one phrase: 'new preliminary data' | 'reframing' | 'mentor team strengthening' | 'methodological clarification' | 'expanded sample' | 'stakeholder letter' | 'concede and deemphasize' | 'point-by-point clarification only' | 'no action needed, reviewer error'>"
    }
  ],
  "intro_page": {
    "label": "<the agency's name for this page, e.g. 'Introduction to Resubmission' or 'Response to Reviewers'>",
    "target_length": "<e.g. '1 page' or '2 pages'>",
    "draft": "<the full draft text of the Introduction page, in the mechanism's expected convention. Use the response_drafts above; do not contradict them. End with a 'Substantial Changes' summary if NIH-style.>"
  },
  "revision_plan": {
    "new_data_needed": ["<specific new analysis, pilot data, or aim addition>", "<another>", "..."],
    "reframe": ["<specific section to reframe>", "<another>"],
    "deemphasize_or_concede": ["<specific point to soften or drop>", "<another>"],
    "letters_of_support_needed": ["<specific letter type / source>", "..."]
  }
}

QUANTITY GUIDELINES
  - critiques: ONE entry per substantive critique. A typical NIH Summary Statement has 8 to 18 substantive critiques; a typical VA Summary Statement has 10 to 25. Do not collapse multiple critiques into one entry just to keep the list short.
  - revision_plan arrays: 2 to 6 items each; empty array is acceptable if nothing belongs there.

CONTENT RULES
  - DO NOT invent new data, new aims, new preliminary findings, new sample sizes. If the response requires data the PI does not have, write "[NEW DATA NEEDED: <what>]" in the response_draft instead of fabricating.
  - DO NOT invent reviewer text. Restate critiques in your own words faithfully; if the Summary Statement is too brief on a point, say so in the critique field rather than embellishing.
  - Triage honestly. A "showstopper" critique means the resubmission cannot succeed without addressing it (e.g., fundamental design flaw, missing IRB, irreconcilable feasibility concern). "Major" means scored down but addressable. "Minor" means stylistic, clarity, or housekeeping.
  - Group critiques by reviewer when the Summary Statement makes the source clear (R1, R2, R3, Panel, etc.). When unclear, use "Unknown".
  - "Consider-new-submission" is a real option. If the critiques fundamentally challenge the premise (wrong gap, wrong population, wrong framework), name it. The faculty deserves the honest read.
  - The Intro page draft must read like a real grant Introduction, not a list of bullets. Prose, paragraph-structured, mechanism-appropriate length.
  - No em dashes. Use commas, periods, or restructure. Em dashes are banned.
  - No marketing-cliche adjectives. "Robust", "leverage", "synergy", "novel" as filler are cut.
  - Voice: senior peer, direct, warm but honest. The faculty wants to know if this is fundable, not to be reassured.`;
}

function buildUserMessage(payload) {
  const { summary_statement, application_excerpt, mechanism, attempt_number, pi_concerns } = payload;
  const mech = MECHANISMS[mechanism];

  const lines = [];
  lines.push('MECHANISM: ' + mech.label);
  lines.push('AGENCY: ' + mech.agency);
  lines.push('MAX ATTEMPTS ALLOWED FOR THIS MECHANISM: ' + (mech.max_attempts >= 99 ? 'no formal cap' : mech.max_attempts));
  lines.push('THIS RESUBMISSION IS ATTEMPT NUMBER: ' + attempt_number);
  lines.push('ATTEMPTS REMAINING AFTER THIS ONE: ' + (mech.max_attempts >= 99 ? 'no cap' : Math.max(0, mech.max_attempts - attempt_number)));
  lines.push('');
  lines.push('MECHANISM RESPONSE CONVENTION:');
  lines.push(mech.response_convention);
  lines.push('');
  lines.push('MECHANISM QUIRKS:');
  lines.push(mech.quirks);
  lines.push('');
  lines.push('THE AGENCY CALLS THE INTRODUCTION PAGE: "' + mech.intro_label + '" (target length: ' + mech.intro_pages + ' page' + (mech.intro_pages > 1 ? 's' : '') + ')');
  lines.push('');
  lines.push('STRATEGIC GUIDANCE FOR THIS ATTEMPT:');
  lines.push(attemptStrategy(mech, attempt_number));
  lines.push('');
  lines.push('-------------------- REVIEWER SUMMARY STATEMENT --------------------');
  lines.push(summary_statement);
  lines.push('-------------------- END SUMMARY STATEMENT --------------------');

  if (application_excerpt) {
    lines.push('');
    lines.push('ORIGINAL APPLICATION EXCERPTS (for context; do not invent details outside this):');
    lines.push(application_excerpt);
  }

  if (pi_concerns) {
    lines.push('');
    lines.push("PI'S OWN FLAGGED CONCERNS AND PRIORITIES:");
    lines.push(pi_concerns);
  }

  lines.push('');
  lines.push('Produce the full resubmission package. Output ONLY the JSON object specified in the system prompt.');
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

function shapeCritique(c) {
  if (!c || typeof c !== 'object') return null;
  const SEV = new Set(['showstopper', 'major', 'minor']);
  return {
    reviewer: typeof c.reviewer === 'string' ? c.reviewer : 'Unknown',
    category: typeof c.category === 'string' ? c.category : 'Other',
    severity: SEV.has(c.severity) ? c.severity : 'major',
    critique: typeof c.critique === 'string' ? c.critique : '',
    response_draft: typeof c.response_draft === 'string' ? c.response_draft : '',
    action_required: typeof c.action_required === 'string' ? c.action_required : '',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod === 'GET') {
    // Expose the mechanism matrix so the UI can build the dropdown without
    // duplicating the list. Cheap to keep in sync.
    const mechs = Object.keys(MECHANISMS).map((k) => ({
      key: k,
      label: MECHANISMS[k].label,
      agency: MECHANISMS[k].agency,
      max_attempts: MECHANISMS[k].max_attempts,
    }));
    return json(200, { ok: true, mechanisms: mechs });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const summary_statement = String(body.summary_statement || '').trim().slice(0, MAX_STATEMENT_CHARS);
  if (!summary_statement || summary_statement.length < 100) return json(400, { error: 'summary_statement required (min 100 chars)' });

  const application_excerpt = String(body.application_excerpt || '').trim().slice(0, MAX_APP_CHARS);

  const mechanism = String(body.mechanism || '').trim().toLowerCase();
  if (!VALID_MECHANISMS.has(mechanism)) return json(400, { error: 'invalid mechanism', detail: 'unknown mechanism key: ' + mechanism });

  const attempt_number = parseInt(body.attempt_number, 10);
  if (!VALID_ATTEMPTS.has(attempt_number)) return json(400, { error: 'attempt_number must be 1, 2, or 3' });

  const pi_concerns = String(body.pi_concerns || '').trim().slice(0, MAX_CONCERNS_CHARS);

  const mech = MECHANISMS[mechanism];

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ summary_statement, application_excerpt, mechanism, attempt_number, pi_concerns });

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
    console.error('[resubmission-builder] anthropic error', err && err.message);
    return json(502, { error: 'build failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[resubmission-builder] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const RES = new Set(['yes', 'yes-with-major-rework', 'consider-new-submission']);

  const oa = (parsed.overall_assessment && typeof parsed.overall_assessment === 'object') ? parsed.overall_assessment : {};
  const ip = (parsed.intro_page && typeof parsed.intro_page === 'object') ? parsed.intro_page : {};
  const rp = (parsed.revision_plan && typeof parsed.revision_plan === 'object') ? parsed.revision_plan : {};
  const asArr = (v) => Array.isArray(v) ? v.slice(0, 10).map(String) : [];

  const result = stripEmDashes({
    mechanism: mech.label,
    agency: mech.agency,
    max_attempts: mech.max_attempts,
    attempt_number,
    attempts_remaining: mech.max_attempts >= 99 ? null : Math.max(0, mech.max_attempts - attempt_number),
    overall_assessment: {
      rescuable: RES.has(oa.rescuable) ? oa.rescuable : 'yes-with-major-rework',
      headline: typeof oa.headline === 'string' ? oa.headline : '',
      biggest_risk: typeof oa.biggest_risk === 'string' ? oa.biggest_risk : '',
    },
    attempt_strategy: typeof parsed.attempt_strategy === 'string' ? parsed.attempt_strategy : attemptStrategy(mech, attempt_number),
    critiques: Array.isArray(parsed.critiques) ? parsed.critiques.slice(0, 40).map(shapeCritique).filter(Boolean) : [],
    intro_page: {
      label: typeof ip.label === 'string' ? ip.label : mech.intro_label,
      target_length: typeof ip.target_length === 'string' ? ip.target_length : (mech.intro_pages + ' page' + (mech.intro_pages > 1 ? 's' : '')),
      draft: typeof ip.draft === 'string' ? ip.draft : '',
    },
    revision_plan: {
      new_data_needed: asArr(rp.new_data_needed),
      reframe: asArr(rp.reframe),
      deemphasize_or_concede: asArr(rp.deemphasize_or_concede),
      letters_of_support_needed: asArr(rp.letters_of_support_needed),
    },
  });

  return json(200, { ok: true, result });
};
