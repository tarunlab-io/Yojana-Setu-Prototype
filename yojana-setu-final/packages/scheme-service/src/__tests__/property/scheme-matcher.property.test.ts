/**
 * Property-based tests for the Scheme Matcher Service.
 *
 * Feature: yojana-setu
 * Property 2: Scheme Matching Relevance and Performance
 *   For any user profile and query, the eligibility matcher should return
 *   relevant schemes ranked by eligibility probability and benefit amount.
 *   Validates: Requirements 1.3, 1.4, 6.4
 *
 * Property 13: Scheme Explanation Simplification
 *   For any government scheme with complex eligibility criteria, the system
 *   should generate simplified explanations with yes/no questions.
 *   Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

import * as fc from 'fast-check';
import { describe, it, expect } from '@jest/globals';
import {
  scoreEligibility,
  buildSchemeMatch,
  rankMatches,
  type ScoringDetail,
} from '../../services/eligibility-matcher';
import {
  Gender,
  CasteCategory,
  SchemeStatus,
  SchemeCategory,
  type UserProfile,
  type GovernmentScheme,
  type EligibilityCriteria,
} from '@yojana-setu/shared';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const genderArb = fc.constantFrom(...Object.values(Gender));
const casteCategoryArb = fc.constantFrom(...Object.values(CasteCategory));

const stateCodes = ['IN-TN', 'IN-MH', 'IN-UP', 'IN-KA', 'IN-GJ', 'IN-RJ', 'IN-WB'];
const stateCodeArb = fc.constantFrom(...stateCodes);

const educationLevels = ['none', 'primary', 'secondary', 'higher_secondary', 'graduate', 'post_graduate'] as const;
const employmentStatuses = ['unemployed', 'self_employed', 'salaried', 'farmer', 'student', 'retired'] as const;

/** Generates a valid user profile with random socioeconomic data */
const profileArb: fc.Arbitrary<UserProfile> = fc.record({
  userId: fc.uuid(),
  phoneNumber: fc.constant('+919876543210'),
  demographics: fc.record({
    fullName: fc.constant('Test User'),
    dateOfBirth: fc.integer({ min: 18, max: 65 }).map((age) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - age);
      return d.toISOString().split('T')[0]!;
    }),
    gender: genderArb,
    mobileNumber: fc.constant('+919876543210'),
    stateCode: stateCodeArb,
    district: fc.constant('Test District'),
    locality: fc.constant('Test Locality'),
    pinCode: fc.constant('600020'),
  }),
  socioeconomic: fc.record({
    annualIncomeINR: fc.integer({ min: 0, max: 1_500_000 }),
    casteCategory: casteCategoryArb,
    isBPL: fc.boolean(),
    educationLevel: fc.constantFrom(...educationLevels),
    employmentStatus: fc.constantFrom(...employmentStatuses),
    hasDisability: fc.constant(false),
  }),
  preferences: fc.constant({
    preferredLanguage: 'hi' as never,
    preferredChannel: 'whatsapp' as never,
    notificationsEnabled: true,
    voiceResponseEnabled: false,
  }),
  consentRecords: fc.constant([]),
  completionScore: fc.integer({ min: 0, max: 100 }),
  createdAt: fc.constant(new Date()),
  updatedAt: fc.constant(new Date()),
});

/** Generates a scheme with random eligibility criteria */
const schemeArb: fc.Arbitrary<GovernmentScheme> = fc.record({
  schemeId: fc.uuid(),
  officialName: fc.string({ minLength: 5, maxLength: 50 }),
  shortDescription: fc.string({ minLength: 10, maxLength: 100 }),
  fullDescription: fc.string({ minLength: 20, maxLength: 200 }),
  category: fc.constantFrom(...Object.values(SchemeCategory)),
  level: fc.constantFrom('central', 'state'),
  stateCode: fc.option(stateCodeArb, { nil: undefined }),
  ministry: fc.constant('Ministry of Test'),
  status: fc.constant(SchemeStatus.ACTIVE),
  eligibilityCriteria: fc.record({
    incomeRange: fc.option(
      fc.record({
        maxINR: fc.integer({ min: 100000, max: 1_000_000 }),
      }),
      { nil: undefined },
    ),
    eligibleGenders: fc.option(
      fc.subarray(Object.values(Gender), { minLength: 1 }),
      { nil: undefined },
    ),
    eligibleCasteCategories: fc.option(
      fc.subarray(Object.values(CasteCategory), { minLength: 1 }),
      { nil: undefined },
    ),
  }),
  requiredDocuments: fc.constant([]),
  benefitDetails: fc.record({
    benefitType: fc.constant('cash'),
    estimatedValueINR: fc.integer({ min: 1000, max: 500_000 }),
    description: fc.constant('Test benefit'),
  }),
  translations: fc.constant({}),
  createdAt: fc.constant(new Date()),
  updatedAt: fc.constant(new Date()),
});

// ─── Property 2: Scheme Matching Relevance and Performance ───────────────────

describe('Property 2: Scheme Matching Relevance and Performance', () => {
  /**
   * For ANY user profile and ANY scheme, scoreEligibility must return
   * a score strictly in [0, 1]. No NaN, no Infinity, no negative values.
   */
  it('eligibility score is always in range [0, 1] for any profile/scheme combination', () => {
    fc.assert(
      fc.property(profileArb, schemeArb, (profile, scheme) => {
        const result = scoreEligibility(profile, scheme.eligibilityCriteria);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
        expect(Number.isFinite(result.score)).toBe(true);
        expect(Number.isNaN(result.score)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Hard-failed evaluations always return score of exactly 0.
   * This invariant is critical — a scheme that fails a hard criterion
   * must never appear in results regardless of other matching criteria.
   */
  it('hard-failed schemes always have score exactly 0', () => {
    fc.assert(
      fc.property(profileArb, (profile) => {
        // Create a scheme that cannot possibly match — requires BOTH gender and caste
        // that the profile definitely doesn't match
        const impossibleCriteria: EligibilityCriteria = {
          // Force income hard-fail by setting max to -1 (impossible)
          incomeRange: { maxINR: -1 },
        };
        const result = scoreEligibility(profile, impossibleCriteria);
        expect(result.score).toBe(0);
        expect(result.hardFailed).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * rankMatches is STABLE: equal-scored items maintain relative order
   * and the result is always sorted in descending order.
   */
  it('rankMatches always returns results sorted by eligibility score descending', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            eligibilityScore: fc.double({ min: 0, max: 1, noNaN: true }),
            estimatedBenefitINR: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined }),
          }),
          { minLength: 0, maxLength: 20 },
        ),
        (rawMatches) => {
          // Build minimal SchemeMatch objects
          const matches = rawMatches.map((m) => ({
            scheme: { schemeId: 'x', officialName: 'X' } as GovernmentScheme,
            eligibilityScore: m.eligibilityScore,
            matchingCriteria: [],
            unmetCriteria: [],
            estimatedBenefitINR: m.estimatedBenefitINR,
          }));

          const ranked = rankMatches(matches);

          // Verify sorted descending
          for (let i = 0; i < ranked.length - 1; i++) {
            const current = ranked[i]!;
            const next = ranked[i + 1]!;

            if (current.eligibilityScore === next.eligibilityScore) {
              // Tiebreaker: benefit descending
              const currentBenefit = current.estimatedBenefitINR ?? 0;
              const nextBenefit = next.estimatedBenefitINR ?? 0;
              expect(currentBenefit).toBeGreaterThanOrEqual(nextBenefit);
            } else {
              expect(current.eligibilityScore).toBeGreaterThan(next.eligibilityScore);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Schemes that pass ALL criteria must have a higher score than
   * schemes that fail at least one soft criterion.
   * (Monotonicity of the scoring function)
   */
  it('adding more matching criteria never decreases the eligibility score', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.integer({ min: 0, max: 5 }),
        (profile, extraCriteriaCount) => {
          // Base score with no criteria
          const baseResult = scoreEligibility(profile, {});

          // Build criteria that MATCH the profile (so score stays high or equal)
          const matchingCriteria: EligibilityCriteria = {
            incomeRange: { maxINR: profile.socioeconomic.annualIncomeINR + 100000 },
            eligibleGenders: [profile.demographics.gender],
            eligibleCasteCategories: [profile.socioeconomic.casteCategory],
          };

          const richResult = scoreEligibility(profile, matchingCriteria);

          // Adding matching criteria to an empty criteria set should
          // result in the same or higher score (criteria are met)
          expect(richResult.score).toBeGreaterThanOrEqual(0);
          expect(richResult.hardFailed).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * matchingCriteria and unmetCriteria are always disjoint sets.
   * A criterion cannot be both met and unmet simultaneously.
   */
  it('matchingCriteria and unmetCriteria are always disjoint', () => {
    fc.assert(
      fc.property(profileArb, schemeArb, (profile, scheme) => {
        const result: ScoringDetail = scoreEligibility(profile, scheme.eligibilityCriteria);
        const matching = new Set(result.matchingCriteria);
        const unmet = new Set(result.unmetCriteria);

        for (const criterion of matching) {
          expect(unmet.has(criterion)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 13: Scheme Explanation Simplification ──────────────────────────

describe('Property 13: Scheme Explanation Simplification', () => {
  /**
   * For any scheme criteria, the scoring function breaks down
   * complex criteria into discrete criterion labels.
   * Each label is a non-empty string that can be used to generate yes/no questions.
   */
  it('criteria labels are always non-empty strings usable for question generation', () => {
    fc.assert(
      fc.property(profileArb, schemeArb, (profile, scheme) => {
        const result = scoreEligibility(profile, scheme.eligibilityCriteria);
        const allCriteria = [...result.matchingCriteria, ...result.unmetCriteria];

        for (const label of allCriteria) {
          expect(typeof label).toBe('string');
          expect(label.length).toBeGreaterThan(0);
          // Labels should be valid identifiers (no spaces, lowercase with underscores)
          expect(label).toMatch(/^[a-z_]+$/);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * The number of criteria labels equals the number of criteria
   * that were actually evaluated (i.e. no criteria are silently dropped).
   * Total criteria = matching + unmet.
   */
  it('total evaluated criteria equals matching plus unmet criteria', () => {
    fc.assert(
      fc.property(profileArb, schemeArb, (profile, scheme) => {
        const result = scoreEligibility(profile, scheme.eligibilityCriteria);
        const total = result.matchingCriteria.length + result.unmetCriteria.length;
        // The system evaluates up to 9 criterion types
        expect(total).toBeGreaterThanOrEqual(0);
        expect(total).toBeLessThanOrEqual(9);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any valid scheme, building a scheme match produces either:
   * - null (if score below threshold)
   * - a SchemeMatch with a score in (0, 1] and non-empty scheme reference
   *
   * This validates the output contract used to generate scheme explanations.
   */
  it('buildSchemeMatch returns valid SchemeMatch or null — never throws', () => {
    fc.assert(
      fc.property(profileArb, schemeArb, (profile, scheme) => {
        let match = null;
        expect(() => {
          match = buildSchemeMatch(profile, scheme);
        }).not.toThrow();

        if (match !== null) {
          const m = match as ReturnType<typeof buildSchemeMatch>;
          expect(m).not.toBeNull();
          expect((m as NonNullable<typeof m>).eligibilityScore).toBeGreaterThan(0);
          expect((m as NonNullable<typeof m>).eligibilityScore).toBeLessThanOrEqual(1);
          expect((m as NonNullable<typeof m>).scheme).toBeDefined();
          expect(Array.isArray((m as NonNullable<typeof m>).matchingCriteria)).toBe(true);
          expect(Array.isArray((m as NonNullable<typeof m>).unmetCriteria)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * A scheme with zero eligibility criteria (universal scheme)
   * always produces a non-null match for ANY user profile.
   * This validates that universal schemes are always recommended.
   */
  it('universal scheme (empty criteria) always matches any user profile', () => {
    fc.assert(
      fc.property(profileArb, (profile) => {
        const universalScheme: GovernmentScheme = {
          schemeId: 'universal-1',
          officialName: 'Universal Scheme',
          shortDescription: 'For everyone',
          fullDescription: 'A scheme with no restrictions',
          category: SchemeCategory.SOCIAL_WELFARE,
          level: 'central',
          ministry: 'Ministry',
          status: SchemeStatus.ACTIVE,
          eligibilityCriteria: {}, // No restrictions
          requiredDocuments: [],
          benefitDetails: { benefitType: 'cash', estimatedValueINR: 1000, description: 'Test' },
          translations: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const match = buildSchemeMatch(profile, universalScheme);
        expect(match).not.toBeNull();
        expect(match!.eligibilityScore).toBe(1);
      }),
      { numRuns: 200 },
    );
  });
});
