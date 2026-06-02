/* ─────────────────────────────────────────────────────────────────────────────
   deskline-submit — score a Deskline submission and return percentile.

   POST /.netlify/functions/deskline-submit
   Body: {
     puzzle_id: "2026-06-02",
     answers: ["world","security","health","technology","business","sports","entertainment"]
   }

   Response: {
     score: 6,
     total: 7,
     percentile: 78,           // % of today's players that scored <= this
     play_count: 142,          // total plays of today's puzzle
     correct: [                // the actual answers per question
       { idx, correct_desk, correct_label, glyph, your_desk, your_label, your_glyph, hit, near_miss }
     ],
     share_grid: "DESKLINE #003 · 6/7\n\n✅✅⛔✅✅✅✅\nTop 22%",
   }

   Stores per-puzzle play_count and per-score histogram in Netlify Blobs
   so percentile rankings refine as more people play.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const { DESK_OPTIONS, mulberry32, todayUTC, seedFromDate } = require('./deskline-puzzle');

const DESK_BY_ID = DESK_OPTIONS.reduce((acc, d) => { acc[d.id] = d; return acc; }, {});

// Desks that read as adjacent for the "near miss" yellow square. Same
// editorial neighborhoods that would plausibly cover the same story.
// Expanded after Deskline launch revealed too many flat-miss scorings on
// stories that span obvious editorial overlaps (Ebola in Kenya = world OR
// health OR security depending on lens; AI medical imaging = science OR
// health; pharma earnings = business OR health). Now health, science,
// security, world, and business have wider adjacency rings.
const ADJACENT = {
  us:            ['world', 'business', 'security'],
  world:         ['us', 'security', 'health'],
  business:      ['technology', 'us', 'health', 'science'],
  technology:    ['business', 'science', 'security'],
  security:      ['world', 'us', 'technology', 'health', 'science'],
  science:       ['technology', 'health', 'security'],
  health:        ['science', 'security', 'world', 'business'],
  entertainment: [],
  sports:        ['business'],
};

function isNearMiss(guess, correct) {
  if (!guess || !correct || guess === correct) return false;
  return (ADJACENT[correct] || []).includes(guess);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid json' }) }; }

  const puzzle_id = String(body.puzzle_id || todayUTC());
  if (puzzle_id !== todayUTC()) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'submissions only accepted for today\'s puzzle' }) };
  }
  const answers = Array.isArray(body.answers) ? body.answers.map(a => String(a || '').toLowerCase()) : [];

  try { connectLambda(event); } catch (_) {}

  // Reconstruct the same 7 picks the puzzle endpoint served by re-running
  // the deterministic selection on today's index. Cheaper than storing the
  // puzzle separately and keeps everything stateless.
  let order = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    console.error('[deskline-submit] index read failed', err && err.message);
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'wire index unavailable' }) };
  }
  const pool = order.filter(p => p && p.title && p.slug && p.desk && DESK_BY_ID[p.desk]);
  if (pool.length < 7) {
    return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'puzzle not ready' }) };
  }
  const rng = mulberry32(seedFromDate(puzzle_id));
  const indices = pool.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const picked = indices.slice(0, 7).map(i => pool[i]);

  // Score. Half-point for adjacent (near-miss) guesses. Possible per-Q
  // values: 1 (exact), 0.5 (near miss), 0 (miss). Possible totals out of 7:
  // 0, 0.5, 1, 1.5, ..., 7. Tracked in a 15-bucket histogram indexed by
  // score*2 (so index 11 = 5.5/7, index 14 = 7/7).
  let score = 0;
  const correct = picked.map((p, idx) => {
    const guess = answers[idx] || '';
    const hit = guess === p.desk;
    const near = !hit && isNearMiss(guess, p.desk);
    if (hit) score += 1;
    else if (near) score += 0.5;
    const cd = DESK_BY_ID[p.desk];
    const gd = DESK_BY_ID[guess];
    return {
      idx,
      title: p.title,
      correct_desk: p.desk,
      correct_label: cd ? cd.label : p.desk,
      correct_glyph: cd ? cd.glyph : '',
      your_desk: guess,
      your_label: gd ? gd.label : guess,
      your_glyph: gd ? gd.glyph : '',
      hit,
      near_miss: near,
    };
  });

  // Pretty score string: integer if whole (e.g. "6"), one-decimal if half
  // (e.g. "5.5"). Used in the share grid and response. Score itself stays
  // numeric for percentile math.
  const scoreLabel = (score % 1 === 0) ? String(score) : score.toFixed(1);
  const scoreIdx = Math.round(score * 2); // 0..14

  // Update per-puzzle stats: total plays, 15-bucket score histogram.
  //   Index 0  = 0   correct
  //   Index 1  = 0.5
  //   Index 2  = 1
  //   ...
  //   Index 14 = 7
  // Migrate legacy 8-bucket integer-only histograms by expanding into the
  // 15-bucket form: old[i] becomes new[i*2]. Old halves never existed so
  // the in-between slots start at zero.
  let stats = { total: 0, histogram: new Array(15).fill(0) };
  try {
    const statsStore = getStore('deskline_stats');
    const existing = await statsStore.get(puzzle_id, { type: 'json' });
    if (existing && Array.isArray(existing.histogram)) {
      if (existing.histogram.length === 15) {
        stats = existing;
      } else if (existing.histogram.length === 8) {
        // Migrate 8-bucket integer histogram into 15-bucket half-step.
        const migrated = new Array(15).fill(0);
        for (let i = 0; i < 8; i++) migrated[i * 2] = existing.histogram[i] || 0;
        stats = { total: existing.total || 0, histogram: migrated };
      }
    }
    stats.total = (stats.total || 0) + 1;
    stats.histogram[scoreIdx] = (stats.histogram[scoreIdx] || 0) + 1;
    await statsStore.setJSON(puzzle_id, stats);
  } catch (err) {
    console.error('[deskline-submit] stats write failed', err && err.message);
    // Non-fatal: scoring still works without stats.
  }

  // Percentile: "you scored at or above X% of today's players."
  // Count plays that scored STRICTLY HIGHER than this user; the rest are
  // <= and form the user's beat-percent.
  let above = 0;
  for (let s = scoreIdx + 1; s < 15; s++) above += stats.histogram[s] || 0;
  const better_than_percent = stats.total > 0
    ? Math.max(0, Math.round(((stats.total - above) / stats.total) * 100) - 1)
    : 50;

  // Puzzle number: days since launch (June 2 2026 = day 1).
  const launchUtc = new Date('2026-06-02T00:00:00Z');
  const todayUtc = new Date(puzzle_id + 'T00:00:00Z');
  const dayNumber = Math.max(1, Math.round((todayUtc - launchUtc) / 86400000) + 1);

  // Share grid: spoiler-free emoji line + score + ranking. Score is the
  // pretty label so half-points render as "5.5" not "5.5000001".
  const grid = correct.map(c => c.hit ? '✅' : c.near_miss ? '🟨' : '⛔').join('');
  const share_grid = `DESKLINE #${String(dayNumber).padStart(3, '0')} · ${scoreLabel}/${picked.length}\n\n${grid}\nTop ${Math.max(1, 100 - better_than_percent)}%\netl-newswire.com/press/deskline`;

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      score,
      score_label: scoreLabel,
      total: picked.length,
      percentile: better_than_percent,
      play_count: stats.total,
      day_number: dayNumber,
      correct,
      share_grid,
    }),
  };
};
