/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-methods-coach

   Methods Coach: faculty (or a faculty member helping a student) describes
   a research design and gets back:
     - A one-sentence summary of what the design appears to be
     - Strengths
     - Weaknesses
     - Common reviewer criticisms, each grounded in real methodological
       literature via web_search where possible
     - Defense strategies
     - Writing guidance for the chosen section context

   Public endpoint. NO auth. NO server-side storage. POST a design
   description, get structured JSON back.

   POST /.netlify/functions/office-hours-methods-coach
   Body: {
     design: '<description of the research design>',
     topic: '<topic / field, optional>',
     section: '<proposal | methods | defense | peer-review | grant | ''>',
   }

   Response: {
     ok: true,
     analysis: {
       summary,
       strengths: [...],
       weaknesses: [...],
       common_criticisms: [{ criticism, source: { title, url } }],
       defense_strategies: [...],
       writing_guidance,
     }
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_DESIGN_CHARS = 8000;
const MAX_TOPIC_CHARS = 500;
const VALID_SECTIONS = new Set(['', 'proposal', 'methods', 'defense', 'peer-review', 'grant']);

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

function sectionFraming(section) {
  switch (section) {
    case 'proposal':
      return 'The faculty member is preparing a proposal or pre-registration. Writing guidance should focus on how to PRESENT the design persuasively to a committee or registry, anticipating objections in advance.';
    case 'methods':
      return 'The faculty member is writing the methods section of a manuscript or dissertation. Writing guidance should focus on the order in which to present elements (design, sampling, measurement, analysis), the level of detail conventional for the field, and where reviewers will look for gaps.';
    case 'defense':
      return 'The faculty member is preparing for an oral defense or qualifying exam. Defense strategies should focus on how to FIELD live questions, including how to acknowledge a limitation honestly without conceding the whole study.';
    case 'peer-review':
      return 'The faculty member is reviewing this design for a journal (i.e., they did not run it). Criticisms should be framed as what they would write in their review comments. Defense strategies in this context are what an author COULD say to address those criticisms if given the chance to revise.';
    case 'grant':
      return 'The faculty member is using this in a grant application. Writing guidance should focus on how to frame the design as feasible, rigorous, and likely to produce interpretable results, anticipating the reviewer rubric used by federal panels.';
    default:
      return 'No specific section context was provided. Cover the design analytically across whatever uses the faculty member might have.';
  }
}

function buildSystemPrompt() {
  return `You are Methods Coach, a writing assistant for faculty members and graduate students who need to evaluate, defend, or write up a research design.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after:
{
  "summary": "<one to two sentences: what the described design appears to be>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "weaknesses": ["<weakness 1>", "<weakness 2>", ...],
  "common_criticisms": [
    {
      "criticism": "<the criticism a peer reviewer or committee member is most likely to raise>",
      "source": { "title": "<author last name, year, paper title or descriptive name>", "url": "<url if known>" }
    }
  ],
  "defense_strategies": ["<strategy 1>", "<strategy 2>", ...],
  "writing_guidance": "<2 to 4 short paragraphs, plain text with blank lines between paragraphs>"
}

QUANTITY GUIDELINES
  - 3 to 5 strengths
  - 3 to 5 weaknesses
  - 3 to 5 common criticisms (each with a source if possible)
  - 3 to 5 defense strategies
  - writing_guidance: a coherent multi-paragraph block

VOICE
  - Speak to the faculty member as a senior methodologist would speak to a peer. Direct, specific, useful.
  - No marketing-cliche language. No "leverage" "synergy" or "robust" used as filler.
  - No em dashes. Use commas, periods, or restructure. Em dashes are on the faculty's banned list.
  - Avoid hedging that adds no information ("it depends" alone is not useful; specify what it depends on).

SOURCES
  - For common_criticisms, use the web_search tool to ground criticisms in real published methodological literature where possible (textbooks, methodology papers, reporting guidelines, prominent reviews). Cite authors and year.
  - Do NOT fabricate citations. If you cannot find a real source for a criticism but the criticism is sound, include it with an empty source object: {"title": "", "url": ""}.
  - For well-known reporting guidelines (CONSORT, PRISMA, STROBE, COREQ, SRQR, JARS), you may cite them by name without a specific paper.

CONTENT RULES
  - Identify the design type FIRST in your summary (cross-sectional survey, RCT, qualitative interview study, mixed-methods, systematic review, etc.) and ground the rest of the analysis in that identification.
  - If the faculty's description is ambiguous, name the ambiguity in the summary rather than guessing.
  - When discussing limitations, distinguish between FUNDAMENTAL limitations (intrinsic to the design choice) and FIXABLE limitations (the faculty can address with revision).
  - Defense strategies should be CONCRETE moves the faculty can use, not platitudes ("you could acknowledge the limitation" is not a strategy; "if asked about external validity, point to the demographic match between your sample and the population of interest as documented in Table 1" is a strategy).`;
}

function buildUserMessage(design, topic, section) {
  const lines = [];
  lines.push('RESEARCH DESIGN (described by the faculty member):');
  lines.push(design);
  lines.push('');
  if (topic) {
    lines.push('TOPIC / FIELD: ' + topic);
  }
  lines.push('SECTION CONTEXT: ' + (section || '(none specified)'));
  lines.push('SECTION FRAMING: ' + sectionFraming(section));
  lines.push('');
  lines.push('Analyze the design. Use web_search to ground common_criticisms in real methodological literature where possible. Output ONLY the JSON object.');
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const design = String(body.design || '').trim().slice(0, MAX_DESIGN_CHARS);
  if (!design) return json(400, { error: 'design description required' });

  const topic = String(body.topic || '').trim().slice(0, MAX_TOPIC_CHARS);
  const section = String(body.section || '').trim().toLowerCase();
  if (!VALID_SECTIONS.has(section)) {
    return json(400, { error: 'invalid section' });
  }

  const system = buildSystemPrompt();
  const userMsg = buildUserMessage(design, topic, section);

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
    console.error('[methods-coach] anthropic error', err && err.message);
    return json(502, { error: 'analysis failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[methods-coach] json parse failed. raw output head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  // Shape-validate and em-dash-strip
  const analysis = stripEmDashes({
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8).map(String) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.slice(0, 8).map(String) : [],
    common_criticisms: Array.isArray(parsed.common_criticisms)
      ? parsed.common_criticisms.slice(0, 8).map((c) => {
          if (typeof c === 'string') return { criticism: c, source: { title: '', url: '' } };
          const text = typeof c.criticism === 'string' ? c.criticism : (typeof c.text === 'string' ? c.text : '');
          const src = c.source && typeof c.source === 'object' ? c.source : (typeof c.source === 'string' ? { title: c.source, url: '' } : { title: '', url: '' });
          return {
            criticism: text,
            source: {
              title: typeof src.title === 'string' ? src.title : '',
              url: typeof src.url === 'string' ? src.url : '',
            },
          };
        })
      : [],
    defense_strategies: Array.isArray(parsed.defense_strategies) ? parsed.defense_strategies.slice(0, 8).map(String) : [],
    writing_guidance: typeof parsed.writing_guidance === 'string' ? parsed.writing_guidance : '',
  });

  return json(200, { ok: true, analysis });
};
