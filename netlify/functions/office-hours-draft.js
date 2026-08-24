/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-draft — generate a draft email reply or letter of
   recommendation for a faculty member.

   Public endpoint. NO authentication, NO server-side storage of any
   inputs or outputs. Every call processes the intake JSON through
   Anthropic's API and returns the draft text. Nothing is logged beyond
   Netlify's standard request log (which we do not control).

   Privacy posture (must remain true; surface on the page):
     - Faculty fill the form in their browser
     - Files (resume, transcript) parsed client-side; only the EXTRACTED
       TEXT travels to this function
     - Signature image + logo + faculty profile NEVER reach this function
       (they're applied client-side on export)
     - Anthropic does not train on API content and does not retain it

   POST /.netlify/functions/office-hours-draft
   Body: {
     mode: 'email-reply' | 'lor',
     intake: { ... see intake schema below ... }
   }

   Response: { ok: true, draft: '<plain-text draft>', word_count: int }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2400;
const VALID_MODES = new Set(['email-reply', 'lor']);

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

function buildEmailReplySystemPrompt() {
  return `You are drafting a faculty member's reply to a student email. You are NOT the faculty member; you are a writing assistant producing a draft they will review, edit, and send themselves.

VOICE
  - Match the tone the faculty member specified (warm / formal / direct / "letting them down gently"). Use professional academic register; no marketing-cliche language.
  - Speak in the FIRST PERSON as the faculty member (they sign and send it).
  - No em dashes. Use periods, commas, or restructure. The faculty member has a banned-list and em dashes are on it.
  - Address the student by their first name in the opening if known.
  - End with a clear next step or close. Do not leave the student hanging.

CONTENT RULES
  - Anchor every claim in something the faculty member can substantiate. If the resume or transcript is provided, you may reference specific evidence ("your A in 305", "your work on the protein-folding project"). Do NOT invent grades, project titles, or experiences.
  - If the inbound email asked a specific question, answer it directly in the first or second paragraph.
  - If the faculty's relationship is "never met" or "brief interaction", the reply should reflect that honestly. Do not feign familiarity.
  - If the faculty marked the tone as "letting them down gently", you may decline the request, but always do so kindly and with a constructive alternative or pointer.
  - Respect the length setting: "one paragraph" = a single coherent paragraph, ~80 words. "Full reply" = 150-250 words. "Two versions" = produce two complete reply drafts separated by the literal line "--- VERSION 2 ---" so the faculty can pick.
  - Include a sign-off ("Best," / "All best," / "Best regards,") matching the tone, followed by a placeholder for the faculty's name: [Your name]. Do not embed any specific name in the sign-off.

OUTPUT
  Return ONLY the email body text. No JSON. No commentary before or after. No subject line unless the faculty asked for one. Plain text with blank lines between paragraphs.`;
}

function buildLorSystemPrompt() {
  return `You are drafting a faculty member's letter of recommendation. You are a writing assistant; the faculty member will review, edit, sign, and send it.

VOICE
  - Match the recommendation tier the faculty selected:
    * "cannot recommend without reservation" — honest, restrained, names concerns the faculty noted, frames the candidate's strengths in narrow scope
    * "i recommend" — solid, specific, no superlatives, finds genuine strengths
    * "i strongly recommend" — confident, comparative-favorable, concrete evidence
    * "i enthusiastically recommend" — top-tier, "one of the best i have supervised", uses ranking/percentile if provided
  - First-person from the faculty member. Past or present tense as appropriate to the relationship.
  - Professional academic letter register. No marketing-cliche adjectives.
  - No em dashes (use periods, commas, or restructure).

STRUCTURE
  - Opening paragraph: state the tier sentence directly (e.g. "I enthusiastically recommend [Student] for [Program]."), how the faculty knows the student, how long, in what context.
  - Body: 2-4 paragraphs of specific evidence. Use the anecdotes box VERBATIM as raw material — rewrite the faculty's notes into prose without losing the specifics. If percentile + cohort were provided, work them in naturally ("in the top 10% of students I have advised in my graduate methods course over the last five years").
  - If the faculty flagged a weakness to address (and FERPA waiver allows candor), address it honestly with framing that contextualizes rather than dwells.
  - Closing paragraph: tie the candidate's strengths to the specific target program / role. State the faculty member's availability for follow-up contact.
  - Length: respect the cap (page count or word count) the faculty supplied. If no cap was given, target 400-600 words.

CONTENT RULES
  - Never invent quotes, grades, project titles, awards, or comparison data. Use only what the faculty provided.
  - The candidate's resume/transcript text is reference material; quote only when the faculty member would have observed it directly.
  - Address the letter to whoever the faculty specified (specific committee, or "To Whom It May Concern" if generic).
  - End with the standard letter close: a sign-off line, then a blank line, then a placeholder block:
    [Your name]
    [Your title]
    [Your department]
    [Your university]
    [Your email]

OUTPUT
  Return ONLY the letter body text. No JSON. No commentary before or after. Plain text with blank lines between paragraphs. Include the date stamp on its own line at the top (use "[Today's date]" as a placeholder; the export pass fills it in client-side).`;
}

function buildEmailReplyUserMessage(intake) {
  const lines = [];
  lines.push('FACULTY CONTEXT');
  lines.push(`  Student level: ${intake.student_level || '(not specified)'}`);
  lines.push(`  Student name: ${intake.student_name || '(not specified)'}`);
  lines.push(`  What they are asking for: ${intake.ask_type || '(not specified)'}`);
  lines.push(`  My relationship to this student: ${intake.relationship || '(not specified)'}`);
  lines.push(`  Tone I want: ${intake.tone || 'warm'}`);
  lines.push(`  Length: ${intake.length || 'full reply'}`);
  if (intake.deadline) lines.push(`  Deadline / urgency: ${intake.deadline}`);
  if (intake.special_notes) {
    lines.push('');
    lines.push('MY VOICE / SPECIAL NOTES (the faculty member to you, the assistant)');
    lines.push(`  ${intake.special_notes}`);
  }
  if (intake.resume_text) {
    lines.push('');
    lines.push('STUDENT RESUME (extracted text, reference only)');
    lines.push(intake.resume_text.slice(0, 4000));
  }
  if (intake.transcript_text) {
    lines.push('');
    lines.push('STUDENT TRANSCRIPT (extracted text, reference only)');
    lines.push(intake.transcript_text.slice(0, 4000));
  }
  lines.push('');
  lines.push('INBOUND STUDENT EMAIL (the message I am replying to)');
  lines.push(intake.inbound_email || '(no inbound email provided)');
  lines.push('');
  lines.push('Draft my reply. Output ONLY the email body text.');
  return lines.join('\n');
}

function buildLorUserMessage(intake) {
  const lines = [];
  lines.push('FACULTY CONTEXT');
  lines.push(`  Student name: ${intake.student_name || '(not specified)'}`);
  lines.push(`  Student level: ${intake.student_level || '(not specified)'}`);
  lines.push(`  Target program / role: ${intake.target_program || '(not specified)'}`);
  lines.push(`  Addressee: ${intake.addressee || 'To Whom It May Concern'}`);
  lines.push(`  Application deadline: ${intake.deadline || '(not specified)'}`);
  lines.push(`  Length cap: ${intake.length_cap || '(none specified — target 400-600 words)'}`);
  lines.push(`  Recommendation tier: ${intake.tier || 'i recommend'}`);
  lines.push(`  How well I know this student (1-5): ${intake.know_level || '(not specified)'}`);
  if (intake.percentile && intake.cohort) {
    lines.push(`  Percentile rank: top ${intake.percentile}% of ${intake.cohort}`);
  } else if (intake.percentile) {
    lines.push(`  Percentile rank: top ${intake.percentile}% (cohort unspecified)`);
  }
  lines.push(`  FERPA waiver: ${intake.ferpa_waived ? 'student WAIVED right to view — candor permitted' : 'student did NOT waive right to view — letter may be read by student'}`);
  if (intake.strengths) {
    lines.push('');
    lines.push('STRENGTHS TO EMPHASIZE');
    lines.push(`  ${intake.strengths}`);
  }
  if (intake.weaknesses && intake.ferpa_waived) {
    lines.push('');
    lines.push('WEAKNESSES TO ADDRESS HONESTLY (FERPA-waiver permits)');
    lines.push(`  ${intake.weaknesses}`);
  }
  if (intake.anecdotes) {
    lines.push('');
    lines.push('SPECIFIC ANECDOTES / EVIDENCE (raw notes from faculty — rewrite into prose)');
    lines.push(intake.anecdotes);
  }
  if (intake.special_notes) {
    lines.push('');
    lines.push('MY VOICE / SPECIAL NOTES');
    lines.push(`  ${intake.special_notes}`);
  }
  if (intake.resume_text) {
    lines.push('');
    lines.push('STUDENT RESUME (extracted text, reference only)');
    lines.push(intake.resume_text.slice(0, 4000));
  }
  if (intake.transcript_text) {
    lines.push('');
    lines.push('STUDENT TRANSCRIPT (extracted text, reference only)');
    lines.push(intake.transcript_text.slice(0, 4000));
  }
  lines.push('');
  lines.push('Draft the letter. Output ONLY the letter body text with the date placeholder at the top.');
  return lines.join('\n');
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

  const mode = String(body.mode || '').trim().toLowerCase();
  if (!VALID_MODES.has(mode)) return json(400, { error: 'mode must be email-reply or lor' });

  const intake = (body.intake && typeof body.intake === 'object') ? body.intake : {};

  const system = mode === 'email-reply' ? buildEmailReplySystemPrompt() : buildLorSystemPrompt();
  const userMsg = mode === 'email-reply' ? buildEmailReplyUserMessage(intake) : buildLorUserMessage(intake);

  const client = new Anthropic({ apiKey });
  let draft;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    draft = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    // Strip em dashes the model might have slipped in despite the rule.
    draft = draft.replace(/—/g, ', ').replace(/–/g, ', ');
  } catch (err) {
    console.error('[office-hours-draft] anthropic error', err && err.message);
    return json(502, { error: 'draft generation failed', detail: err && err.message });
  }

  if (!draft) return json(502, { error: 'empty draft returned' });

  const word_count = draft.split(/\s+/).filter(Boolean).length;
  return json(200, { ok: true, mode, draft, word_count });
};
