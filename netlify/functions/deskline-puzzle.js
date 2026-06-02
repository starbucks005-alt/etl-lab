/* ─────────────────────────────────────────────────────────────────────────────
   deskline-puzzle — returns today's Deskline puzzle.

   The puzzle is a 7-headline desk-classification quiz. For each headline
   the player picks the desk; their score is the number of correct matches
   against the wire's actual desk assignment.

   GET /.netlify/functions/deskline-puzzle
   Returns: { puzzle_id, date, questions: [{idx, title, dek}], desk_options }

   IMPORTANT: the correct answers are NOT returned in this response. They
   are sealed for the player. The score is computed server-side via
   deskline-submit; that endpoint returns the correct answers + the score.

   The puzzle is deterministic per UTC date: every visitor that day sees the
   exact same 7 headlines in the exact same order. Selection is seeded by
   date so the puzzle is stable.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const DESK_OPTIONS = [
  { id: 'us',            label: 'US',            glyph: '🇺🇸' },
  { id: 'world',         label: 'World',         glyph: '🌍' },
  { id: 'business',      label: 'Business',      glyph: '💼' },
  { id: 'technology',    label: 'Technology',    glyph: '💻' },
  { id: 'security',      label: 'Security',      glyph: '🔒' },
  { id: 'science',       label: 'Science',       glyph: '🔬' },
  { id: 'health',        label: 'Health',        glyph: '⚕️' },
  { id: 'entertainment', label: 'Entertainment', glyph: '🎭' },
  { id: 'sports',        label: 'Sports',        glyph: '🏈' },
];

// Deterministic shuffle: a simple seeded PRNG so the same date+pool produces
// the same selection on every server warm-up. Mulberry32.
function mulberry32(seed) {
  return function() {
    let t = (seed += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Today's puzzle id = US Eastern date. Rotates at midnight ET so American
// players wake up to a new puzzle. Using UTC would rotate at 8 PM ET which
// is wrong for the "daily morning ritual" use case.
function todayET() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(new Date()); // YYYY-MM-DD
}
// Keep the old name as an alias so deskline-submit.js's require still works.
const todayUTC = todayET;

// Seed from a date string (e.g. "2026-06-02") deterministically.
function seedFromDate(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  const puzzle_id = todayUTC();

  let order = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    console.error('[deskline-puzzle] index read failed', err && err.message);
  }

  // Eligible pool: pieces with a title + a valid desk classification.
  const pool = order.filter(p => p && p.title && p.slug && p.desk && DESK_OPTIONS.some(d => d.id === p.desk));

  if (pool.length < 7) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        puzzle_id,
        ready: false,
        reason: 'Not enough pieces on the wire to build today\'s puzzle. Need at least 7 desk-tagged pieces.',
        desk_options: DESK_OPTIONS,
      }),
    };
  }

  // Deterministic shuffle of the pool, take first 7. Same date -> same picks.
  const rng = mulberry32(seedFromDate(puzzle_id));
  const indices = pool.map((_, i) => i);
  // Fisher-Yates with seeded rng
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const picked = indices.slice(0, 7).map(i => pool[i]);

  // Public response: NO correct answers. Just the question stems.
  const questions = picked.map((p, idx) => ({
    idx,
    title: p.title,
    dek: p.dek || '',
  }));

  // Cache headers: same puzzle for the day. Aggressive cache OK.
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600',
    },
    body: JSON.stringify({
      puzzle_id,
      date: puzzle_id,
      ready: true,
      questions,
      desk_options: DESK_OPTIONS,
      total_questions: questions.length,
    }),
  };
};

// Export internals for the submit endpoint to reuse the same selection logic.
exports.DESK_OPTIONS = DESK_OPTIONS;
exports.mulberry32 = mulberry32;
exports.todayUTC = todayUTC;
exports.seedFromDate = seedFromDate;
