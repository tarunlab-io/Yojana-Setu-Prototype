import type {
  SupportedLanguage,
  Gender,
  CasteCategory,
  ConsentType,
  Channel,
} from '../enums';

// ─── Demographics ─────────────────────────────────────────────────────────────

export interface Demographics {
  /** Full name as per government ID */
  fullName: string;
  /** Date of birth in ISO 8601 format */
  dateOfBirth: string;
  gender: Gender;
  /** Mobile number in E.164 format, e.g. +919876543210 */
  mobileNumber: string;
  /** ISO 3166-2:IN state code, e.g. "IN-TN" */
  stateCode: string;
  /** District name */
  district: string;
  /** Village / Town / City */
  locality: string;
  /** PIN code */
  pinCode: string;
}

// ─── Socioeconomic Data ───────────────────────────────────────────────────────

export interface SocioeconomicData {
  /** Annual family income in INR */
  annualIncomeINR: number;
  casteCategory: CasteCategory;
  /** Specific caste name */
  casteName?: string;
  /** BPL = Below Poverty Line */
  isBPL: boolean;
  /** Highest education level attained */
  educationLevel:
    | 'none'
    | 'primary'
    | 'secondary'
    | 'higher_secondary'
    | 'graduate'
    | 'post_graduate';
  /** Current employment status */
  employmentStatus: 'unemployed' | 'self_employed' | 'salaried' | 'farmer' | 'student' | 'retired';
  /** Whether user has any disability */
  hasDisability: boolean;
  /** Disability percentage if applicable */
  disabilityPercentage?: number;
  /** Land holding in acres, if applicable */
  landHoldingAcres?: number;
}

// ─── User Preferences ─────────────────────────────────────────────────────────

export interface UserPreferences {
  preferredLanguage: SupportedLanguage;
  preferredChannel: Channel;
  notificationsEnabled: boolean;
  voiceResponseEnabled: boolean;
}

// ─── Consent ──────────────────────────────────────────────────────────────────

export interface ConsentRecord {
  consentType: ConsentType;
  granted: boolean;
  timestamp: Date;
  /** IP or device identifier for audit trail */
  sourceIdentifier: string;
}

// ─── Full User Profile ────────────────────────────────────────────────────────

export interface UserProfile {
  userId: string;
  /** WhatsApp phone number — primary identifier */
  phoneNumber: string;
  demographics: Demographics;
  socioeconomic: SocioeconomicData;
  preferences: UserPreferences;
  consentRecords: ConsentRecord[];
  /** Profile completion percentage 0–100 */
  completionScore: number;
  createdAt: Date;
  updatedAt: Date;
}

export type UserProfileData = Omit<UserProfile, 'userId' | 'completionScore' | 'createdAt' | 'updatedAt'>;
export type UserProfileUpdate = Partial<UserProfileData>;

// ─── Extended consent record for privacy-service ─────────────────────────────

import type { ConsentPurpose, ConsentStatus } from '../enums';
import type { SupportedLanguage } from './voice.types';

export interface PrivacyConsentRecord {
  consentId: string;
  userId: string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  grantedAt?: Date;
  revokedAt?: Date;
  privacyNoticeVersion: string;
  channel: string;
  language: SupportedLanguage;
  ipHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConsentGrant {
  userId: string;
  purposes: ConsentPurpose[];
  channel: string;
  language: SupportedLanguage;
  privacyNoticeVersion: string;
}

// ─── Deletion request ─────────────────────────────────────────────────────────

import type { DeletionStatus } from '../enums';

export interface DeletionRequest {
  requestId: string;
  userId: string;
  status: DeletionStatus;
  requestedAt: Date;
  scheduledDeletionAt: Date;
  completedAt?: Date;
  blockingReason?: string;
}

export interface DeletionResult {
  requestId: string;
  success: boolean;
  deletionResults?: Record<string, boolean>;
  pseudoId?: string;
  completedAt?: Date;
  error?: string;
}
