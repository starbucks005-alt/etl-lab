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

/* ──────────────────────────────────────────────────────────────────────────
   pickPuzzle(puzzle_id) — the single source of truth for "what are today's
   7 questions." Lazy-freeze pattern:

     1. Check `deskline_puzzles` blob for a frozen entry keyed by puzzle_id.
     2. If present → return it. Every visitor today sees the same picks,
        even if the wire pool grows or shrinks during the day.
     3. If absent → run the seeded shuffle on the current pool, store the
        picked 7 as the frozen entry, return them. The first visitor of
        the day pays a small write cost; everyone after reads from blob.

   This replaces the prior "recompute live on every request" approach,
   which was fragile: mid-day publishes/archives changed the pool and
   silently shifted the picks (or broke them if a picked piece got
   deleted). With the frozen blob, the puzzle is immutable for the day.

   Returns { ready: true, picks: [{title, slug, desk, dek}] }
        or { ready: false, reason: "..." } when pool < 7.
   ────────────────────────────────────────────────────────────────────────── */
async function pickPuzzle(puzzle_id) {
  const puzzleStore = getStore('deskline_puzzles');

  // 1. Frozen?
  try {
    const frozen = await puzzleStore.get(puzzle_id, { type: 'json' });
    if (frozen && Array.isArray(frozen.picks) && frozen.picks.length === 7) {
      return { ready: true, picks: frozen.picks, frozen_at: frozen.frozen_at };
    }
  } catch (err) {
    console.error('[deskline] frozen-puzzle read failed', err && err.message);
    // Fall through to recompute. Better to serve a fresh puzzle than 500.
  }

  // 2. Load wire pool.
  let order = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    console.error('[deskline] index read failed', err && err.message);
  }

  const pool = order.filter(p => p && p.title && p.slug && p.desk && DESK_OPTIONS.some(d => d.id === p.desk));
  if (pool.length < 7) {
    return {
      ready: false,
      reason: 'Not enough pieces on the wire to build today\'s puzzle. Need at least 7 desk-tagged pieces.',
    };
  }

  // 3. Deterministic shuffle from date seed. Pool is also sorted by slug
  //    first so the indices are stable even if the index file's natural
  //    order changes between calls (e.g. a piece edited and re-saved).
  const sortedPool = pool.slice().sort((a, b) => a.slug.localeCompare(b.slug));
  const rng = mulberry32(seedFromDate(puzzle_id));
  const indices = sortedPool.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const picks = indices.slice(0, 7).map(i => {
    const p = sortedPool[i];
    return { title: p.title, slug: p.slug, desk: p.desk, dek: p.dek || '' };
  });

  // 4. Freeze for the rest of the day. The frozen_at timestamp doubles as
  //    a version marker — the client uses it as part of the localStorage
  //    key so that if we ever invalidate the frozen puzzle (e.g. after a
  //    reclassify), the next visit re-freezes with a NEW timestamp,
  //    producing a NEW localStorage key, and the user automatically gets
  //    a fresh playable puzzle without having to clear browser data.
  const frozen_at = new Date().toISOString();
  try {
    await puzzleStore.setJSON(puzzle_id, { picks, frozen_at });
  } catch (err) {
    console.error('[deskline] freeze write failed', err && err.message);
  }

  return { ready: true, picks, frozen_at };
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  const puzzle_id = todayET();
  const result = await pickPuzzle(puzzle_id);

  if (!result.ready) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        puzzle_id,
        ready: false,
        reason: result.reason,
        desk_options: DESK_OPTIONS,
      }),
    };
  }

  // Public response: NO correct answers. Just the question stems.
  const questions = result.picks.map((p, idx) => ({
    idx,
    title: p.title,
    dek: p.dek || '',
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // Short cache so an admin-triggered reclassify invalidation reaches
      // visitors within seconds, not 10 minutes. The puzzle is still
      // immutable for the day; the cache window just bounds how long a
      // stale frozen_at could linger after invalidation.
      'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=300',
    },
    body: JSON.stringify({
      puzzle_id,
      date: puzzle_id,
      ready: true,
      questions,
      desk_options: DESK_OPTIONS,
      total_questions: questions.length,
      frozen_at: result.frozen_at || '',
    }),
  };
};

// Export internals for the submit endpoint to reuse the same selection logic.
exports.DESK_OPTIONS = DESK_OPTIONS;
exports.mulberry32 = mulberry32;
exports.todayUTC = todayUTC;
exports.todayET = todayET;
exports.seedFromDate = seedFromDate;
exports.pickPuzzle = pickPuzzle;
