/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-visiting-scholar

   The Visiting Scholar: faculty members attending a seminar, defense, or
   talk outside their expertise upload 1-4 slide photos and get back
   3-5 substantive questions to ask, with real sources behind them.

   Two modes:
     - "visiting-scholar"   accessible questions that invite the presenter
                            to teach the audience; for guests at other
                            people's seminars
     - "committee-member"   evaluation-depth questions for a defense or
                            review panel; for when faculty are sitting in
                            judgment

   Public endpoint. NO authentication. NO server-side storage of any
   inputs or outputs. Images come in as base64, go straight to the
   Anthropic API, and are not retained.

   POST /.netlify/functions/office-hours-visiting-scholar
   Body: {
     mode: 'visiting-scholar' | 'committee-member',
     context: '<discipline / setting, optional>',
     images: [ { media_type: 'image/png' | 'image/jpeg', base64: '...' }, ... ]
   }

   Response: {
     ok: true,
     mode,
     summary: '<one-sentence read of the slides>',
     questions: [
       {
         question: '<the question to ask>',
         rationale: '<why this question is worth asking>',
         sources: [ { title: '...', url: '...' }, ... ]
       },
       ...
     ]
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_IMAGES = 4;
const MAX_BASE64_BYTES_PER_IMAGE = 12 * 1024 * 1024; // ~9 MB raw after base64 expansion
const VALID_MEDIA_TYPES = new Set(['image/png', 'image/jpeg']);
const VALID_MODES = new Set(['visiting-scholar', 'committee-member']);

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

function buildSystemPrompt(mode) {
  const sharedPreamble = `You are assisting a faculty member who is attending a seminar, thesis defense, or research presentation. They have uploaded one or more photos of slides from that presentation. They are NOT a subject-matter expert in this exact topic. Your job is to help them ask intelligent, substantive questions of the presenter.

OUTPUT FORMAT (mandatory)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": "<one to two sentences: what you read on the slides>",
  "questions": [
    {
      "question": "<the question the faculty member would ask>",
      "rationale": "<one to two sentences: why this question is worth asking, in the faculty member's voice>",
      "sources": [
        { "title": "<author last name, year, paper title or descriptive name>", "url": "<url if known>" }
      ]
    }
  ]
}

Return 3 to 5 questions. Each question MUST be self-contained (no "what about X?" that depends on context you didn't establish).

VOICE
  - Write each question in the first person, as the faculty member would actually phrase it out loud.
  - No academic jargon for the sake of jargon. Use plain words where they work.
  - No em dashes. Use commas, periods, or restructure. Em dashes are on the faculty's banned list.

SOURCES
  - You DO NOT have web access on this call. Cite only papers, authors, and frameworks you can identify with high confidence from your training. Do NOT fabricate citations.
  - PREFER CITATIONS FROM THE LAST 5 YEARS (2021 onward) where possible. Recent work signals you are current with the field. Only fall back to older citations when (a) the older work is canonical and still the standard reference (e.g., a CONSORT statement, a foundational 1990s framework that no recent paper has superseded), or (b) you genuinely cannot identify a recent paper on the topic from your training. If you must cite older work, briefly note why ("classic reference still in use" or similar).
  - When you cite a paper, include author + year + identifying phrase ("e.g., Smith 2023 on cognitive load and engagement") so the faculty member can search for it themselves.
  - If you are not confident a real source exists for a question, LEAVE the sources array empty rather than guessing.
  - URLs are optional; only include one if you are highly confident it is correct. Otherwise omit.

CONTENT RULES
  - Read the slides carefully. Identify the central claim, the method, the data or evidence, and the implications shown.
  - If the slides are partial (you can only see one slide of a longer talk), say so in the summary and frame questions around what you can see.
  - Do not invent what's NOT on the slides. If you don't know the discipline well enough to ask the killer question, ask the well-informed-curious-outsider question.
`;

  if (mode === 'visiting-scholar') {
    return sharedPreamble + `
THIS MODE: Visiting Scholar.
The faculty member is a GUEST at this seminar or defense. They are not on the committee, not the expert. They want to ask questions that:
  - Invite the presenter to teach them and the room something they did not already cover
  - Connect the work to a broader literature or adjacent field they might not have considered
  - Demonstrate engaged curiosity without showing off
  - Open a door for the speaker to shine, not shut one in their face

DO NOT generate gotcha questions, attacking questions, or methods-skeptic questions in this mode. The user is a guest, not a panelist. They want to leave with the speaker liking them.`;
  }

  // committee-member
  return sharedPreamble + `
THIS MODE: Committee Member.
The faculty member is on the EVALUATION PANEL for this defense or review. They are expected to push back, probe for weaknesses, and ensure the work meets standards. Their questions should:
  - Test the methodology, the assumptions, and the boundary conditions of the claim
  - Surface limitations the student or presenter may not have addressed
  - Connect the work to competing approaches in the literature
  - Be fair but firm. Not gotchas; substantive challenges with a clear standard behind them.

If the slides reveal a methodological gap or unaddressed limitation, prioritize a question about it. The point of a defense is to verify the work can survive scrutiny.`;
}

function buildUserBlocks(context, images) {
  const blocks = [];
  // Each image becomes an image block
  images.forEach(function (img, idx) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.media_type,
        data: img.base64,
      },
    });
  });
  // Then a text block with the brief
  const lines = [];
  lines.push('These are slides from a presentation I am attending.');
  if (context) {
    lines.push('Discipline / setting: ' + context);
  }
  lines.push('Image count: ' + images.length);
  lines.push('');
  lines.push('Read the slides, ground questions in real literature via web_search where you can, and return the JSON specified in the system prompt. Output ONLY the JSON object.');
  blocks.push({ type: 'text', text: lines.join('\n') });
  return blocks;
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
  // Try to parse directly first
  try { return JSON.parse(text); } catch (_) { /* fall through */ }
  // Find first { and last } and try that slice
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = text.slice(first, last + 1);
    try { return JSON.parse(slice); } catch (_) { /* fall through */ }
  }
  // Try stripping ``` code fences
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

  const mode = String(body.mode || 'visiting-scholar').trim().toLowerCase();
  if (!VALID_MODES.has(mode)) {
    return json(400, { error: 'mode must be visiting-scholar or committee-member' });
  }

  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 500) : '';

  const imagesRaw = Array.isArray(body.images) ? body.images : [];
  if (imagesRaw.length === 0) return json(400, { error: 'at least one image required' });
  if (imagesRaw.length > MAX_IMAGES) return json(400, { error: 'max ' + MAX_IMAGES + ' images' });

  const images = [];
  for (const img of imagesRaw) {
    if (!img || typeof img !== 'object') {
      return json(400, { error: 'each image must be {media_type, base64}' });
    }
    const media_type = String(img.media_type || '').toLowerCase();
    if (!VALID_MEDIA_TYPES.has(media_type)) {
      return json(400, { error: 'media_type must be image/png or image/jpeg' });
    }
    const base64 = typeof img.base64 === 'string' ? img.base64 : '';
    if (!base64) return json(400, { error: 'image base64 missing' });
    if (base64.length > MAX_BASE64_BYTES_PER_IMAGE) {
      return json(400, { error: 'image too large (max ~9 MB)' });
    }
    images.push({ media_type, base64 });
  }

  const system = buildSystemPrompt(mode);
  const userBlocks = buildUserBlocks(context, images);

  const client = new Anthropic({ apiKey });
  let modelOutput;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      // web_search intentionally disabled here to keep round-trip under
      // ~15 seconds for corporate-proxy environments. Sources in the
      // response come from the model's training; the prompt instructs it
      // to label unverified citations and leave sources blank when
      // unsure. If real citation grounding becomes critical, convert
      // this function to a background-function pattern.
      messages: [{ role: 'user', content: userBlocks }],
    });
    // Concatenate text blocks from the final response
    modelOutput = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[visiting-scholar] anthropic error', err && err.message);
    return json(502, { error: 'analysis failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[visiting-scholar] json parse failed. raw output:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  // Sanity-shape the response and strip em dashes
  const out = stripEmDashes({
    ok: true,
    mode,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.slice(0, 6).map((q) => ({
          question: typeof q.question === 'string' ? q.question : (typeof q.text === 'string' ? q.text : ''),
          rationale: typeof q.rationale === 'string' ? q.rationale : '',
          sources: Array.isArray(q.sources)
            ? q.sources.slice(0, 4).map((s) => {
                if (typeof s === 'string') return { title: s, url: '' };
                return {
                  title: typeof s.title === 'string' ? s.title : (typeof s.text === 'string' ? s.text : ''),
                  url: typeof s.url === 'string' ? s.url : '',
                };
              })
            : [],
        }))
      : [],
  });

  return json(200, out);
};
