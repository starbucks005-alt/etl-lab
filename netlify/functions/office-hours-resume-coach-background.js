/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-resume-coach-background

   Unified background function for the Résumé Coach. Three jobs share one
   pipeline because they all need the same blob-polling pattern to defeat
   Netlify's 26s sync-function timeout:

     kind = 'brief'   → Charles reads the CV and produces the coaching brief.
     kind = 'rewrite' → Charles closes the session: scorecard + restructured CV.
     kind = 'polish'  → Bea line-edits the CV (CMOS, preserves bullet fragments).

   Companion: office-hours-resume-coach-status.js polls the blob by job_id.

   POST body: { job_id, kind, payload: { ...kind-specific fields } }
   Writes result to Netlify Blobs store 'resume_coach_jobs' under job_id.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';

/* ─── audience prefix (mirror of prep-room.html audiencePrefix) ─── */
function audiencePrefix(audience) {
  if (audience === 'pros') {
    return 'AUDIENCE CONTEXT: this user is a mid-career or senior professional ' +
           '(not a student). Speak peer to peer. Skip the teaching framing. Be ' +
           'direct, no hand-holding, no "good question" affirmations. Assume ' +
           'they understand the basics and are here for the gap you can name ' +
           'that they cannot see in themselves. Executive-coach register. ';
  }
  return 'AUDIENCE CONTEXT: this user is a student or early-career learner. ' +
         'Teach as you push back. Frame what a strong answer looks like before ' +
         'or after a hard question lands. Scaffolded, formative, committee-chair ' +
         'register. Honest about gaps without being crushing. ';
}

/* ─── resume audience rules (mirror) ─── */
function resumeAudienceRules(audience) {
  if (audience === 'pros') {
    return 'PROFESSIONAL CV RULES: this is a mid-career or senior candidate. ' +
           'Length expectations vary by sector: corporate (2-3 pages), academic ' +
           '(10-25 pages is normal for full CVs), nonprofit (2-4 pages), government ' +
           '(5+ pages for federal-style). Do NOT default to "2 pages max." When ' +
           'they push back about length or content, re-read what is actually in the ' +
           'document; do not invent. Skip teaching the basics. Focus on the gap ' +
           'they cannot see in themselves: undersold leadership scope, missing P&L ' +
           'numbers, board service buried in bullet form, institutional ' +
           'transformations reduced to a verb. Hold them to the right sector ' +
           'standard, not corporate-by-default.';
  }
  return 'STUDENT CV RULES: this is a student or early-career learner. Length ' +
         'expectations: 1-2 pages for most early-career formats; graduate students ' +
         'may stretch to 3 with publications. Teach the principles AS you review.';
}

/* ─── focus directive (mirror) ─── */
function focusDirective(focusMode, focusValue, jdText) {
  if (focusMode === 'job' && jdText) {
    return 'REVIEW PURPOSE: this review is for a SPECIFIC JOB. A job description has been provided. Judge the CV by FIT to that role: what the document is arguing vs. what the role needs, what to elevate, what to cut, what to add.';
  }
  if (focusMode === 'focus' && focusValue) {
    return 'REVIEW PURPOSE: this review is for a SPECIFIC AUDIENCE OR POSITIONING — "' + focusValue + '". The CV is not being matched to a posted job. Judge the document by how well it currently SPEAKS TO that audience: which sections lead, which sections support, which content should be foregrounded, which should be softened or moved later, what gaps an audience-aware reader would notice. Do NOT invent content. If the document is missing something the focus would call for, name it as a gap; never fabricate.';
  }
  return 'REVIEW PURPOSE: this is a GENERAL CLEANUP, no specific job and no specific focus. Judge the CV on its own merits: argument clarity, evidence quality, length appropriate to sector, three-sentence Professional Summary, substance over fluff. Recommend cuts, amplifications, and structural fixes that improve the document for any audience.';
}

/* ─── prompts: BRIEF (Charles) ─── */
function buildBriefPrompts({ audience, focusMode, focusValue, docText, clText, jdText }) {
  const sys = resumeAudienceRules(audience) + '\n\n' +
    focusDirective(focusMode, focusValue, jdText) + '\n\n' +
    'You are the Résumé Coach\'s reading assistant. Produce a TIGHT brief that the coach will speak from. Honest, specific, no flattery, anchored on Dr. Oroszi\'s CV philosophy: a CV is an argument for a specific role; length is the wrong question (Two-CV Tactic: short and long); the Professional Summary is exactly three sentences (who you are, what you have done, what you are looking for); competencies must be earned by evidence; substance over fluff. ' +
    'SECTOR-AWARE RUBRIC: Academic budget authority often appears as "co-led" or "stewarded" — it still counts. Federal advisory boards, national professional society leadership, and 501(c)(3) chairs count as board experience. Academic CVs of 10-25 pages may already be the targeted short version. The honesty bar still applies. ' +
    'FORMATTING: Output PLAIN TEXT only. Each labeled section begins on its own line with the label in ALL CAPS followed by a colon. ONE BLANK LINE between sections. For sections that take bullets, put each bullet on its own line starting with "• ". ' +
    'Sections, in this exact order: CURRENT ARGUMENT: (one sentence). TARGET ROLE: (from input, or "not specified"). SECTOR: (Corporate / Academic / Nonprofit/Mission-Driven / Government / Hybrid). FIT: (1-3 sentences). LENGTH STANCE: (1-3 sentences anchored on the Two-CV Tactic). PROFESSIONAL SUMMARY: (1-3 sentences). EVIDENCE GAPS: (3-6 bullets). CUTS: (3-6 bullets). AMPLIFY: (3-6 bullets). COVER LETTER NOTES: (2-4 bullets, or "Not provided."). OPEN QUESTION: (one short prompt). Keep under 550 words total.';

  const user = 'CANDIDATE CV:\n\n' + docText.slice(0, 60000)
    + (clText ? '\n\nCOVER LETTER:\n\n' + clText.slice(0, 8000) : '')
    + (focusMode === 'job' && jdText ? '\n\nJOB DESCRIPTION:\n\n' + jdText.slice(0, 8000) : '')
    + (focusMode === 'focus' && focusValue ? '\n\nFOCUS / AUDIENCE FOR THIS REVIEW:\n\n' + focusValue : '')
    + (focusMode === 'general' ? '\n\nNo specific job or focus — general cleanup.' : '');

  return { sys, user, max_tokens: 1600 };
}

/* ─── prompts: REWRITE (Charles closes session) ─── */
function buildRewritePrompts({ audience, focusMode, focusValue, docText, clText, jdText, brief, transcript }) {
  let purposeLine;
  if (focusMode === 'job' && jdText) purposeLine = '\n\nReview purpose: tailored to a specific job.';
  else if (focusMode === 'focus' && focusValue) purposeLine = '\n\nReview purpose: positioning for "' + focusValue + '". Restructure so it speaks to that audience; never invent.';
  else purposeLine = '\n\nReview purpose: general cleanup.';

  const sys = audiencePrefix(audience) + '\n\n' + resumeAudienceRules(audience) + '\n\n' +
    'You are Charles Monroe, Associate Director of Career Services, closing out a coaching session with a ' + (audience === 'pros' ? 'mid-career or senior professional' : 'student') + '. You have already delivered a structured review and had a chat. Now produce: (1) a short verdict on the document\'s current argument; (2) a 5-category scorecard (1=needs work, 5=strong) covering CLARITY OF ARGUMENT, EVIDENCE BEHIND CLAIMS, LENGTH & SHAPE, PROFESSIONAL SUMMARY, SUBSTANCE OVER FLUFF; (3) a 3-6 item prioritized fix list in order; (4) an UPDATED CV restructuring the student\'s material into a sharper, more argument-focused document; (5) if the student provided a cover letter, an UPDATED cover letter. ' +
    'SECTOR-AWARE SCORING: Academic budget authority often appears as "co-led" or "stewarded" — it counts. Board experience includes federal advisory boards, national professional society officer roles, and 501(c)(3) chairs. Academic CVs of 10-25 pages may already be the short version. The honesty bar still applies. ' +
    'HARD RULES on the updated CV and cover letter: Use ONLY what the student stated in the original CV, the original cover letter, the chat transcript, and the brief. DO NOT invent employers, dates, titles, numbers, schools, accomplishments, or claims that are not present in their own words. If a quantifiable detail is not present, leave it general rather than fabricating a number. Preserve the student as the author; you are organizing their own words. The Professional Summary must be EXACTLY three sentences. ' +
    'Return ONLY valid JSON, no markdown, in this exact shape: {"verdict":"string","categories":[{"name":"string","score":1-5,"note":"one specific sentence"}],"drill":["string","string","string"],"updated_cv":{"name":"string","contact":"string","summary":"three sentences","education":["string"],"experience":[{"title":"string","org":"string","dates":"string","bullets":["string"]}],"projects":["string"],"skills":["string"]},"updated_cover_letter":"string with paragraphs separated by \\n\\n, or empty string if none was provided"}';

  const user = 'Original CV:\n\n' + docText.slice(0, 60000)
    + (clText ? '\n\nOriginal cover letter:\n\n' + clText.slice(0, 8000) : '')
    + (focusMode === 'job' && jdText ? '\n\nTarget role / job description:\n\n' + jdText.slice(0, 8000) : '')
    + (focusMode === 'focus' && focusValue ? '\n\nFocus / audience for this review:\n\n' + focusValue : '')
    + purposeLine
    + '\n\nCoaching brief:\n\n' + brief
    + '\n\nSession transcript:\n\n' + (transcript || '(no chat turns)');

  return { sys, user, max_tokens: 24000 };
}

/* ─── prompts: POLISH (Bea) ─── */
function buildPolishPrompts({ docText }) {
  const sys = 'You are Beatriz — "Bea" — a senior copy editor at Greylander Press, on loan to the Office Hours Résumé Coach. Reference-desk librarian energy: precise, well-read, warm but exact. You read CMOS for fun. ' +
    'You are doing a CV LINE EDIT, not a manuscript line edit. A CV is structurally different from prose: bullets are intentionally fragmentary (no full sentences required), headers and dates need consistent formatting, and parallel structure across bullets matters more than flow. ' +
    'YOUR JOB: fix mechanical issues only. Do not reposition, do not restructure, do not invent. ' +
    'WHAT TO FIX: extra spaces, double spaces, stray tabs, inconsistent punctuation (Oxford comma usage, period or no-period consistency at end of bullets), inconsistent capitalization (title case in section headers, sentence case in bullets, etc. — pick the document\'s convention and apply it everywhere), inconsistent date formats (pick one — "Jan 2024 – Present" OR "January 2024 – Present" — apply consistently), em-dash hygiene (em dashes are fine in CVs, but use them consistently — never mix em, en, and double-hyphen), parallel verb tense in bullets within a single role (past tense for past roles; present tense for current roles), parallel grammatical structure (all bullets in a section start with strong verbs OR all are noun phrases — match what dominates). Strip Microsoft Word smart-quote / weird-character artifacts (curly quotes only where intentional). ' +
    'WHAT NOT TO TOUCH: the candidate\'s voice, regional spelling preferences (US vs UK — keep what they used), intentional stylistic choices (small caps, all caps for an organization name, etc. — if it is consistent, treat it as house style), the structural order of sections, the bullets\' meaning. ' +
    'WHAT YOU NEVER DO: invent content, expand bullets, summarize, paraphrase for "better wording," collapse multiple bullets into one, add new sections, remove sections, or change facts. If a bullet is grammatically odd but factually meaningful, leave it. ' +
    'Return ONLY valid JSON, no markdown, in this exact shape: {"summary":"one to three sentences on what you fixed and what you noticed (warm and specific, not formulaic)","fix_count":number,"notable_fixes":["short string","short string","short string"],"open_questions":["string","string"],"polished_cv":{"name":"string","contact":"string","summary":"the candidate\'s existing Professional Summary, lightly cleaned (DO NOT rewrite for content)","education":["string"],"experience":[{"title":"string","org":"string","dates":"string","bullets":["string"]}],"projects":["string"],"skills":["string"]}}. ' +
    'In notable_fixes, list 3-6 examples of mechanical fixes you made (e.g., "Standardized date format to \\"Jan 2024 – Present\\" across all roles"). In open_questions, list anything you flagged but did not change because it might be a deliberate craft choice (e.g., "You use small caps for institution names in some places but not others — is one intentional?"). Keep summary under 400 chars.';

  const user = 'CV to polish:\n\n' + docText.slice(0, 60000);

  return { sys, user, max_tokens: 24000 };
}

/* ─── tolerant JSON extraction ─── */
function extractJson(raw) {
  let s = (raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const first = s.indexOf('{'); const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch (_) {}
  }
  throw new Error('Could not parse model response as JSON');
}

/* ─── strip em dashes on user-facing brief text (Charles's brief is plain text) ─── */
function stripEmDashes(s) {
  return String(s || '').replace(/[—–]/g, ', ').replace(/\s*,\s*,\s*/g, ', ');
}

/* ─── handler ─── */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'method not allowed' };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: 'invalid json' };
  }
  const job_id = String(body.job_id || '').trim();
  const kind = String(body.kind || '').trim();
  const payload = body.payload || {};
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(job_id)) {
    return { statusCode: 400, body: 'invalid job_id' };
  }
  if (!['brief', 'rewrite', 'polish'].includes(kind)) {
    return { statusCode: 400, body: 'invalid kind' };
  }

  try { connectLambda(event); } catch (err) {
    console.error('[resume-coach-background] connectLambda failed', err && err.message);
    return { statusCode: 500, body: 'blobs connect failed' };
  }

  const store = getStore('resume_coach_jobs');

  // Mark pending immediately so the status endpoint reports "running" rather
  // than "pending" forever if the model call is slow.
  try {
    await store.setJSON(job_id, { status: 'running', kind, started_at_iso: '(server-stamped)' });
  } catch (_) { /* non-fatal */ }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic({ apiKey });

    let prompts;
    if (kind === 'brief') prompts = buildBriefPrompts(payload);
    else if (kind === 'rewrite') prompts = buildRewritePrompts(payload);
    else prompts = buildPolishPrompts(payload);

    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: prompts.max_tokens,
      system: prompts.sys,
      messages: [{ role: 'user', content: prompts.user }],
    });

    const raw = (resp.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    let result;
    if (kind === 'brief') {
      // Brief is plain text. Strip em dashes (Terry's public-surface rule).
      result = { status: 'done', kind, brief: stripEmDashes(raw) };
    } else {
      // Rewrite + polish return JSON.
      const data = extractJson(raw);
      result = { status: 'done', kind, data };
    }

    await store.setJSON(job_id, result);
    return { statusCode: 202, body: 'ok' };
  } catch (err) {
    console.error('[resume-coach-background] failed', err && err.message);
    try {
      await store.setJSON(job_id, {
        status: 'error',
        kind,
        error: (err && err.message) || 'unknown error',
      });
    } catch (_) { /* swallow */ }
    return { statusCode: 500, body: 'job failed' };
  }
};
