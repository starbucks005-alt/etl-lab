/* etl-design-background — the ETL Design relay.
   ─────────────────────────────────────────────────────────────────────────
   Four agents, one brief, in order. Each one's output is the next one's
   input, which is the entire point.

     1. Yuki Mendel   sets the house look   palette + type, from the concept
                                            image when one is uploaded
     2. Reid Callum   finds the angle       positioning, hook, proof points
     3. Zara Cole     writes the caption    the words BESIDE the graphic
     4. Chris Avila   builds the graphic    Gamma, laid out in Yuki's system

   WHAT THE PRODUCT IS (changed 2026-07-30, on Dr. O's call): the deliverable
   is a DESIGNED CARD with copy on it, not a wordless illustration. The first
   build asked Gamma for artwork with no text, which Gamma cannot do: its
   textMode is generate | condense | preserve and nothing else, because Gamma
   makes cards, not pictures. Fighting that produced a slide that ignored
   Yuki's palette, ignored her type, and wrote its own copy with em dashes in
   it. So the tool now does what it is actually for.

   The consequence is that the card's own copy is authored HERE, by Reid and
   Yuki, and handed to Gamma with textMode 'preserve' so it lays out our words
   instead of inventing its own. Zara's post becomes the caption that goes
   beside the graphic, which is the job a social writer actually does.

   Chris Avila uses they/them.

   POST { job_id, promoting, audience, business_name, business_site, platform,
          concept_image (optional data URL) }
*/

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const { buyerVoiceCore, buyerAgentPrompt } = require('./_social-voice.js');

const MODEL = 'claude-sonnet-4-6';
const GAMMA = 'https://public-api.gamma.app/v1.0/generations';

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

    /* ── 4. Chris: the graphic, laid out in Yuki's system ──────────────── */
    const gammaKey = process.env.GAMMA_API_KEY || process.env.GAMMA_KEY || process.env.BUILD_YOUR_AGENT_GAMMA;
    if (gammaKey) {
      const card = reid.card || {};
      const blocks = Array.isArray(card.blocks) ? card.blocks : [];
      const pal = Array.isArray(yuki.palette) ? yuki.palette : [];
      const fonts = yuki.fonts || {};

      // The exact words to set. Every string de-dashed before it can be
      // rendered into a PNG nobody can edit afterwards.
      const cardText = [
        '# ' + deDash(card.headline || reid.hook || co),
        '', deDash(card.subhead || reid.positioning || ''), '',
      ].concat(blocks.map(b => '## ' + deDash(b.title || '') + '\n' + deDash(b.body || '')))
       .concat(['', deDash(co) + (brief.businessSite ? ' · ' + deDash(brief.businessSite) : '')])
       .join('\n');

      // Yuki's system, stated as design direction. Gamma controls its own
      // theme, so this steers rather than dictates; the palette and type are
      // named explicitly to give it every chance to comply.
      const styleDirection = [
        'Design system to follow exactly.',
        'Palette: ' + pal.map(p => (p.name || '') + ' ' + (p.hex || '') + (p.use ? ' for ' + p.use : '')).join('; ') + '.',
        'Typography: ' + (fonts.display || '') + ' for headlines, ' + (fonts.body || '') + ' for body.',
        'Feel: ' + (yuki.look || ''),
        'Generous negative space, strong type hierarchy, one accent colour used sparingly.',
        'Use only the words given. Do not add copy, taglines, statistics or contact details.',
        'Never use em dashes or en dashes.',
      ].join(' ');

      const buildPayload = (dims) => ({
        inputText: cardText.slice(0, 4000),
        format: 'social',
        // 'preserve' takes our words as written. 'generate' is what let Gamma
        // author its own copy, off-palette and full of em dashes, on the first
        // live run. Valid values are generate | condense | preserve only.
        textMode: 'preserve',
        numCards: 1,
        cardOptions: { dimensions: dims },
        imageOptions: { source: 'aiGenerated', model: 'imagen-4-pro', style: styleDirection.slice(0, 2000) },
        additionalInstructions: styleDirection.slice(0, 2000),
        exportAs: 'png',
      });

      const attempts = P.dims === '1x1' ? ['1x1'] : [P.dims, '1x1'];
      let lastDetail = '';
      for (let i = 0; i < attempts.length; i++) {
        try {
          const gr = await fetch(GAMMA, {
            method: 'POST',
            headers: { 'X-API-KEY': gammaKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPayload(attempts[i])),
          });
          const gd = await gr.json().catch(() => ({}));
          if (gr.ok && gd.generationId) {
            await save({ result: Object.assign(state.result, {
              gamma_generation_id: gd.generationId, image_dims: attempts[i], card_text: cardText,
            }) });
            lastDetail = '';
            break;
          }
          lastDetail = 'gamma_' + gr.status + ' @' + attempts[i] + ': ' +
                       String((gd && (gd.message || gd.error)) || JSON.stringify(gd)).slice(0, 240);
          console.error('[etl-design] gamma refused', lastDetail);
        } catch (e) {
          lastDetail = 'gamma_threw @' + attempts[i] + ': ' + String(e && e.message);
          console.error('[etl-design]', lastDetail);
        }
      }
      if (lastDetail) await save({ result: Object.assign(state.result, { image_error: lastDetail }) });
    } else {
      console.warn('[etl-design] no GAMMA key set; delivering copy without a graphic');
      await save({ result: Object.assign(state.result, { image_error: 'no_gamma_key' }) });
    }

    await save({ status: 'done', step: 4, note: 'Ready.' });
    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('[etl-design] relay failed', err && err.message);
    await save({ status: 'error', error: (err && err.message) || 'relay failed' });
    return { statusCode: 500, body: 'failed' };
  }
};
