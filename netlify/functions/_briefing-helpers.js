/* ─────────────────────────────────────────────────────────────────────────────
   _briefing-helpers — shared logic for the live daily ATF generator
   (newswire-briefing-background.js) and the historical backfill generator
   (newswire-briefing-backdate-background.js).

   Underscore prefix marks this as private to other functions, not a Netlify
   route. Netlify Functions ignore files starting with _ when registering
   endpoints.

   What lives here:
     - ANCHOR config (Marcus Reyes voice)
     - Reporter desk labels
     - Reporter loading
     - Script system + user prompts
     - ElevenLabs segment synthesis + multi-voice render
     - Xing/Info header injection (correct duration display)
     - Episode key + index helpers (per-episode blob storage)

   Why this exists: before the backdate function landed, the daily
   generator was a single self-contained file. Cloning it for backdate
   would mean two copies of ~300 lines of voice/prompt logic. Any tweak
   to a voice setting, a guardrail line, or the Xing parser would have
   to happen in two places, with the inevitable drift. Single source of
   truth here, both call sites import.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore } = require('@netlify/blobs');
const { VOICE_LAW_PROSE, houseTypography } = require('./_etl-voice-law.js');

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

// Audio is 64 kbps CBR (we force output_format=mp3_44100_64 in synthSegment).
// Used downstream for accurate duration math.
const AUDIO_BITRATE_BPS = 64000;

let REPORTERS_CACHE = null;
function loadReporters() {
  if (REPORTERS_CACHE) return REPORTERS_CACHE;
  try {
    const data = require('../../config/newswire-reporters.json');
    REPORTERS_CACHE = (data.reporters || []).reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  } catch (_) { REPORTERS_CACHE = {}; }
  return REPORTERS_CACHE;
}

// Owner voice overrides, set through Iris's voice desk (store
// "etl_voice_overrides", key "map": { speakerId: elevenLabsVoiceId }).
// Beats the config default at render time so Dr. O can recast a voice
// from chat without a deploy. "anchor" is a valid speaker key too.
// Cached 60s per warm lambda; storage failure means config defaults apply.
let VOICE_OVERRIDES_CACHE = null;
let VOICE_OVERRIDES_TS = 0;
async function loadVoiceOverrides() {
  const now = Date.now();
  if (VOICE_OVERRIDES_CACHE && (now - VOICE_OVERRIDES_TS) < 60000) return VOICE_OVERRIDES_CACHE;
  try {
    const { getStore } = require('@netlify/blobs');
    const map = await getStore('etl_voice_overrides').get('map', { type: 'json' });
    VOICE_OVERRIDES_CACHE = (map && typeof map === 'object') ? map : {};
  } catch (_) {
    VOICE_OVERRIDES_CACHE = VOICE_OVERRIDES_CACHE || {};
  }
  VOICE_OVERRIDES_TS = now;
  return VOICE_OVERRIDES_CACHE;
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

Return ONLY the JSON object. No markdown fences, no preamble.` + VOICE_LAW_PROSE;
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

  try {
    const overrides = await loadVoiceOverrides();
    if (overrides[speakerId]) voiceId = overrides[speakerId];
  } catch (_) {}

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

/* ──────────────────────────────────────────────────────────────────────────
   prependXingInfoHeader — inject a Xing/Info VBR header frame at the start
   of a concatenated mp3 so HTML5 audio elements show the correct total
   duration BEFORE playback starts.

   The Problem: byte-concatenating mp3 segments produces a valid playable
   file, but no top-level metadata declares the total length. The browser
   reads the first frame's MPEG header, divides "this frame's bitrate" into
   "the bytes I can see so far," and shows that as the duration. Result:
   the audio bar shows the length of segment 1 only, then jumps to the
   real total mid-playback. Users can't tell up front how long the
   briefing is, which kills the use case ("I have 5 minutes, will this
   fit?").

   The Fix: prepend a single synthetic MPEG audio frame whose data area
   contains a Xing/Info tag declaring the real total frame count and total
   byte count. Browsers (and all standard players) read this and show the
   correct duration immediately.

   The synthetic frame's audio payload is all zeros, which decodes to ~26
   ms of silence. Imperceptible at the start of a multi-minute briefing.

   We match the synthetic frame's MPEG profile (version/layer/bitrate/
   samplerate/channel mode) to the actual first frame in the buffer, so
   the prepended frame is fully compatible with whatever ElevenLabs gave
   us — no assumptions about mono vs stereo, etc.

   Returns a new Buffer. On any parse failure, returns the input unchanged
   (zero risk to existing behavior).
   ────────────────────────────────────────────────────────────────────── */
function prependXingInfoHeader(mp3Buffer) {
  try {
    // Find first MPEG sync frame. Skip ID3v2 if present.
    let frameStart = 0;
    if (mp3Buffer[0] === 0x49 && mp3Buffer[1] === 0x44 && mp3Buffer[2] === 0x33) {
      // ID3v2 header: 10 bytes + sync-safe 28-bit size
      const size = ((mp3Buffer[6] & 0x7F) << 21) | ((mp3Buffer[7] & 0x7F) << 14)
                 | ((mp3Buffer[8] & 0x7F) << 7)  |  (mp3Buffer[9] & 0x7F);
      frameStart = 10 + size;
    }
    while (frameStart < mp3Buffer.length - 4) {
      if (mp3Buffer[frameStart] === 0xFF && (mp3Buffer[frameStart + 1] & 0xE0) === 0xE0) break;
      frameStart++;
    }
    if (frameStart >= mp3Buffer.length - 4) return mp3Buffer;

    const b1 = mp3Buffer[frameStart + 1];
    const b2 = mp3Buffer[frameStart + 2];
    const b3 = mp3Buffer[frameStart + 3];

    // Decode MPEG header bits.
    const versionBits = (b1 >> 3) & 0x03;  // 11=V1, 10=V2, 00=V2.5
    const layerBits   = (b1 >> 1) & 0x03;  // 01=Layer III
    const bitrateIdx  = (b2 >> 4) & 0x0F;
    const sampleIdx   = (b2 >> 2) & 0x03;
    const channelMode = (b3 >> 6) & 0x03;  // 11=mono

    if (layerBits !== 0x01) return mp3Buffer; // not Layer III, bail

    const isV1 = versionBits === 3;
    const isMono = channelMode === 3;

    // Bitrate tables (kbps). Layer III only.
    const V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
    const bitrate = (isV1 ? V1L3[bitrateIdx] : V2L3[bitrateIdx]) * 1000;
    if (!bitrate) return mp3Buffer;

    // Sample rate tables (Hz).
    const SR_V1   = [44100, 48000, 32000, 0];
    const SR_V2   = [22050, 24000, 16000, 0];
    const SR_V25  = [11025, 12000, 8000, 0];
    const sampleRate = isV1 ? SR_V1[sampleIdx]
                     : (versionBits === 2 ? SR_V2[sampleIdx] : SR_V25[sampleIdx]);
    if (!sampleRate) return mp3Buffer;

    // Frame size formula for Layer III.
    // V1: 144 * bitrate / sampleRate
    // V2/V2.5: 72 * bitrate / sampleRate
    const frameSize = Math.floor((isV1 ? 144 : 72) * bitrate / sampleRate);
    if (frameSize < 24) return mp3Buffer; // too small to fit Xing payload

    // Side info size for Layer III.
    //   MPEG-1:   mono = 17, stereo/dual/JS = 32
    //   MPEG-2/2.5: mono = 9, stereo/dual/JS = 17
    const sideInfoSize = isV1 ? (isMono ? 17 : 32) : (isMono ? 9 : 17);

    // Audio frame count in the original buffer. ElevenLabs returns CBR so
    // a simple division is accurate to within a frame or two. Padding
    // bytes (when padding bit is set) skew this slightly but not enough
    // to matter for the duration display.
    const audioFrameCount = Math.round(mp3Buffer.length / frameSize);

    // Build the synthetic Info frame.
    const xingFrame = Buffer.alloc(frameSize);
    xingFrame[0] = 0xFF;
    xingFrame[1] = b1;
    // Zero out the padding bit (bit 1 of b2) since our synthetic frame
    // has no padding. Bit pattern: PPPPpriv where padding=bit 1.
    xingFrame[2] = b2 & 0xFD;
    xingFrame[3] = b3;
    // Side info area (bytes 4 .. 4+sideInfoSize-1) is all zeros, which
    // decodes to silence. Buffer.alloc already zero-fills.

    // Write Xing/Info payload starting just after side info.
    let pos = 4 + sideInfoSize;
    xingFrame.write('Info', pos, 'ascii'); pos += 4;
    // Flags: bit 0 = frames, bit 1 = bytes, bit 2 = TOC.
    xingFrame.writeUInt32BE(0x00000007, pos); pos += 4;
    // Total frame count (includes this Info frame, per LAME convention).
    xingFrame.writeUInt32BE(audioFrameCount + 1, pos); pos += 4;
    // Total byte count (the entire final file, including this Info frame).
    xingFrame.writeUInt32BE(mp3Buffer.length + frameSize, pos); pos += 4;
    // Linear TOC: each byte i represents the byte offset (scaled 0-255)
    // at the i% playback point. Linear distribution works for CBR.
    for (let i = 0; i < 100; i++) {
      xingFrame[pos + i] = Math.min(255, Math.floor(i * 256 / 100));
    }
    // Remaining bytes of the frame stay zero.

    return Buffer.concat([xingFrame, mp3Buffer]);
  } catch (err) {
    console.error('[briefing] Xing header injection failed, falling back to raw concat:', err && err.message);
    return mp3Buffer;
  }
}

// Render the full multi-voice briefing. Each segment becomes its own mp3,
// then byte-concatenated into a single audio file. ElevenLabs returns
// consistent encoding (turbo_v2_5), so concatenated mp3s play correctly in
// HTML5 audio.
async function renderBriefingFromSegments(segments) {
  const buffers = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = houseTypography(seg.text).replace(/\s{2,}/g, ' ').trim();
    if (!text) continue;
    const buf = await synthSegment(text, seg.speaker || 'anchor');
    buffers.push(buf);
  }
  if (!buffers.length) throw new Error('no segments produced audio');
  return Buffer.concat(buffers);
}

/* ──────────────────────────────────────────────────────────────────────────
   Per-episode storage helpers.

   STORAGE MODEL (post-refactor 2026-06-03):

   newswire_briefings_audio blob store:
     episode-YYYY-MM-DD   mp3 audio for that calendar date's episode
     latest               mp3 audio for the most recently generated episode
                          (alias / convenience copy, kept for the existing
                          homepage player that hits ?v=<timestamp> without
                          a specific episode key)

   newswire_briefings_meta blob store:
     episode-YYYY-MM-DD   metadata JSON for that date's episode
     latest               metadata JSON for the most recent episode (alias)
     index                JSON array of episode keys, sorted newest-first.
                          The RSS feed enumerates this to emit one <item>
                          per episode. Cap at INDEX_MAX entries to keep
                          the feed manageable.

   Why an index list? Listing blobs is supported but slow and not always
   ordered. An explicit index keeps RSS fast and predictable.
   ────────────────────────────────────────────────────────────────────── */

const INDEX_MAX = 60; // 2 months of daily episodes. Plenty for podcast catchup.

function episodeKeyForDate(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(+d)) throw new Error('episodeKeyForDate: invalid date');
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `episode-${y}-${m}-${day}`;
}

// Returns the noon-UTC timestamp for a given date string (YYYY-MM-DD) or
// Date instance. Used as the episode's published_at so it lands on the
// expected calendar day in any reasonable time zone.
function noonUtcForDate(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(+d)) throw new Error('noonUtcForDate: invalid date');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)).toISOString();
}

// Read the episode index. Returns [] if missing.
async function readEpisodeIndex() {
  try {
    const metaStore = getStore('newswire_briefings_meta');
    const idx = await metaStore.get('index', { type: 'json' });
    return Array.isArray(idx) ? idx : [];
  } catch (err) {
    console.error('[briefing-helpers] index read failed', err && err.message);
    return [];
  }
}

// Add (or update timestamp for) an episode key in the index. Idempotent:
// adding a key already present moves it to the front and rewrites the
// generated_at timestamp. Truncates to INDEX_MAX. Last-write-wins under
// concurrency, which is acceptable since the only writers are the daily
// cron (once a day) and an admin-triggered backfill (rare). Worst case a
// concurrent write loses a single index entry; the underlying episode
// blob is still there and a re-fire of the backfill would re-add it.
async function upsertEpisodeIndex(episodeKey, generatedAtIso) {
  const metaStore = getStore('newswire_briefings_meta');
  const existing = await readEpisodeIndex();
  const filtered = existing.filter(e => e && e.key !== episodeKey);
  const next = [{ key: episodeKey, generated_at: generatedAtIso }, ...filtered].slice(0, INDEX_MAX);
  await metaStore.setJSON('index', next);
  return next;
}

module.exports = {
  ANCHOR,
  DESK_LABELS,
  AUDIO_BITRATE_BPS,
  SITE_BASE,
  loadReporters,
  buildScriptSystemPrompt,
  buildScriptUserMessage,
  synthSegment,
  prependXingInfoHeader,
  renderBriefingFromSegments,
  episodeKeyForDate,
  noonUtcForDate,
  readEpisodeIndex,
  upsertEpisodeIndex,
};
