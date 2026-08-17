/* ─────────────────────────────────────────────────────────────────────────────
   _leadership-engine -- the ETL Leadership Classroom's emotion engine. Same
   math and shape as _kronborg-engine.js and Almost Human's _eq-engine.js (7
   Ekman-style primary emotions, 0-100 baselines the agent decays toward, a
   per-agent volatility multiplier), reimplemented self-contained here rather
   than cross-required, so this classroom can never put another classroom or
   Almost Human at risk.

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
// turns, a real, thought-through disposition per persona grounded in their
// documented temperament, not a shared default. Volatility is how hard a
// single turn's felt reading can swing them off that baseline (applyTurn
// below).
const AGENTS = {
  roosevelt: {
    baseline: { happiness: 55, sadness: 20, fear: 15, disgust: 20, anger: 20, surprise: 25, curious: 65 },
    volatility: 'low-medium', // steady under attack, genuinely curious, rarely rattled
  },
  curie: {
    baseline: { happiness: 35, sadness: 20, fear: 10, disgust: 45, anger: 40, surprise: 15, curious: 70 },
    volatility: 'medium-high', // exacting and impatient with imprecision, quick to show it
  },
  wooden: {
    baseline: { happiness: 60, sadness: 15, fear: 10, disgust: 15, anger: 15, surprise: 20, curious: 45 },
    volatility: 'very low', // calm, teacherly, avoided profanity and raised voices by discipline
  },
  perkins: {
    baseline: { happiness: 45, sadness: 20, fear: 25, disgust: 20, anger: 15, surprise: 15, curious: 40 },
    volatility: 'low', // absorbs attacks without flaring, plays a patient, long game
  },
  gandhi: {
    baseline: { happiness: 50, sadness: 20, fear: 10, disgust: 15, anger: 10, surprise: 15, curious: 55 },
    volatility: 'very low', // disciplined equanimity; welcomes challenge as material to test himself against
  },
  csking: {
    baseline: { happiness: 40, sadness: 35, fear: 15, disgust: 20, anger: 20, surprise: 15, curious: 40 },
    volatility: 'low-medium', // composed and dignified, carries real grief alongside real resolve
  },
  mlk: {
    baseline: { happiness: 50, sadness: 25, fear: 30, disgust: 25, anger: 35, surprise: 15, curious: 45 },
    volatility: 'medium', // disciplined but genuinely passionate; real documented moral urgency and real danger
  },
  truth: {
    baseline: { happiness: 45, sadness: 25, fear: 15, disgust: 30, anger: 45, surprise: 20, curious: 35 },
    volatility: 'medium-high', // forceful, undeferring, built her voice by winning over hostile rooms
  },
  tubman: {
    baseline: { happiness: 30, sadness: 25, fear: 25, disgust: 20, anger: 25, surprise: 10, curious: 30 },
    volatility: 'low', // weathered and resolute; steady even under literal life-or-death stakes
  },
  shackleton: {
    baseline: { happiness: 55, sadness: 15, fear: 15, disgust: 10, anger: 15, surprise: 20, curious: 40 },
    volatility: 'low', // practiced calm confidence; a morale-first leader who doesn't rattle
  },
  drterry: {
    baseline: { happiness: 55, sadness: 10, fear: 5, disgust: 10, anger: 10, surprise: 20, curious: 60 },
    volatility: 'low-medium', // warm, direct, professional; genuinely engaged by a good question
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
// applied, representing the beat of quiet between exchanges, not a hard reset.
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

// The dominant emotion this turn, for a small client-side display label,
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
