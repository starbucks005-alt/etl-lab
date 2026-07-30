/* etl-design-background — the ETL Design relay.
   ─────────────────────────────────────────────────────────────────────────
   Four agents, one brief, in order. Each one's output is the next one's
   input, which is the entire point.

     1. Yuki Mendel   sets the house look   palette + type, from the concept
                                            image when one is uploaded
     2. Reid Callum   finds the angle       positioning, hook, proof points
     3. Zara Cole     writes the caption    the words BESIDE the graphic
     4. Chris Avila   makes the artwork     gpt-image-1, then Yuki composes
                                            the finished piece around it

   WHAT THE PRODUCT IS: a VISUAL for social media, with the caption beside it.
   Dr. O: "I like visuals for Social Media, that is why I want it."

   HOW IT GOT HERE, so nobody re-litigates it (2026-07-30):
   Gamma was step 4 for three live runs. It honoured the palette and nothing
   else. It ignored the typography, broke "Month 1 Free" into "Mon th 1 Free"
   mid-layout, added chips in colours Yuki never chose, and never placed a
   visual at all, so the deliverable was type in coloured boxes. Gamma builds
   decks; it cannot hold a 6x4 postcard at 300 DPI either. Asking it to be a
   design system was the mistake.

   Now the designer emits the design. Chris generates real artwork, Yuki
   composes the piece around it as SVG, and we rasterise with sharp, so the
   palette, the type, the layout and the canvas are the ones she specified.
   Zara's post is the caption beside the graphic, which is the job a social
   writer actually does.

   Chris Avila uses they/them.

   POST { job_id, promoting, audience, business_name, business_site, platform,
          concept_image (optional data URL) }
*/

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const { buyerVoiceCore, buyerAgentPrompt } = require('./_social-voice.js');
/* Loaded LAZILY, inside step 4, and deliberately so.
   _design-render pulls in sharp, a native module. When sharp was missing from
   package.json this require threw at MODULE LOAD, which killed the function
   before it could write a single line of job state, so the page polled a job
   that had never existed and showed nothing at all. Steps 1 to 3 are useful on
   their own; a broken renderer should cost the picture, not the whole job
   (2026-07-30). */
let renderSvg = null, CANVASES = null, openaiImage = null, renderLoadError = null;
try {
  ({ renderSvg, CANVASES } = require('./_design-render.js'));
  openaiImage = require('./_openai-image.js');
} catch (e) {
  renderLoadError = 'design renderer unavailable: ' + (e && e.message);
  console.error('[etl-design] ' + renderLoadError);
}
/* Canvas fallback so the rest of the relay can still reason about platform
   even when the renderer failed to load. */
const CANVAS_FALLBACK = { instagram: { w: 1080, h: 1080, kind: 'social', label: 'Instagram square' } };

const MODEL = 'claude-sonnet-4-6';

const PLATFORMS = {
  linkedin:  { name: 'LinkedIn',  charLimit: 3000, ideal: 1300, dims: '4x5',
               format: 'Long-form professional, about 1300 characters. Lead with a hook line that earns the click-to-expand. Line breaks every 1 or 2 sentences. 3 to 5 hashtags at the bottom.' },
  instagram: { name: 'Instagram', charLimit: 2200, ideal: 150,  dims: '1x1',
               format: 'Caption style. The first 125 characters show without a "more" tap, so put the hook there. 5 to 15 hashtags, mixing broad and niche.' },
  x:         { name: 'X',         charLimit: 280,  ideal: 240,  dims: '16x9',
               format: '280 character hard maximum. Single post, no threads. Conversational. 1 to 3 hashtags.' },
  facebook:  { name: 'Facebook',  charLimit: 5000, ideal: 250,  dims: '1x1',
               format: 'Conversational, about 250 characters. Broader audience than LinkedIn. 0 to 2 hashtags. A question at the end works well.' },
};

function extractJson(raw) {
  let s = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {} }
  throw new Error('model did not return usable JSON');
}

const NO_EM_DASH = 'Do not use em dashes or en dashes anywhere. Use commas or periods.';

/* Belt and braces on the house rule. Gamma lays out exactly what we send, so
   whatever slips past the prompt ends up rendered into a PNG a customer
   posts, where it cannot be edited. Strip at the door. */
function deDash(s) {
  return String(s == null ? '' : s).replace(/\s*[—–]\s*/g, ', ');
}

async function ask(client, system, content, maxTokens) {
  const r = await client.messages.create({
    model: MODEL, max_tokens: maxTokens || 1200, system,
    messages: [{ role: 'user', content }],
  });
  return (r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
}

/* A data URL from the browser -> an Anthropic image block. Returns null for
   anything that is not a plausible inline image, so a malformed paste
   degrades to "no concept image" instead of failing the whole job. */
function imageBlock(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) return null;
  const media = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
  if (m[2].length > 7000000) return null;            // ~5MB decoded, Anthropic's ceiling
  return { type: 'image', source: { type: 'base64', media_type: media, data: m[2] } };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const jobId = String(body.job_id || '').trim();
  if (!jobId) return { statusCode: 400, body: 'job_id required' };

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore('etl_design_jobs'); } catch (e) {
    console.error('[etl-design] blob store unavailable', e && e.message);
    return { statusCode: 500, body: 'no store' };
  }

  const brief = {
    promoting:     String(body.promoting || '').trim().slice(0, 1200),
    audience:      String(body.audience || '').trim().slice(0, 400),
    businessName:  String(body.business_name || '').trim().slice(0, 160),
    businessSite:  String(body.business_site || '').trim().slice(0, 300),
    platform:      PLATFORMS[body.platform] ? body.platform : 'linkedin',
  };
  const P = PLATFORMS[brief.platform];
  const co = brief.businessName || 'this business';
  const concept = imageBlock(body.concept_image);

  const state = {
    job_id: jobId, status: 'running', step: 0, of: 4,
    created_at: new Date().toISOString(),
    brief: Object.assign({}, brief, { had_concept_image: !!concept }),
    result: {}, error: null,
  };
  const save = async (patch) => {
    Object.assign(state, patch || {});
    state.updated_at = new Date().toISOString();
    try { await store.setJSON(jobId, state); } catch (e) { console.error('[etl-design] save failed', e && e.message); }
  };
  await save({ step: 0, note: concept ? 'Yuki is reading your concept image.' : 'Yuki is setting the look.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { await save({ status: 'error', error: 'ANTHROPIC_API_KEY not set' }); return { statusCode: 500, body: 'no key' }; }
  const client = new Anthropic({ apiKey });

  try {
    /* ── 1. Yuki: the house look, anchored to the concept image ────────── */
    const yukiText =
      'BUSINESS: ' + co + (brief.businessSite ? ' (' + brief.businessSite + ')' : '') +
      '\nWHAT THEY ARE PROMOTING: ' + brief.promoting +
      '\nAUDIENCE: ' + (brief.audience || 'not specified') +
      (concept
        ? '\n\nThe attached image is the client\'s own concept reference. Pull the palette and the mood FROM IT. Name colours you can actually see in it, with hex values you have judged from the image, and choose type that suits it. If the image is a photo of their space, product or work, treat it as the truth about who they are.'
        : '') +
      '\n\nSet the brand direction.';
    const yuki = extractJson(await ask(client,
      'You are Yuki Mendel, a type-first graphic designer. You make wordmarks, not mascots. You build a small brand system a one-person shop can hold together: a typeface pairing, a tight palette, and the spacing logic that makes it look deliberate. ' + NO_EM_DASH +
      '\n\nReturn ONLY JSON: {"wordmark":"how the name should be set, one sentence","palette":[{"name":"Ink","hex":"#111111","use":"body text"}],"fonts":{"display":"a real, widely available typeface","body":"a real, widely available typeface"},"look":"two sentences on the overall feel and why it fits this audience"}. Give exactly 4 palette entries with real hex values.',
      concept ? [concept, { type: 'text', text: yukiText }] : yukiText, 1200));
    await save({ step: 1, note: 'Reid is finding the angle.', result: Object.assign(state.result, { brand: yuki }) });

    /* ── 2. Reid: the angle, AND the words that go on the graphic ──────── */
    // Reid writes the card copy here rather than letting Gamma invent it.
    // Gamma is given this verbatim under textMode 'preserve'.
    const reid = extractJson(await ask(client,
      'You are Reid Callum, a go-to-market strategist. You tell people how to sell the thing, not how to describe it. You never invent statistics, awards, customer counts, testimonials or prices. ' + NO_EM_DASH +
      '\n\nYou are also writing the words that will be SET IN TYPE on a single marketing graphic, so they must be short enough to read at a glance. Return ONLY JSON: ' +
      '{"positioning":"one sentence, the clear reason to pick them","hook":"the single sharpest line to lead with","proof_points":["2 to 3 short concrete points, drawn only from the brief"],' +
      '"card":{"headline":"6 to 9 words maximum","subhead":"one sentence, 18 words maximum","blocks":[{"title":"2 to 4 words","body":"one sentence, 14 words maximum"}]}}. Give exactly 3 blocks.',
      'BUSINESS: ' + co +
      '\nWHAT THEY ARE PROMOTING: ' + brief.promoting +
      '\nAUDIENCE: ' + (brief.audience || 'not specified') +
      '\n\nFind the angle and write the graphic.', 1400));
    await save({ step: 2, note: 'Zara is writing the caption.', result: Object.assign(state.result, { angle: reid }) });

    /* ── 3. Zara: the caption that goes beside the graphic ─────────────── */
    const zaraSys = buyerVoiceCore('', co) + '\n\n---\n\nSTYLE TILT (apply on top of the baseline voice):\n\n' +
      buyerAgentPrompt('zara', '', co) +
      '\n\nThis is the CAPTION that sits beside a finished graphic. The graphic already carries the headline "' +
      deDash((reid.card && reid.card.headline) || reid.hook || '') + '". Do not simply repeat it; say the thing the picture cannot.' +
      '\n\nPLATFORM RULES, write for ' + P.name + ':\n' + P.format +
      '\nCharacter limit: ' + P.charLimit + ' hard max, ' + P.ideal + ' target.\n\n' +
      'ANGLE (from the strategist, do not contradict it):\nPositioning: ' + (reid.positioning || '') + '\n\n' +
      (brief.businessSite
        ? 'URL RULE, HARD: if you include a link use EXACTLY ' + brief.businessSite + ', character for character. Never invent or alter it.\n\n'
        : 'URL RULE, HARD: no link was supplied. Do NOT include any URL and do NOT guess one from the name.\n\n') +
      'Never invent statistics, testimonials, prices, or customer counts. ' + NO_EM_DASH + '\n\n' +
      'Return ONLY JSON: {"post":"the caption without hashtags","hashtags":"space separated, or empty","notes":"one sentence on why this lands for this platform"}';
    const zara = extractJson(await ask(client, zaraSys,
      'SUBJECT: ' + brief.promoting + '\n\nWrite the caption for ' + P.name + '.', 1500));
    await save({ step: 3, note: 'Chris is building the graphic.', result: Object.assign(state.result, { copy: zara, platform: P.name }) });

    /* ── 4. Chris: real artwork, then the piece composed around it ─────── */
    // Two moves, because the point of the product is a VISUAL. The first
    // build handed a description to Gamma and got type in coloured boxes
    // back, which is not design. Chris makes an actual image; Yuki composes
    // the finished piece around it in SVG and we rasterise that ourselves,
    // so the palette, the type and the layout are the ones she specified
    // rather than a deck tool's approximation of them (2026-07-30).
    if (renderLoadError) {
      // Steps 1 to 3 already landed and are worth having. Say plainly that the
      // picture is missing rather than failing the job the client just waited
      // through, and charge nothing for it.
      await save({ result: Object.assign(state.result, { image_error: renderLoadError }) });
      await save({ status: 'done', step: 4, note: 'Ready, without the graphic.' });
      return { statusCode: 200, body: 'ok (no renderer)' };
    }
    const CANVAS_TABLE = CANVASES || CANVAS_FALLBACK;
    const canvasKey = CANVAS_TABLE[brief.platform] ? brief.platform : 'instagram';
    const canvas = CANVAS_TABLE[canvasKey];
    const pal = Array.isArray(yuki.palette) ? yuki.palette : [];
    const paletteText = pal.map(p => (p.name || '') + ' ' + (p.hex || '')).join(', ');
    const card = reid.card || {};
    const blocks = Array.isArray(card.blocks) ? card.blocks : [];

    let artB64 = '';
    try {
      const orient = canvas.w > canvas.h ? 'landscape' : (canvas.h > canvas.w ? 'portrait' : 'square');
      const artPrompt = [
        'Editorial marketing artwork for ' + co + '. Subject: ' + brief.promoting + '.',
        'Mood: ' + (yuki.look || '') + '.',
        'Use this colour palette and nothing else: ' + paletteText + '.',
        'Absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO watermarks anywhere in the image.',
        // Asking for "no text" is not enough on its own: gpt-image-1 wrote
        // MEPPERS onto a bottle label doing exactly that. Steer it off the
        // surfaces that invite lettering in the first place (2026-07-30).
        'Do not depict product labels, packaging, signage, posters, menus, price tags or storefronts, since those invite lettering. Show the subject matter itself, materials, ingredients, hands, texture, place.',
        'Composition must work as a BACKGROUND: even tone, no single dominant focal object, nothing important in the top third or along the left edge.',
        'Photographic or richly illustrated, confident composition, not a flat icon and not clip art.',
        concept ? 'Match the look, setting and colouring of the reference the client supplied.' : '',
      ].filter(Boolean).join(' ');
      artB64 = await openaiImage.generate(artPrompt, openaiImage.SIZES[orient], 'medium');
      await save({ note: 'Yuki is composing the piece.' });
    } catch (e) {
      // No artwork is survivable: Yuki can compose a strong type-led piece
      // in her own palette. Losing the whole job over it is not.
      console.error('[etl-design] artwork failed', e && e.message);
      await save({ result: Object.assign(state.result, { art_error: String(e && e.message).slice(0, 200) }) });
    }

    /* Yuki composes. She is given the exact canvas, the exact words, and the
       artwork to build around. */
    const artHref = artB64 ? ('data:image/png;base64,' + artB64) : '';
    const composeSys = [
      'You are Yuki Mendel, a type-first graphic designer. You are producing FINISHED ARTWORK as a single SVG document. Output ONLY the SVG, starting with <svg and ending with </svg>. No markdown fence, no commentary.',
      '',
      'CANVAS: exactly ' + canvas.w + ' by ' + canvas.h + ' (' + canvas.label + '). Use viewBox="0 0 ' + canvas.w + ' ' + canvas.h + '".',
      (canvas.kind === 'print'
        ? 'THIS IS PRINT. Anything meant to reach the edge must bleed to the artboard edge, and NOTHING readable may sit within ' + canvas.safe + ' units of any edge, or it will be trimmed off.'
        : 'Keep important elements clear of the outer 40 units so nothing is cropped by a feed.'),
      '',
      'PALETTE, use these and nothing else: ' + paletteText + '.',
      'TYPE: ' + ((yuki.fonts && yuki.fonts.display) || 'a serif') + ' for display, ' + ((yuki.fonts && yuki.fonts.body) || 'a sans-serif') + ' for body. Set font-family to a stack ending in "serif" or "sans-serif".',
      '',
      artHref
        ? 'ARTWORK: place <image href="CONCEPT_IMAGE" .../> as a major element. Use the literal string CONCEPT_IMAGE as the href; it is substituted at render time. Give it a real role in the composition: full bleed behind the type, a strong band, or a confident crop. Use <clipPath> or a translucent <rect> in a palette colour over it so the headline stays readable.'
        : 'There is no photograph. Build a strong type-led composition using rules, blocks, and generous negative space.',
      '',
      'HARD RULES, these break the piece if ignored:',
      '1. SVG <text> DOES NOT WRAP. Emit each line as its own <text>. Never put a long sentence in one <text>.',
      '2. Keep display lines under about 28 characters and body lines under about 48.',
      '3. Never break a word across lines.',
      '4. No em dashes or en dashes anywhere.',
      '5. Every colour must be a hex from the palette above.',
      '6. Do not invent copy. Use only the words given below, though you may drop a block if the composition is stronger without it.',
      '7. CONTRAST IS NOT OPTIONAL. Wherever text sits over the artwork you MUST first lay a solid or gradient <rect> from the palette across that whole region, at 0.72 opacity or heavier. Asking the artwork to leave room does not work; it did not. Every line of text must sit on a flat field, not on a photograph.',
      '8. DECORATIVE TYPE MUST NOT TOUCH ANYTHING. An oversized background word or numeral has to clear every block, rule, panel and text element by at least 40 units on all sides. If it cannot, do not draw it. Filling an awkward gap with a giant ghosted word is not composition, and it has now produced both a stray 6 and a HEAT lying under the content blocks. Restructure the layout instead.',
      '9. Any decorative numeral or symbol must be labelled by adjacent text, or omitted. A lone 6 means nothing to someone who did not read the brief.',
      '10. THE NAME AND THE URL ARE THE RESPONSE MECHANISM. They must be the highest contrast small text on the piece: set them on a plain field in the lightest palette colour against the darkest, or the reverse. They may never sit on artwork, on a rule, on a band edge, or in a colour close to what is behind them. Losing the URL loses the whole point of the piece, and dark red on near black across a rule line is exactly how that happened.',
      '11. Leave a clear margin between the last content block and the footer. Do not fill that band with decoration.',
    ].join('\n');

    const composeUser = [
      'HEADLINE: ' + deDash(card.headline || reid.hook || co),
      'SUBHEAD: ' + deDash(card.subhead || reid.positioning || ''),
      '',
      'BLOCKS:',
      blocks.map((b, i) => (i + 1) + '. ' + deDash(b.title || '') + ' :: ' + deDash(b.body || '')).join('\n'),
      '',
      'FOOTER: ' + deDash(co) + (brief.businessSite ? '  ·  ' + deDash(brief.businessSite) : ''),
      '',
      'Compose the piece.',
    ].join('\n');

    let svg = await ask(client, composeSys, composeUser, 4000);
    svg = svg.replace(/^```(?:svg|xml|html)?\s*/i, '').replace(/```\s*$/, '').trim();

    try {
      let out = await renderSvg(svg, canvasKey, artHref);
      // One retry, with the measured complaints handed back. Text running off
      // the canvas is the single most likely way this ships something broken,
      // and it is exactly what "Mon th 1 Free" looked like under Gamma.
      if (out.overflow.length) {
        console.warn('[etl-design] overflow, retrying:', out.overflow.join(' | '));
        const fixed = await ask(client,
          composeSys + '\n\nYOUR PREVIOUS ATTEMPT OVERRAN THE CANVAS. Fix these and return the corrected SVG only:\n' +
          out.overflow.map(o => '- ' + o).join('\n'),
          composeUser, 4000);
        const cleaned = fixed.replace(/^```(?:svg|xml|html)?\s*/i, '').replace(/```\s*$/, '').trim();
        if (/^<svg/i.test(cleaned)) {
          const retry = await renderSvg(cleaned, canvasKey, artHref);
          if (retry.overflow.length <= out.overflow.length) out = retry;
        }
      }
      const key = jobId + '.png';
      await store.set(key, out.png, { metadata: { contentType: 'image/png' } });
      // Keep the SVG. It is the DESIGN SOURCE: the PNG is just a picture of
      // it. Without this, a question as basic as "why is there a 6 on my
      // piece" cannot be answered except by guessing, and a defect cannot be
      // traced to the element that caused it (2026-07-30). It also makes an
      // editable hand-off possible later.
      try { await store.set(jobId + '.svg', out.svg, { metadata: { contentType: 'image/svg+xml' } }); }
      catch (e) { console.warn('[etl-design] svg not stored (non-fatal)', e && e.message); }
      await save({ result: Object.assign(state.result, {
        image_key: key,
        image_w: out.canvas.w, image_h: out.canvas.h,
        image_kind: out.canvas.kind, image_label: out.canvas.label,
        overflow_notes: out.overflow.length ? out.overflow : null,
      }) });
    } catch (e) {
      console.error('[etl-design] compose/render failed', e && e.message);
      await save({ result: Object.assign(state.result, { image_error: String(e && e.message).slice(0, 240) }) });
    }

    await save({ status: 'done', step: 4, note: 'Ready.' });
    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('[etl-design] relay failed', err && err.message);
    await save({ status: 'error', error: (err && err.message) || 'relay failed' });
    return { statusCode: 500, body: 'failed' };
  }
};
