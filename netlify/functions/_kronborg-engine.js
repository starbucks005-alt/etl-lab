/* ─────────────────────────────────────────────────────────────────────────────
   _kronborg-engine — the History: Denmark 1500-1600s classroom's emotion
   engine. Same math and shape as Almost Human's _eq-engine.js (7 Ekman-style
   primary emotions, 0-100 baselines the agent decays toward, a per-agent
   volatility multiplier), reimplemented self-contained here rather than
   cross-required, so this classroom can never put Almost Human at risk (same
   principle kronborg-chat.js's own header already states for its Wikipedia
   backpack).

   This ships the LIVE, session-only half of Almost Human's two-layer system
   (the per-turn "felt" scales, resent by the client each turn, decayed and
   nudged by the model's own felt output). It deliberately skips the second,
   optional layer -- a DB-persisted "canon mood of the day" curated through an
   owner admin UI (etl_agent_emotions + memory-implant-emotions.js /
   memory-implant-admin.js) -- since that's a separate editorial workflow, not
   part of "do the agents have emotions," and can be added later without
   touching this module.

   Underscore prefix = utility module, not a Netlify endpoint.
   ───────────────────────────────────────────────────────────────────────────── */

const EMOTIONS = ['happiness', 'sadness', 'fear', 'disgust', 'anger', 'surprise', 'curious'];

const VOLATILITY = {
  'very low': 0.4,
  low: 0.6,
  'low-medium': 0.75,
  medium: 1.0,
  'medium-high': 1.25,
  high: 1.5,
};

// Baselines are the resting state each agent's scales decay toward between
// turns -- a real, thought-through disposition per persona, not a shared
// default. Volatility is how hard a single turn's felt reading can swing
// them off that baseline (applyTurn below).
const AGENTS = {
  king: {
    baseline: { happiness: 55, sadness: 15, fear: 10, disgust: 40, anger: 45, surprise: 20, curious: 35 },
    volatility: 'high', // a temperamental absolute monarch, quick to flare
  },
  boy_king: {
    baseline: { happiness: 35, sadness: 40, fear: 25, disgust: 20, anger: 30, surprise: 30, curious: 70 },
    volatility: 'medium', // frustrated and powerless, but genuinely alight with intellectual curiosity
  },
  anne_catherine: {
    baseline: { happiness: 30, sadness: 20, fear: 10, disgust: 55, anger: 25, surprise: 15, curious: 25 },
    volatility: 'very low', // ice-cold German court decorum; almost nothing visibly moves her
  },
  kirsten_munk: {
    baseline: { happiness: 45, sadness: 30, fear: 15, disgust: 35, anger: 60, surprise: 30, curious: 40 },
    volatility: 'high', // fiery, defiant, quick to temper
  },
  jens: {
    baseline: { happiness: 40, sadness: 20, fear: 45, disgust: 25, anger: 20, surprise: 25, curious: 50 },
    volatility: 'medium', // a merchant's anxious calculation, always pricing the next risk
  },
  morten: {
    baseline: { happiness: 35, sadness: 15, fear: 10, disgust: 30, anger: 40, surprise: 10, curious: 20 },
    volatility: 'low', // gruff, stoic, not easily rattled either way
  },
  rasmus: {
    baseline: { happiness: 65, sadness: 15, fear: 15, disgust: 20, anger: 15, surprise: 35, curious: 60 },
    volatility: 'medium-high', // boisterous host, genuinely lights up at a good story
  },
  kirsten_m: {
    baseline: { happiness: 45, sadness: 20, fear: 20, disgust: 35, anger: 40, surprise: 20, curious: 30 },
    volatility: 'medium', // sharp-witted and protective, quick to flash but practical
  },
  niels: {
    baseline: { happiness: 25, sadness: 35, fear: 40, disgust: 15, anger: 20, surprise: 15, curious: 25 },
    volatility: 'low', // weathered and fatalistic, the sea has worn the swings out of him
  },
  hans_bodil: {
    baseline: { happiness: 65, sadness: 15, fear: 35, disgust: 10, anger: 15, surprise: 55, curious: 70 },
    volatility: 'high', // children: delighted or terrified within a sentence
  },
};

const SMOOTHING = 0.6; // how much of the way from current to target one turn moves
const DECAY = 0.2;     // how much of the way back to baseline one turn's silence settles

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function seedOpeningState(agentKey) {
  const cfg = AGENTS[agentKey];
  return cfg ? { ...cfg.baseline } : Object.fromEntries(EMOTIONS.map((e) => [e, 20]));
}

function sanitizeScales(scales, agentKey) {
  const base = seedOpeningState(agentKey);
  if (!scales || typeof scales !== 'object') return base;
  const out = {};
  EMOTIONS.forEach((e) => {
    const v = Number(scales[e]);
    out[e] = Number.isFinite(v) ? clamp(v, 0, 100) : base[e];
  });
  return out;
}

// Settles the scales toward baseline a bit before the new turn's stimulus is
// applied -- represents the beat of quiet between exchanges, not a hard reset.
function decayEmotions(scales, agentKey) {
  const cfg = AGENTS[agentKey];
  const baseline = cfg ? cfg.baseline : seedOpeningState(agentKey);
  const current = sanitizeScales(scales, agentKey);
  const out = {};
  EMOTIONS.forEach((e) => {
    out[e] = current[e] + (baseline[e] - current[e]) * DECAY;
  });
  return out;
}

// felt: { happiness..curious: 0-8 }, the model's own per-turn reading of how
// strongly it felt each emotion this turn. Target pulls toward baseline plus
// that reading scaled by the agent's volatility; next state moves partway
// there (smoothing), so one turn nudges rather than teleports the state.
function applyTurn(decayedScales, felt, agentKey, smoothing) {
  const cfg = AGENTS[agentKey];
  const baseline = cfg ? cfg.baseline : seedOpeningState(agentKey);
  const volatility = VOLATILITY[cfg && cfg.volatility] || VOLATILITY.medium;
  const s = typeof smoothing === 'number' ? smoothing : SMOOTHING;
  const feltSafe = felt && typeof felt === 'object' ? felt : {};
  const out = {};
  EMOTIONS.forEach((e) => {
    const feltValue = clamp(Number(feltSafe[e]) || 0, 0, 8);
    const target = clamp(baseline[e] + feltValue * volatility * 11, 0, 100);
    out[e] = decayedScales[e] + (target - decayedScales[e]) * s;
  });
  return out;
}

// The dominant emotion this turn, for a small client-side display label --
// not used server-side, just handed back for convenience.
function dominantEmotion(scales) {
  let best = 'curious', bestVal = -1;
  EMOTIONS.forEach((e) => {
    const v = Number(scales && scales[e]) || 0;
    if (v > bestVal) { bestVal = v; best = e; }
  });
  return best;
}

module.exports = {
  EMOTIONS,
  AGENTS,
  SMOOTHING,
  seedOpeningState,
  sanitizeScales,
  decayEmotions,
  applyTurn,
  dominantEmotion,
};
