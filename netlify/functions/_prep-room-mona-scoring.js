/* _prep-room-mona-scoring — deterministic readiness scoring + routing lookup
   for the PREP Room premed coach (Mona Bahrami, MD).

   This is Mona's "backpack": the actual rule logic from
   PREP_ROOM/PREMED COACH/readiness_scoring_rules.json and routing_table.json,
   ported to code so tier boundaries and module routes are never improvised
   in-conversation by the model (guardrail, FRAMEWORK.md Section 9). The model
   supplies structured intake fields (and a small number of qualitative flags
   it is best positioned to judge, e.g. whether a "why medicine" narrative
   reads as generic); this module does the actual tier math.

   Not a general rules engine — mirrors the source JSON's documented logic
   directly, including its stated exceptions. Tune thresholds by editing
   PREP_ROOM/PREMED COACH/readiness_scoring_rules.json and mirroring the
   change here; the two are meant to stay in lockstep.
*/

const TIERS = ['Low', 'Developing', 'On-Track', 'Strong'];
const TIER_IDX = { Low: 0, Developing: 1, 'On-Track': 2, Strong: 3 };

function tierMin(...tiers) {
  const present = tiers.filter((t) => t && TIER_IDX[t] !== undefined);
  if (!present.length) return 'Developing';
  return present.reduce((min, t) => (TIER_IDX[t] < TIER_IDX[min] ? t : min));
}

function capAt(tier, cap) {
  return TIER_IDX[tier] > TIER_IDX[cap] ? cap : tier;
}

const YEAR_PROGRESS = {
  freshman: 0.25,
  sophomore: 0.5,
  junior: 0.75,
  senior: 1.0,
  'post-bac': 1.0,
  gap_year: 1.0,
  reapplicant: 1.0,
};

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------- academic

function scoreAcademic(intake) {
  const signals = {};
  const gaps = [];
  const isDO = intake.target_pathway === 'DO';
  const adj = isDO ? 0.15 : 0;

  // gpa_level
  const oGpa = num(intake.overall_gpa, 0);
  const sGpa = num(intake.science_gpa, 0);
  let gpaLevel;
  if (oGpa >= 3.7 - adj && sGpa >= 3.7 - adj) gpaLevel = 'Strong';
  else if (oGpa >= 3.4 - adj && sGpa >= 3.4 - adj) gpaLevel = 'On-Track';
  else if (oGpa >= 3.0 - adj && sGpa >= 3.0 - adj) gpaLevel = 'Developing';
  else gpaLevel = 'Low';
  signals.gpa_level = gpaLevel;
  if (gpaLevel === 'Low') gaps.push('Overall or science GPA is below the range committees screen on.');

  // gpa_trend (modifier, not part of the min-set directly, applied as a cap)
  const trend = intake.gpa_trend;
  const trendUrgent = trend === 'downward' && sGpa < 3.3;
  if (trend === 'downward') gaps.push('GPA trend is downward' + (trendUrgent ? ' and science GPA is under 3.3 — time-sensitive.' : '.'));

  // academic_risk
  const withdrawals = num(intake.course_withdrawals_count, 0);
  let academicRisk = 'Strong';
  if (withdrawals >= 2) academicRisk = 'Low';
  else if (withdrawals === 1) academicRisk = 'Developing';
  signals.academic_risk = academicRisk;
  if (withdrawals > 0) gaps.push(`${withdrawals} course withdrawal${withdrawals > 1 ? 's' : ''} on record.`);

  // prereq_progress (informational only, not in domain_rating min-set)
  const yearFrac = YEAR_PROGRESS[intake.current_year] ?? 1.0;
  const prereqs = Array.isArray(intake.prerequisites_status) ? intake.prerequisites_status : [];
  const prereqDone = prereqs.filter((p) => p.status === 'completed' || p.status === 'in_progress').length;
  signals.prereq_progress_note = `${prereqDone}/${prereqs.length || '?'} prereqs completed or in progress (expected pace ~${Math.round(yearFrac * 100)}% by ${intake.current_year || 'this point'}).`;

  // mcat_readiness
  let mcatReadiness;
  if (intake.mcat_status === 'not_yet_taken') {
    mcatReadiness = intake.mcat_target_test_date ? 'Developing' : 'Low';
    if (!intake.mcat_target_test_date) gaps.push('No MCAT date set — timeline risk.');
  } else {
    const score = num(intake.mcat_diagnostic_score, 0);
    if (score >= 513) mcatReadiness = 'Strong';
    else if (score >= 508) mcatReadiness = 'On-Track';
    else if (score >= 498) mcatReadiness = 'Developing';
    else mcatReadiness = 'Low';
    if (Array.isArray(intake.mcat_weak_sections) && intake.mcat_weak_sections.length) {
      gaps.push('MCAT weak sections: ' + intake.mcat_weak_sections.join(', ') + '.');
    }
  }
  signals.mcat_readiness = mcatReadiness;

  let rating = tierMin(gpaLevel, academicRisk, mcatReadiness);
  if (trend === 'downward') rating = capAt(rating, 'Developing');

  return {
    rating,
    signals,
    driving_gaps: gaps.slice(0, 3),
    urgency: trendUrgent || mcatReadiness === 'Low' ? 'time_sensitive' : 'long_horizon',
  };
}

// ----------------------------------------------------------- experiential

function scoreExperiential(intake) {
  const signals = {};
  const gaps = [];
  const yearFrac = YEAR_PROGRESS[intake.current_year] ?? 1.0;

  // clinical_exposure
  const benchmark = 150 * yearFrac;
  const hours = num(intake.clinical_hours_total, 0);
  const ratio = benchmark > 0 ? hours / benchmark : 0;
  const types = Array.isArray(intake.clinical_hours_types) ? intake.clinical_hours_types : [];
  let clinicalExposure;
  if (ratio >= 1.3) clinicalExposure = 'Strong';
  else if (ratio >= 1.0) clinicalExposure = 'On-Track';
  else if (ratio >= 0.5) clinicalExposure = 'Developing';
  else clinicalExposure = 'Low';
  if (clinicalExposure === 'Strong' && types.length < 2) clinicalExposure = 'On-Track';
  signals.clinical_exposure = clinicalExposure;
  if (TIER_IDX[clinicalExposure] <= TIER_IDX.Developing) gaps.push(`Clinical hours (${hours}) are behind the pace expected for ${intake.current_year || 'this point'}.`);

  // volunteer_commitment
  const vHours = num(intake.volunteer_hours_total, 0);
  const vMonths = num(intake.volunteer_longitudinal_months, 0);
  let volunteerCommitment;
  if (vMonths >= 12 && vHours >= 100) volunteerCommitment = 'Strong';
  else if (vHours >= 50 && vMonths >= 6) volunteerCommitment = 'On-Track';
  else if (vHours > 0) volunteerCommitment = 'Developing';
  else volunteerCommitment = 'Low';
  if (vMonths < 6) volunteerCommitment = capAt(volunteerCommitment, 'Developing');
  signals.volunteer_commitment = volunteerCommitment;
  if (vMonths < 6 && vHours > 0) gaps.push('Volunteer work reads as one-off rather than longitudinal (under 6 months in one commitment).');

  // research_depth (reported separately, not in domain_rating min-set)
  let researchDepth;
  if (!intake.research_involved) {
    researchDepth = intake.target_pathway === 'MD-PhD' ? 'Low' : 'Developing';
  } else {
    const months = num(intake.research_duration_months, 0);
    const pi = intake.research_pi_relationship_strength;
    const outputs = Array.isArray(intake.research_outputs) ? intake.research_outputs : [];
    const hasOutput = outputs.some((o) => o && o !== 'none_yet');
    if (months >= 12 && pi !== 'minimal_contact' && hasOutput) researchDepth = 'Strong';
    else if (months >= 6) researchDepth = 'On-Track';
    else researchDepth = 'Developing';
  }
  signals.research_depth = researchDepth;

  // leadership_evidence
  const roles = Array.isArray(intake.leadership_roles) ? intake.leadership_roles : [];
  const ownershipRe = /\b(founded|initiated|led|created|launched|started|built|organized)\b/i;
  const hasOwnership = roles.some((r) => r.self_described_impact && ownershipRe.test(r.self_described_impact));
  let leadershipEvidence;
  if (hasOwnership) leadershipEvidence = 'Strong';
  else if (roles.length && roles.some((r) => num(r.duration_months, 0) > 0)) leadershipEvidence = 'On-Track';
  else leadershipEvidence = 'Developing';
  signals.leadership_evidence = leadershipEvidence;
  if (leadershipEvidence === 'Developing') gaps.push('No leadership roles with clear duration listed yet.');

  const rating = tierMin(clinicalExposure, volunteerCommitment, leadershipEvidence);

  return {
    rating,
    signals,
    driving_gaps: gaps.slice(0, 3),
    urgency: 'long_horizon',
  };
}

// ------------------------------------------------------------ professional

function monthsUntilCycleOpen(targetYear) {
  if (!targetYear) return null;
  const open = new Date(Date.UTC(Number(targetYear), 4, 1)); // AMCAS opens ~May
  const now = new Date();
  return (open.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
}

function scoreProfessional(intake) {
  const signals = {};
  const gaps = [];
  const monthsToOpen = monthsUntilCycleOpen(intake.target_application_cycle_year);

  // letters_readiness
  const count = num(intake.letters_secured_count, 0);
  const strength = intake.letters_relationship_strength_avg;
  const sources = Array.isArray(intake.letters_sources) ? intake.letters_sources : [];
  const hasMix = sources.includes('science_faculty') && (sources.includes('non_science_faculty') || sources.includes('clinical_supervisor'));
  let lettersReadiness;
  if (count >= 3 && strength === 'strong' && hasMix) lettersReadiness = 'Strong';
  else if (count >= 2 && (strength === 'moderate' || strength === 'strong')) lettersReadiness = 'On-Track';
  else if (count >= 1) lettersReadiness = 'Developing';
  else lettersReadiness = 'Low';
  signals.letters_readiness = lettersReadiness;
  if (lettersReadiness === 'Low') gaps.push('No letters of recommendation secured yet.');
  else if (strength === 'weak') gaps.push('Letter relationships read as weak — worth strengthening before asking.');

  // personal_statement_progress (time-sensitive)
  const psStatus = intake.personal_statement_status;
  let personalStatement;
  if (psStatus === 'final') personalStatement = 'Strong';
  else if (psStatus === 'revised') personalStatement = 'On-Track';
  else if (psStatus === 'outline' || psStatus === 'draft') personalStatement = 'Developing';
  else personalStatement = (monthsToOpen !== null && monthsToOpen < 6) ? 'Low' : 'Developing';
  signals.personal_statement_progress = personalStatement;
  const psUrgent = psStatus === 'not_started' && monthsToOpen !== null && monthsToOpen < 6;
  if (psUrgent) gaps.push('Personal statement not started with under 6 months to the application cycle opening.');

  // timeline_confidence
  const conf = Number(intake.application_timeline_confidence) || 0;
  let timelineConfidence;
  if (conf <= 2) timelineConfidence = 'Low';
  else if (conf === 3) timelineConfidence = 'Developing';
  else if (conf === 4) timelineConfidence = 'On-Track';
  else timelineConfidence = 'Strong';
  signals.timeline_confidence = timelineConfidence;
  if (TIER_IDX[timelineConfidence] <= TIER_IDX.Developing) gaps.push('Low confidence in the application timeline — needs a concrete deadline walkthrough.');

  // interview_readiness
  const ip = intake.interview_prep_status;
  let interviewReadiness;
  if (ip === 'mock_interviewed') interviewReadiness = 'Strong';
  else if (ip === 'practicing') interviewReadiness = 'On-Track';
  else if (ip === 'researching_format') interviewReadiness = 'Developing';
  else interviewReadiness = (monthsToOpen !== null && monthsToOpen > 8) ? 'Developing' : 'Low';
  signals.interview_readiness = interviewReadiness;

  const rating = tierMin(lettersReadiness, personalStatement, timelineConfidence, interviewReadiness);

  return {
    rating,
    signals,
    driving_gaps: gaps.slice(0, 3),
    urgency: psUrgent || lettersReadiness === 'Low' ? 'time_sensitive' : 'long_horizon',
    months_to_cycle_open: monthsToOpen === null ? null : Math.round(monthsToOpen),
  };
}

// ---------------------------------------------------------------- identity

const CLICHE_RE = /\b(help people|always wanted to|passion for (science|medicine)|change (the world|people's lives)|since i was (a )?(kid|child|young))\b/i;

function scoreIdentity(intake, opts = {}) {
  const signals = {};
  const gaps = [];

  const rating1to5 = Number(intake.why_medicine_confidence_self_rating) || 0;
  let whyMedicine;
  if (rating1to5 <= 2) whyMedicine = 'Low';
  else if (rating1to5 === 3) whyMedicine = 'Developing';
  else if (rating1to5 === 4) whyMedicine = 'On-Track';
  else whyMedicine = 'Strong';
  const freeText = intake.why_medicine_free_text || '';
  const clicheFlag = typeof opts.why_medicine_cliche_flag === 'boolean'
    ? opts.why_medicine_cliche_flag
    : CLICHE_RE.test(freeText);
  if (clicheFlag && freeText) {
    whyMedicine = TIERS[Math.max(0, TIER_IDX[whyMedicine] - 1)];
    gaps.push('"Why medicine" narrative reads as generic — needs a specific, personal throughline.');
  }
  signals.why_medicine_clarity = whyMedicine;

  const stress = intake.stress_self_report;
  let stressPerformance;
  if (stress === 'struggles_under_pressure') stressPerformance = 'Low';
  else if (stress === 'performs_well_under_pressure') stressPerformance = 'On-Track';
  else stressPerformance = 'Developing'; // inconsistent or unsure
  signals.stress_performance = stressPerformance;
  signals.stress_performance_note = 'Self-report only, provisional — Strong requires the ETL Pressure Simulation Agent.';
  if (TIER_IDX[stressPerformance] <= TIER_IDX.Developing) gaps.push('Stress performance under pressure is self-reported as shaky or uncertain.');

  const rating = tierMin(whyMedicine, stressPerformance);

  return {
    rating,
    signals,
    driving_gaps: gaps.slice(0, 3),
    urgency: 'long_horizon',
    hedge: 'This domain is the most qualitative of the four; treat the rating as directional, not final.',
  };
}

function buildReadinessProfile(intake, opts = {}) {
  return {
    generated_at: new Date().toISOString(),
    target_application_cycle_year: intake.target_application_cycle_year || null,
    domains: {
      academic: scoreAcademic(intake),
      experiential: scoreExperiential(intake),
      professional: scoreProfessional(intake),
      identity: scoreIdentity(intake, opts),
    },
  };
}

// -------------------------------------------------------------- routing

const ROUTING_TABLE = {
  scientific_reasoning: {
    target_module: 'ETL Faculty Agent',
    handoff_notes: 'Pass mcat_weak_sections and specific prerequisite course gaps so the faculty agent can target content review rather than starting generic.',
  },
  communication_clarity: {
    target_module: 'ETL Communication Coach',
    handoff_notes: "Pass why_medicine_free_text (if provided) and personal_statement_status so the coach isn't starting from zero context.",
  },
  professionalism_flags: {
    target_module: 'ETL Behavioral Science Agent',
    handoff_notes: "Use sparingly, framed constructively — route the underlying relationship-building or communication gap, never label the student 'unprofessional.'",
  },
  stress_performance: {
    target_module: 'ETL Pressure Simulation Agent',
    handoff_notes: 'Intake-level stress rating is self-reported and provisional; this module is the actual assessment mechanism.',
  },
  mcat_prep: {
    target_module: 'ETL Cognitive Training Agent',
    handoff_notes: 'Pass mcat_status, mcat_diagnostic_score (if present), mcat_target_test_date, and mcat_weak_sections.',
  },
  personal_statement_drafting: {
    target_module: 'ETL Writing Coach',
    handoff_notes: 'For active drafting support once the student is ready to write, distinct from communication_clarity (pre-writing narrative clarity).',
  },
  interview_prep: {
    target_module: 'ETL MMI Agent',
    handoff_notes: 'Gate on timeline — do not route a student to interview prep just because interview_prep_status is not_started if the cycle is far off.',
  },
};

function lookupRoute(routeId) {
  return ROUTING_TABLE[routeId] || null;
}

module.exports = {
  TIERS,
  TIER_IDX,
  buildReadinessProfile,
  scoreAcademic,
  scoreExperiential,
  scoreProfessional,
  scoreIdentity,
  ROUTING_TABLE,
  lookupRoute,
};
