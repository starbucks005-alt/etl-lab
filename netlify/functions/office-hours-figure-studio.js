/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-figure-studio

   Vision tool. Faculty uploads a figure (chart, graph, diagram, image), names
   the figure number, picks a citation style, optionally adds context, and
   selects a mode. Returns:
     - captions mode: journal-style caption + alt text + "This figure
       illustrates..." sentence + "The data demonstrate..." sentence + key
       visual elements list
     - interpret mode: Results paragraph + Discussion paragraph + Limitations
       note + plain-language "What this means" summary
     - both: everything above

   POST /.netlify/functions/office-hours-figure-studio
   Body: {
     image: { type: 'image/png' | 'image/jpeg' | ..., data: '<base64 without data: prefix>' },
     figure_number: '<e.g. "1", "2", "A1">',
     style: 'apa' | 'ama' | 'ieee' | 'chicago' | 'mla',
     context: '<optional short description>',
     mode: 'captions' | 'interpret' | 'both'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getUser, extractToken } = require('./_etl-credits-util');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4500;
const MAX_CONTEXT_CHARS = 1500;
const MAX_FIGNUM_CHARS = 20;
const MAX_IMAGE_BYTES = 4_000_000; // ~4MB pre-decode budget

const VALID_STYLES = new Set(['apa', 'ama', 'ieee', 'chicago', 'mla']);
const VALID_MODES = new Set(['captions', 'interpret', 'both']);
const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

const STYLE_NAMES = {
  apa:     'APA 7th Edition',
  ama:     'AMA (American Medical Association)',
  ieee:    'IEEE',
  chicago: 'Chicago 17th Edition',
  mla:     'MLA 9th Edition',
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
  return `You are an expert academic editor specializing in figure description, scientific writing, and accessibility. Faculty uploads a figure (chart, graph, diagram, photo). You examine it carefully and return publication-ready content.

OUTPUT FORMAT (MANDATORY)
You MUST return ONLY a JSON object with this exact shape, no prose before or after. Include ONLY the keys appropriate to the requested mode:

For "captions" mode, include only:
{
  "captions": {
    "caption": "<complete journal-style caption in the requested style, starting with 'Figure N.' Describes what the figure shows, patterns, scales, and notable features.>",
    "alt_text": "<complete alt-text description for screen-reader accessibility. Conveys all visible information. Plain prose, no markdown.>",
    "illustrates_sentence": "<one sentence beginning with 'This figure illustrates...' suitable for in-text reference>",
    "data_demonstrate_sentence": "<one sentence beginning with 'The data demonstrate...' suitable for a Results section>",
    "key_elements": ["<specific element 1 a reader should notice>", "<element 2>", "<element 3>", "<element 4 optional>"]
  }
}

For "interpret" mode, include only:
{
  "interpretation": {
    "results_paragraph": "<3 to 4 sentences for a Results section. Past tense, scholarly voice, reference specific values or patterns visible in the figure.>",
    "discussion_paragraph": "<3 to 4 sentences interpreting meaning and implications for a Discussion section>",
    "limitations_note": "<1 to 2 sentences acknowledging what this figure cannot show>",
    "what_this_means": "<2 to 3 plain-language sentences suitable for a presentation, poster, or lay summary>"
  }
}

For "both" mode, include BOTH the "captions" and "interpretation" objects.

CONTENT RULES
  - DO NOT invent numbers or claims not visible in the figure. If axes are unlabeled or values unreadable, say so in alt_text and use [CHECK: <what's not visible>] markers in the captions/paragraphs.
  - The caption uses the requested citation style's conventions (e.g., APA italicizes the figure label and uses sentence case for the title; AMA uses bold figure label; IEEE numbers figures with "Fig. N").
  - The alt_text is for accessibility: convey every meaningful element a sighted reader would see, in plain prose, without redundant phrases like "image of" or "picture showing".
  - "Key visual elements" are SPECIFIC and ORDERED by importance ("Note the inflection point at week 6" beats "There are interesting patterns").
  - Results paragraph: past tense, no interpretation, just what was observed in this figure.
  - Discussion paragraph: interpretation, implications, connection to broader literature with [CITE: topic] placeholders only when relevant.
  - Limitations note: what this figure cannot show. Be honest. "The figure cannot distinguish causation from association" is the right register.
  - "What this means" is plain language: a reader with no domain background should understand it.
  - Voice: scholarly but readable. Cut filler.
  - No em dashes. Use commas, periods, or restructure. Em dashes are banned.
  - No marketing-cliche adjectives. 'Robust', 'leverage', 'synergy', 'novel' as filler are cut.`;
}

function buildUserText(payload) {
  const { figure_number, style, context, mode } = payload;
  const lines = [];
  lines.push('FIGURE NUMBER: ' + (figure_number || '1'));
  lines.push('CITATION STYLE: ' + STYLE_NAMES[style]);
  lines.push('MODE: ' + mode);
  if (context) {
    lines.push('CONTEXT FROM FACULTY: ' + context);
  }
  lines.push('');
  lines.push('Examine the figure above. Produce the requested output. Return ONLY the JSON object specified in the system prompt.');
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

  const img = body.image || {};
  let mediaType = String(img.type || 'image/png').toLowerCase();
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
  if (!VALID_IMAGE_TYPES.has(mediaType)) return json(400, { error: 'invalid image type', detail: mediaType });

  const data = String(img.data || '').trim();
  if (!data) return json(400, { error: 'image data required' });
  if (data.length > MAX_IMAGE_BYTES) return json(413, { error: 'image too large; please downscale to under 3MB' });

  const figure_number = String(body.figure_number || '1').trim().slice(0, MAX_FIGNUM_CHARS) || '1';

  const style = String(body.style || 'apa').trim().toLowerCase();
  if (!VALID_STYLES.has(style)) return json(400, { error: 'invalid citation style' });

  const mode = String(body.mode || 'both').trim().toLowerCase();
  if (!VALID_MODES.has(mode)) return json(400, { error: 'invalid mode' });

  const context = String(body.context || '').trim().slice(0, MAX_CONTEXT_CHARS);

  const system = buildSystemPrompt();
  const userText = buildUserText({ figure_number, style, context, mode });

  const client = new Anthropic({ apiKey });
  let modelOutput;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: data } },
          { type: 'text', text: userText },
        ],
      }],
    });
    modelOutput = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[figure-studio] anthropic error', err && err.message);
    return json(502, { error: 'analysis failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  let parsed;
  try {
    parsed = extractJson(modelOutput);
  } catch (err) {
    console.error('[figure-studio] json parse failed. raw head:', modelOutput.slice(0, 500));
    return json(502, { error: 'model did not return valid JSON', detail: modelOutput.slice(0, 400) });
  }

  const out = { figure_number, style: STYLE_NAMES[style], mode };

  if (parsed.captions && typeof parsed.captions === 'object') {
    const c = parsed.captions;
    out.captions = stripEmDashes({
      caption: typeof c.caption === 'string' ? c.caption : '',
      alt_text: typeof c.alt_text === 'string' ? c.alt_text : '',
      illustrates_sentence: typeof c.illustrates_sentence === 'string' ? c.illustrates_sentence : '',
      data_demonstrate_sentence: typeof c.data_demonstrate_sentence === 'string' ? c.data_demonstrate_sentence : '',
      key_elements: Array.isArray(c.key_elements) ? c.key_elements.slice(0, 8).map(String) : [],
    });
  }

  if (parsed.interpretation && typeof parsed.interpretation === 'object') {
    const i = parsed.interpretation;
    out.interpretation = stripEmDashes({
      results_paragraph: typeof i.results_paragraph === 'string' ? i.results_paragraph : '',
      discussion_paragraph: typeof i.discussion_paragraph === 'string' ? i.discussion_paragraph : '',
      limitations_note: typeof i.limitations_note === 'string' ? i.limitations_note : '',
      what_this_means: typeof i.what_this_means === 'string' ? i.what_this_means : '',
    });
  }

  return json(200, { ok: true, result: out });
};
