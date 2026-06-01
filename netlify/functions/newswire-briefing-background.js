/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-background — generate the "5 in Under 5" audio briefing.

   Pulls the 5 most recent ETL Newswire pieces, asks Anthropic to write a
   ~600-word NPR Morning Edition style script in Margaret Applewood's voice,
   then calls ElevenLabs to render the mp3. Stores both in Netlify Blobs.

   Admin-gated POST /.netlify/functions/newswire-briefing-background
   Body: {}  (no params needed)

   This is a background function (15-min runtime). It returns 202 immediately
   while the work continues. ElevenLabs TTS for ~600 words runs in ~10-30
   seconds; the Anthropic script generation is another ~10-20 seconds.

   Requires env vars:
     ANTHROPIC_API_KEY
     ELEVENLABS_API_KEY
     PRESS_ADMIN_USER + PRESS_ADMIN_PASS
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1400;
const SITE_BASE = 'https://emerging-tech-lab.com';

// ETL Newswire briefing anchor. Distinct from Margaret Applewood (who hosts
// The Dose) to avoid cross-platform listener confusion. The anchor is
// Marcus Reyes, US Desk Senior Correspondent. Voice = ElevenLabs "Bill"
// (strong late-middle-aged American male, news-report register).
const ANCHOR = {
  name: 'Marcus Reyes',
  role: 'US Desk Senior Correspondent',
  voiceId: 'pqHfZKP75CvOlQylNhV4', // ElevenLabs "Bill"
  model: 'eleven_turbo_v2_5',
  settings: { stability: 0.65, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false },
  voiceRider:
    "Wire-service news anchor. Trusted, measured, AP-style neutral. Reads like the top of an NPR Morning Edition " +
    "newscast: short sentences, sources named, no editorial color. Plain pronunciation. " +
    "Reads numbers naturally (write '50 million' not '50,000,000'). Includes commas and periods for natural pause. " +
    "No em dashes (the synthesizer reads them awkwardly). Use periods and commas instead.",
};

const DESK_LABELS = {
  us: 'US', world: 'World', business: 'Business', technology: 'Technology',
  security: 'Security', science: 'Science', health: 'Health',
  entertainment: 'Entertainment', sports: 'Sports',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function requireBasicAuth(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) return { ok: false, response: { statusCode: 503, body: 'admin disabled' } };
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'auth required' } };
  }
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx === -1) throw new Error('malformed');
    if (decoded.slice(0, idx) !== user || decoded.slice(idx + 1) !== pass) {
      return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid credentials' } };
    }
  } catch {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid auth' } };
  }
  return { ok: true };
}

let REPORTERS_CACHE = null;
function loadReporters() {
  if (REPORTERS_CACHE) return REPORTERS_CACHE;
  try {
    const data = require('../../config/newswire-reporters.json');
    REPORTERS_CACHE = (data.reporters || []).reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  } catch (_) { REPORTERS_CACHE = {}; }
  return REPORTERS_CACHE;
}

function buildScriptSystemPrompt() {
  return `You are writing the script for "Above the Fold," a daily audio briefing on ETL Newswire. The script will be read aloud by ${ANCHOR.name}, ${ANCHOR.role}, via text-to-speech. The name "Above the Fold" is the newspaper tradition: the stories an editor judges important enough to land on the top half of the front page. Treat this as editorial judgment, not a checklist.

VOICE
  ${ANCHOR.voiceRider}

HARD CONSTRAINTS - DO NOT VIOLATE
  - Cover EVERY story in the input list. Do not skip any.
  - Do not reference other news events, other stories, "in other news," "elsewhere on the wire," follow-up coverage, or any story not in the input list.
  - Each story gets 2 to 5 sentences. The more important stories get more sentences; the weaker ones get fewer.
  - Total word count: 320 to 600 words. Runtime 3 to 6 minutes spoken at wire-service cadence.

FORMAT
  - Open (1-2 sentences): "From ETL Newswire, this is Above the Fold. I'm ${ANCHOR.name} at the US desk." Then one sentence framing the day's wire.
  - Story blocks in the order given. Each block:
      1. Brief transition or desk cue. "Leading the wire..." "From the world desk..." "On business..." "On technology..." "From the security desk..." "On science..." "On health..." "From entertainment..." "On sports..." Vary it.
      2. The headline news in one or two clean sentences.
      3. The reporter byline by name and tier ("Senior Correspondent Elke Vogel reports..." or "Correspondent Sasha Park files...").
      4. Optional: ONE sentence of the most important detail from the dek. Skip this if the headline already conveys it.
  - Close (1 sentence): "That's Above the Fold from ETL Newswire. I'm ${ANCHOR.name}. Back to the wire."

  When you reach a story written by ${ANCHOR.name}, do NOT introduce it with his own name as the reporter. Frame it as "our US desk has..." or "on the US beat..." so he is not introducing himself in third person.

VOICE GUARDRAILS
  - No em dashes. The TTS will read them awkwardly. Use periods or commas.
  - No "BREAKING" or "shocking" framing. NPR cadence, not cable news.
  - Write numbers as Margaret would say them ("about a fifth" not "1/5", "fifteen percent" not "15%" unless natural).
  - Names should be pronounced as spelled. Avoid surnames Margaret would need to guess at.

OUTPUT
  Return ONLY the script text, ready to feed to TTS. No JSON wrapper, no preamble, no stage directions, no markdown.`;
}

function buildScriptUserMessage(pieces) {
  const reporters = loadReporters();
  const lines = pieces.map((p, i) => {
    const r = (p.byline_kind === 'reporter' && p.reporter_id) ? reporters[p.reporter_id] : null;
    const reporterLine = r ? `${r.tier_label || 'Reporter'} ${r.name}` : (p.author || p.source_label || 'Wire staff');
    const desk = DESK_LABELS[p.desk] || 'Wire';
    return `[Story ${i + 1}] ${desk} desk
  Headline: ${p.title}
  Dek: ${p.dek || '(no dek)'}
  Byline: ${reporterLine}
  Source/Outlet: ${p.source_label || ''}`;
  });
  return `Here are the five stories for today's briefing, in order:\n\n${lines.join('\n\n')}\n\nWrite the script.`;
}

async function generateMp3(scriptText) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ANCHOR.voiceId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: scriptText,
      model_id: ANCHOR.model,
      voice_settings: ANCHOR.settings,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 200)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  try { connectLambda(event); } catch (err) {
    console.error('[briefing] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  // Pull the 5 most recent pieces from press_index.
  let order = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    console.error('[briefing] index read failed', err && err.message);
    return json(500, { error: 'index read failed' });
  }
  // "Above the fold" - editor judgment, not a fixed count. Pull up to 7 most
  // recent pieces; the prompt tells the model to cover every story in the
  // input. Adjust the slice if you want a tighter or wider window.
  const top = order.filter(p => p && p.title && p.slug).slice(0, 7);
  if (!top.length) return json(400, { error: 'no pieces on the wire to brief on yet' });

  // Generate the script.
  const client = new Anthropic({ apiKey });
  let scriptText;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildScriptSystemPrompt(),
      messages: [{ role: 'user', content: buildScriptUserMessage(top) }],
    });
    scriptText = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[briefing] anthropic error', err && err.message);
    return json(502, { error: 'script generation failed', detail: err && err.message });
  }
  if (!scriptText) return json(502, { error: 'script generation returned empty' });

  // Scrub em dashes the model may have produced anyway.
  scriptText = scriptText.replace(/—/g, ', ').replace(/–/g, ', ').replace(/\s{2,}/g, ' ').trim();

  // Render to mp3 via ElevenLabs.
  let mp3Buffer;
  try {
    mp3Buffer = await generateMp3(scriptText);
  } catch (err) {
    console.error('[briefing] elevenlabs error', err && err.message);
    return json(502, { error: 'audio generation failed', detail: err && err.message });
  }

  // Store the mp3 + metadata.
  const generatedAt = new Date().toISOString();
  try {
    const audioStore = getStore('newswire_briefings_audio');
    await audioStore.set('latest', mp3Buffer, { metadata: { contentType: 'audio/mpeg' } });
  } catch (err) {
    console.error('[briefing] audio store write failed', err && err.message);
    return json(500, { error: 'audio store write failed' });
  }

  const meta = {
    generated_at: generatedAt,
    script: scriptText,
    word_count: scriptText.split(/\s+/).length,
    pieces: top.map(p => ({
      slug: p.slug,
      title: p.title,
      desk: p.desk || '',
      desk_label: DESK_LABELS[p.desk] || '',
      author: p.author || '',
      reporter_id: p.reporter_id || null,
    })),
    audio_url: '/.netlify/functions/newswire-briefing-audio?v=' + encodeURIComponent(generatedAt),
  };
  try {
    const metaStore = getStore('newswire_briefings_meta');
    await metaStore.setJSON('latest', meta);
  } catch (err) {
    console.error('[briefing] meta store write failed', err && err.message);
    return json(500, { error: 'meta store write failed' });
  }

  return json(200, { ok: true, complete: true, generated_at: generatedAt, word_count: meta.word_count, pieces: meta.pieces.length });
};
