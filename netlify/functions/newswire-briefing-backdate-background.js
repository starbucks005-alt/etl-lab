/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-backdate-background — generate N HISTORICAL episodes of
   "Above the Fold" in one run, so the podcast RSS feed has multiple episodes
   to publish to Spotify, Apple Podcasts, etc.

   Why this exists: the daily generator only produces today's briefing.
   Spotify won't accept a podcast feed with a single episode, and the
   submission goal needs a believable back catalogue. This function loops
   over the last N calendar days and generates one episode per day, dating
   each to its historical day so the RSS feed shows a natural episode
   cadence.

   Admin-gated POST /.netlify/functions/newswire-briefing-backdate-background
   Body: {
     count:    integer (1..30)   how many historical episodes to generate
     end_date: 'YYYY-MM-DD' OR omit  the most-recent date to backfill;
                                     omit to default to yesterday (today's
                                     daily cron handles today)
     skip_existing: boolean  default true. When true, dates whose episodes
                             already exist in storage are skipped, so a
                             re-run is idempotent and cheap.
   }

   Background function (15-min runtime). For each historical date:
     1. Pull wire pieces from press_index with published_at <= that date
     2. Take top 7 (most recent as-of that date)
     3. Generate the multi-voice script via Anthropic
     4. Render audio via ElevenLabs (per-segment voices)
     5. Store under episode-YYYY-MM-DD blob keys + add to index
     6. DO NOT overwrite 'latest' (that points at today, set by daily cron)

   Story-selection note: the historical episodes use the SAME wire-piece
   selection logic as the daily generator, just frozen to a historical
   "as of" date. Result: each historical episode sounds like a real
   archived ATF that aired on that day. Requires the wire to have pieces
   dated across the backfill window (press-seed-background did that
   work in May 2026).

   Per-day generation cost: ~1 Anthropic call (~$0.02-0.05) + ElevenLabs
   per-segment (~$0.10-0.25 per minute of audio). 14 episodes ~= $2-5
   in TTS, well within the budget for a podcast launch.

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
  noonUtcForDate,
  upsertEpisodeIndex,
} = require('./_briefing-helpers');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2200;

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

// Compute the list of historical dates to generate, newest-first.
// Yields YYYY-MM-DD strings.
function* historicalDates(endDateStr, count) {
  const end = new Date(endDateStr + 'T00:00:00Z'); // UTC midnight
  for (let i = 0; i < count; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    yield d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
}

// Filter wire pieces to those whose published_at is <= the historical date.
// Returns up to 7 most-recent. Falls back to "any pieces" if the filter
// returns nothing (early backfill dates before the seed range).
function piecesAsOfDate(allPieces, dateStr) {
  const cutoff = dateStr + 'T23:59:59Z';
  const eligible = allPieces.filter(p => {
    if (!p || !p.title || !p.slug) return false;
    const ts = p.published_at || p.created_at || p.updated_at || '';
    if (!ts) return false; // can't date, skip
    return ts <= cutoff;
  });
  // Sort newest-first by whatever timestamp is available.
  eligible.sort((a, b) => {
    const ta = a.published_at || a.created_at || a.updated_at || '';
    const tb = b.published_at || b.created_at || b.updated_at || '';
    return tb.localeCompare(ta);
  });
  return eligible.slice(0, 7);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  // Parse body.
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (_) {
    return json(400, { error: 'invalid JSON body' });
  }
  const count = Math.max(1, Math.min(30, parseInt(body.count, 10) || 14));
  const skipExisting = body.skip_existing !== false;

  // Default end date = yesterday UTC (today is handled by the daily cron).
  let endDateStr = body.end_date;
  if (!endDateStr) {
    const y = new Date();
    y.setUTCDate(y.getUTCDate() - 1);
    endDateStr = y.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
    return json(400, { error: 'end_date must be YYYY-MM-DD' });
  }

  try { connectLambda(event); } catch (err) {
    console.error('[backdate] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  // Load the full wire index once. We re-filter per historical date.
  let allPieces = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) allPieces = arr;
  } catch (err) {
    console.error('[backdate] index read failed', err && err.message);
    return json(500, { error: 'index read failed' });
  }
  if (!allPieces.length) {
    return json(400, { error: 'no pieces on the wire to backfill from' });
  }

  const audioStore = getStore('newswire_briefings_audio');
  const metaStore  = getStore('newswire_briefings_meta');
  const client = new Anthropic({ apiKey });

  const results = [];
  const dates = Array.from(historicalDates(endDateStr, count));
  console.log('[backdate] starting backfill', { count, endDateStr, dates });

  for (const dateStr of dates) {
    const episodeKey = episodeKeyForDate(dateStr + 'T12:00:00Z');
    const publishedAt = noonUtcForDate(dateStr);

    // Idempotency: skip if this episode already exists.
    if (skipExisting) {
      try {
        const existing = await metaStore.get(episodeKey, { type: 'json' });
        if (existing) {
          console.log('[backdate] skip existing', episodeKey);
          results.push({ date: dateStr, episode_key: episodeKey, status: 'skipped_existing' });
          continue;
        }
      } catch (_) { /* missing is fine */ }
    }

    // Select wire pieces that existed as-of this historical date.
    const pieces = piecesAsOfDate(allPieces, dateStr);
    if (!pieces.length) {
      console.warn('[backdate] no pieces as-of', dateStr, '- skipping');
      results.push({ date: dateStr, episode_key: episodeKey, status: 'skipped_no_pieces' });
      continue;
    }

    // Generate script.
    let rawText;
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildScriptSystemPrompt(),
        messages: [{ role: 'user', content: buildScriptUserMessage(pieces) }],
      });
      rawText = (resp.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
    } catch (err) {
      console.error('[backdate] anthropic error for', dateStr, err && err.message);
      results.push({ date: dateStr, episode_key: episodeKey, status: 'error_script', error: err && err.message });
      continue; // keep going; one bad day shouldn't kill the whole backfill
    }
    if (!rawText) {
      results.push({ date: dateStr, episode_key: episodeKey, status: 'error_script_empty' });
      continue;
    }

    // Parse JSON.
    let segments;
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : rawText);
      segments = Array.isArray(parsed.segments) ? parsed.segments : null;
    } catch (err) {
      console.error('[backdate] JSON parse failed for', dateStr, err && err.message);
      results.push({ date: dateStr, episode_key: episodeKey, status: 'error_parse', error: err && err.message });
      continue;
    }
    if (!segments || !segments.length) {
      results.push({ date: dateStr, episode_key: episodeKey, status: 'error_no_segments' });
      continue;
    }

    // Render audio.
    let mp3Buffer;
    try {
      mp3Buffer = await renderBriefingFromSegments(segments);
    } catch (err) {
      console.error('[backdate] elevenlabs render failed for', dateStr, err && err.message);
      results.push({ date: dateStr, episode_key: episodeKey, status: 'error_tts', error: err && err.message });
      continue;
    }

    // Duration math (before Xing injection so we measure only audio).
    const durationSeconds = Math.max(1, Math.round(mp3Buffer.length * 8 / AUDIO_BITRATE_BPS));
    const durationLabel = Math.floor(durationSeconds / 60) + ':' + String(durationSeconds % 60).padStart(2, '0');
    mp3Buffer = prependXingInfoHeader(mp3Buffer);

    // Build script text + metadata.
    const scriptText = segments
      .map(s => String(s.text || '').trim())
      .filter(Boolean)
      .join('\n\n');

    const meta = {
      episode_key: episodeKey,
      generated_at: publishedAt,   // stamp as the historical date (noon UTC)
      backdated: true,
      backdated_run_at: new Date().toISOString(),
      script: scriptText,
      word_count: scriptText.split(/\s+/).length,
      segment_count: segments.length,
      voices_used: Array.from(new Set(segments.map(s => s.speaker || 'anchor'))),
      duration_seconds: durationSeconds,
      duration_label: durationLabel,
      byte_size: mp3Buffer.length,
      pieces: pieces.map(p => ({
        slug: p.slug,
        title: p.title,
        desk: p.desk || '',
        desk_label: DESK_LABELS[p.desk] || '',
        author: p.author || '',
        reporter_id: p.reporter_id || null,
      })),
      audio_url: '/.netlify/functions/newswire-briefing-audio?episode=' + encodeURIComponent(episodeKey),
    };

    // Write per-episode keys. Do NOT touch 'latest' - that's today's.
    try {
      await audioStore.set(episodeKey, mp3Buffer, { metadata: { contentType: 'audio/mpeg' } });
      await metaStore.setJSON(episodeKey, meta);
    } catch (err) {
      console.error('[backdate] store write failed for', dateStr, err && err.message);
      results.push({ date: dateStr, episode_key: episodeKey, status: 'error_store', error: err && err.message });
      continue;
    }

    // Update the index. Failure here means the RSS won't show this
    // episode until next index write; don't fail the whole loop on it.
    try {
      await upsertEpisodeIndex(episodeKey, publishedAt);
    } catch (err) {
      console.error('[backdate] index update failed for', dateStr, '(stored ok)', err && err.message);
    }

    console.log('[backdate] generated', episodeKey, durationLabel, meta.word_count + 'w', pieces.length + 'p');
    results.push({
      date: dateStr,
      episode_key: episodeKey,
      status: 'generated',
      duration: durationLabel,
      word_count: meta.word_count,
      pieces: pieces.length,
    });
  }

  const generated = results.filter(r => r.status === 'generated').length;
  const skipped = results.filter(r => r.status.startsWith('skipped')).length;
  const errored = results.filter(r => r.status.startsWith('error')).length;

  return json(200, {
    ok: true,
    count_requested: count,
    end_date: endDateStr,
    generated,
    skipped,
    errored,
    results,
  });
};
