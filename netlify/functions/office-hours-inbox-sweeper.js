/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-inbox-sweeper

   Inbox Sweeper: faculty pastes a batch of student emails separated by
   blank lines or "---" markers. Tool splits, drafts a tailored reply
   for each one, returns the batch.

   No web_search used here. Text-only. Fast.

   POST /.netlify/functions/office-hours-inbox-sweeper
   Body: {
     raw_emails: '<the whole inbox dump>',
     tone: 'warm' | 'formal' | 'direct' | 'letting-down-gently',
     signoff: 'Best,' | 'Best regards,' | ...,
     voice: '<blanket instructions, optional>'
   }

   Response: {
     ok: true,
     replies: [
       {
         from: '<extracted From line if present>',
         subject: '<extracted Subject if present>',
         inbound: '<the inbound message text>',
         draft: '<the draft reply text>'
       }
     ]
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_RAW_CHARS = 20000;
const MAX_EMAILS_PER_BATCH = 15;
const VALID_TONES = new Set(['warm', 'formal', 'direct', 'letting-down-gently']);

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

function splitEmails(raw) {
  // Split on a line that is exactly "---" (with optional whitespace), OR on
  // a blank line that comes between a "From:" line and another message. We
  // prefer explicit --- separators when present.
  let blocks;
  if (/^\s*---\s*$/m.test(raw)) {
    blocks = raw.split(/^\s*---\s*$/m);
  } else {
    // Fall back to splitting on 2+ consecutive blank lines (a common boundary)
    blocks = raw.split(/\n\s*\n\s*\n/);
  }
  return blocks
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .slice(0, MAX_EMAILS_PER_BATCH);
}

function parseHeaders(block) {
  // Best-effort: pull "From: ..." and "Subject: ..." lines if present at the top.
  const lines = block.split('\n');
  let from = '';
  let subject = '';
  let headerEnd = 0;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const m1 = lines[i].match(/^\s*From:\s*(.+?)\s*$/i);
    const m2 = lines[i].match(/^\s*Subject:\s*(.+?)\s*$/i);
    if (m1) { from = m1[1]; headerEnd = i + 1; continue; }
    if (m2) { subject = m2[1]; headerEnd = i + 1; continue; }
    // If we've seen at least one header and this is a blank line, treat as end-of-headers
    if (headerEnd > 0 && lines[i].trim() === '') { headerEnd = i + 1; break; }
    // If we haven't matched a header yet and this isn't a header-shaped line, give up
    if (headerEnd === 0 && !/^\s*[A-Za-z-]+:\s+/.test(lines[i])) break;
  }
  const body = headerEnd > 0 ? lines.slice(headerEnd).join('\n').trim() : block;
  return { from, subject, inbound: body };
}

function buildSystemPrompt() {
  return `You are Inbox Sweeper, a drafting assistant for a faculty member who has pasted a batch of inbound student emails and needs a polite, tailored draft reply for each.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "replies": [
    { "from": "<student name or empty>", "subject": "<extracted subject or empty>", "inbound": "<the inbound message text the faculty provided, verbatim>", "draft": "<your draft reply>" }
  ]
}

EXACTLY one entry per inbound message in the batch. Preserve the inbound order.

VOICE
  - Speak in the FIRST PERSON as the faculty member (they sign and send it).
  - Match the tone the faculty specified for the batch. Each individual reply may need slight adjustment (e.g., warmer for an anxious student, more direct for a deadline-missed request), but stay within the chosen register.
  - Use the faculty's blanket instructions ("voice / blanket instructions") in every reply where relevant.
  - Address the student by their first name when known. If only an email handle is available, use it sparingly or skip the greeting name.
  - End with a clear next step or close. Do not leave the student hanging.
  - End the body with the faculty's chosen sign-off (e.g., "Best regards,") followed by a blank line and "[Your name]" as a placeholder.
  - No em dashes. Use commas, periods, or restructure. Em dashes are on the faculty's banned list.

CONTENT RULES
  - Answer the actual question or request in the FIRST or SECOND paragraph. Do not make the student wait for the answer.
  - If the inbound is unclear, name the ambiguity and ask one clarifying question rather than guessing.
  - For requests for letters of recommendation: state the policy from the faculty's voice instructions (notice required, materials needed, timeline). Do not commit to writing if the faculty hasn't indicated they will.
  - For grade appeals: cite the syllabus policy or process the faculty mentioned, never invent one.
  - For extension/late-submission requests: weigh the faculty's stated policy. If they granted "first extensions, decline second ones", apply that consistently.
  - For scheduling: propose specific times if the faculty's voice instructions include availability.
  - Keep each reply concise. 60-180 words typical. The faculty has a stack; they want the draft to be 80% there so they can send fast.

INBOUND PRESERVATION
  - In the "inbound" field of each reply, return the BODY of the message (NOT the From/Subject headers, which go in their own fields). Strip the headers cleanly but preserve the message text verbatim.

NEVER fabricate names, dates, or policies the faculty hasn't given you. If you don't know the faculty's name or sign-off, use the placeholder "[Your name]".`;
}

function buildUserMessage(emails, tone, signoff, voice) {
  const lines = [];
  lines.push('TONE: ' + tone);
  lines.push('SIGN-OFF: ' + signoff);
  if (voice) {
    lines.push('');
    lines.push('FACULTY VOICE / BLANKET INSTRUCTIONS:');
    lines.push(voice);
  }
  lines.push('');
  lines.push('INBOUND BATCH (' + emails.length + ' emails to reply to):');
  lines.push('');
  emails.forEach((e, i) => {
    lines.push('────── EMAIL ' + (i + 1) + ' ──────');
    if (e.from) lines.push('From: ' + e.from);
    if (e.subject) lines.push('Subject: ' + e.subject);
    if (e.from || e.subject) lines.push('');
    lines.push(e.inbound);
    lines.push('');
  });
  lines.push('Draft a reply for each. Output ONLY the JSON object specified in the system prompt.');
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

  const raw = String(body.raw_emails || '').trim().slice(0, MAX_RAW_CHARS);
  if (!raw) return json(400, { error: 'raw_emails required' });

  const tone = String(body.tone || 'warm').trim().toLowerCase();
  if (!VALID_TONES.has(tone)) return json(400, { error: 'invalid tone' });

  const signoff = String(body.signoff || 'Best regards,').trim().slice(0, 60);
  const voice = String(body.voice || '').trim().slice(0, 4000);

  const blocks = splitEmails(raw);
  if (blocks.length === 0) return json(400, { error: 'no emails found in raw_emails' });

  const emails = blocks.map(parseHeaders);

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage(emails, tone, signoff, voice);

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
    console.error('[inbox-sweeper] anthropic error', err && err.message);
    return json(502, { error: 'sweep failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[inbox-sweeper] json parse failed. raw output head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const replies = Array.isArray(parsed.replies) ? parsed.replies : [];
  const shaped = stripEmDashes(
    replies.slice(0, emails.length).map((r, i) => ({
      from: typeof r.from === 'string' ? r.from : (emails[i] ? emails[i].from : ''),
      subject: typeof r.subject === 'string' ? r.subject : (emails[i] ? emails[i].subject : ''),
      inbound: typeof r.inbound === 'string' && r.inbound ? r.inbound : (emails[i] ? emails[i].inbound : ''),
      draft: typeof r.draft === 'string' ? r.draft : '',
    }))
  );

  return json(200, { ok: true, replies: shaped });
};
