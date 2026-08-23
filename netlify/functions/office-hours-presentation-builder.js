/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-presentation-builder

   Faculty pastes a manuscript, abstract, or key points and names the
   presentation type, time limit, and audience. Returns a complete slide-by-
   slide outline, an opening hook, an elevator version, and anticipated
   questions with response approaches.

   POST /.netlify/functions/office-hours-presentation-builder
   Body: {
     content: '<manuscript or summary text, min 50 chars>',
     type: 'defense' | 'conference' | 'lab' | 'class' | 'faculty',
     time: '5' | '10' | '15' | '20' | '30' | '45' | '60',
     audience: 'expert' | 'academic' | 'general'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 7000;
const MAX_CONTENT_CHARS = 16000;

const VALID_TYPES = new Set(['defense', 'conference', 'lab', 'class', 'faculty']);
const VALID_TIMES = new Set(['5', '10', '15', '20', '30', '45', '60']);
const VALID_AUDIENCE = new Set(['expert', 'academic', 'general']);

const TYPE_NAMES = {
  defense:    'dissertation defense',
  conference: 'academic conference presentation',
  lab:        'lab or group meeting',
  class:      'class presentation',
  faculty:    'faculty job talk',
};
const AUDIENCE_NAMES = {
  expert:   'expert committee or specialists in this field',
  academic: 'mixed academic audience',
  general:  'general audience',
};

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

function buildSystemPrompt() {
  return `You are an expert academic presentation coach. Faculty hand you research content, a time slot, an audience level, and a presentation type. You return a complete deck outline with speaker notes, a tight opening hook, a 5-minute elevator version, and a Q&A prep list.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "opening_hook": "<exact first three sentences to open the talk. Spoken language, not text on a slide. Frames why this matters to THIS audience.>",
  "slides": [
    {
      "number": <integer, 1-indexed>,
      "title": "<slide title, 6 words or fewer>",
      "minutes": <number, e.g. 1.5>,
      "bullets": ["<bullet, 5 words or fewer>", "<bullet>", "<bullet, optional 4th>"],
      "speaker_note": "<what to say while this slide is up, spoken language, 2 to 4 sentences>",
      "visual": "<specific recommendation: chart type, image, diagram. 'Bar chart of readmission rate by HPPD quintile' beats 'a relevant chart'.>"
    }
  ],
  "elevator": "<the 5-minute condensed version. 600 to 800 words. Spoken language, not bullet points. Covers the essential story for someone who only has 5 minutes.>",
  "anticipated_questions": [
    { "question": "<the actual question phrased the way an audience member would ask it>", "approach": "<one to two sentences on how to respond. Concrete strategy, not 'be confident'.>" }
  ]
}

QUANTITY GUIDELINES
  - slides: SLIDE COUNT MUST MATCH THE TIME BUDGET. Use roughly 1.5 to 2 minutes per slide. So 20 minutes = ~12 slides; 60 minutes = ~30 slides; 5 minutes = ~3 to 4 slides. Total of the 'minutes' field across all slides MUST sum to no more than the time budget.
  - anticipated_questions: 5 to 8 entries.
  - Slide bullets: 2 to 4 per slide.

SLIDE STRUCTURE
  - Opening hook slide -> background/why it matters -> the gap/problem -> research question -> methods overview -> key findings (often 2 to 3 slides) -> discussion/implications -> conclusions -> Q&A landing slide.
  - For DEFENSE: extra weight on methods, results, and limitations.
  - For CONFERENCE: tight; lead with finding, defend it briefly.
  - For LAB/GROUP: more methods detail, more invitation for discussion.
  - For CLASS: more background; less assumption of audience expertise.
  - For FACULTY JOB TALK: strong opening, big-picture significance, clear research program arc, future directions slide.

VOICE
  - Bullets are memory cues for the speaker, not text to be read aloud. 5 words or fewer. The audience reads them while you talk; if they're sentences, you've lost the audience.
  - Speaker notes are SPOKEN LANGUAGE. Contractions OK. Read them out loud in your head as you write them; if they sound like a paper, rewrite.
  - Opening hook is THE opener. Specific, vivid, not "Today I'll be talking about". Show, don't preface.
  - No em dashes. Use commas, periods, or restructure. Em dashes are banned.
  - No marketing-cliche adjectives. 'Robust', 'leverage', 'synergy' are cut.

CONTENT RULES
  - DO NOT invent results, numbers, or methods detail not in the source content. If a slide would require detail the source does not contain, write "[CHECK: <what's missing>]" in the speaker note.
  - The elevator version is a COMPLETE narrative, not the deck restated. Someone could read it on a flight and know the work.
  - Anticipated questions match the audience: a dissertation committee asks about theoretical framing and methods choices; a conference audience asks about scope and replicability; a job-talk audience asks about research program and fit. Tune accordingly.`;
}

function buildUserMessage(payload) {
  const { content, type, time, audience } = payload;
  const targetSlides = Math.round(parseInt(time, 10) / 1.75);
  const lines = [];
  lines.push('PRESENTATION TYPE: ' + TYPE_NAMES[type]);
  lines.push('TIME BUDGET: ' + time + ' minutes');
  lines.push('TARGET SLIDE COUNT: approximately ' + targetSlides + ' slides (range ' + Math.max(2, targetSlides - 2) + ' to ' + (targetSlides + 2) + ')');
  lines.push('AUDIENCE: ' + AUDIENCE_NAMES[audience]);
  lines.push('');
  lines.push('RESEARCH CONTENT (as pasted by the faculty):');
  lines.push(content);
  lines.push('');
  lines.push('Produce the full presentation package. Output ONLY the JSON object specified in the system prompt.');
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

function shapeSlide(s, idx) {
  if (!s || typeof s !== 'object') return null;
  const num = parseInt(s.number, 10);
  const mins = parseFloat(s.minutes);
  return {
    number: Number.isFinite(num) ? num : (idx + 1),
    title: typeof s.title === 'string' ? s.title : '',
    minutes: Number.isFinite(mins) ? mins : 1.5,
    bullets: Array.isArray(s.bullets) ? s.bullets.slice(0, 6).map(String) : [],
    speaker_note: typeof s.speaker_note === 'string' ? s.speaker_note : (typeof s.note === 'string' ? s.note : ''),
    visual: typeof s.visual === 'string' ? s.visual : '',
  };
}

function shapeQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  return {
    question: typeof q.question === 'string' ? q.question : '',
    approach: typeof q.approach === 'string' ? q.approach : (typeof q.response === 'string' ? q.response : ''),
  };
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

  const content = String(body.content || '').trim().slice(0, MAX_CONTENT_CHARS);
  if (!content || content.length < 50) return json(400, { error: 'content required (min 50 chars)' });

  const type = String(body.type || 'conference').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) return json(400, { error: 'invalid presentation type' });

  const time = String(body.time || '20').trim();
  if (!VALID_TIMES.has(time)) return json(400, { error: 'invalid time' });

  const audience = String(body.audience || 'academic').trim().toLowerCase();
  if (!VALID_AUDIENCE.has(audience)) return json(400, { error: 'invalid audience' });

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage({ content, type, time, audience });

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
    console.error('[presentation-builder] anthropic error', err && err.message);
    return json(502, { error: 'build failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[presentation-builder] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const deck = stripEmDashes({
    presentation_type: TYPE_NAMES[type],
    time_minutes: parseInt(time, 10),
    audience: AUDIENCE_NAMES[audience],
    opening_hook: typeof parsed.opening_hook === 'string' ? parsed.opening_hook : '',
    slides: Array.isArray(parsed.slides) ? parsed.slides.slice(0, 50).map(shapeSlide).filter(Boolean) : [],
    elevator: typeof parsed.elevator === 'string' ? parsed.elevator : '',
    anticipated_questions: Array.isArray(parsed.anticipated_questions) ? parsed.anticipated_questions.slice(0, 12).map(shapeQuestion).filter(Boolean) : [],
  });

  return json(200, { ok: true, deck });
};
