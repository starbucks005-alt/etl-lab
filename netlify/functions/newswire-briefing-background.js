/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-background — generate the "Above the Fold" multi-voice
   audio briefing for TODAY.

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

   STORAGE (per-episode model, see _briefing-helpers.js):
     Writes BOTH:
       - newswire_briefings_audio/episode-YYYY-MM-DD  (per-day key)
       - newswire_briefings_audio/latest              (alias for the player)
       - newswire_briefings_meta/episode-YYYY-MM-DD   (per-day metadata)
       - newswire_briefings_meta/latest               (alias)
       - newswire_briefings_meta/index                (rolling episode list)

   The index list is what newswire-podcast-rss enumerates to publish multiple
   episodes to Spotify/Apple. Without per-episode keys + the index, the feed
   only ever showed today.

   Requires env vars:
     ANTHROPIC_API_KEY
     ELEVENLABS_API_KEY
     PRESS_ADMIN_USER + PRESS_ADMIN_PASS
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const {
  DESK_LABELS,
  AUDIO_BITRATE_BPS,
  buildScriptSystemPrompt,
  buildScriptUserMessage,
  prependXingInfoHeader,
  renderBriefingFromSegments,
  episodeKeyForDate,
  upsertEpisodeIndex,
} = require('./_briefing-helpers');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2200; // JSON output is more verbose than plain script

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Every rejection below is logged (added 2026-07-30). These four branches each
// mean something different and none of them said so: from outside, a missing
// env var, a mismatched credential and a cron that never fired all looked
// identical. The daily briefing stopped generating on 2026-07-27 and narrowing
// it took comparing timestamps across unrelated crons. Presence and reason only,
// never the credential values.
function requireBasicAuth(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    console.error('[briefing] REJECTED 503: admin creds not configured.'
      + ' PRESS_ADMIN_USER set=' + !!user + ' PRESS_ADMIN_PASS set=' + !!pass);
    return { ok: false, response: { statusCode: 503, body: 'admin disabled' } };
  }
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    console.error('[briefing] REJECTED 401: caller sent no basic auth header'
      + ' (header present=' + !!header + ')');
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'auth required' } };
  }
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx === -1) throw new Error('malformed');
    if (decoded.slice(0, idx) !== user || decoded.slice(idx + 1) !== pass) {
      console.error('[briefing] REJECTED 401: credentials did not match the'
        + ' configured PRESS_ADMIN_USER/PASS'
        + ' (user matched=' + (decoded.slice(0, idx) === user) + ')');
      return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid credentials' } };
    }
  } catch (err) {
    console.error('[briefing] REJECTED 401: malformed basic auth header:', err && err.message);
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid auth' } };
  }
  return { ok: true };
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

  // Compute the real duration from byte count. ElevenLabs returns CBR mp3
  // at 64 kbps (we forced output_format=mp3_44100_64 in synthSegment), so
  //   seconds = bytes * 8 / 64000
  // is exact. Compute BEFORE Xing injection so we measure only audio
  // content, not the prepended silent info frame.
  const durationSeconds = Math.max(1, Math.round(mp3Buffer.length * 8 / AUDIO_BITRATE_BPS));
  const durationLabel = Math.floor(durationSeconds / 60) + ':' + String(durationSeconds % 60).padStart(2, '0');

  // Inject a Xing/Info VBR header at the start of the concatenated stream
  // so the HTML5 audio element shows the correct total duration BEFORE
  // playback starts. See _briefing-helpers comment block for the full
  // rationale. Safe: on any parse failure it returns the input unchanged.
  mp3Buffer = prependXingInfoHeader(mp3Buffer);

  // Build a plain-text version of the script for the metadata (for reference,
  // RSS, transcript display). One blank line between segments.
  const scriptText = segments
    .map(s => String(s.text || '').trim())
    .filter(Boolean)
    .join('\n\n');

  // Episode key for today (UTC). The daily cron fires at 10 UTC = early
  // morning ET, so the date is unambiguous for ET-based listeners. Even
  // for late-night manual regenerations, "today UTC" is the right slot.
  const generatedAt = new Date().toISOString();
  const episodeKey = episodeKeyForDate(generatedAt);

  // Store the mp3 under BOTH the per-episode key AND latest. Latest keeps
  // the existing homepage player working unchanged. Per-episode key is
  // what the RSS feed and the per-episode audio endpoint use.
  try {
    const audioStore = getStore('newswire_briefings_audio');
    await audioStore.set(episodeKey, mp3Buffer, { metadata: { contentType: 'audio/mpeg' } });
    await audioStore.set('latest', mp3Buffer, { metadata: { contentType: 'audio/mpeg' } });
  } catch (err) {
    console.error('[briefing] audio store write failed', err && err.message);
    return json(500, { error: 'audio store write failed' });
  }

  const meta = {
    episode_key: episodeKey,
    generated_at: generatedAt,
    script: scriptText,
    word_count: scriptText.split(/\s+/).length,
    segment_count: segments.length,
    voices_used: Array.from(new Set(segments.map(s => s.speaker || 'anchor'))),
    duration_seconds: durationSeconds,
    duration_label: durationLabel,
    byte_size: mp3Buffer.length,
    pieces: top.map(p => ({
      slug: p.slug,
      title: p.title,
      desk: p.desk || '',
      desk_label: DESK_LABELS[p.desk] || '',
      author: p.author || '',
      reporter_id: p.reporter_id || null,
    })),
    // audio_url points at the per-episode endpoint so each item in the RSS
    // feed resolves to its own episode and never gets confused with another.
    audio_url: '/.netlify/functions/newswire-briefing-audio?episode=' + encodeURIComponent(episodeKey),
  };
  try {
    const metaStore = getStore('newswire_briefings_meta');
    await metaStore.setJSON(episodeKey, meta);
    await metaStore.setJSON('latest', meta);
  } catch (err) {
    console.error('[briefing] meta store write failed', err && err.message);
    return json(500, { error: 'meta store write failed' });
  }

  // Update the rolling episode index so the RSS feed picks up the new
  // episode. Failure here doesn't fail the whole generation - the audio
  // and meta are already saved - but it does mean the RSS won't list this
  // episode until the next successful write. Log loudly.
  try {
    await upsertEpisodeIndex(episodeKey, generatedAt);
  } catch (err) {
    console.error('[briefing] index update failed (audio + meta saved, RSS may lag)', err && err.message);
  }

  return json(200, {
    ok: true,
    complete: true,
    episode_key: episodeKey,
    generated_at: generatedAt,
    word_count: meta.word_count,
    pieces: meta.pieces.length,
  });
};
