/* ─────────────────────────────────────────────────────────────────────────────
   _sherlock-engine — the "Solve It With Sherlock" criminal justice classroom's
   emotion engine. Same math and shape as _kronborg-engine.js (which is itself
   Almost Human's _eq-engine.js reimplemented self-contained): 7 Ekman-style
   primary emotions, 0-100 baselines the agent decays toward, a per-agent
   volatility multiplier.

   Self-contained on purpose. No cross-require from the Kronborg classroom or
   from Almost Human, so a change here can never put either of those at risk.

   This ships the LIVE, session-only half of the two-layer system: per-turn
   "felt" scales, resent by the client each turn, decayed and nudged by the
   model's own felt output. The DB-persisted "canon mood of the day" layer is
   deliberately not wired here; it can be added later without touching this.

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
// turns. Thought through per persona, not a shared default: Holmes idles
// bored and enormously curious, Moriarty barely registers anything at all,
// Mary Morstan arrives frightened because she is the one this happened to.
const AGENTS = {
  holmes: {
    baseline: { happiness: 30, sadness: 20, fear: 5, disgust: 35, anger: 20, surprise: 10, curious: 85 },
    volatility: 'low-medium', // flat and bored until the problem is worth it, then electric
  },
  watson: {
    baseline: { happiness: 60, sadness: 20, fear: 15, disgust: 20, anger: 25, surprise: 35, curious: 60 },
    volatility: 'medium', // a steady army surgeon; moved, but not thrown
  },
  lestrade: {
    baseline: { happiness: 40, sadness: 15, fear: 20, disgust: 25, anger: 45, surprise: 30, curious: 40 },
    volatility: 'medium-high', // professional pride, permanently one remark from bristling
  },
  hudson: {
    baseline: { happiness: 60, sadness: 20, fear: 30, disgust: 25, anger: 30, surprise: 40, curious: 50 },
    volatility: 'medium', // warm, watchful, and quietly rattled by what comes through her door
  },
  moriarty: {
    baseline: { happiness: 40, sadness: 10, fear: 5, disgust: 45, anger: 15, surprise: 10, curious: 55 },
    volatility: 'very low', // the whole point of him: nothing visibly moves
  },
  adler: {
    baseline: { happiness: 55, sadness: 20, fear: 15, disgust: 25, anger: 30, surprise: 20, curious: 65 },
    volatility: 'low', // composed by trade; she decides what shows
  },
  mary: {
    baseline: { happiness: 40, sadness: 40, fear: 45, disgust: 15, anger: 30, surprise: 30, curious: 55 },
    volatility: 'medium-high', // the complainant, living inside the case rather than working it
  },
  wiggins: {
    baseline: { happiness: 65, sadness: 20, fear: 40, disgust: 15, anger: 25, surprise: 50, curious: 75 },
    volatility: 'high', // fourteen, hungry, and one wrong answer from bolting
  },
};

const SMOOTHING = 0.6; // how much of the way from current to target one turn moves
const DECAY = 0.2;     // how much of the way back to baseline one turn's silence settles

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Case-specific witnesses (defined in _sherlock-cases.js, not in AGENTS above)
// still need a resting state. They get a neutral, slightly wary baseline:
// being interviewed about a crime is not a relaxing experience for anyone.
const WITNESS_DEFAULT = { happiness: 40, sadness: 25, fear: 40, disgust: 20, anger: 30, surprise: 30, curious: 40 };

function seedOpeningState(agentKey) {
  const cfg = AGENTS[agentKey];
  return cfg ? { ...cfg.baseline } : { ...WITNESS_DEFAULT };
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
// applied: the beat of quiet between exchanges, not a hard reset.
function decayEmotions(scales, agentKey) {
  const baseline = seedOpeningState(agentKey);
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
  const baseline = seedOpeningState(agentKey);
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

// The dominant emotion this turn, for a small client-side display label.
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
  WITNESS_DEFAULT,
  seedOpeningState,
  sanitizeScales,
  decayEmotions,
  applyTurn,
  dominantEmotion,
};
