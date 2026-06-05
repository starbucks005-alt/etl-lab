/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-tenure-dossier

   Tenure Dossier Helper: faculty member pastes a CV, picks an institution
   type and discipline, names strengths and concerns. Tool returns draft
   narratives for the three standard dossier sections:
     - Teaching statement
     - Research statement
     - Service statement
   Plus a summary of how the case reads and a strategic guidance note.

   No web_search. Text-only. Lives within proxy timeout budgets.

   POST /.netlify/functions/office-hours-tenure-dossier
   Body: {
     cv: '<CV as plain text>',
     institution: 'r1' | 'r2' | 'slac' | 'teaching-focused' | 'medical-school' | 'professional-school' | 'community-college',
     discipline: '<field>',
     stage: 'early' | 'mid' | 'final' | 'reappointment',
     strengths: '<faculty-flagged strengths>',
     concerns: '<faculty-flagged concerns / gaps>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 6000;
const MAX_CV_CHARS = 20000;
const MAX_DISCIPLINE_CHARS = 200;
const MAX_STRENGTHS_CHARS = 4000;
const MAX_CONCERNS_CHARS = 4000;
const VALID_INSTITUTIONS = new Set(['r1', 'r2', 'slac', 'teaching-focused', 'medical-school', 'professional-school', 'community-college']);
const VALID_STAGES = new Set(['early', 'mid', 'final', 'reappointment']);

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

function institutionFraming(inst) {
  switch (inst) {
    case 'r1':
      return 'R1 RESEARCH UNIVERSITY. Research carries the case; expected: funded research portfolio (federal funding the norm at most R1s), strong publication record in venues appropriate to the field, evidence of national or international reputation (invited talks, study sections, editorial roles). Teaching needs to be at least adequate and ideally show some signature contribution; teaching DOES NOT compensate for a weak research record. Service should be appropriate for rank: substantial departmental, present at university level, emerging at national level.';
    case 'r2':
      return 'R2 RESEARCH UNIVERSITY. Research is central but the bar is lower than R1; expected: regular publication, external funding (federal preferred but state/foundation acceptable), beginning to build national profile. Teaching matters more proportionally than at R1; signature courses and good evaluations are evaluated seriously. Service balanced across departmental and university.';
    case 'slac':
      return 'SELECTIVE LIBERAL ARTS COLLEGE. Teaching and research carry roughly equal weight, with TEACHING + ADVISING often the heart of the case. Expected: distinctive teaching (signature courses, evals trajectory, advising track record including senior theses and post-graduation outcomes), a coherent scholarly trajectory (book trajectory in humanities; sustained article portfolio + maybe one major external grant in sciences; in arts: exhibitions/performances/commissions), and substantial service to college and faculty governance. National service is appreciated but not required.';
    case 'teaching-focused':
      return 'TEACHING-FOCUSED 4-YEAR (regional comprehensive). Teaching is the case. Expected: distinctive teaching across course types (general education, major-required, capstone), curriculum or pedagogy innovation, sustained strong evaluations or evidence of trajectory, advising load. Scholarship: evidence of an active, current scholar (some publications, presentations, maybe a small grant), not a research portfolio. Service: substantial, sustained, university-and-community.';
    case 'medical-school':
      return 'MEDICAL SCHOOL / ACADEMIC HEALTH CENTER. Tenure norms vary widely by school but typically: research effort (with funding) is the spine, clinical effort is expected but kept below a threshold (often 30-50%), and educational/administrative contributions are valued. For tenure-track faculty: NIH R01 or equivalent is often the de facto bar; for clinician-educator track: educational leadership and clinical innovation can carry the case. Service: substantial within institution; emerging nationally.';
    case 'professional-school':
      return 'PROFESSIONAL SCHOOL (business, law, engineering, etc.). Standards vary widely by discipline within professional schools. Generally: scholarship in field-appropriate venues, practice or industry engagement valued (case studies, advisory roles, applied research), teaching of practitioner-students considered, service substantial at school and field levels. Be careful not to apply arts-and-sciences norms.';
    case 'community-college':
      return 'COMMUNITY COLLEGE. Teaching is the case, full stop. Expected: distinctive teaching across course levels and modalities (in-person, hybrid, online), evidence of student success including completion and transfer outcomes, curricular development, advising, equity work. Scholarship optional; if present, valued as pedagogical scholarship or applied work. Service: substantial within institution and to the community college mission.';
    default:
      return 'Unspecified institution type. Use generally applicable tenure norms.';
  }
}

function stageFraming(stage) {
  switch (stage) {
    case 'early':
      return 'EARLY (3 or more years out). Narratives should establish the trajectory the candidate is on. Emphasize the architecture of the case being built. Acknowledge that some milestones are still in progress.';
    case 'mid':
      return 'MID (1-2 years out). Narratives should look more finished. The trajectory is now mostly visible; the dossier should read as a candidate whose case is coming together. Address known gaps directly, frame them as in-progress where honest.';
    case 'final':
      return 'FINAL YEAR (going up this cycle). Narratives are the actual draft for submission. Every sentence has to earn its place. Strengths get the strongest framing; concerns get the most honest and best-defended framing. Strategic guidance should be sharp.';
    case 'reappointment':
      return 'REAPPOINTMENT / PRE-TENURE REVIEW. Narratives should demonstrate progress against the appointment letter expectations and signal a clear path to tenure. More forward-looking than a tenure dossier; less defensive.';
    default:
      return 'Unspecified stage.';
  }
}

function buildSystemPrompt() {
  return `You are Tenure Dossier Helper, a writing assistant for a faculty member preparing tenure dossier narratives. You produce DRAFT narratives the faculty will edit and own. You are not the candidate; you are drafting at their elbow.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": "<one to two sentences: how this case reads at this institution type at this stage>",
  "teaching_narrative": {
    "title": "<short evocative title for the teaching statement, in the candidate's voice>",
    "draft": "<3 to 5 paragraph prose draft of the teaching statement>",
    "key_points": ["<talking point 1>", "<talking point 2>", ...]
  },
  "research_narrative": {
    "title": "<short evocative title>",
    "draft": "<3 to 5 paragraph prose draft>",
    "key_points": ["<talking point 1>", ...]
  },
  "service_narrative": {
    "title": "<short evocative title>",
    "draft": "<3 to 5 paragraph prose draft>",
    "key_points": ["<talking point 1>", ...]
  },
  "overall_guidance": "<2 to 4 sentences of strategic guidance for the candidate as they finalize the dossier>"
}

NARRATIVE LENGTHS (calibrate by institution; these are targets, not hard caps)
  - R1: 600-900 words per narrative
  - R2: 500-800 words per narrative
  - SLAC: 600-900 words per narrative, with teaching narrative often the longest
  - Teaching-focused: 700-1000 words for teaching; 400-700 for research and service
  - Medical school: 500-800 per narrative
  - Professional school: 500-800 per narrative
  - Community college: 800-1200 for teaching; shorter on others

VOICE
  - Write in the FIRST PERSON as the candidate would write it. Confident but not boastful. Evidence-rich; specific over general.
  - Use the candidate's CV details verbatim where possible (specific course titles, grant numbers, paper titles, advisee counts, award names).
  - No marketing-cliche language. No "leverage" "synergy" "passionate" "robust" as fillers. No empty modifiers ("very", "extremely").
  - No em dashes. Use commas, periods, or restructure. Em dashes are on the faculty's banned list.
  - Each narrative should have one clear THROUGH-LINE (the candidate's central argument about themselves in that domain), not a kitchen-sink list.

CONTENT RULES
  - The CV is your evidence base. Do NOT invent grants, papers, courses, awards, or service the candidate doesn't have. If a strength is missing from the CV, you may use the candidate's strengths field to inform framing but only if it points to evidence the candidate could substantiate.
  - The candidate's CONCERNS field tells you what they know reviewers will find. Address each material concern in the narrative where it lives (teaching gap in teaching narrative, etc.) with HONEST framing: name it, contextualize it, point to the trajectory. Do not pretend concerns don't exist.
  - Tailor every narrative to the institution type using the framing provided. Do not write an R1 research narrative for a teaching-focused candidate.
  - KEY POINTS are bullet talking-points the candidate can use in their committee meeting or in an informal pre-dossier conversation. 3-5 per narrative. Specific, evidence-anchored, defensive-of-the-case.
  - OVERALL GUIDANCE is the candidate's friend, not their consultant. One or two sharp observations + one or two actionable suggestions. No fluff.

WHAT TO AVOID
  - Do not assume any milestone the CV doesn't show.
  - Do not gloss over concerns; the dossier will be read by people who notice them too.
  - Do not over-claim importance ("groundbreaking", "field-defining") unless the CV evidence (e.g., Nature paper, named chair, major prize) genuinely warrants it.
  - Do not write narratives that could apply to any candidate. Specificity is the whole point.`;
}

function buildUserMessage(payload) {
  const { cv, institution, discipline, stage, strengths, concerns } = payload;
  const lines = [];
  lines.push('CANDIDATE CV (pasted by the faculty member):');
  lines.push(cv);
  lines.push('');
  lines.push('--------------------------- CASE METADATA ---------------------------');
  lines.push('INSTITUTION TYPE: ' + institution);
  lines.push('INSTITUTION FRAMING: ' + institutionFraming(institution));
  lines.push('');
  if (discipline) lines.push('DISCIPLINE: ' + discipline);
  lines.push('STAGE: ' + stage);
  lines.push('STAGE FRAMING: ' + stageFraming(stage));
  lines.push('');
  if (strengths) {
    lines.push('STRENGTHS the candidate wants emphasized:');
    lines.push(strengths);
    lines.push('');
  }
  if (concerns) {
    lines.push('CONCERNS / GAPS the candidate knows about (address honestly):');
    lines.push(concerns);
    lines.push('');
  }
  lines.push('Draft the three narratives. Output ONLY the JSON object specified in the system prompt.');
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

function shapeNarrative(n) {
  if (!n || typeof n !== 'object') return null;
  return {
    title: typeof n.title === 'string' ? n.title : '',
    draft: typeof n.draft === 'string' ? n.draft : '',
    key_points: Array.isArray(n.key_points) ? n.key_points.slice(0, 8).map(String) : [],
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

  const cv = String(body.cv || '').trim().slice(0, MAX_CV_CHARS);
  if (!cv) return json(400, { error: 'cv required' });

  const institution = String(body.institution || 'r1').trim().toLowerCase();
  if (!VALID_INSTITUTIONS.has(institution)) return json(400, { error: 'invalid institution' });

  const discipline = String(body.discipline || '').trim().slice(0, MAX_DISCIPLINE_CHARS);
  const stage = String(body.stage || 'mid').trim().toLowerCase();
  if (!VALID_STAGES.has(stage)) return json(400, { error: 'invalid stage' });

  const strengths = String(body.strengths || '').trim().slice(0, MAX_STRENGTHS_CHARS);
  const concerns = String(body.concerns || '').trim().slice(0, MAX_CONCERNS_CHARS);

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ cv, institution, discipline, stage, strengths, concerns });

  const client = new Anthropic({ apiKey });
  let modelOutput;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      // No web_search: keeps round-trip under proxy timeout. Narratives are
      // grounded in the CV the candidate pasted, not in external literature.
      messages: [{ role: 'user', content: userMsg }],
    });
    modelOutput = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[tenure-dossier] anthropic error', err && err.message);
    return json(502, { error: 'dossier generation failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[tenure-dossier] json parse failed. raw output head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const dossier = stripEmDashes({
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    teaching_narrative: shapeNarrative(parsed.teaching_narrative),
    research_narrative: shapeNarrative(parsed.research_narrative),
    service_narrative: shapeNarrative(parsed.service_narrative),
    overall_guidance: typeof parsed.overall_guidance === 'string' ? parsed.overall_guidance : '',
  });

  return json(200, { ok: true, dossier });
};
