/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-background — generate the "Above the Fold" multi-voice
   audio briefing.

   Pulls up to 7 most recent ETL Newswire pieces, asks Anthropic to write a
   structured script as an array of segments (each tagged with a speaker:
   "anchor" or a reporter id), then calls ElevenLabs per segment using the
   right voice. Byte-concatenates all segment mp3s into one playable file.

   Anchor: Marcus Reyes, US Desk Senior Correspondent (ElevenLabs "Bill").
   Reporter voices: voice_id field on each reporter in newswire-reporters.json.

   Admin-gated POST /.netlify/functions/newswire-briefing-background
   Body: {}  (no params needed)

   Background function (15-min runtime ceiling). Typical generation: ~10-20
   sec Anthropic + ~30-90 sec ElevenLabs (varies with reporter count).

   Requires env vars:
     ANTHROPIC_API_KEY
     ELEVENLABS_API_KEY
     PRESS_ADMIN_USER + PRESS_ADMIN_PASS
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2200; // JSON output is more verbose than plain script
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
  return `You are writing the script for "Above the Fold," a daily multi-voice audio briefing on ETL Newswire. The script is a STRUCTURED HANDOFF between the anchor and the staff reporters. Each segment is rendered in its own voice via text-to-speech.

ROLES
  - Anchor: ${ANCHOR.name}, ${ANCHOR.role}. Opens, hands off to each reporter, closes. Wire-service neutral, AP-style, NPR Morning Edition cadence.
  - Reporters: each staff reporter speaks their OWN story in their OWN voice. Marcus introduces them; they speak their segment in first person ("I'm Correspondent Karen Bishop on the health desk. Today...").

CRITICAL EMPLOYMENT RULE
  Every reporter named in the input is a STAFF reporter for ETL Newswire. They are NOT employees of any other outlet. The "Underlying story source" field on each story is the outlet that ORIGINALLY broke or covered the story - it is NOT the reporter's employer.
  - DO say: "Correspondent Karen Bishop has the story." Karen then says: "I'm Correspondent Karen Bishop on the health desk..."
  - DO NOT say: "Karen Bishop files for NBC News" or "Reports from Capitol News IL." That misrepresents employment.
  - If a reporter must reference the underlying source, frame it as coverage: "I've been covering a New York Times investigation that..." or "An NBC News report this week shows..."

OUTPUT FORMAT - STRICT JSON ONLY
  Return ONLY this JSON shape, nothing before or after:
  {
    "segments": [
      { "speaker": "anchor", "text": "From ETL Newswire, this is Above the Fold. I'm ${ANCHOR.name} at the US desk. Today the wire covers..." },
      { "speaker": "anchor", "text": "Leading the wire on the world desk, Senior Correspondent Elke Vogel." },
      { "speaker": "elke_vogel", "text": "I'm Senior Correspondent Elke Vogel on the world desk. Tehran has..." },
      { "speaker": "anchor", "text": "Turning to the health desk, Correspondent Karen Bishop has the story." },
      { "speaker": "karen_bishop", "text": "I'm Correspondent Karen Bishop on the health desk. A Kenyan high court..." },
      { "speaker": "anchor", "text": "That's Above the Fold from ETL Newswire. I'm ${ANCHOR.name}. Back to the wire." }
    ]
  }

SEGMENT RULES
  - Anchor segments: short. Open, hand-off lines (1 sentence each), close. Roughly 60-100 words total across all anchor segments.
  - Reporter segments: each reporter gets 2-4 sentences. They open with "I'm [Tier] [Name] on the [Desk] desk." then deliver the news.
  - Cover EVERY story in the input list. One reporter segment per story.
  - If a story's reporter is ${ANCHOR.name} (anchor self-reporting), handle it as a single "anchor" segment that does both the handoff and the reporting in one block ("Our US desk has been tracking..." then the news).
  - Total runtime target: 3 to 6 minutes spoken. Total word count: 350 to 650 words across all segments.

SPEAKER ID VALUES
  - Use "anchor" for ${ANCHOR.name}'s host segments.
  - Use the reporter's id (snake_case like "karen_bishop", "elke_vogel", "marcus_reyes") for reporter segments. Match the "Speaker ID" field in the input exactly.

VOICE GUARDRAILS
  - No em dashes anywhere. TTS reads them awkwardly. Use periods or commas.
  - No "BREAKING" or "shocking" framing. Wire-service cadence, not cable news.
  - Numbers spoken naturally ("about a fifth", "fifteen percent", "50 million").
  - No raw URLs in text.

Return ONLY the JSON object. No markdown fences, no preamble.`;
}

function buildScriptUserMessage(pieces) {
  const reporters = loadReporters();
  const lines = pieces.map((p, i) => {
    const r = (p.byline_kind === 'reporter' && p.reporter_id) ? reporters[p.reporter_id] : null;
    const desk = DESK_LABELS[p.desk] || 'Wire';
    const reporterLine = r
      ? `${r.tier_label || 'Reporter'} ${r.name} (ETL Newswire ${desk} desk)`
      : (p.author || 'Wire staff');
    // Marcus = anchor. Use "anchor" speaker for his own stories too so the
    // script does not introduce him in third person.
    const speakerId = (r && r.id !== 'marcus_reyes') ? r.id : 'anchor';
    const underlying = p.source_label
      ? `Underlying story originally covered by: ${p.source_label} (NOT the reporter's employer; do not say "files for" / "reports for" this outlet)`
      : 'Underlying story originally covered by: (not specified)';
    return `[Story ${i + 1}] ${desk} desk
  Headline: ${p.title}
  Dek: ${p.dek || '(no dek)'}
  Our reporter (ETL Newswire staff): ${reporterLine}
  Speaker ID for this reporter's segment: "${speakerId}"
  ${underlying}`;
  });
  return `Here are the stories for today's briefing, in order:\n\n${lines.join('\n\n')}\n\nWrite the script as a JSON object with a "segments" array. The anchor opens, hands off to each reporter who speaks their own story, anchor closes. Use the exact "Speaker ID" values shown above.`;
}

// Synthesize a single mp3 buffer from a chunk of text in the given speaker's
// voice. Speakers: "anchor" -> ANCHOR config. Reporter speaker IDs map to a
// reporter's voice_id from newswire-reporters.json.
async function synthSegment(text, speakerId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');

  let voiceId, model, settings;
  if (speakerId === 'anchor') {
    voiceId = ANCHOR.voiceId;
    model = ANCHOR.model;
    settings = ANCHOR.settings;
  } else {
    const reporters = loadReporters();
    const r = reporters[speakerId];
    if (!r || !r.voice_id) {
      // Fall back to anchor if reporter has no voice assigned. Logs noisy but
      // keeps the briefing playable.
      console.warn('[briefing] no voice_id for', speakerId, '- falling back to anchor');
      voiceId = ANCHOR.voiceId;
      model = ANCHOR.model;
      settings = ANCHOR.settings;
    } else {
      voiceId = r.voice_id;
      model = 'eleven_turbo_v2_5';
      settings = { stability: 0.55, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false };
    }
  }

  // output_format=mp3_44100_64 cuts file size in half vs default 128kbps
  // while sounding identical for spoken-word voice. Also keeps encoding
  // consistent across segments so byte-concat produces a playable file.
  // Critical: Netlify function responses are capped at 6 MB. At default
  // 128kbps the multi-voice briefing exceeded this and crashed the audio
  // endpoint with ResponseSizeTooLarge.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    throw new Error(`ElevenLabs ${res.status} for ${speakerId}: ${errText.slice(0, 200)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// Render the full multi-voice briefing. Each segment becomes its own mp3,
// then byte-concatenated into a single audio file. ElevenLabs returns
// consistent encoding (turbo_v2_5), so concatenated mp3s play correctly in
// HTML5 audio.
async function renderBriefingFromSegments(segments) {
  const buffers = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = String(seg.text || '').replace(/—/g, ', ').replace(/–/g, ', ').replace(/\s{2,}/g, ' ').trim();
    if (!text) continue;
    const buf = await synthSegment(text, seg.speaker || 'anchor');
    buffers.push(buf);
  }
  if (!buffers.length) throw new Error('no segments produced audio');
  return Buffer.concat(buffers);
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

  // Generate the structured script (JSON with segments array).
  const client = new Anthropic({ apiKey });
  let rawText;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildScriptSystemPrompt(),
      messages: [{ role: 'user', content: buildScriptUserMessage(top) }],
    });
    rawText = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
  } catch (err) {
    console.error('[briefing] anthropic error', err && err.message);
    return json(502, { error: 'script generation failed', detail: err && err.message });
  }
  if (!rawText) return json(502, { error: 'script generation returned empty' });

  // Parse the JSON. The model may wrap it in code fences or add stray text.
  let parsed, segments;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
    segments = Array.isArray(parsed.segments) ? parsed.segments : null;
  } catch (err) {
    console.error('[briefing] JSON parse failed', err && err.message, 'raw:', rawText.slice(0, 300));
    return json(502, { error: 'script JSON parse failed', detail: err && err.message });
  }
  if (!segments || !segments.length) {
    return json(502, { error: 'script returned no segments', detail: rawText.slice(0, 300) });
  }

  // Render multi-voice: each segment in its own voice, byte-concatenated.
  let mp3Buffer;
  try {
    mp3Buffer = await renderBriefingFromSegments(segments);
  } catch (err) {
    console.error('[briefing] elevenlabs render failed', err && err.message);
    return json(502, { error: 'audio generation failed', detail: err && err.message });
  }

  // Build a plain-text version of the script for the metadata (for reference,
  // RSS, transcript display). One blank line between segments.
  const scriptText = segments
    .map(s => String(s.text || '').trim())
    .filter(Boolean)
    .join('\n\n');

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
    segment_count: segments.length,
    voices_used: Array.from(new Set(segments.map(s => s.speaker || 'anchor'))),
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
