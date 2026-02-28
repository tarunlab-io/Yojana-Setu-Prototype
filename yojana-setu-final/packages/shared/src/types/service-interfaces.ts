/**
 * Service interface contracts.
 * Every service implements these interfaces, enabling easy mocking in tests
 * and future provider swaps (e.g. switching WhatsApp providers).
 */

import type { SupportedLanguage } from '../enums';
import type {
  UserProfile,
  UserProfileData,
  UserProfileUpdate,
} from './user-profile.types';
import type { ConsentType } from '../enums';
import type {
  GovernmentScheme,
  SchemeMatch,
  SchemeExplanation,
  EligibilityResult,
  SchemeUpdate,
} from './scheme.types';
import type {
  VoiceProcessingResult,
  LanguageDetectionResult,
  SpeechGenerationOptions,
  BhashiniTranslationRequest,
  BhashiniTranslationResponse,
} from './voice.types';
import type {
  ValidationResult,
  ValidationReport,
  QualityAssessment,
  ExtractedData,
} from './document.types';
import type { DocumentType } from '../enums';
import type {
  WhatsAppMessage,
  WhatsAppWebhook,
  MessageResult,
  ConversationState,
} from './whatsapp.types';
import type {
  Application,
  ApplicationSummary,
} from './application.types';

// ─── Voice Service ────────────────────────────────────────────────────────────

export interface IVoiceService {
  processVoiceInput(audioData: Buffer, language?: SupportedLanguage): Promise<VoiceProcessingResult>;
  generateSpeechResponse(text: string, options: SpeechGenerationOptions): Promise<Buffer>;
  detectLanguage(audioData: Buffer): Promise<LanguageDetectionResult>;
  translate(request: BhashiniTranslationRequest): Promise<BhashiniTranslationResponse>;
  normalizeText(text: string, language: SupportedLanguage): Promise<string>;
}

// ─── Scheme Matcher Service ───────────────────────────────────────────────────

export interface ISchemeMatcherService {
  findEligibleSchemes(userProfile: UserProfile, query?: string): Promise<SchemeMatch[]>;
  explainScheme(schemeId: string, language: SupportedLanguage): Promise<SchemeExplanation>;
  checkEligibility(schemeId: string, userProfile: UserProfile): Promise<EligibilityResult>;
  getSchemeUpdates(userId: string): Promise<SchemeUpdate[]>;
  getSchemeById(schemeId: string): Promise<GovernmentScheme | null>;
  searchSchemes(query: string, language?: SupportedLanguage): Promise<GovernmentScheme[]>;
}

// ─── Document Validator Service ───────────────────────────────────────────────

export interface IDocumentValidatorService {
  validateDocument(documentImage: Buffer, documentType: DocumentType): Promise<ValidationResult>;
  extractDocumentData(documentImage: Buffer): Promise<ExtractedData>;
  checkDocumentQuality(documentImage: Buffer): Promise<QualityAssessment>;
  generateValidationReport(userId: string, schemeId: string): Promise<ValidationReport>;
}

// ─── User Profile Service ─────────────────────────────────────────────────────

export interface IUserProfileService {
  createProfile(profileData: UserProfileData): Promise<UserProfile>;
  updateProfile(userId: string, updates: UserProfileUpdate): Promise<UserProfile>;
  getProfile(userId: string): Promise<UserProfile | null>;
  getProfileByPhone(phoneNumber: string): Promise<UserProfile | null>;
  deleteProfile(userId: string): Promise<void>;
  checkConsent(userId: string, consentType: ConsentType): Promise<boolean>;
  updateConsent(userId: string, consentType: ConsentType, granted: boolean): Promise<void>;
  calculateCompletionScore(profile: UserProfile): number;
}

// ─── WhatsApp Interface Service ───────────────────────────────────────────────

export interface IWhatsAppService {
  sendMessage(phoneNumber: string, message: WhatsAppMessage): Promise<MessageResult>;
  processIncomingWebhook(webhook: WhatsAppWebhook): Promise<void>;
  downloadMedia(mediaId: string): Promise<Buffer>;
  uploadMedia(mediaData: Buffer, mimeType: string): Promise<string>;
  getOrCreateSession(phoneNumber: string): Promise<ConversationState>;
  updateSession(sessionId: string, updates: Partial<ConversationState>): Promise<void>;
}

// ─── Application Tracking Service ────────────────────────────────────────────

export interface IApplicationService {
  createApplication(userId: string, schemeId: string, documentIds: string[]): Promise<Application>;
  getApplication(applicationId: string): Promise<Application | null>;
  getApplicationByTracking(trackingReference: string): Promise<Application | null>;
  getUserApplications(userId: string): Promise<ApplicationSummary[]>;
  updateApplicationStatus(applicationId: string, status: Application['status'], note?: string): Promise<Application>;
}

// ─── Notification Service ─────────────────────────────────────────────────────

export interface INotificationService {
  sendSchemeMatchNotification(userId: string, schemeIds: string[]): Promise<void>;
  sendApplicationUpdateNotification(userId: string, applicationId: string): Promise<void>;
  sendSessionReminder(userId: string): Promise<void>;
  sendDeadlineReminder(userId: string, schemeId: string): Promise<void>;
}
