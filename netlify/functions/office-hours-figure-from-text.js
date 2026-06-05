/* ─────────────────────────────────────────────────────────────────────────────
   office-hours-figure-from-text

   Faculty describes a diagram (concept map, flow chart, causal path model,
   variable map, theoretical framework, timeline) and picks a diagram type
   and color palette. Returns a self-contained publication-ready SVG figure
   ready to download as .svg or embed in a manuscript/poster.

   POST /.netlify/functions/office-hours-figure-from-text
   Body: {
     description: '<what to draw, min 10 chars>',
     type: 'conceptual' | 'flowchart' | 'causal' | 'variables' | 'framework' | 'timeline',
     palette: 'bw' | 'blue' | 'gold' | 'color',
     caption: '<optional caption>'
   }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4500;
const MAX_DESC_CHARS = 4000;
const MAX_CAPTION_CHARS = 600;

const VALID_TYPES = new Set(['conceptual', 'flowchart', 'causal', 'variables', 'framework', 'timeline']);
const VALID_PALETTES = new Set(['bw', 'blue', 'gold', 'color']);

const TYPE_INSTRUCTIONS = {
  conceptual: 'a conceptual model with boxes for constructs and arrows showing relationships. Use rectangles for main constructs and diamonds for mediators or moderators.',
  flowchart:  'a flowchart with rectangles for process steps, diamonds for decision nodes, and directional arrows showing flow.',
  causal:     'a path model with rectangles for variables and directional arrows showing causal paths. Label each arrow with the relationship type (e.g. + or , or beta value).',
  variables:  'a variable map grouping independent, mediating, moderating, and dependent variables in clearly labeled columns.',
  framework:  'a theoretical framework with layered or nested components showing relationships between levels.',
  timeline:   'a horizontal timeline with labeled nodes for key events or stages in chronological sequence.',
};

const PALETTES = {
  bw:    { box: '#ffffff', boxBorder: '#0a0a0f', boxText: '#0a0a0f', arrow: '#0a0a0f', bg: '#ffffff', accent: '#555555' },
  blue:  { box: '#e8f0fb', boxBorder: '#4a6fa5', boxText: '#1a3a6a', arrow: '#4a6fa5', bg: '#ffffff', accent: '#4a6fa5' },
  gold:  { box: '#fdf6e8', boxBorder: '#b8922a', boxText: '#0a0a0f', arrow: '#b8922a', bg: '#fffbef', accent: '#8a6c1a' },
  color: { box: '#e8f5ec', boxBorder: '#285c4d', boxText: '#0a0a0f', arrow: '#4a6fa5', bg: '#ffffff', accent: '#285c4d' },
};

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

function buildPrompt(payload) {
  const { description, type, palette, caption } = payload;
  const p = PALETTES[palette];
  const typeInstruction = TYPE_INSTRUCTIONS[type];

  return `You are an SVG diagram specialist. Generate a clean, publication-ready academic SVG figure based on the faculty description.

DESCRIPTION:
${description}

DIAGRAM TYPE: ${typeInstruction}

COLOR PALETTE (use these EXACT hex values):
  boxes: fill="${p.box}" stroke="${p.boxBorder}" text="${p.boxText}"
  arrows: stroke="${p.arrow}"
  background: ${p.bg}
  accent: ${p.accent}

${caption ? 'CAPTION TO DISPLAY UNDER FIGURE: ' + caption : ''}

RULES (strict, do not deviate):
- SVG opening tag MUST be: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
- Use <rect> for boxes with rx="4", <text> for labels, <line> or <path> for arrows, <polygon> for arrowheads.
- Fonts: font-family="Georgia, serif" for box labels; font-family="monospace" for small annotations on arrows.
- All text MUST fit inside its box. Wrap long labels across multiple <text> elements with dy offsets.
- Define an arrowhead marker once in <defs> (id="arr") and reference it via marker-end="url(#arr)" on lines/paths.
- NO external font imports, NO embedded images, NO scripts, NO foreignObject. Pure SVG only.
- First child of <svg>: a full-area background rect <rect x="0" y="0" width="800" height="500" fill="${p.bg}"/>.
${caption ? '- Reserve the bottom 60 pixels for a caption area. Render the caption with <text> at y=470, font-size="12", font-family="Georgia, serif", fill="' + p.accent + '", with the literal italic prefix "Figure 1. " followed by the caption text. Wrap long captions across two lines with dy="14".' : ''}
- Diagram content must fit within the top 440 pixels if a caption is present, top 480 pixels otherwise.

OUTPUT
Return ONLY the SVG code. Begin with <svg and end with </svg>. NO markdown fences, NO prose, NO explanation, NO preamble.`;
}

function extractSvg(text) {
  if (!text) return null;
  const stripped = text.replace(/```(?:svg|xml)?\s*/i, '').replace(/```\s*$/i, '');
  const m = stripped.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const description = String(body.description || '').trim().slice(0, MAX_DESC_CHARS);
  if (!description || description.length < 10) return json(400, { error: 'description required (min 10 chars)' });

  const type = String(body.type || 'conceptual').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) return json(400, { error: 'invalid diagram type' });

  const palette = String(body.palette || 'bw').trim().toLowerCase();
  if (!VALID_PALETTES.has(palette)) return json(400, { error: 'invalid palette' });

  const caption = String(body.caption || '').trim().slice(0, MAX_CAPTION_CHARS);

  const prompt = buildPrompt({ description, type, palette, caption });

  const client = new Anthropic({ apiKey });
  let modelOutput;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    modelOutput = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[figure-from-text] anthropic error', err && err.message);
    return json(502, { error: 'generation failed', detail: err && err.message });
  }

  if (!modelOutput) return json(502, { error: 'empty model output' });

  const svg = extractSvg(modelOutput);
  if (!svg) {
    console.error('[figure-from-text] could not extract SVG. raw head:', modelOutput.slice(0, 400));
    return json(502, { error: 'model did not return valid SVG', detail: modelOutput.slice(0, 400) });
  }

  return json(200, { ok: true, svg, caption, type, palette });
};
