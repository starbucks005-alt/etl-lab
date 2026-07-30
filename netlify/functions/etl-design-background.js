/* etl-design-background — the ETL Design relay.
   ─────────────────────────────────────────────────────────────────────────
   Four agents, one brief, in order. Each one's output is the next one's
   input, which is the entire point: the visual matches the copy because
   Chris is briefed with Zara's post and Yuki's palette, not with the raw
   request.

     1. Yuki Mendel   sets the house look     (wordmark, palette, type)
     2. Reid Callum   sets the angle          (positioning, hook, proof)
     3. Zara Cole     writes the post         (platform-native, hashtags)
     4. Chris Avila   makes the visual        (Gamma, inside Yuki's system)

   Chris Avila uses they/them.

   THERE IS NO OWNER HERE. Every field comes from the requester's own brief.
   The generic voice builders in _social-voice.js are shared with the
   Studio's Social Posts tool so Zara sounds like Zara in both places.

   POST { job_id, promoting, audience, business_name, business_site, platform }
   Writes progress + result to the etl_design_jobs blob store as it goes, so
   the page can show each agent finishing rather than one long spinner.
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

async function ask(client, system, user, maxTokens) {
  const r = await client.messages.create({
    model: MODEL, max_tokens: maxTokens || 1200, system,
    messages: [{ role: 'user', content: user }],
  });
  return (r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
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

  // Progress is written after every step. The page renders each agent as it
  // lands, so a 60-90 second relay reads as four people working rather than
  // one stalled spinner.
  const state = {
    job_id: jobId, status: 'running', step: 0, of: 4,
    created_at: new Date().toISOString(),
    brief, result: {}, error: null,
  };
  const save = async (patch) => {
    Object.assign(state, patch || {});
    state.updated_at = new Date().toISOString();
    try { await store.setJSON(jobId, state); } catch (e) { console.error('[etl-design] save failed', e && e.message); }
  };
  await save({ step: 0, note: 'Yuki is setting the look.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { await save({ status: 'error', error: 'ANTHROPIC_API_KEY not set' }); return { statusCode: 500, body: 'no key' }; }
  const client = new Anthropic({ apiKey });

  try {
    /* ── 1. Yuki: the house look ───────────────────────────────────────── */
    const yuki = extractJson(await ask(client,
      'You are Yuki Mendel, a type-first graphic designer. You make wordmarks, not mascots. You build a small brand system a one-person shop can actually hold together: a typeface pairing, a tight palette, and the spacing logic that makes it look deliberate. You do not design logos with icons in them unless asked. ' + NO_EM_DASH +
      '\n\nReturn ONLY JSON: {"wordmark":"how the name should be set, one sentence","palette":[{"name":"Ink","hex":"#111111","use":"body text"}],"fonts":{"display":"a real, widely available typeface","body":"a real, widely available typeface"},"look":"two sentences on the overall feel and why it fits this audience"}. Give exactly 4 palette entries with real hex values.',
      'BUSINESS: ' + co + (brief.businessSite ? ' (' + brief.businessSite + ')' : '') +
      '\nWHAT THEY ARE PROMOTING: ' + brief.promoting +
      '\nAUDIENCE: ' + (brief.audience || 'not specified') +
      '\n\nSet the brand direction.', 1200));
    await save({ step: 1, note: 'Reid is finding the angle.', result: Object.assign(state.result, { brand: yuki }) });

    /* ── 2. Reid: the angle ────────────────────────────────────────────── */
    const reid = extractJson(await ask(client,
      'You are Reid Callum, a go-to-market strategist. You tell people how to actually sell the thing, not how to describe it. You find the one clear reason a customer picks them over the alternative. You never invent statistics, awards, customer counts, or prices. ' + NO_EM_DASH +
      '\n\nReturn ONLY JSON: {"positioning":"one sentence, the clear reason to pick them","hook":"the single sharpest line to lead with","proof_points":["2 to 3 short, concrete, non-invented points drawn only from what the brief actually says"]}',
      'BUSINESS: ' + co +
      '\nWHAT THEY ARE PROMOTING: ' + brief.promoting +
      '\nAUDIENCE: ' + (brief.audience || 'not specified') +
      '\n\nFind the angle.', 1000));
    await save({ step: 2, note: 'Zara is writing the post.', result: Object.assign(state.result, { angle: reid }) });

    /* ── 3. Zara: the post ─────────────────────────────────────────────── */
    const zaraSys = buyerVoiceCore('', co) + '\n\n---\n\nSTYLE TILT (apply on top of the baseline voice):\n\n' +
      buyerAgentPrompt('zara', '', co) +
      '\n\nPLATFORM RULES, write for ' + P.name + ':\n' + P.format +
      '\nCharacter limit: ' + P.charLimit + ' hard max, ' + P.ideal + ' target.\n\n' +
      'ANGLE TO USE (from the strategist, do not contradict it):\n' +
      'Positioning: ' + (reid.positioning || '') + '\nHook: ' + (reid.hook || '') + '\n\n' +
      (brief.businessSite
        ? 'URL RULE, HARD: if you include a link use EXACTLY ' + brief.businessSite + ', character for character. Never invent or alter it.\n\n'
        : 'URL RULE, HARD: no link was supplied. Do NOT include any URL and do NOT guess one from the name.\n\n') +
      'Never invent statistics, testimonials, prices, or customer counts. ' + NO_EM_DASH + '\n\n' +
      'Return ONLY JSON: {"post":"the post text without hashtags","hashtags":"space separated, or empty","notes":"one sentence on why this lands for this platform"}';
    const zara = extractJson(await ask(client, zaraSys,
      'SUBJECT: ' + brief.promoting + '\n\nWrite the post for ' + P.name + '.', 1500));
    await save({ step: 3, note: 'Chris is making the visual.', result: Object.assign(state.result, { copy: zara, platform: P.name }) });

    /* ── 4. Chris: the visual, inside Yuki's system ────────────────────── */
    // Briefed with the palette and the actual post, so the image belongs to
    // the piece rather than being generic stock that happens to sit above it.
    const gammaKey = process.env.GAMMA_API_KEY || process.env.GAMMA_KEY || process.env.BUILD_YOUR_AGENT_GAMMA;
    if (gammaKey) {
      const paletteText = Array.isArray(yuki.palette)
        ? yuki.palette.map(p => (p.name || '') + ' ' + (p.hex || '')).join(', ') : '';
      const style = 'Editorial marketing graphic, not a photograph of a person. ' +
        'Colour palette strictly: ' + paletteText + '. ' +
        'Clean geometric composition, generous negative space, flat modern illustration, ' +
        'no text, no words, no letterforms, no logos, no watermarks. ' +
        (yuki.look || '');
      const buildPayload = (dims) => ({
        inputText: ('Marketing visual for ' + co + '. Subject: ' + brief.promoting + '. Mood: ' + (yuki.look || '') + '.').slice(0, 4000),
        // textMode MUST be one of generate | condense | preserve. 'none' is
        // rejected outright: "Input validation errors: 1. textMode must be one
        // of: generate, condense, preserve" (live 400, 2026-07-30). 'preserve'
        // is the right one here, it takes inputText as written instead of
        // letting Gamma expand it into copy that would compete with Zara's.
        // NOTE: gamma-image-ask.js still sends 'none', so Build Your Own
        // Agent's portrait generation is failing the same way.
        format: 'social', textMode: 'preserve', numCards: 1,
        cardOptions: { dimensions: dims },
        imageOptions: { source: 'aiGenerated', model: 'imagen-4-pro', style: style.slice(0, 2000) },
        exportAs: 'png',
      });

      // Two attempts. The per-platform aspect ratio is what we WANT (4x5 reads
      // better in a LinkedIn feed, 16x9 on X), but the only Gamma call proven
      // on this campus uses 1x1, and a first live run came back gamma_400. So
      // try the good ratio, and on a 4xx fall back to the known-good square
      // rather than losing the visual entirely. The refusal detail is stored,
      // not just the status code, so the cause is visible without shell access
      // to the logs (2026-07-30).
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
              gamma_generation_id: gd.generationId, image_dims: attempts[i],
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
      // A failed image must never discard three good text steps. Same lesson
      // as the brief generator dropping a finished brief on a TTS failure.
      if (lastDetail) await save({ result: Object.assign(state.result, { image_error: lastDetail }) });
    } else {
      console.warn('[etl-design] no GAMMA key set; delivering copy without a visual');
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
