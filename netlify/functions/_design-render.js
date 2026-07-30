/* _design-render — turn Yuki's SVG into a finished PNG.
   ─────────────────────────────────────────────────────────────────────────
   Replaces Gamma as step 4. Gamma honoured the palette and nothing else: it
   ignored the typography, broke a word in half mid-layout, added chips in
   colours Yuki never chose, and never placed a visual at all. It makes decks,
   and a deck tool cannot hold a 6x4 postcard at 300 DPI with USPS clear
   zones, which is the job Dr. O actually brought (2026-07-30).

   So the designer emits the design, and we rasterise it. sharp is already a
   dependency and renders SVG through librsvg.

   Two things this file exists to protect:

   1. FONTS. The Netlify runtime is Linux with a different font set than any
      dev machine. A named face that resolves locally and silently falls back
      in production is exactly the bug that looks fine here and ships wrong,
      so every font-family is rewritten to end in a generic family.

   2. TEXT DOES NOT WRAP IN SVG. An over-long <text> runs off the canvas
      instead of reflowing. Yuki is told to emit explicit lines; this module
      measures what she sent and reports anything that would overrun, so the
      caller can retry rather than ship a piece with words hanging off it.
*/

const path = require('path');
const fs = require('fs');

/* FONTS MUST BE POINTED AT BEFORE sharp LOADS.
   ─────────────────────────────────────────────────────────────────────────
   Netlify's Lambda image ships with no font files. librsvg draws text through
   pango/fontconfig, so the first live render produced a piece with correct
   artwork, correct colours, correct composition, and every single letter as a
   missing-glyph box. Rewriting families to generics cannot help when there is
   nothing to fall back TO.

   Four faces now travel with the function. fontconfig reads its config once,
   lazily, on first use, so FONTCONFIG_PATH has to be set before anything
   triggers that, which means before sharp is required. */
(function pointFontconfigAtOurFonts() {
  const candidates = [
    path.join(__dirname, 'fonts'),
    path.join(process.cwd(), 'netlify', 'functions', 'fonts'),
    path.join(process.cwd(), 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'fonts.conf'))) {
        process.env.FONTCONFIG_PATH = dir;
        process.env.FONTCONFIG_FILE = path.join(dir, 'fonts.conf');
        try { fs.mkdirSync('/tmp/fontconfig', { recursive: true }); } catch (_) {}
        return;
      }
    } catch (_) {}
  }
  console.warn('[design-render] no bundled fonts found; text will render as boxes');
})();

const sharp = require('sharp');

/* Canvas sizes. Social in pixels, print at 300 DPI with a safe margin the
   design must stay inside. */
const CANVASES = {
  linkedin:  { w: 1200, h: 1500, label: 'LinkedIn 4:5',      kind: 'social' },
  instagram: { w: 1080, h: 1080, label: 'Instagram square',  kind: 'social' },
  x:         { w: 1600, h: 900,  label: 'X 16:9',            kind: 'social' },
  facebook:  { w: 1200, h: 1200, label: 'Facebook square',   kind: 'social' },
  // Print. Trim size at 300 DPI, plus 0.125in bleed on every edge, so the
  // artboard is larger than the finished card and anything meant to run to
  // the edge must actually run into the bleed.
  postcard6x4: { w: 1875, h: 1275, trimW: 1800, trimH: 1200, bleed: 37, safe: 112,
                 label: 'Postcard 6x4 at 300 DPI', kind: 'print' },
  postcard6x9: { w: 2775, h: 1875, trimW: 2700, trimH: 1800, bleed: 37, safe: 112,
                 label: 'Postcard 6x9 at 300 DPI', kind: 'print' },
};

/* Generic families librsvg will always resolve on a bare Linux box. Yuki
   names a real typeface for the brand sheet; what actually renders is the
   generic, and saying so out loud beats pretending otherwise. */
const SERIF = "'DejaVu Serif', Georgia, 'Times New Roman', serif";
const SANS  = "'DejaVu Sans', Helvetica, Arial, sans-serif";
const MONO  = "'DejaVu Sans Mono', 'Courier New', monospace";

function normalizeFonts(svg) {
  return String(svg).replace(/font-family\s*=\s*(["'])(.*?)\1/gi, (m, q, val) => {
    const v = val.toLowerCase();
    if (/mono|courier|consol/.test(v)) return 'font-family="' + MONO + '"';
    if (/serif/.test(v) && !/sans/.test(v)) return 'font-family="' + SERIF + '"';
    if (/sans|helvetica|arial|inter|grotesk|gothic/.test(v)) return 'font-family="' + SANS + '"';
    // A named face we cannot vouch for. Keep it first, then a generic, so
    // librsvg has somewhere real to land.
    return 'font-family="' + val + ', ' + SANS + '"';
  });
}

/* Rough advance-width estimate. librsvg gives us no measuring API, so this
   is a deliberately conservative approximation used only to catch text that
   would visibly overrun the canvas. Serif and bold run wider. */
function estimateWidth(text, fontSize, weightAttr, familyAttr) {
  const bold = /bold|[6-9]00/.test(String(weightAttr || ''));
  const serif = /serif/i.test(String(familyAttr || '')) && !/sans/i.test(String(familyAttr || ''));
  let per = 0.50;
  if (serif) per += 0.02;
  if (bold)  per += 0.04;
  return String(text).length * fontSize * per;
}

/* Find <text> elements that would run past the right edge. Returns a list of
   plain-language complaints for the model to fix on a retry. */
function findOverflow(svg, canvasW) {
  const problems = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    const content = m[2].replace(/<[^>]*>/g, '').trim();
    if (!content) continue;
    const x = parseFloat((/\bx\s*=\s*["']([-\d.]+)/.exec(attrs) || [])[1] || '0');
    const size = parseFloat((/\bfont-size\s*=\s*["']([\d.]+)/.exec(attrs) || [])[1] || '16');
    const weight = (/\bfont-weight\s*=\s*["']([^"']+)/.exec(attrs) || [])[1];
    const family = (/\bfont-family\s*=\s*["']([^"']+)/.exec(attrs) || [])[1];
    const anchor = ((/\btext-anchor\s*=\s*["']([^"']+)/.exec(attrs) || [])[1] || 'start').toLowerCase();
    const w = estimateWidth(content, size, weight, family);
    let right = x + w;
    if (anchor === 'middle') right = x + w / 2;
    else if (anchor === 'end') right = x;
    if (right > canvasW * 1.02) {
      problems.push('"' + content.slice(0, 42) + '" is too long for one line at ' + Math.round(size) +
                    'px starting at x=' + Math.round(x) + '. Break it into shorter lines or reduce the size.');
    }
  }
  return problems;
}

/* Embed the client's uploaded photo so it can actually be part of the design
   rather than only informing the palette. Yuki references it as
   href="CONCEPT_IMAGE" and we swap in the data URL. */
function injectConcept(svg, conceptDataUrl) {
  if (!conceptDataUrl) {
    // No upload: strip any <image> that points at the placeholder, so a
    // missing photo leaves a clean composition instead of a broken icon.
    return String(svg).replace(/<image\b[^>]*href\s*=\s*["']CONCEPT_IMAGE["'][^>]*\/?>(?:<\/image>)?/gi, '');
  }
  return String(svg).replace(/CONCEPT_IMAGE/g, conceptDataUrl);
}

async function renderSvg(svg, canvasKey, conceptDataUrl) {
  const c = CANVASES[canvasKey] || CANVASES.instagram;
  let out = injectConcept(svg, conceptDataUrl);
  out = normalizeFonts(out);

  // Force the artboard. A model that quietly emits a different width would
  // otherwise produce a correct-looking piece at the wrong physical size,
  // which for print means a card that will not trim.
  out = out.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    const cleaned = attrs
      .replace(/\swidth\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\sheight\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\sviewBox\s*=\s*["'][^"']*["']/gi, '');
    return '<svg' + cleaned + ' width="' + c.w + '" height="' + c.h +
           '" viewBox="0 0 ' + c.w + ' ' + c.h + '">';
  });
  if (!/xmlns=/i.test(out)) out = out.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');

  const overflow = findOverflow(out, c.w);

  // NO density option. The SVG already carries explicit pixel width/height,
  // and density RESCALES that by density/72: at 300 it turned a 1080 square
  // into 4500, which then blew the function's response cap and returned a 502
  // instead of a picture. Print sizes are already expressed in pixels at
  // 300 DPI in the canvas table, so the artboard is the artboard (2026-07-30).
  const png = await sharp(Buffer.from(out))
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, overflow, canvas: c, svg: out };
}

module.exports = { CANVASES, renderSvg, normalizeFonts, findOverflow, SERIF, SANS, MONO };
