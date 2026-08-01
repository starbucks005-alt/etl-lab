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

/* Collect every <rect> so text can be measured against the PANEL it sits on
   rather than against the canvas.

   This is the fix for a piece that shipped with two visible overruns while
   reporting overflow: null. Both lines were comfortably inside 1080 wide, so a
   canvas-width check passed them. What they actually overran was the cream
   panel and the green block they were sitting on. Measuring against the canvas
   answers a question nobody asked (2026-07-30). */
function collectRects(svg) {
  const rects = [];
  const re = /<rect\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(svg))) {
    const a = m[1];
    const num = (name) => {
      const hit = new RegExp('\\b' + name + '\\s*=\\s*["\']([-\\d.]+)').exec(a);
      return hit ? parseFloat(hit[1]) : NaN;
    };
    const x = num('x'), y = num('y'), w = num('width'), h = num('height');
    if (![x, y, w, h].every((v) => isFinite(v))) continue;
    rects.push({ x, y, w, h });
  }
  return rects;
}

/* The tightest rect containing this baseline point, ignoring anything the size
   of the whole artboard, which is the background rather than a panel. */
function panelUnder(rects, x, y, canvasW, canvasH) {
  let best = null;
  for (const r of rects) {
    if (r.w >= canvasW * 0.98 && r.h >= canvasH * 0.98) continue;
    // A baseline sits near the bottom of the cap-height box, so allow slack
    // above and below rather than demanding strict containment.
    if (x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 4 && y <= r.y + r.h + 8) {
      if (!best || r.w * r.h < best.w * best.h) best = r;
    }
  }
  return best;
}

/* Find text that would run past its container: its panel when it has one, the
   canvas when it does not. Returns plain-language complaints for the retry. */
function findOverflow(svg, canvasW, canvasH) {
  const problems = [];
  const boxes = [];
  const rects = collectRects(svg);
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    const content = m[2].replace(/<[^>]*>/g, '').trim();
    if (!content) continue;
    const attr = (name) => {
      const hit = new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)').exec(attrs);
      return hit ? hit[1] : '';
    };
    const x = parseFloat(attr('x')) || 0;
    const y = parseFloat(attr('y')) || 0;
    const size = parseFloat(attr('font-size')) || 16;
    const weight = attr('font-weight');
    const family = attr('font-family');
    const anchor = (attr('text-anchor') || 'start').toLowerCase();
    const w = estimateWidth(content, size, weight, family);

    let right = x + w;
    if (anchor === 'middle') right = x + w / 2;
    else if (anchor === 'end') right = x;

    const panel = panelUnder(rects, x, y, canvasW, canvasH);
    if (panel) {
      // Demand real padding inside the panel, not a hairline miss.
      const limit = panel.x + panel.w - Math.max(8, size * 0.25);
      if (right > limit) {
        problems.push('"' + content.slice(0, 42) + '" is wider than the panel it sits on. That panel ends at x=' +
          Math.round(panel.x + panel.w) + ' and the text reaches about x=' + Math.round(right) +
          '. Widen the panel to fit the text with padding, shorten the line, or reduce the size.');
        continue;
      }
    }
    if (right > canvasW * 1.02) {
      problems.push('"' + content.slice(0, 42) + '" runs off the canvas at ' + Math.round(size) +
        'px starting at x=' + Math.round(x) + '. Break it into shorter lines or reduce the size.');
    }

    /* Kept for the collision pass below. A baseline sits near the bottom of
       the cap-height box, so the box runs mostly upward from y. */
    let left = x;
    if (anchor === 'middle') left = x - w / 2;
    else if (anchor === 'end') left = x - w;
    boxes.push({
      text: content, size,
      left, right: left + w,
      top: y - size * 0.8, bottom: y + size * 0.22,
    });
  }

  problems.push(...findCollisions(boxes));
  return problems;
}

/* TWO LINES PRINTED ON TOP OF EACH OTHER.
   ─────────────────────────────────────────────────────────────────────────
   findOverflow asks whether a line overruns its container. It has no opinion
   about whether two lines overrun EACH OTHER, so a revision that gave the
   third and fourth headline lines nearly the same y passed every check and
   shipped with "remembers" printed through "you" (2026-07-31). Individually
   both were comfortably inside their panel; together they were unreadable.

   Deliberately not strict about touching. Tight leading is a design choice
   and cap-height boxes are an estimate, so this only complains when the pair
   genuinely sits on top of each other: a real share of the smaller line's
   height AND a real share of its width. */
function findCollisions(boxes) {
  const problems = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (vOverlap <= 0 || hOverlap <= 0) continue;
      const minH = Math.min(a.bottom - a.top, b.bottom - b.top);
      const minW = Math.min(a.right - a.left, b.right - b.left);
      if (vOverlap < minH * 0.35) continue;   // ordinary tight leading
      if (hOverlap < minW * 0.18) continue;   // a clipped corner, not a collision
      problems.push('"' + a.text.slice(0, 30) + '" and "' + b.text.slice(0, 30) +
        '" are printed on top of each other. Give them separate lines with real leading between the baselines, ' +
        'or shorten them so they do not occupy the same space. Text must never overlap other text.');
      if (problems.length >= 4) return problems;   // enough to fix on the retry
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

  const overflow = findOverflow(out, c.w, c.h);

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

/* THE TYPE, ON TRANSPARENT ALPHA.
   ─────────────────────────────────────────────────────────────────────────
   A flattened PNG is a dead asset to an animator: the words are baked into
   the picture, so the only available move is to push in on the whole frame,
   type and all. Dr. O animates in Claude Design by handing it frames and an
   action, and an overlay is what lets the plate move while the type holds
   still.

   Strips the artwork, and any rect the size of the artboard, which is the
   background rather than a panel and is the same test panelUnder already
   uses. Content panels SURVIVE on purpose: they are part of the type block,
   and an overlay without them is unreadable over a moving picture.

   Rasterised without flattening, so the alpha comes through (2026-07-31). */
async function renderOverlay(svg, canvasKey) {
  const c = CANVASES[canvasKey] || CANVASES.instagram;
  let out = normalizeFonts(String(svg));

  out = out.replace(/<image\b[^>]*>/gi, '').replace(/<\/image>/gi, '');

  out = out.replace(/<rect\b([^>]*)>/gi, (whole, attrs) => {
    const num = (name) => {
      const hit = new RegExp('\\b' + name + '\\s*=\\s*["\']([-\\d.]+)').exec(attrs);
      return hit ? parseFloat(hit[1]) : NaN;
    };
    const w = num('width'), h = num('height');
    if (!isFinite(w) || !isFinite(h)) return whole;

    /* GROUND, NOT PANEL.
       ─────────────────────────────────────────────────────────────────────
       The test used to be "as wide AND as tall as the artboard", which only
       catches a single full-canvas rect. The vertical-split layout paints its
       ground as TWO full-height panels either side of a divider, 528 and 672
       wide on a 1200 canvas, and neither is 98% wide. Both survived, and the
       overlay came back 0% transparent: laid over a video it would hide the
       video completely.

       The honest test is full-bleed on EITHER axis AND large. That removes a
       backdrop and the halves of a split, while keeping the things that are
       genuinely part of the type block: the 4px divider (full height but
       0.3% of the canvas) and the accent band behind a headline (large but
       full-bleed on neither axis) (2026-08-01). */
    const fullBleed = w >= c.w * 0.98 || h >= c.h * 0.98;
    const big = (w * h) >= (c.w * c.h) * 0.25;
    return (fullBleed && big) ? '' : whole;
  });

  return sharp(Buffer.from(out), { density: 72 })
    .resize(c.w, c.h, { fit: 'fill' })
    .png()
    .toBuffer();
}

module.exports = { CANVASES, renderSvg, renderOverlay, normalizeFonts, findOverflow, SERIF, SANS, MONO };
