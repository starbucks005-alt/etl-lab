// _eq-engine.js — EQ Room emotion engine: scales, meters, and dynamics math.
// Pure functions, no I/O, so this is unit-testable in isolation from whatever
// Netlify function wires it to the model calls and Supabase.
// Spec: EQ ROOM/eq-room-emotion-engine-spec.md

// Six primary emotions (Ekman-style) replacing the earlier five relational scales
// (warmth/openness/ease/spirits/interest). Those measured "how do I feel about this guest",
// a steady, cumulative trait; these measure "what am I actually feeling right now", a
// momentary state that spikes on a real trigger and fades. All six use the same
// absolute-intensity update rule (applyEmotion) and the same fast decay-toward-baseline,
// unlike the old relational scales which nudged incrementally off wherever they last sat.
const SCALE_KEYS = ['happiness', 'sadness', 'fear', 'disgust', 'anger', 'surprise'];
const ALL_SCALE_KEYS = SCALE_KEYS;
const SURPRISE_BASELINE = 12; // kept as the name existing code already calls this constant
const SURPRISE_DECAY_FRACTION = 0.55;
const EMOTION_DECAY_FRACTION = 0.55;

const VOLATILITY = {
  'very low': 0.5,
  low: 0.7,
  medium: 1.0,
  'medium-high': 1.3,
  high: 1.6,
  // Marcus Holt is the only agent tagged "low-medium" in the spec's per-agent
  // table, but that tier has no number in the volatility list itself (only
  // very low/low/medium/medium-high/high are given). 0.85 is the midpoint of
  // low (0.7) and medium (1.0), a placeholder until Terry confirms the real
  // number, not something the spec actually states.
  'low-medium': 0.85,
};

const AGENTS = {
  ivy: {
    name: 'Ms. Ivy',
    baseline: { happiness: 68, sadness: 8, fear: 6, disgust: 6, anger: 8, surprise: 12 },
    volatility: 'low',
    warmsTo: 'curiosity, a nervous learner reassured, honest questions',
    chillsAt: 'condescension, belittling learners, arrogance',
  },
  auggie: {
    name: 'Auggie',
    baseline: { happiness: 71, sadness: 8, fear: 6, disgust: 6, anger: 8, surprise: 12 },
    volatility: 'medium',
    warmsTo: 'warmth, being appreciated, real rapport, respect',
    chillsAt: 'rudeness, disrespect of his work, disrespect of who he is',
  },
  dom: {
    name: 'Coach Dom',
    baseline: { happiness: 65, sadness: 8, fear: 6, disgust: 6, anger: 10, surprise: 12 },
    volatility: 'low',
    warmsTo: 'honest effort, wanting to improve, straight talk',
    chillsAt: 'ego-lifting, excuses, hype and shortcuts',
  },
  chris: {
    name: 'Chris Avila',
    baseline: { happiness: 54, sadness: 10, fear: 8, disgust: 8, anger: 8, surprise: 12 },
    volatility: 'medium',
    warmsTo: 'genuine interest in the work, being seen, respect for they/them',
    chillsAt: 'dismissing the art, misgendering, empty small talk, being rushed',
  },
  arthur: {
    name: 'Dr. Arthur Pendelton',
    baseline: { happiness: 62, sadness: 8, fear: 5, disgust: 6, anger: 6, surprise: 12 },
    volatility: 'low',
    warmsTo: 'someone struggling met with honesty, real vulnerability',
    chillsAt: 'cruelty toward the vulnerable, bad-faith games',
  },
  jen: {
    name: 'Jen Lopez',
    baseline: { happiness: 62, sadness: 8, fear: 6, disgust: 8, anger: 10, surprise: 12 },
    volatility: 'medium',
    warmsTo: 'competence, respect for time, a clear ask, humor',
    chillsAt: 'time-wasting, vagueness, chaos, disrespect',
  },
  noor: {
    name: 'Noor Haddad',
    baseline: { happiness: 64, sadness: 6, fear: 5, disgust: 5, anger: 4, surprise: 10 },
    volatility: 'very low',
    warmsTo: 'presence, someone seeking calm, honesty',
    chillsAt: 'aggression, mockery of stillness (she de-escalates, rarely spikes)',
  },
  mara: {
    name: 'Mara Rivera',
    baseline: { happiness: 67, sadness: 8, fear: 6, disgust: 10, anger: 10, surprise: 14 },
    volatility: 'medium-high',
    warmsTo: 'good taste, culture talk, real enthusiasm, banter',
    chillsAt: 'bad faith, philistinism, cruelty, pretension',
  },
  marceline: {
    name: 'Marceline Smith',
    baseline: { happiness: 52, sadness: 10, fear: 8, disgust: 8, anger: 8, surprise: 12 },
    volatility: 'low',
    warmsTo: 'respect, brevity, competence, politeness (warms slowly)',
    chillsAt: 'pushiness, entitlement, wasting time, rudeness',
  },
  marcus: {
    name: 'Marcus Holt',
    baseline: { happiness: 55, sadness: 6, fear: 4, disgust: 10, anger: 12, surprise: 10 },
    volatility: 'low-medium',
    warmsTo: 'intelligence, directness, a good argument, being challenged well',
    chillsAt: 'fluff, flattery, vagueness, emotional appeals without substance',
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function volatilityFor(agentKey) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`unknown agent: ${agentKey}`);
  const mult = VOLATILITY[agent.volatility];
  if (mult === undefined) throw new Error(`unknown volatility tier: ${agent.volatility}`);
  return mult;
}

// Kept for reference/tests; no longer used by the live turn flow now that all six scales are
// primary emotions rather than steady relational traits.
function applyDelta(current, delta, volatility, smoothing) {
  const applied = delta * volatility;
  const target = clamp(current + applied, 0, 100);
  return current + (target - current) * smoothing;
}

// Every emotion is an absolute intensity signal, not a relative nudge off wherever it
// currently sits: felt says how strongly this emotion fired this turn (0 = not at all, 8 =
// as hard as it gets), so it maps straight to a target level scaled by the agent's baseline
// and volatility, the same mechanic originally built for surprise, now shared by all six.
function applyEmotion(current, baseline, feltValue, volatility, smoothing) {
  const target = clamp(baseline + feltValue * volatility * 11, 0, 100);
  return current + (target - current) * smoothing;
}

// Kept for backward compatibility with the surprise-only code path; now just applyEmotion
// with SURPRISE_BASELINE, superseded by the generic per-emotion baselines in applyTurn.
function applySurprise(current, feltSurprise, smoothing) {
  return applyEmotion(current, SURPRISE_BASELINE, feltSurprise, 1, smoothing);
}

// Applies one turn's full felt object to a scales state (all floats).
function applyTurn(scales, felt, agentKey, smoothing) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`unknown agent: ${agentKey}`);
  const volatility = volatilityFor(agentKey);
  const next = {};
  for (const key of SCALE_KEYS) {
    const feltValue = felt[key] || 0;
    next[key] = applyEmotion(scales[key], agent.baseline[key], feltValue, volatility, smoothing);
  }
  return next;
}

// Fast decay toward each emotion's own baseline, applied before this turn's felt reaction so a
// spike from a real trigger fades hard over the next turn or two instead of sitting stuck at
// its peak, since nothing else in the live turn flow pulls scales back toward baseline.
function decayEmotions(scales, agentKey) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`unknown agent: ${agentKey}`);
  const next = {};
  for (const key of SCALE_KEYS) {
    const current = typeof scales[key] === 'number' ? scales[key] : agent.baseline[key];
    const baseline = agent.baseline[key];
    next[key] = current + (baseline - current) * EMOTION_DECAY_FRACTION;
  }
  return next;
}

// Deprecated single-scale version, kept only so nothing else importing it breaks; the live
// flow now calls decayEmotions for all six scales at once.
function decaySurprise(scales) {
  const current = typeof scales.surprise === 'number' ? scales.surprise : SURPRISE_BASELINE;
  const next = current + (SURPRISE_BASELINE - current) * SURPRISE_DECAY_FRACTION;
  return { ...scales, surprise: next };
}

// current = current + sign(baseline - current) * DECAY_STEP, clamped.
// Snaps to baseline instead of stepping past it when already within one
// decay step: the raw sign() formula is fragile right at the baseline,
// floating-point drift can leave current a hair off-target and flip the
// sign, causing a full step in the wrong effective direction.
function decayToward(scales, baseline, decayStep) {
  const next = {};
  for (const key of SCALE_KEYS) {
    const current = scales[key];
    const target = baseline[key];
    const diff = target - current;
    if (Math.abs(diff) <= decayStep) {
      next[key] = target;
    } else {
      next[key] = clamp(current + Math.sign(diff) * decayStep, 0, 100);
    }
  }
  return next;
}

// Meters ease toward a fresh judge reading with the same smoothing constant
// used for the feeling scales (per spec: "the same way as the scales").
function applyJudge(meters, judgeReading, smoothing) {
  const next = { ...meters };
  if (typeof judgeReading.humanness === 'number') {
    next.humanness = meters.humanness + (judgeReading.humanness - meters.humanness) * smoothing;
  }
  if (typeof judgeReading.eq === 'number') {
    next.eq = meters.eq + (judgeReading.eq - meters.eq) * smoothing;
  }
  return next;
}

// Seeds opening scales from an agent's baseline, nudged by canon mood-of-the-day.
// moodNudge is an optional partial scales object (e.g. {warmth: -4, ease: -3}
// for a "prickly" mood), applied as a flat addition, since it represents the
// day's starting point rather than a felt reaction to the user.
function seedOpeningState(agentKey, moodNudge) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`unknown agent: ${agentKey}`);
  const scales = {};
  for (const key of ALL_SCALE_KEYS) {
    const base = agent.baseline[key];
    const nudge = (moodNudge && moodNudge[key]) || 0;
    scales[key] = clamp(base + nudge, 0, 100);
  }
  return scales;
}

function renderScales(scales) {
  const out = {};
  for (const key of ALL_SCALE_KEYS) out[key] = Math.round(scales[key]);
  return out;
}

// Blends the six primary emotions into one 0-100 "vibe" value for the simplified single-emoji
// display. Happiness and the four negative emotions (sadness/fear/disgust/anger) pull in
// opposite directions, so this weighs happiness against their inverse rather than just
// averaging everything together, which would produce nonsense (high happiness and high sadness
// at once averaging out to a falsely "neutral" reading). Surprise is excluded, since it isn't
// inherently positive or negative, just intensity of shock.
function gaugeFromScales(scales) {
  const negativeAvg = (scales.sadness + scales.fear + scales.disgust + scales.anger) / 4;
  return scales.happiness * 0.6 + (100 - negativeAvg) * 0.4;
}

const GAUGE_BANDS = [
  { max: 20, emoji: '😠', label: 'upset' },
  { max: 40, emoji: '☹️', label: 'cool' },
  { max: 60, emoji: '😐', label: 'neutral' },
  { max: 80, emoji: '🙂', label: 'warm' },
  { max: 100, emoji: '😊', label: 'delighted' },
];

function gaugeBand(value) {
  for (const band of GAUGE_BANDS) {
    if (value <= band.max) return band;
  }
  return GAUGE_BANDS[GAUGE_BANDS.length - 1];
}

module.exports = {
  SCALE_KEYS,
  ALL_SCALE_KEYS,
  SURPRISE_BASELINE,
  VOLATILITY,
  AGENTS,
  clamp,
  volatilityFor,
  applyDelta,
  applyEmotion,
  applySurprise,
  applyTurn,
  decayEmotions,
  decaySurprise,
  decayToward,
  applyJudge,
  seedOpeningState,
  renderScales,
  gaugeFromScales,
  GAUGE_BANDS,
  gaugeBand,
};
