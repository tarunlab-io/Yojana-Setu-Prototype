import { describe, it, expect } from '@jest/globals';
import { scoreEligibility, buildSchemeMatch, rankMatches } from '../../services/eligibility-matcher';
import {
  Gender,
  CasteCategory,
  SchemeStatus,
  SchemeCategory,
  type UserProfile,
  type GovernmentScheme,
  type EligibilityCriteria,
} from '@yojana-setu/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<{
  gender: Gender;
  casteCategory: CasteCategory;
  annualIncomeINR: number;
  isBPL: boolean;
  educationLevel: string;
  employmentStatus: string;
  stateCode: string;
  dateOfBirth: string;
  hasDisability: boolean;
  disabilityPercentage: number;
}>= {}): UserProfile {
  return {
    userId: 'test-user-1',
    phoneNumber: '+919876543210',
    demographics: {
      fullName: 'Test User',
      dateOfBirth: overrides.dateOfBirth ?? '1990-01-15',
      gender: overrides.gender ?? Gender.FEMALE,
      mobileNumber: '+919876543210',
      stateCode: overrides.stateCode ?? 'IN-TN',
      district: 'Chennai',
      locality: 'Adyar',
      pinCode: '600020',
    },
    socioeconomic: {
      annualIncomeINR: overrides.annualIncomeINR ?? 150000,
      casteCategory: overrides.casteCategory ?? CasteCategory.SC,
      isBPL: overrides.isBPL ?? true,
      educationLevel: (overrides.educationLevel ?? 'secondary') as UserProfile['socioeconomic']['educationLevel'],
      employmentStatus: (overrides.employmentStatus ?? 'unemployed') as UserProfile['socioeconomic']['employmentStatus'],
      hasDisability: overrides.hasDisability ?? false,
      disabilityPercentage: overrides.disabilityPercentage,
    },
    preferences: {
      preferredLanguage: 'hi' as never,
      preferredChannel: 'whatsapp' as never,
      notificationsEnabled: true,
      voiceResponseEnabled: false,
    },
    consentRecords: [],
    completionScore: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeScheme(criteria: EligibilityCriteria, benefit = 50000): GovernmentScheme {
  return {
    schemeId: 'test-scheme-1',
    officialName: 'Test Welfare Scheme',
    shortDescription: 'A test scheme',
    fullDescription: 'Full description of test scheme',
    category: SchemeCategory.SOCIAL_WELFARE,
    level: 'central',
    ministry: 'Ministry of Test',
    status: SchemeStatus.ACTIVE,
    eligibilityCriteria: criteria,
    requiredDocuments: [],
    benefitDetails: {
      benefitType: 'cash',
      estimatedValueINR: benefit,
      description: `₹${benefit} direct benefit`,
    },
    translations: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── scoreEligibility Tests ────────────────────────────────────────────────────

describe('scoreEligibility', () => {
  it('returns score 1.0 for empty criteria (universal scheme)', () => {
    const result = scoreEligibility(makeProfile(), {});
    expect(result.score).toBe(1);
    expect(result.hardFailed).toBe(false);
    expect(result.unmetCriteria).toHaveLength(0);
  });

  it('hard-fails when income exceeds maximum', () => {
    const profile = makeProfile({ annualIncomeINR: 500000 });
    const result = scoreEligibility(profile, { incomeRange: { maxINR: 200000 } });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
    expect(result.unmetCriteria).toContain('income');
  });

  it('hard-fails when income is below minimum', () => {
    const profile = makeProfile({ annualIncomeINR: 50000 });
    const result = scoreEligibility(profile, { incomeRange: { minINR: 100000 } });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
  });

  it('matches when income is within range', () => {
    const profile = makeProfile({ annualIncomeINR: 150000 });
    const result = scoreEligibility(profile, { incomeRange: { minINR: 0, maxINR: 200000 } });
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchingCriteria).toContain('income');
  });

  it('hard-fails when gender does not match scheme requirement', () => {
    const profile = makeProfile({ gender: Gender.MALE });
    const result = scoreEligibility(profile, { eligibleGenders: [Gender.FEMALE] });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
    expect(result.unmetCriteria).toContain('gender');
  });

  it('matches when gender is in eligible list', () => {
    const profile = makeProfile({ gender: Gender.FEMALE });
    const result = scoreEligibility(profile, { eligibleGenders: [Gender.FEMALE, Gender.TRANSGENDER] });
    expect(result.matchingCriteria).toContain('gender');
  });

  it('hard-fails when caste category is not eligible', () => {
    const profile = makeProfile({ casteCategory: CasteCategory.GENERAL });
    const result = scoreEligibility(profile, { eligibleCasteCategories: [CasteCategory.SC, CasteCategory.ST] });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
  });

  it('hard-fails when BPL required but user is not BPL', () => {
    const profile = makeProfile({ isBPL: false });
    const result = scoreEligibility(profile, { requiresBPL: true });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
  });

  it('matches when BPL required and user is BPL', () => {
    const profile = makeProfile({ isBPL: true });
    const result = scoreEligibility(profile, { requiresBPL: true });
    expect(result.matchingCriteria).toContain('bpl_status');
  });

  it('hard-fails when age is outside range', () => {
    const profile = makeProfile({ dateOfBirth: '1960-01-01' }); // ~64 years old
    const result = scoreEligibility(profile, { ageRange: { max: 40 } });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
  });

  it('reduces score (soft fail) when education level is insufficient', () => {
    const profile = makeProfile({ educationLevel: 'primary' });
    const resultWithCriteria = scoreEligibility(profile, { requiredEducationLevel: 'graduate' });
    const resultWithoutCriteria = scoreEligibility(profile, {});
    // Should reduce but NOT hard-fail
    expect(resultWithCriteria.hardFailed).toBe(false);
    expect(resultWithCriteria.score).toBeLessThan(resultWithoutCriteria.score);
    expect(resultWithCriteria.unmetCriteria).toContain('education');
  });

  it('hard-fails when state does not match', () => {
    const profile = makeProfile({ stateCode: 'IN-MH' });
    const result = scoreEligibility(profile, { eligibleStates: ['IN-TN', 'IN-KA'] });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
    expect(result.unmetCriteria).toContain('state');
  });

  it('hard-fails disability scheme for non-disabled user', () => {
    const profile = makeProfile({ hasDisability: false });
    const result = scoreEligibility(profile, { requiresDisability: true, minimumDisabilityPercentage: 40 });
    expect(result.score).toBe(0);
    expect(result.hardFailed).toBe(true);
  });

  it('matches disability scheme when user meets percentage threshold', () => {
    const profile = makeProfile({ hasDisability: true, disabilityPercentage: 50 });
    const result = scoreEligibility(profile, { requiresDisability: true, minimumDisabilityPercentage: 40 });
    expect(result.score).toBeGreaterThan(0);
    expect(result.hardFailed).toBe(false);
  });

  it('score is always between 0 and 1', () => {
    const profile = makeProfile();
    const criteria: EligibilityCriteria = {
      incomeRange: { maxINR: 200000 },
      eligibleGenders: [Gender.FEMALE],
      eligibleCasteCategories: [CasteCategory.SC],
      educationLevel: 'primary',
    };
    const result = scoreEligibility(profile, criteria as EligibilityCriteria);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ─── rankMatches Tests ─────────────────────────────────────────────────────────

describe('rankMatches', () => {
  it('sorts by eligibility score descending', () => {
    const profile = makeProfile();
    const highScheme = makeScheme({}, 10000);
    const lowScheme = makeScheme({ requiredEducationLevel: 'post_graduate' }, 10000);

    const highMatch = buildSchemeMatch(profile, highScheme)!;
    const lowMatch = buildSchemeMatch(profile, lowScheme)!;

    // Manually set scores to test sorting
    highMatch.eligibilityScore = 0.9;
    lowMatch.eligibilityScore = 0.6;

    const ranked = rankMatches([lowMatch, highMatch]);
    expect(ranked[0]!.eligibilityScore).toBe(0.9);
    expect(ranked[1]!.eligibilityScore).toBe(0.6);
  });

  it('uses benefit amount as tiebreaker when scores are equal', () => {
    const profile = makeProfile();

    const schemeA = makeScheme({}, 100000); // ₹1 lakh
    const schemeB = makeScheme({}, 50000);  // ₹50k

    const matchA = buildSchemeMatch(profile, schemeA)!;
    const matchB = buildSchemeMatch(profile, schemeB)!;

    // Force equal scores
    matchA.eligibilityScore = 0.8;
    matchB.eligibilityScore = 0.8;

    const ranked = rankMatches([matchB, matchA]);
    expect(ranked[0]!.estimatedBenefitINR).toBe(100000);
  });

  it('returns empty array for empty input', () => {
    expect(rankMatches([])).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const profile = makeProfile();
    const schemeA = makeScheme({}, 100000);
    const schemeB = makeScheme({}, 50000);
    const matchA = buildSchemeMatch(profile, schemeA)!;
    const matchB = buildSchemeMatch(profile, schemeB)!;

    const original = [matchA, matchB];
    const originalRef = original[0];
    rankMatches(original);
    expect(original[0]).toBe(originalRef); // original unchanged
  });
});
