/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-reviewer-panel-run-background

   Background function. POSTed with { job_id, ...payload }. Runs the
   reviewer-panel fan-out (N parallel Anthropic calls), writes the final
   panel result to Netlify Blobs at key=job_id. Netlify returns 202 to the
   caller immediately; the actual work continues for up to 15 minutes.

   Companion: office-hours-reviewer-panel-status.js polls the blob for the
   result by job_id.

   Naming note: Netlify routes any function ending in `-background.js` to
   the background-function runtime automatically. The caller POSTs to
   /.netlify/functions/office-hours-reviewer-panel-run-background and gets
   202 back.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4500;
const MAX_PAPER_TEXT_CHARS = 60000;
const MAX_PDF_BYTES = 6_000_000;
const MAX_SME_CHARS = 400;
const MAX_JOURNAL_CHARS = 200;

const VALID_PAPER_TYPES = new Set(['primary', 'review', 'systematic-review', 'brief-report', 'case-report', 'perspective', 'methods']);

const PAPER_TYPE_NAMES = {
  'primary':           'Primary research article (empirical original research)',
  'review':            'Narrative review article',
  'systematic-review': 'Systematic review or meta-analysis',
  'brief-report':      'Brief report or short communication',
  'case-report':       'Case report or case series',
  'perspective':       'Perspective, commentary, or opinion piece',
  'methods':           'Methods paper',
};

/* Reviewer roster — same source of truth as the roster endpoint. */
const REVIEWERS = {
  vv: {
    name: 'Dr. Victoria Vance', role: 'The Methodologist',
    desc: 'Research design, variables, controls, and bias. If one gear is misaligned, the machine fails.',
    portrait_open: '/prep-room-assets/vv_open.jpg',
    portrait_closed: '/prep-room-assets/vv_closed.jpg',
    portrait_card: '/prep-room-assets/vv_card.jpg',
    persona: 'You are Dr. Victoria Vance, the Methodologist. You spend weekends in your home workshop calibrating antique drafting tools and mid-century mechanical clocks, and you treat methodology the same way: every component must justify its place or the machine fails. You have zero interest in a beautiful theory built on a flawed execution framework. Aggressively scrutinize research design, variables, controls, sampling, and potential biases. Precise, exacting, unsentimental; your voice is dry and structural and never inflated.',
  },
  lc: {
    name: 'Dr. Lawrence Cole', role: 'The Domain Expert',
    desc: 'Knows every major study and competing school. Tests whether you can contribute, not just summarize.',
    portrait_open: '/prep-room-assets/lc_open.jpg',
    portrait_closed: '/prep-room-assets/lc_closed.jpg',
    portrait_card: '/prep-room-assets/lc_card.jpg',
    persona: 'You are Dr. Lawrence Cole, the Domain Expert, fully embedded in this topic and its literature. You row open water in the morning and keep a meticulous handwritten field journal of seasonal bird migrations, and you bring that same patient archival mastery to the literature: you know every major study and every competing school going back decades. You are testing whether the candidate is ready to contribute to the field or is merely summarizing it. Probe nuances, hidden complexities, competing schools of thought, and any conflicting evidence in the literature. Warm but exacting; never combative for its own sake.',
  },
  mt: {
    name: 'Dr. Marcus Thorne', role: 'The Theorist',
    desc: 'An intellectual disruptor. Challenges your foundational assumptions to see if your logic holds.',
    portrait_open: '/prep-room-assets/mt_open.jpg',
    portrait_closed: '/prep-room-assets/mt_closed.jpg',
    portrait_card: '/prep-room-assets/mt_card.jpg',
    persona: 'You are Dr. Marcus Thorne, the Theorist, an intellectual disruptor who despises safe, predictable conclusions. You grew up in Chicago at a dinner table where a union-organizer father and an avant-garde painter mother treated challenging institutional authority as ordinary conversation, and you still seek out hostile mountain terrain on vacation because, in your phrase, comfort breeds intellectual rot. You care about paradigm shifts, conceptual sovereignty, and abstract reasoning. Deliberately challenge the foundational assumptions to see if the logic holds when the ground shifts. Provocative, philosophical, and unimpressed by elegant safety.',
  },
  mp: {
    name: 'Dr. Maya Patel', role: 'The Skeptic',
    desc: 'No patience for jargon or inflated claims. What is the real, scalable utility, and who benefits?',
    portrait_open: '/prep-room-assets/mp_open.jpg',
    portrait_closed: '/prep-room-assets/mp_closed.jpg',
    portrait_card: '/prep-room-assets/mp_card.jpg',
    persona: 'You are Dr. Maya Patel, the Skeptic. Your parents ran a medical-supply distribution company in Cleveland and you grew up watching them strip every shipment and supply chain to ruthless utility, and you bring that same lens to academic claims. You train two champion-bred rottweilers in agility trials and run a hyper-efficient hydroponic greenhouse, and you can spot a wasted square foot in either an argument or a garden bed. You have no patience for fluff, circular jargon, or inflated significance. Cut through nomenclature. Demand the real, scalable utility, and ask exactly who benefits. Blunt and efficiency-driven.',
  },
  cs: {
    name: 'Dr. Charles Sterling', role: 'The Supportive Editor',
    desc: 'A senior editor who frames the path forward without losing rigor. Reads for revisable structure.',
    portrait_open: '/prep-room-assets/cs_open.jpg',
    portrait_closed: '/prep-room-assets/cs_closed.jpg',
    portrait_card: '/prep-room-assets/cs_card.jpg',
    persona: 'You are Dr. Charles Sterling, a senior associate editor. Your father was a Presbyterian minister and your mother a social worker, and you carry their habit of mediating under pressure into every desk you sit at; you also play cello in a community chamber orchestra and you know exactly when to let a passage breathe. You facilitate, keep decorum, and still expect rigorous work. Ask structured, framing questions that let an author reset, clarify their core thesis, and reconnect conclusions to their original research questions. Where there is salvageable work, you find the revisable path forward and name it.',
  },
  az: {
    name: 'Dr. Alan Zhao', role: 'The Stats Hardliner',
    desc: 'A quantitative purist. Statistical power, sample size, error rates, p-values. No hand-waving.',
    portrait_open: '/prep-room-assets/az_open.jpg',
    portrait_closed: '/prep-room-assets/az_closed.jpg',
    portrait_card: '/prep-room-assets/az_card.jpg',
    persona: 'You are Dr. Alan Zhao, the Stats Hardliner. Your father did aerospace mathematics, your mother wrote statistical programs for a logistics firm, and in your San Francisco childhood numbers were how truth was spoken. You still play competitive chess and run custom predictive models on international soccer leagues for amusement; your household budget lives in shared, hyper-detailed spreadsheets. If a claim cannot be measured, modeled, and verified, it is anecdotal. Focus on statistical power, sample size, error rates, p-values, and any over-extrapolation of the data. Granular, logical, unforgiving on numbers, and never satisfied with hand-waving.',
  },
  mvg: {
    name: 'Dr. Meredith Vance-Giles', role: 'The Outside Reader',
    desc: 'From another discipline, with fresh eyes. Can you explain the value in plain terms?',
    portrait_open: '/prep-room-assets/mvg_open.jpg',
    portrait_closed: '/prep-room-assets/mvg_closed.jpg',
    portrait_card: '/prep-room-assets/mvg_card.jpg',
    persona: 'You are Dr. Meredith Vance-Giles, an outside-discipline reader brought in to ensure the work communicates beyond its niche. You grew up the daughter of US Foreign Service diplomats, moving to a new country every three years, and you developed a near-reflexive ability to walk into an unfamiliar room and read its structure from the outside; you bring that fresh-eyes test to academic work, sharpened on weekends by abstract photography and immersive cooking in remote regions. Examine whether the work communicates its value to an educated audience outside its niche. Broad, structural, focused on clarity in plain language, and unafraid to ask the obvious question.',
  },
  tk: {
    name: 'Dr. Tariq Khan', role: 'The Interdisciplinary Bridge',
    desc: 'A polymath. Is the thesis trapped in a silo, or do you see its broader ecosystem?',
    portrait_open: '/prep-room-assets/tk_open.jpg',
    portrait_closed: '/prep-room-assets/tk_closed.jpg',
    portrait_card: '/prep-room-assets/tk_card.jpg',
    persona: 'You are Dr. Tariq Khan, an interdisciplinary reviewer. You grew up in New York in a Pakistani-immigrant household where urban planning and classical music were dinner conversation, and you still play jazz saxophone, study amateur astronomy, and route long bicycle trips along geological fault lines because you cannot stop seeing how unrelated systems quietly connect. Look for cross-pollination and systems-level thinking, and challenge the work to look sideways: is the contribution trapped in an academic silo, or does the author understand its broader ecosystem? Lateral, comparative, and curious.',
  },
};

const VALID_REVIEWER_IDS = Object.keys(REVIEWERS);

function pickReviewers(paper_type) {
  switch (paper_type) {
    case 'primary':           return ['vv', 'lc', 'az'];
    case 'systematic-review': return ['az', 'lc', 'cs'];
    case 'review':            return ['lc', 'tk', 'mt'];
    case 'brief-report':      return ['vv', 'az', 'mp'];
    case 'case-report':       return ['cs', 'mvg', 'lc'];
    case 'perspective':       return ['mt', 'mp', 'mvg'];
    case 'methods':           return ['vv', 'az', 'tk'];
    default:                  return ['vv', 'lc', 'mvg'];
  }
}

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

function buildReviewerSystemPrompt(reviewer, payload) {
  const { paper_type, sme, journal } = payload;
  const lines = [];
  lines.push(reviewer.persona);
  lines.push('');
  lines.push('CURRENT TASK: You are serving as a peer reviewer for a journal submission. You have the paper in front of you. Read it with your characteristic voice and lens, write a structured reviewer report in the format below.');
  lines.push('');
  lines.push('PAPER METADATA');
  lines.push('Paper type: ' + PAPER_TYPE_NAMES[paper_type]);
  lines.push('Subject matter / discipline: ' + (sme || '[Infer from the paper]'));
  if (journal) lines.push('Target journal: ' + journal);
  lines.push('');
  lines.push('OUTPUT FORMAT (MANDATORY)');
  lines.push('You MUST return ONLY a JSON object with this exact shape, no prose before or after:');
  lines.push('{');
  lines.push('  "decision": "accept" | "minor-revisions" | "major-revisions" | "reject",');
  lines.push('  "score": <integer 1 to 10>,');
  lines.push('  "summary": "<two to three sentence reviewer summary>",');
  lines.push('  "strengths": ["<specific strength>", "<another>", "<another>"],');
  lines.push('  "major_issues": [ { "title": "<headline>", "detail": "<2-4 sentences with section anchors>", "actionable": "<one sentence on what the author can do>" } ],');
  lines.push('  "minor_issues": [ { "title": "<headline>", "detail": "<1-2 sentences>" } ],');
  lines.push('  "questions_for_authors": ["<question>", "<another>"],');
  lines.push('  "confidential_comments_to_editor": "<2-4 sentences for the editor only>"');
  lines.push('}');
  lines.push('');
  lines.push('QUANTITY: strengths 2 to 4; major_issues 2 to 6; minor_issues 2 to 8; questions_for_authors 3 to 7.');
  lines.push('');
  lines.push('CONTENT RULES');
  lines.push('  - Stay IN CHARACTER. Use your voice, your lens. Other reviewers cover other angles; do not try to cover all bases.');
  lines.push('  - Tie each issue to a SPECIFIC section, table, figure, or claim in the paper.');
  lines.push('  - DO NOT invent results, citations, or content not in the paper.');
  lines.push('  - Decision should reflect your lens honestly.');
  lines.push('  - Confidential-to-editor is candid: novelty, fit, replicability, anything you would only tell the editor.');
  lines.push('  - No em dashes. No marketing-cliche filler ("robust", "leverage", "synergy", "novel" as decoration).');
  return lines.join('\n');
}

function buildUserContent(payload) {
  const { paper_pdf, paper_text } = payload;
  const blocks = [];
  if (paper_pdf && paper_pdf.data) {
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: paper_pdf.data } });
    blocks.push({ type: 'text', text: 'The paper is attached above as a PDF. Read it carefully and produce your reviewer report. Return ONLY the JSON object specified.' });
  } else {
    blocks.push({ type: 'text', text: 'PAPER TEXT (pasted by the author):\n\n' + paper_text + '\n\nProduce your reviewer report. Return ONLY the JSON object specified.' });
  }
  return blocks;
}

function stripEmDashes(value) {
  if (typeof value === 'string') return value.replace(/—/g, ', ').replace(/–/g, ', ');
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = stripEmDashes(value[k]);
    return out;
  }
  return value;
}

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const first = text.indexOf('{'); const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(text.slice(first, last + 1)); } catch (_) {} }
  const fenced = text.replace(/```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(fenced); } catch (_) {}
  throw new Error('Could not parse JSON from model output');
}

const VALID_DECISIONS = new Set(['accept', 'minor-revisions', 'major-revisions', 'reject']);

function shapeIssue(it) {
  if (typeof it === 'string') return { title: it, detail: '', actionable: '' };
  if (!it || typeof it !== 'object') return null;
  return {
    title: typeof it.title === 'string' ? it.title : '',
    detail: typeof it.detail === 'string' ? it.detail : '',
    actionable: typeof it.actionable === 'string' ? it.actionable : '',
  };
}

function shapeReviewerReport(report, reviewerKey) {
  const r = REVIEWERS[reviewerKey];
  if (!r) return null;
  const decision = VALID_DECISIONS.has(report.decision) ? report.decision : 'major-revisions';
  const scoreNum = parseInt(report.score, 10);
  return {
    id: reviewerKey, name: r.name, role: r.role, desc: r.desc,
    portrait_open: r.portrait_open, portrait_closed: r.portrait_closed, portrait_card: r.portrait_card,
    decision, score: Number.isFinite(scoreNum) ? Math.max(1, Math.min(10, scoreNum)) : 5,
    summary: typeof report.summary === 'string' ? report.summary : '',
    strengths: Array.isArray(report.strengths) ? report.strengths.slice(0, 8).map(String) : [],
    major_issues: Array.isArray(report.major_issues) ? report.major_issues.slice(0, 10).map(shapeIssue).filter(Boolean) : [],
    minor_issues: Array.isArray(report.minor_issues) ? report.minor_issues.slice(0, 12).map(shapeIssue).filter(Boolean) : [],
    questions_for_authors: Array.isArray(report.questions_for_authors) ? report.questions_for_authors.slice(0, 10).map(String) : [],
    confidential_comments_to_editor: typeof report.confidential_comments_to_editor === 'string' ? report.confidential_comments_to_editor : '',
  };
}

function computeEditorDecision(reviewerReports) {
  if (!reviewerReports.length) return { consensus: 'major-revisions', consensus_basis: 'No reviews completed', avg_score: 0 };
  const order = ['reject', 'major-revisions', 'minor-revisions', 'accept'];
  const counts = {};
  reviewerReports.forEach((r) => { counts[r.decision] = (counts[r.decision] || 0) + 1; });
  const half = reviewerReports.length / 2;
  let consensus = null;
  for (const d of order) { if ((counts[d] || 0) > half) { consensus = d; break; } }
  if (!consensus) for (const d of order) { if (counts[d]) { consensus = d; break; } }
  const avg_score = Math.round(reviewerReports.reduce((s, r) => s + (r.score || 0), 0) / reviewerReports.length);
  const breakdown = order.filter((d) => counts[d]).map((d) => counts[d] + ' x ' + d).join(', ');
  return { consensus: consensus || 'major-revisions', consensus_basis: breakdown, avg_score };
}

async function writeStatus(jobId, status) {
  try {
    const store = getStore('reviewer_panel_jobs');
    await store.setJSON(jobId, { ...status, updated_at: Date.now() });
  } catch (err) {
    console.error('[reviewer-panel-bg] writeStatus failed for ' + jobId + ':', err && err.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  // Auth gate -- Lab Member required (no credit deduction; auth only)
  const token = extractToken(event.headers.authorization);
  if (!token) return json(401, { error: 'no_token', message: 'Sign in at /member-login to use Office Hours.' });
  const user = await getUser(token);
  if (!user) return json(401, { error: 'invalid_token', message: 'Your session has expired. Sign in again at /member-login.' });


  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const job_id = String(body.job_id || '').trim();
  if (!job_id || !/^[a-zA-Z0-9_-]{8,64}$/.test(job_id)) return json(400, { error: 'invalid job_id' });

  // Connect Blobs immediately and write a "queued" status, so the polling client sees something.
  try { connectLambda(event); } catch (err) {
    console.error('[reviewer-panel-bg] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }
  await writeStatus(job_id, { status: 'running', step: 'starting' });

  const apiKey = process.env.OFFICE_HOURS_API_KEY;
  if (!apiKey) {
    await writeStatus(job_id, { status: 'failed', error: 'ANTHROPIC_API_KEY not configured' });
    return json(500, { error: 'ANTHROPIC_API_KEY not configured' });
  }

  // Validate payload
  const paper_pdf = (body.paper_pdf && body.paper_pdf.data) ? body.paper_pdf : null;
  const paper_text = String(body.paper_text || '').trim().slice(0, MAX_PAPER_TEXT_CHARS);
  if (!paper_pdf && (!paper_text || paper_text.length < 200)) {
    await writeStatus(job_id, { status: 'failed', error: 'Either paper_pdf or paper_text (min 200 chars) required' });
    return json(400, { error: 'paper required' });
  }
  if (paper_pdf && (paper_pdf.data || '').length > MAX_PDF_BYTES) {
    await writeStatus(job_id, { status: 'failed', error: 'PDF too large' });
    return json(413, { error: 'pdf too large' });
  }

  const paper_type = String(body.paper_type || 'primary').trim().toLowerCase();
  if (!VALID_PAPER_TYPES.has(paper_type)) {
    await writeStatus(job_id, { status: 'failed', error: 'invalid paper_type' });
    return json(400, { error: 'invalid paper_type' });
  }
  const sme = String(body.sme || '').trim().slice(0, MAX_SME_CHARS);
  const journal = String(body.journal || '').trim().slice(0, MAX_JOURNAL_CHARS);

  let reviewerIds;
  if (Array.isArray(body.reviewers) && body.reviewers.length) {
    reviewerIds = body.reviewers.map((x) => String(x).toLowerCase()).filter((x) => VALID_REVIEWER_IDS.indexOf(x) >= 0);
    if (!reviewerIds.length) {
      await writeStatus(job_id, { status: 'failed', error: 'no valid reviewer ids' });
      return json(400, { error: 'no valid reviewer ids' });
    }
    reviewerIds = reviewerIds.slice(0, 5);
  } else {
    reviewerIds = pickReviewers(paper_type);
  }

  await writeStatus(job_id, { status: 'running', step: 'reviewers_started', reviewer_count: reviewerIds.length });

  const client = new Anthropic({ apiKey });
  const calls = reviewerIds.map(async (rid) => {
    const reviewer = REVIEWERS[rid];
    const system = buildReviewerSystemPrompt(reviewer, { paper_type, sme, journal });
    const userContent = buildUserContent({ paper_pdf, paper_text });
    try {
      const resp = await client.messages.create({
        model: MODEL, max_tokens: MAX_TOKENS, system,
        messages: [{ role: 'user', content: userContent }],
      });
      const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const parsed = extractJson(text);
      return shapeReviewerReport(parsed, rid);
    } catch (err) {
      console.error('[reviewer-panel-bg] reviewer ' + rid + ' failed:', err && err.message);
      return {
        id: rid, name: REVIEWERS[rid].name, role: REVIEWERS[rid].role, desc: REVIEWERS[rid].desc,
        portrait_open: REVIEWERS[rid].portrait_open, portrait_closed: REVIEWERS[rid].portrait_closed, portrait_card: REVIEWERS[rid].portrait_card,
        decision: null, score: null,
        summary: '[This reviewer could not complete the review. Try again.]',
        strengths: [], major_issues: [], minor_issues: [], questions_for_authors: [],
        confidential_comments_to_editor: '', error: (err && err.message) || 'unknown error',
      };
    }
  });

  const reviewerReports = (await Promise.all(calls)).filter(Boolean);
  if (!reviewerReports.length) {
    await writeStatus(job_id, { status: 'failed', error: 'all reviewers failed' });
    return json(502, { error: 'all reviewers failed' });
  }

  const completed = reviewerReports.filter((r) => r.decision);
  const editor_decision = computeEditorDecision(completed);

  const panel = stripEmDashes({
    paper_type: PAPER_TYPE_NAMES[paper_type],
    sme: sme || null, journal: journal || null,
    reviewer_ids: reviewerIds,
    reviewers: reviewerReports,
    editor_decision,
  });

  await writeStatus(job_id, { status: 'done', ok: true, panel, finished_at: Date.now() });
  return json(200, { ok: true, job_id });
};
