/**
 * Eligibility Matcher
 *
 * Pure functions for scoring a user profile against scheme eligibility criteria.
 * No DB or cache dependencies — fully testable in isolation.
 *
 * Scoring model:
 *  - Each criterion is worth a weight (total weights = 1.0)
 *  - Hard-fail criteria (income, gender, caste, state) disqualify immediately
 *  - Soft criteria reduce the score proportionally
 *  - Final score: 0.0 (no match) → 1.0 (perfect match)
 */

import type {
  UserProfile,
  GovernmentScheme,
  SchemeMatch,
  EligibilityResult,
  EligibilityCriteria,
} from '@yojana-setu/shared';

// ─── Criterion Weights ────────────────────────────────────────────────────────

const WEIGHTS = {
  income:      0.25,
  age:         0.15,
  gender:      0.15,
  caste:       0.15,
  bpl:         0.10,
  education:   0.08,
  employment:  0.07,
  disability:  0.05,
} as const;

// ─── Age Calculation ──────────────────────────────────────────────────────────

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

// ─── Education Level Ordering ─────────────────────────────────────────────────

const EDUCATION_ORDER: Record<string, number> = {
  none: 0,
  primary: 1,
  secondary: 2,
  higher_secondary: 3,
  graduate: 4,
  post_graduate: 5,
};

// ─── Single Criterion Evaluators ─────────────────────────────────────────────

interface CriterionResult {
  met: boolean;
  isHardFail: boolean;
  label: string;
}

function evalIncome(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  const { incomeRange } = criteria;
  if (!incomeRange) return { met: true, isHardFail: false, label: 'income' };

  const income = profile.socioeconomic.annualIncomeINR;
  const aboveMin = incomeRange.minINR === undefined || income >= incomeRange.minINR;
  const belowMax = incomeRange.maxINR === undefined || income <= incomeRange.maxINR;
  const met = aboveMin && belowMax;

  return { met, isHardFail: true, label: 'income' };
}

function evalAge(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  const { ageRange } = criteria;
  if (!ageRange) return { met: true, isHardFail: false, label: 'age' };

  const age = calculateAge(profile.demographics.dateOfBirth);
  const aboveMin = ageRange.min === undefined || age >= ageRange.min;
  const belowMax = ageRange.max === undefined || age <= ageRange.max;
  const met = aboveMin && belowMax;

  return { met, isHardFail: true, label: 'age' };
}

function evalGender(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  const { eligibleGenders } = criteria;
  if (!eligibleGenders || eligibleGenders.length === 0) {
    return { met: true, isHardFail: false, label: 'gender' };
  }
  const met = eligibleGenders.includes(profile.demographics.gender);
  return { met, isHardFail: true, label: 'gender' };
}

function evalCaste(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  const { eligibleCasteCategories } = criteria;
  if (!eligibleCasteCategories || eligibleCasteCategories.length === 0) {
    return { met: true, isHardFail: false, label: 'caste_category' };
  }
  const met = eligibleCasteCategories.includes(profile.socioeconomic.casteCategory);
  return { met, isHardFail: true, label: 'caste_category' };
}

function evalBPL(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  if (criteria.requiresBPL === undefined) {
    return { met: true, isHardFail: false, label: 'bpl_status' };
  }
  const met = !criteria.requiresBPL || profile.socioeconomic.isBPL;
  return { met, isHardFail: criteria.requiresBPL, label: 'bpl_status' };
}

function evalState(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  const { eligibleStates } = criteria;
  if (!eligibleStates || eligibleStates.length === 0) {
    return { met: true, isHardFail: false, label: 'state' };
  }
  const met = eligibleStates.includes(profile.demographics.stateCode);
  return { met, isHardFail: true, label: 'state' };
}

function evalEducation(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  const { requiredEducationLevel } = criteria;
  if (!requiredEducationLevel) return { met: true, isHardFail: false, label: 'education' };

  const userLevel = EDUCATION_ORDER[profile.socioeconomic.educationLevel] ?? 0;
  const requiredLevel = EDUCATION_ORDER[requiredEducationLevel] ?? 0;
  const met = userLevel >= requiredLevel;

  return { met, isHardFail: false, label: 'education' };
}

function evalEmployment(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  const { requiredEmploymentStatus } = criteria;
  if (!requiredEmploymentStatus || requiredEmploymentStatus.length === 0) {
    return { met: true, isHardFail: false, label: 'employment_status' };
  }
  const met = requiredEmploymentStatus.includes(profile.socioeconomic.employmentStatus);
  return { met, isHardFail: false, label: 'employment_status' };
}

function evalDisability(profile: UserProfile, criteria: EligibilityCriteria): CriterionResult {
  if (criteria.requiresDisability === undefined) {
    return { met: true, isHardFail: false, label: 'disability' };
  }

  if (!criteria.requiresDisability) return { met: true, isHardFail: false, label: 'disability' };

  const hasDisability = profile.socioeconomic.hasDisability;
  if (!hasDisability) return { met: false, isHardFail: true, label: 'disability' };

  if (criteria.minimumDisabilityPercentage !== undefined) {
    const pct = profile.socioeconomic.disabilityPercentage ?? 0;
    const met = pct >= criteria.minimumDisabilityPercentage;
    return { met, isHardFail: true, label: 'disability_percentage' };
  }

  return { met: true, isHardFail: false, label: 'disability' };
}

// ─── Core Scoring Function ────────────────────────────────────────────────────

export interface ScoringDetail {
  score: number;
  matchingCriteria: string[];
  unmetCriteria: string[];
  hardFailed: boolean;
}

/**
 * Scores a user profile against scheme eligibility criteria.
 * Returns a score from 0–1 and lists of met/unmet criteria.
 *
 * @pure — no side effects, deterministic for same inputs
 */
export function scoreEligibility(
  profile: UserProfile,
  criteria: EligibilityCriteria,
): ScoringDetail {
  const evaluators: Array<{ fn: () => CriterionResult; weight: number }> = [
    { fn: () => evalIncome(profile, criteria),     weight: WEIGHTS.income },
    { fn: () => evalAge(profile, criteria),        weight: WEIGHTS.age },
    { fn: () => evalGender(profile, criteria),     weight: WEIGHTS.gender },
    { fn: () => evalCaste(profile, criteria),      weight: WEIGHTS.caste },
    { fn: () => evalBPL(profile, criteria),        weight: WEIGHTS.bpl },
    { fn: () => evalEducation(profile, criteria),  weight: WEIGHTS.education },
    { fn: () => evalEmployment(profile, criteria), weight: WEIGHTS.employment },
    { fn: () => evalDisability(profile, criteria), weight: WEIGHTS.disability },
    { fn: () => evalState(profile, criteria),      weight: 0 }, // State is hard-fail but unweighted
  ];

  let weightedScore = 0;
  let totalWeight = 0;
  const matchingCriteria: string[] = [];
  const unmetCriteria: string[] = [];

  for (const { fn, weight } of evaluators) {
    const result = fn();

    if (result.met) {
      if (weight > 0) {
        weightedScore += weight;
        totalWeight += weight;
      }
      matchingCriteria.push(result.label);
    } else {
      if (result.isHardFail) {
        // Hard fail: zero score immediately
        return {
          score: 0,
          matchingCriteria,
          unmetCriteria: [...unmetCriteria, result.label],
          hardFailed: true,
        };
      }
      if (weight > 0) totalWeight += weight;
      unmetCriteria.push(result.label);
    }
  }

  const score = totalWeight > 0 ? weightedScore / totalWeight : 1;

  return {
    score: Math.round(score * 1000) / 1000, // 3 decimal places
    matchingCriteria,
    unmetCriteria,
    hardFailed: false,
  };
}

// ─── Match Builder ────────────────────────────────────────────────────────────

const MINIMUM_SCORE_THRESHOLD = 0.4; // Below this, don't show the scheme

/**
 * Builds a SchemeMatch from a profile and scheme, or returns null if below threshold.
 */
export function buildSchemeMatch(
  profile: UserProfile,
  scheme: GovernmentScheme,
): SchemeMatch | null {
  const detail = scoreEligibility(profile, scheme.eligibilityCriteria);
  if (detail.score < MINIMUM_SCORE_THRESHOLD) return null;

  return {
    scheme,
    eligibilityScore: detail.score,
    matchingCriteria: detail.matchingCriteria,
    unmetCriteria: detail.unmetCriteria,
    estimatedBenefitINR: scheme.benefitDetails.estimatedValueINR,
    applicationDeadline: scheme.applicationDeadline,
  };
}

/**
 * Sorts scheme matches by: eligibility score DESC, then estimated benefit DESC.
 * Implements Requirement 1.4 — rank by eligibility probability and benefit amount.
 */
export function rankMatches(matches: SchemeMatch[]): SchemeMatch[] {
  return [...matches].sort((a, b) => {
    if (b.eligibilityScore !== a.eligibilityScore) {
      return b.eligibilityScore - a.eligibilityScore;
    }
    const aBenefit = a.estimatedBenefitINR ?? 0;
    const bBenefit = b.estimatedBenefitINR ?? 0;
    return bBenefit - aBenefit;
  });
}

/**
 * Builds a full EligibilityResult for a specific scheme check.
 */
export function buildEligibilityResult(
  userId: string,
  scheme: GovernmentScheme,
  profile: UserProfile,
): EligibilityResult {
  const detail = scoreEligibility(profile, scheme.eligibilityCriteria);
  return {
    schemeId: scheme.schemeId,
    userId,
    isEligible: detail.score >= MINIMUM_SCORE_THRESHOLD && !detail.hardFailed,
    eligibilityScore: detail.score,
    matchingCriteria: detail.matchingCriteria,
    unmetCriteria: detail.unmetCriteria,
    checkedAt: new Date(),
  };
}
