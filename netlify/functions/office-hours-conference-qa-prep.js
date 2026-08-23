/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-conference-qa-prep

   Conference Q&A Prep: faculty member pastes an abstract or talk
   summary and gets back:
     - A one-sentence read of what the room will hear
     - The 5 most likely audience questions, each with the likely asker
       type and a suggested answer
     - The one question they DO NOT want to be asked, with a defense
       and a pre-emptive disarmer
     - An optional opening line that disarms the dreaded question
       before it lands

   Public endpoint. NO auth. NO server-side storage.

   POST /.netlify/functions/office-hours-conference-qa-prep
   Body: {
     abstract: '<talk abstract or summary>',
     title: '<talk title, optional>',
     audience: 'academic' | 'industry' | 'policy' | 'mixed' | 'invited-lecture',
     length: '5' | '10' | '15' | '20' | '30' | '45' | '60' | '',
     sensitive: '<faculty-flagged sensitive angles, optional>'
   }

   Response: {
     ok: true,
     prep: {
       summary,
       likely_questions: [
         { question, asker_type, suggested_answer }
       ],
       dreaded_question: { question, defense, disarmer },
       opening_disarmer
     }
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_ABSTRACT_CHARS = 8000;
const MAX_TITLE_CHARS = 300;
const MAX_SENSITIVE_CHARS = 2000;
const VALID_AUDIENCES = new Set(['academic', 'industry', 'policy', 'mixed', 'invited-lecture']);
const VALID_LENGTHS = new Set(['', '5', '10', '15', '20', '30', '45', '60']);

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

function audienceFraming(audience) {
  switch (audience) {
    case 'academic':
      return 'Audience is an academic conference. Expect methodology-savvy questioners, competing-framework partisans, and at least one questioner who wants the speaker to engage with their own work. Tone: peer scholar to peer scholar.';
    case 'industry':
      return 'Audience is industry or professional practitioners. Expect bottom-line questions about applicability, cost, deployment, and competitive landscape. Less interest in methods, more interest in implications.';
    case 'policy':
      return 'Audience is policy people, government staff, or think-tank scholars. Expect questions about implementation feasibility, distributional consequences, political acceptability, and the comparison to existing policy. Some questioners will be skeptical of the entire premise.';
    case 'mixed':
      return "Audience is a mix of academics, practitioners, and interested public. Expect a wide spectrum of question types, including one or two that come from outside the speaker's expected frame entirely.";
    case 'invited-lecture':
      return 'Audience is an invited department lecture. Expect deferential but probing questions from faculty and graduate students. The host department has chosen this talk for a reason; questioners may push to make sure the talk earns the slot.';
    default:
      return 'Audience type unspecified.';
  }
}

function buildSystemPrompt() {
  return `You are Conference Q&A Prep, a writing assistant for a faculty member or speaker preparing to give a talk and field questions afterward.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": "<one to two sentences: what the room will actually hear from this talk>",
  "likely_questions": [
    {
      "question": "<the question, phrased the way an audience member would actually phrase it>",
      "asker_type": "<one phrase describing who is most likely to ask this, e.g. 'methods-skeptic faculty', 'first-year graduate student', 'practitioner who has tried something similar'>",
      "suggested_answer": "<a draft answer in the speaker's voice, 2 to 4 sentences>"
    }
  ],
  "dreaded_question": {
    "question": "<the one question the speaker does NOT want to be asked>",
    "defense": "<what to say if it gets asked anyway, 2 to 4 sentences. Honest, not defensive.>",
    "disarmer": "<a single line the speaker could insert in the talk to head this off before it gets asked>"
  },
  "opening_disarmer": "<optional, one to two sentences the speaker can use early in the talk to defuse the most likely sensitive angle. Empty string if no good disarmer applies.>"
}

QUANTITY
  - EXACTLY 5 likely_questions. Not 3, not 7.
  - EXACTLY 1 dreaded_question.

VOICE
  - Questions: phrase them the way a real human in that audience would actually ask them, out loud, in the moment. Include hedges and tics where natural ("just curious, but...", "I wonder if..."). Avoid AI-flavored questions ("how does your research interact with the broader landscape?" is too generic; "okay so what do you make of the recent push to require pre-registration even for non-experimental work?" is real).
  - Suggested answers: speak in the speaker's voice, first person. Acknowledge the question fairly. Give one specific substantive response. Don't bluff if the data doesn't support it.
  - No em dashes. Use commas, periods, or restructure. Em dashes are on the faculty's banned list.
  - No marketing-cliche language.

CONTENT RULES
  - Use the abstract and the audience framing to pick the 5 most LIKELY questions, not the 5 most interesting questions. "Likely" means a real person in that audience would actually ask it.
  - The dreaded question should be the question the speaker is MOST LIKELY to be uncomfortable with based on (a) the sensitive material they flagged, (b) the limitations apparent in the abstract, and (c) the framing they chose. If they flagged nothing sensitive, infer one based on the abstract.
  - The disarmer should be CONCRETE and INSERTABLE in the talk itself, not abstract advice. Something the speaker could literally say.
  - The opening_disarmer is OPTIONAL. If no good one exists, return an empty string.

SOURCES
  - You may use web_search to ground a question or answer in a real recent paper or news event the audience may be thinking about, but it's not required. Most of the value here is psychological, not bibliographic.
  - When you DO cite, prefer work from the last 5 years (2021 onward). The audience is more likely to be thinking about recent papers and recent news.`;
}

function buildUserMessage(payload) {
  const { abstract, title, audience, length, sensitive } = payload;
  const lines = [];
  lines.push('TALK ABSTRACT / SUMMARY (the actual content of the talk):');
  lines.push(abstract);
  lines.push('');
  if (title) lines.push('TITLE: ' + title);
  lines.push('AUDIENCE: ' + audience);
  lines.push('AUDIENCE FRAMING: ' + audienceFraming(audience));
  if (length) lines.push('TALK LENGTH: ' + length + ' minutes (Q&A is on top of this)');
  if (sensitive) {
    lines.push('');
    lines.push('SENSITIVE ANGLES THE SPEAKER FLAGGED (use this to find the dreaded question):');
    lines.push(sensitive);
  }
  lines.push('');
  lines.push('Generate the Q&A prep. Output ONLY the JSON object.');
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

  const abstract = String(body.abstract || '').trim().slice(0, MAX_ABSTRACT_CHARS);
  if (!abstract) return json(400, { error: 'abstract required' });

  const title = String(body.title || '').trim().slice(0, MAX_TITLE_CHARS);
  const audience = String(body.audience || 'academic').trim().toLowerCase();
  if (!VALID_AUDIENCES.has(audience)) {
    return json(400, { error: 'invalid audience' });
  }
  const length = String(body.length || '').trim();
  if (!VALID_LENGTHS.has(length)) {
    return json(400, { error: 'invalid length' });
  }
  const sensitive = String(body.sensitive || '').trim().slice(0, MAX_SENSITIVE_CHARS);

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ abstract, title, audience, length, sensitive });

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
    console.error('[qa-prep] anthropic error', err && err.message);
    return json(502, { error: 'analysis failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[qa-prep] json parse failed. raw output head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  // Shape-validate and em-dash-strip
  const prep = stripEmDashes({
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    likely_questions: Array.isArray(parsed.likely_questions)
      ? parsed.likely_questions.slice(0, 6).map((q) => ({
          question: typeof q.question === 'string' ? q.question : (typeof q.text === 'string' ? q.text : ''),
          asker_type: typeof q.asker_type === 'string' ? q.asker_type : (typeof q.asker === 'string' ? q.asker : ''),
          suggested_answer: typeof q.suggested_answer === 'string' ? q.suggested_answer : (typeof q.answer === 'string' ? q.answer : ''),
        }))
      : [],
    dreaded_question: (parsed.dreaded_question && typeof parsed.dreaded_question === 'object')
      ? {
          question: typeof parsed.dreaded_question.question === 'string' ? parsed.dreaded_question.question : '',
          defense: typeof parsed.dreaded_question.defense === 'string' ? parsed.dreaded_question.defense : '',
          disarmer: typeof parsed.dreaded_question.disarmer === 'string' ? parsed.dreaded_question.disarmer : '',
        }
      : null,
    opening_disarmer: typeof parsed.opening_disarmer === 'string' ? parsed.opening_disarmer : '',
  });

  return json(200, { ok: true, prep });
};
