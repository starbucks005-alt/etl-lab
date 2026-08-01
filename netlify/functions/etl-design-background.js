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
const composeBrief = require('./_design-compose.js');
const brandExtract = require('./_brand-extract.js');
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

/* NAMED LOOKS A CLIENT CAN ASK FOR BY NAME.
   ─────────────────────────────────────────────────────────────────────────
   "I want them all to feel tech forward, think Blade Runner & Black Mirror."
   Those are two OPPOSITE looks and it is worth keeping them apart, because
   asking for both at once is how you get neither. Blade Runner is night,
   rain, scale and neon through smoke. Black Mirror is the reverse: bright,
   clean, ordinary, shot like a furniture catalogue, and the horror is that
   one detail in a pleasant scene is deeply wrong. Nobody in Black Mirror
   glows (2026-07-31). */
const LOOKS = {
  'black mirror':
    'BLACK MIRROR. Bright, clean and entirely ordinary. Contemporary rooms, contemporary clothes, even neutral light, shot like a furniture catalogue or a product launch. Cool near-neutral palette, one restrained accent, a precise grotesque or a sharp modern serif. The unease is never in the lighting: it is that one fact about an otherwise pleasant scene is deeply wrong. Nothing glows.',
  'blade runner':
    'BLADE RUNNER. Night, depth and scale. Hard practical light, deep shadow, wet reflective surfaces, one saturated colour burning out of the dark. Dense and cinematic rather than clean. Type is confident and slightly cold. No daylight, no cosiness.',
  'modern editorial':
    'MODERN EDITORIAL. Stark grid, enormous type, flat unmodulated colour, no texture, no warmth for its own sake.',
  'technical':
    'TECHNICAL. High contrast, precise, monospaced or grotesque type, hard edges, the confidence of an instrument panel.',
  'luxe':
    'LUXE. Deep saturated colour, a fine serif, wide margins, restraint that reads as expensive.',
  'archival':
    'ARCHIVAL. Engraved, etched or printed, one or two inks, the authority of an old plate rendered sharply.',
  'clinical':
    'CLINICAL. Near white, sharp, minimal, one accent, the clarity of good medical or scientific work.',
  'warm':
    'WARM. Soft light, illustrated, human and intimate.',
};

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
    /* THE REGISTER LOCK.
       ─────────────────────────────────────────────────────────────────
       Yuki picks a register from a list, and left to choose she goes warm
       every time, which is how five My Echo pieces came back as sepia
       storybook illustration for a product about frontier AI. Dr. O has
       said what she wants more than once: "I want them all to feel tech
       forward, think Blade Runner & Black Mirror," and then, watching me
       set up another run without it, "what you are going to make is going
       to be another piece that will be wasted."

       So the register becomes an INPUT rather than a choice. Blank keeps
       the old behaviour for a client with no view (2026-07-31). */
    look:          String(body.look || '').trim().slice(0, 60).toLowerCase(),
  };
  const P = PLATFORMS[brief.platform];
  const co = brief.businessName || 'this business';
  let concept = imageBlock(body.concept_image);
  const uploadedConcept = !!concept;

  const state = {
    job_id: jobId, status: 'running', step: 0, of: 4,
    created_at: new Date().toISOString(),
    brief: Object.assign({}, brief, { had_concept_image: uploadedConcept }),
    result: {}, error: null,
  };
  const save = async (patch) => {
    Object.assign(state, patch || {});
    state.updated_at = new Date().toISOString();
    try { await store.setJSON(jobId, state); } catch (e) { console.error('[etl-design] save failed', e && e.message); }
  };
  await save({ step: 0, note: uploadedConcept ? 'Yuki is reading your concept image.' : 'Yuki is setting the look.' });

  /* READ THE CLIENT'S EXISTING BRAND OFF THEIR OWN SITE.
     ─────────────────────────────────────────────────────────────────────
     Six pieces were made for My Echo and Dr. O kept one. The keeper was the
     run where she had uploaded the M.E. logo: Yuki came back with the actual
     brand, near-black and antique gold in a serif. The five that invented a
     palette all looked like somebody else's product. "What made this one
     work so well is how much it looked in sync with the product."

     The website was on the form the whole time and touched nothing but the
     footer. Now it does the job the uploaded logo did. An upload still wins,
     because a client who hands us a specific file means that file. */
  let brandFacts = '';
  if (brief.businessSite) {
    let ex = null;
    try {
      await save({ note: 'Yuki is looking at your website.' });
      ex = await brandExtract.extractBrand(brief.businessSite);
    } catch (e) {
      ex = { ok: false, error: (e && e.message) || 'brand read failed' };
    }
    /* Recorded either way. A silent fallback to an invented palette is the
       exact failure this feature exists to end, so the page must be able to
       tell the client we could not read their brand. */
    state.brand_source = ex && ex.ok
      ? { ok: true, source: ex.source, palette: ex.palette, fonts: ex.fonts,
          got_logo: !!ex.concept_data_url, image_url: ex.image_url || null,
          used_as_concept: !uploadedConcept && !!ex.concept_data_url }
      : { ok: false, error: (ex && ex.error) || 'unknown' };

    if (ex && ex.ok) {
      if (!uploadedConcept && ex.concept_data_url) concept = imageBlock(ex.concept_data_url);
      const bits = [];
      if (ex.palette && ex.palette.length) bits.push('Colours actually used on ' + ex.source + ', most frequent first: ' + ex.palette.join(', ') + '.');
      if (ex.fonts && ex.fonts.length) bits.push('Typefaces their site declares: ' + ex.fonts.join(', ') + '.');
      if (bits.length) {
        brandFacts = '\n\nTHIS CLIENT ALREADY HAS A BRAND. It was read from their own website, so it is fact, not preference. ' +
          bits.join(' ') +
          ' Build the direction ON these. Use their colours as your palette, adjusting only for contrast where a value is unusable for text, and keep their typefaces unless one genuinely cannot set a headline. Do not invent a new identity for a business that already has one.';
      }
    }
    await save({});
  }

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
      /* THE ONE-NOTE PROBLEM. Six runs, and runs three to six were the same
         warm sepia illustration with the furniture rearranged. Dr. O: "we are
         a 1-note firm" (2026-07-31). The layout archetypes gave the pieces
         different SHAPES while the tone never moved, and tone is what a
         client actually sees. Cause: nothing asked Yuki to CHOOSE a register.
         She read the emotion in a brief and went warm, every time. Same fix
         that worked for the block count and the layout: replace a default
         with a real choice. Yuki is upstream of Chris, who is handed her
         "look" as his mood line, so this is also the only place the category
         rule can actually bite. */
      (LOOKS[brief.look]
        /* ASSIGNED, so there is nothing to default to. Same lesson as the
           layout archetypes: given a menu, the model takes the safe answer
           every time. */
        ? ('\n\nTHE CLIENT HAS SPECIFIED THE LOOK. Build this one. It is not a choice and there is nothing to weigh up.\n' +
           LOOKS[brief.look] +
           '\nCommit to it in the palette, the type and the look line. Do not soften it toward something warmer or safer. ')
        : '\n\nCHOOSE A VISUAL REGISTER. This is the decision that makes one firm look like a firm and not a filter. Pick the one that fits THIS business and audience, commit to it in the palette, the type and the look, and do not blend them:\n' +
      'A. MODERN EDITORIAL. Stark grid, enormous type, flat unmodulated colour, no texture, no warmth for its own sake.\n' +
      'B. TECHNICAL. High contrast, precise, monospaced or grotesque type, hard edges, the confidence of an instrument panel.\n' +
      'C. LUXE. Deep saturated colour, a fine serif, wide margins, restraint that reads as expensive.\n' +
      'D. ARCHIVAL. Engraved, etched or printed, one or two inks, the authority of an old plate rendered sharply.\n' +
      'E. CLINICAL. Near white, sharp, minimal, one accent, the clarity of good medical or scientific work.\n' +
      'F. WARM. Soft light, illustrated, human and intimate.\n' +
      'DO NOT DEFAULT TO F. It is the easiest answer for any brief with a feeling in it and it has been chosen far too often. A tender subject does not require a tender treatment: warmth in the words against restraint in the design is usually stronger than both at once. ') +
      /* Placed here rather than in Chris's art prompt, where it was first
         written and could not work: by the time Chris runs, Yuki's look has
         already set the direction he is told to match. */
      'A TECHNOLOGY BUSINESS MUST NOT BE STYLED AS A HERITAGE ONE. No nostalgia, no antique or period feel, no storybook softness standing in for emotion. If this business is about something new, the look has to be contemporary. ' + NO_EM_DASH +
      '\n\nReturn ONLY JSON: {"wordmark":"how the name should be set, one sentence","palette":[{"name":"Ink","hex":"#111111","use":"body text"}],"fonts":{"display":"a real, widely available typeface","body":"a real, widely available typeface"},"look":"two sentences on the overall feel and why it fits this audience"}. Give exactly 4 palette entries with real hex values.',
      concept ? [concept, { type: 'text', text: yukiText + brandFacts }] : (yukiText + brandFacts), 1200));
    await save({ step: 1, note: 'Reid is finding the angle.', result: Object.assign(state.result, { brand: yuki }) });

    /* ── 2. Reid: the angle, AND the words that go on the graphic ──────── */
    // Reid writes the card copy here rather than letting Gamma invent it.
    // Gamma is given this verbatim under textMode 'preserve'.
    const reid = extractJson(await ask(client,
      'You are Reid Callum, a go-to-market strategist. You tell people how to sell the thing, not how to describe it. You never invent statistics, awards, customer counts, testimonials or prices. ' +
      /* Reid led with "remembers you", which every companion app on earth
         claims, and buried the genuinely strange part (the agents hold their
         own conversations while you are away) in a footnote. Dr. O: "many AI
         products out there remember you, ai relationship apps" (2026-07-31). */
      '\n\nDO NOT LEAD WITH WHAT THE WHOLE CATEGORY ALREADY CLAIMS. Work out what this business\'s competitors also say, and refuse to open with any of it. A hook a rival could print unchanged is a category description, not a hook. Lead with whatever would SURPRISE someone who already knows this market, and if the surprising thing sounds unlikely, that is exactly why it goes first. ' + NO_EM_DASH +
      /* WRITE THE BRIEF'S REGISTER, NOT ONE YOU DRIFTED INTO. Given a brief
         that said plainly "while you are here" and "too busy tonight", Reid
         wrote "Your voice, there when you cannot be". Dr. O read it exactly
         as intended to be avoided: "that still reads as if the person is
         deceased" (2026-07-31). The artwork rules had already chased the
         memorial register out of the picture and it came back through the
         words. Kept general on purpose: a florist, a gym and a law firm all
         have accidental-funeral registers available to them, and a business
         that genuinely is about loss will say so in its brief. */
      '\n\nMATCH THE EMOTIONAL REGISTER OF THE BRIEF. Do not import a mood it did not ask for. If the brief is present tense and practical, stay there. APPLY THIS TEST TO EVERY LINE YOU WRITE: could a reader take it as meaning the person is gone, dying, or unable to come back? If yes, rewrite it, however the words are arranged. A list of forbidden phrases does not work, because the meaning survives rephrasing: "when you cannot be" and "even when you cannot" fail identically. When someone is not in the room, the REASON must be ordinary, temporary and visible in the line itself: working late, travelling, a meeting, tonight. Sentimentality the client did not request is a defect, not a bonus, and on the wrong business it is offensive. ' +
      '\n\nYou are also writing the words that will be SET IN TYPE on a single marketing graphic, so they must be short enough to read at a glance. Return ONLY JSON: ' +
      '{"positioning":"one sentence, the clear reason to pick them","hook":"the single sharpest line to lead with","proof_points":["2 to 3 short concrete points, drawn only from the brief"],' +
      '"card":{"headline":"6 to 9 words maximum","subhead":"one sentence, 18 words maximum","blocks":[{"title":"2 to 4 words","body":"one sentence, 14 words maximum"}]}}. ' +
      /* Was "give exactly 3 blocks", and every piece came back with three.
         The My Echo piece (2026-07-31) showed the cost: three evenly sized
         grey boxes, the lowest-contrast thing on an otherwise strong design,
         there because the count was fixed rather than because the business
         had three things to say. A buyer who runs two briefs sees the same
         skeleton twice and correctly reads it as a template. */
      'BLOCKS ARE OPTIONAL AND YOU DECIDE HOW MANY. Give 0, 1, 2 or 3, based on how much this business genuinely has to say. ' +
      /* Said "prefer FEWER" for one day. That over-corrected: shown a
         three-block piece and a one-block piece side by side, Dr. O picked
         the three-block one (2026-07-31). The defect was never the count, it
         was that the count was FIXED. Let the content decide and three stays
         reachable when three points earn their place. */
      'Let the content decide, not a target. Three is right when there are genuinely three concrete points; one is right when there is one; none is right when the headline and subhead already carry the argument. ' +
      'Only add a block for a point that is concrete and specific to this business. Never pad to reach a number, and never drop a real point to look spare.',
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
        /* DRAW THE IDEA, NOT THE NOUNS. Chris was handed the promoting line
           and illustrated it literally. On a My Echo brief mentioning
           "memories" and "voice" he drew a handwritten letter, an open
           notebook and a phone, and Dr. O read the result instantly as
           "digital diary" (2026-07-31). Props assign a product to a category
           faster than any headline can argue it out of one, so the prop set
           has to be chosen against what the business IS. */
        /* Bland comes from drawing a SYMBOL. Asked for tech-forward, Chris
           put a neon rim light on a head, which is the stock shorthand for
           AI and appears nowhere in the product. Dr. O: "the artwork is
           bland, boring, does not black mirror me." A glow is a symbol. Two
           people at a table, one of them listening to someone not in the
           room, is a situation (2026-07-31). */
        'DRAW A SITUATION, NOT A SYMBOL. Something is happening in this picture and something about it is quietly wrong. Never solve it with a glow, an aura, a rim light or a lit-up face: that is decoration standing in for an idea. The unsettling part belongs in what people are DOING, not in the lighting.',
        'MATCH THE CLIENT\'S OWN VISUAL WORLD. The mood line above was read off their real photography. Shoot in that world: the same kind of place, the same light, the same sort of people, framed the same way. An ordinary, warm, well lit scene in which something is deeply wrong is far stronger than a dark one that announces itself.',
        'DEPICT THE IDEA, NOT THE NOUNS. Do not illustrate the words of the brief object by object. Work out what this business actually IS and show that. If a prop would make a viewer file this under the wrong category, it is the wrong prop, however well it matches the wording.',
        'Absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO watermarks anywhere in the image.',
        // Asking for "no text" is not enough on its own: gpt-image-1 wrote
        // MEPPERS onto a bottle label doing exactly that. Steer it off the
        // surfaces that invite lettering in the first place (2026-07-30).
        'Do not depict product labels, packaging, signage, posters, menus, price tags or storefronts, since those invite lettering.',
        /* The "no text" rule was obeyed and the piece still came back covered
           in writing: pages of illegible pseudo-script, which the model does
           not count as letters. It passes at thumbnail size and reads as
           nonsense at full size, which is exactly the defect a design firm
           cannot ship. Ban the SHAPE, not just the words (2026-07-31). */
        'NO HANDWRITING and NO SCRIPT OF ANY KIND, including illegible, decorative or background writing. No letters, no documents, no open books, no notebooks, no manuscript pages. Writing-shaped marks count as text even when they spell nothing.',
        /* Same piece put a fabricated app interface on a phone screen. That
           invents a product screen the client would then have to live up to,
           the same objection as inventing a business name. */
        'NO SCREENS SHOWING A USER INTERFACE. No app mockups, no dashboards, no chat windows, no placeholder bars.',
        /* Banning fake screens was too narrow: Chris moved the same instinct
           to a physical object and drew a smart speaker, a dark cylinder with
           a glowing ring, for a product called My ECHO. Dr. O, immediately:
           "you have ECHO (ALEXA), and we are talking about your digital
           twin." It implies hardware the client does not make and leans on a
           trademark they do not own (2026-07-31). */
        'NO HARDWARE THE BUSINESS DOES NOT MAKE. No smart speakers, no headsets, no wearables, no laptops, tablets or phones used as a stand-in for the product, and nothing that resembles a recognisable consumer device. If the business sells software or a service, there is no object to photograph, so do not invent one.',
        /* The deeper error, worth stating positively: a gadget was put where
           the PERSON belonged. For a product that is a version of someone,
           that substitution destroys the pitch. */
        'IF THE PRODUCT IS A PERSON, A VOICE, A PRESENCE OR A RELATIONSHIP, THE PICTURE MUST CARRY A HUMAN PRESENCE. Faces, hands, two people, the space between them. Never let a device or an object stand in for the person, because the person IS the product.',
        /* Banning gadgets sent Chris the other way: soft pencil, sepia, a
           storybook grandmother. Warm, and it could have been advertising a
           nanny agency. Dr. O: "it does not demonstrate tech, we are the
           future." The piece she kept, by contrast, had no device in it
           either, just two identical profiles facing each other, an
           IMPOSSIBLE FACT that could only be about this technology. That is
           how the future gets shown without equipment (2026-07-31). */
        'SIGNAL THE CATEGORY THE BUSINESS COMPETES IN. A technology business must not be drawn as a heritage one. No soft storybook pencil, no sepia, no antique or period styling, no nostalgic warmth standing in for emotion. Contemporary rendering, contemporary light, a confident modern hand.',
        'SHOW WHAT ONLY THIS TECHNOLOGY MAKES POSSIBLE. Convey the future through an impossible or uncanny FACT in the picture, never through equipment: a person present and absent at once, one person in two places, a voice with no speaker, a presence with no body, a self meeting itself. Depict the impossible thing plainly and let it be the whole idea.',
        'BANNED VISUAL CLICHES, these read as stock AI and cheapen the piece: circuit boards, glowing brains, neural networks, robots, androids, humanoid machines, holograms, blue neon grids, binary, streaming data, wireframe or polygonal faces.',
        'Show the subject matter itself: materials, hands, texture, place, light, scale.',
        // Not a full-canvas wash. Asking for an even-toned background is how
        // the picture ended up crushed under a global scrim until the piece
        // was effectively black, which is the complaint this product started
        // from: "I just see the words" (2026-07-30).
        'This image OWNS A BAND of the finished piece, not the whole canvas. Make it a real photograph or illustration with a clear subject, well lit, worth looking at on its own. Do not flatten it into a texture and do not leave it empty for text.',
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
    // The compose brief lives in _design-compose.js, shared with the revision
    // path. One copy on purpose: a revision that quietly forgot a rule would
    // put a fixed defect straight back while telling the client it was fixed.
    const composeSys = composeBrief.composeSystem({
      canvas, paletteText, fonts: yuki.fonts, hasArt: !!artHref,
      // Assigned, not chosen. Seeded on the job id so a revision lands on the
      // same layout instead of quietly redesigning the piece.
      archetype: composeBrief.chooseArchetype(jobId, !!artHref),
    });


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

      /* LAYERS, NOT A FLATTENED PICTURE.
         ─────────────────────────────────────────────────────────────────
         A composed PNG is a dead asset to an animator: the words are baked
         into the plate, so the only move available is to push in on the
         whole frame. Dr. O animates in Claude Design by handing it frames
         and an action, which needs the picture and the type apart.

         Both of these already existed and were being thrown away. Chris's
         artwork was generated, embedded and discarded, and the type block
         is just the same SVG with the backdrop and the artwork removed.
         Neither costs a model call (2026-07-31). */
      let plateKey = null, typeKey = null;
      if (artB64) {
        try {
          plateKey = jobId + '-plate.png';
          await store.set(plateKey, Buffer.from(artB64, 'base64'), { metadata: { contentType: 'image/png' } });
        } catch (e) { plateKey = null; console.warn('[etl-design] plate not stored (non-fatal)', e && e.message); }
      }
      try {
        const overlay = await renderOverlay(out.svg, canvasKey);
        typeKey = jobId + '-type.png';
        await store.set(typeKey, overlay, { metadata: { contentType: 'image/png' } });
      } catch (e) { typeKey = null; console.warn('[etl-design] type overlay not stored (non-fatal)', e && e.message); }

      await save({ result: Object.assign(state.result, {
        image_key: key,
        plate_key: plateKey,
        type_key: typeKey,
        svg_key: jobId + '.svg',
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
