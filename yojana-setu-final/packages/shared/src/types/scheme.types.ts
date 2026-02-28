import type { SupportedLanguage, SchemeStatus, SchemeCategory, CasteCategory, Gender } from '../enums';

// ─── Eligibility Criteria ─────────────────────────────────────────────────────

export interface AgeRange {
  min?: number;
  max?: number;
}

export interface IncomeRange {
  /** Minimum annual income in INR (inclusive) */
  minINR?: number;
  /** Maximum annual income in INR (inclusive) */
  maxINR?: number;
}

export interface EligibilityCriteria {
  ageRange?: AgeRange;
  incomeRange?: IncomeRange;
  eligibleGenders?: Gender[];
  eligibleCasteCategories?: CasteCategory[];
  requiresBPL?: boolean;
  requiredEducationLevel?: string;
  requiredEmploymentStatus?: string[];
  requiresDisability?: boolean;
  minimumDisabilityPercentage?: number;
  eligibleStates?: string[];
  minimumLandHoldingAcres?: number;
  maximumLandHoldingAcres?: number;
  /** Any additional criteria as key-value pairs for flexibility */
  additionalCriteria?: Record<string, string | number | boolean>;
}

// ─── Document Requirements ────────────────────────────────────────────────────

export interface RequiredDocument {
  documentType: string;
  description: string;
  isMandatory: boolean;
  acceptedFormats: string[];
  exampleDescription?: string;
}

// ─── Benefit Details ──────────────────────────────────────────────────────────

export interface BenefitDetails {
  /** Type of benefit provided */
  benefitType: 'cash' | 'subsidy' | 'loan' | 'scholarship' | 'equipment' | 'service' | 'insurance';
  /** Estimated value in INR (if applicable) */
  estimatedValueINR?: number;
  description: string;
  disbursementMode?: 'direct_bank_transfer' | 'cheque' | 'online' | 'in_kind';
}

// ─── Government Scheme ────────────────────────────────────────────────────────

export interface GovernmentScheme {
  schemeId: string;
  /** Official scheme name */
  officialName: string;
  /** Simplified popular name */
  popularName?: string;
  /** Short description (1–2 sentences) */
  shortDescription: string;
  /** Full description */
  fullDescription: string;
  /** Simplified explanation for low-literacy users */
  simplifiedExplanation?: string;
  category: SchemeCategory;
  /** Central or state scheme */
  level: 'central' | 'state';
  /** State code if state scheme */
  stateCode?: string;
  /** Ministry or department responsible */
  ministry: string;
  status: SchemeStatus;
  eligibilityCriteria: EligibilityCriteria;
  requiredDocuments: RequiredDocument[];
  benefitDetails: BenefitDetails;
  applicationDeadline?: Date;
  applicationUrl?: string;
  officialNotificationUrl?: string;
  /** Translations of key fields */
  translations?: Partial<Record<SupportedLanguage, SchemeTranslation>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SchemeTranslation {
  shortDescription: string;
  simplifiedExplanation: string;
  benefitDescription: string;
}

// ─── Scheme Match Result ──────────────────────────────────────────────────────

export interface SchemeMatch {
  scheme: GovernmentScheme;
  /** 0–1 score indicating how well the user matches eligibility */
  eligibilityScore: number;
  /** Criteria that matched */
  matchingCriteria: string[];
  /** Criteria the user does not meet */
  unmetCriteria: string[];
  estimatedBenefitINR?: number;
  applicationDeadline?: Date;
}

// ─── Scheme Explanation ───────────────────────────────────────────────────────

export interface EligibilityQuestion {
  questionId: string;
  question: string;
  expectedAnswer: 'yes' | 'no';
  criteriaKey: string;
}

export interface SchemeExplanation {
  schemeId: string;
  language: SupportedLanguage;
  simplifiedDescription: string;
  eligibilityQuestions: EligibilityQuestion[];
  requiredDocumentExamples: string[];
  importantDates: { label: string; date: Date }[];
  applicationSteps: string[];
  generatedAt: Date;
}

// ─── Eligibility Result ───────────────────────────────────────────────────────

export interface EligibilityResult {
  schemeId: string;
  userId: string;
  isEligible: boolean;
  eligibilityScore: number;
  matchingCriteria: string[];
  unmetCriteria: string[];
  checkedAt: Date;
}

// ─── Scheme Update ────────────────────────────────────────────────────────────

export interface SchemeUpdate {
  schemeId: string;
  updateType: 'new' | 'modified' | 'expiring' | 'expired';
  description: string;
  affectedCriteria?: string[];
  updatedAt: Date;
}
