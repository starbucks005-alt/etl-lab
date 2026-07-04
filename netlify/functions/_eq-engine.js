// _eq-engine.js — EQ Room emotion engine: scales, meters, and dynamics math.
// Pure functions, no I/O, so this is unit-testable in isolation from whatever
// Netlify function wires it to the model calls and Supabase.
// Spec: EQ ROOM/eq-room-emotion-engine-spec.md

const SCALE_KEYS = ['warmth', 'openness', 'ease', 'spirits', 'interest'];

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
    baseline: { warmth: 70, openness: 65, ease: 75, spirits: 65, interest: 70 },
    volatility: 'low',
    warmsTo: 'curiosity, a nervous learner reassured, honest questions',
    chillsAt: 'condescension, belittling learners, arrogance',
  },
  auggie: {
    name: 'Auggie',
    baseline: { warmth: 72, openness: 68, ease: 68, spirits: 70, interest: 70 },
    volatility: 'medium',
    warmsTo: 'warmth, being appreciated, real rapport, respect',
    chillsAt: 'rudeness, disrespect of his work, disrespect of who he is',
  },
  dom: {
    name: 'Coach Dom',
    baseline: { warmth: 68, openness: 55, ease: 72, spirits: 62, interest: 68 },
    volatility: 'low',
    warmsTo: 'honest effort, wanting to improve, straight talk',
    chillsAt: 'ego-lifting, excuses, hype and shortcuts',
  },
  chris: {
    name: 'Chris Avila',
    baseline: { warmth: 52, openness: 45, ease: 55, spirits: 55, interest: 60 },
    volatility: 'medium',
    warmsTo: 'genuine interest in the work, being seen, respect for they/them',
    chillsAt: 'dismissing the art, misgendering, empty small talk, being rushed',
  },
  arthur: {
    name: 'Dr. Arthur Pendelton',
    baseline: { warmth: 70, openness: 62, ease: 80, spirits: 60, interest: 68 },
    volatility: 'low',
    warmsTo: 'someone struggling met with honesty, real vulnerability',
    chillsAt: 'cruelty toward the vulnerable, bad-faith games',
  },
  jen: {
    name: 'Jen Lopez',
    baseline: { warmth: 62, openness: 55, ease: 58, spirits: 62, interest: 65 },
    volatility: 'medium',
    warmsTo: 'competence, respect for time, a clear ask, humor',
    chillsAt: 'time-wasting, vagueness, chaos, disrespect',
  },
  noor: {
    name: 'Noor Haddad',
    baseline: { warmth: 68, openness: 58, ease: 82, spirits: 60, interest: 60 },
    volatility: 'very low',
    warmsTo: 'presence, someone seeking calm, honesty',
    chillsAt: 'aggression, mockery of stillness (she de-escalates, rarely spikes)',
  },
  mara: {
    name: 'Mara Rivera',
    baseline: { warmth: 66, openness: 64, ease: 62, spirits: 68, interest: 72 },
    volatility: 'medium-high',
    warmsTo: 'good taste, culture talk, real enthusiasm, banter',
    chillsAt: 'bad faith, philistinism, cruelty, pretension',
  },
  marceline: {
    name: 'Marceline Smith',
    baseline: { warmth: 48, openness: 40, ease: 70, spirits: 55, interest: 52 },
    volatility: 'low',
    warmsTo: 'respect, brevity, competence, politeness (warms slowly)',
    chillsAt: 'pushiness, entitlement, wasting time, rudeness',
  },
  marcus: {
    name: 'Marcus Holt',
    baseline: { warmth: 40, openness: 38, ease: 72, spirits: 55, interest: 55 },
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

// target = clamp(current + delta*volatility, 0, 100)
// newCurrent = current + (target - current) * smoothing
function applyDelta(current, delta, volatility, smoothing) {
  const applied = delta * volatility;
  const target = clamp(current + applied, 0, 100);
  return current + (target - current) * smoothing;
}

// Applies one turn's full felt object to a scales state (all floats).
function applyTurn(scales, felt, agentKey, smoothing) {
  const volatility = volatilityFor(agentKey);
  const next = {};
  for (const key of SCALE_KEYS) {
    const delta = felt[key] || 0;
    next[key] = applyDelta(scales[key], delta, volatility, smoothing);
  }
  return next;
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
  for (const key of SCALE_KEYS) {
    const base = agent.baseline[key];
    const nudge = (moodNudge && moodNudge[key]) || 0;
    scales[key] = clamp(base + nudge, 0, 100);
  }
  return scales;
}

function renderScales(scales) {
  const out = {};
  for (const key of SCALE_KEYS) out[key] = Math.round(scales[key]);
  return out;
}

// Blends the five feeling scales into one 0-100 "vibe" value for the
// simplified single-gauge display. The five-scale/two-meter engine above
// still tracks everything underneath for real scoring; this is purely a
// friendlier visual summary, an unweighted mean of the five scales.
function gaugeFromScales(scales) {
  const sum = SCALE_KEYS.reduce((total, key) => total + scales[key], 0);
  return sum / SCALE_KEYS.length;
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
  VOLATILITY,
  AGENTS,
  clamp,
  volatilityFor,
  applyDelta,
  applyTurn,
  decayToward,
  applyJudge,
  seedOpeningState,
  renderScales,
  gaugeFromScales,
  GAUGE_BANDS,
  gaugeBand,
};
