// ─── Language & Locale ────────────────────────────────────────────────────────

/**
 * All 22 constitutionally recognised Indian languages supported by Bhashini API.
 * ISO 639-1 codes where available, BCP 47 otherwise.
 */
export enum SupportedLanguage {
  ASSAMESE = 'as',
  BENGALI = 'bn',
  BODO = 'brx',
  DOGRI = 'doi',
  GUJARATI = 'gu',
  HINDI = 'hi',
  KANNADA = 'kn',
  KASHMIRI = 'ks',
  KONKANI = 'gom',
  MAITHILI = 'mai',
  MALAYALAM = 'ml',
  MANIPURI = 'mni',
  MARATHI = 'mr',
  NEPALI = 'ne',
  ODIA = 'or',
  PUNJABI = 'pa',
  SANSKRIT = 'sa',
  SANTALI = 'sat',
  SINDHI = 'sd',
  TAMIL = 'ta',
  TELUGU = 'te',
  URDU = 'ur',
  ENGLISH = 'en', // fallback/admin
}

// ─── Communication Channel ────────────────────────────────────────────────────

export enum Channel {
  WHATSAPP = 'whatsapp',
  WEB = 'web',
  VOICE = 'voice',
}

// ─── User Intent ──────────────────────────────────────────────────────────────

export enum UserIntent {
  DISCOVER_SCHEMES = 'discover_schemes',
  CHECK_ELIGIBILITY = 'check_eligibility',
  EXPLAIN_SCHEME = 'explain_scheme',
  UPLOAD_DOCUMENT = 'upload_document',
  TRACK_APPLICATION = 'track_application',
  UPDATE_PROFILE = 'update_profile',
  SWITCH_LANGUAGE = 'switch_language',
  HELP = 'help',
  UNKNOWN = 'unknown',
}

// ─── Conversation Stage ───────────────────────────────────────────────────────

export enum ConversationStage {
  GREETING = 'greeting',
  LANGUAGE_SELECTION = 'language_selection',
  PROFILE_COLLECTION = 'profile_collection',
  SCHEME_DISCOVERY = 'scheme_discovery',
  SCHEME_EXPLANATION = 'scheme_explanation',
  DOCUMENT_COLLECTION = 'document_collection',
  DOCUMENT_VALIDATION = 'document_validation',
  APPLICATION_SUBMISSION = 'application_submission',
  APPLICATION_TRACKING = 'application_tracking',
  COMPLETED = 'completed',
}

// ─── Document ─────────────────────────────────────────────────────────────────

export enum DocumentType {
  AADHAAR = 'aadhaar',
  PAN = 'pan',
  VOTER_ID = 'voter_id',
  PASSPORT = 'passport',
  DRIVING_LICENSE = 'driving_license',
  RATION_CARD = 'ration_card',
  INCOME_CERTIFICATE = 'income_certificate',
  CASTE_CERTIFICATE = 'caste_certificate',
  DOMICILE_CERTIFICATE = 'domicile_certificate',
  BANK_PASSBOOK = 'bank_passbook',
  BIRTH_CERTIFICATE = 'birth_certificate',
  DISABILITY_CERTIFICATE = 'disability_certificate',
  EDUCATIONAL_CERTIFICATE = 'educational_certificate',
  LAND_RECORD = 'land_record',
  OTHER = 'other',
}

export enum DocumentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  VALID = 'valid',
  INVALID = 'invalid',
  EXPIRED = 'expired',
  UNCLEAR = 'unclear',
}

// ─── Scheme ───────────────────────────────────────────────────────────────────

export enum SchemeStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  EXPIRED = 'expired',
  UPCOMING = 'upcoming',
}

export enum SchemeCategory {
  AGRICULTURE = 'agriculture',
  EDUCATION = 'education',
  HEALTH = 'health',
  HOUSING = 'housing',
  EMPLOYMENT = 'employment',
  SOCIAL_WELFARE = 'social_welfare',
  WOMEN_AND_CHILD = 'women_and_child',
  MINORITY = 'minority',
  DISABILITY = 'disability',
  SENIOR_CITIZEN = 'senior_citizen',
  SKILL_DEVELOPMENT = 'skill_development',
  FINANCIAL_INCLUSION = 'financial_inclusion',
}

// ─── Application ──────────────────────────────────────────────────────────────

export enum ApplicationStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  ADDITIONAL_DOCS_REQUIRED = 'additional_docs_required',
  DOCUMENTS_REQUIRED = 'documents_required',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DISBURSEMENT_PENDING = 'disbursement_pending',
  DISBURSED = 'disbursed',
  COMPLETED = 'completed',
  WITHDRAWN = 'withdrawn',
}

// ─── Caste Category ───────────────────────────────────────────────────────────

export enum CasteCategory {
  GENERAL = 'general',
  OBC = 'obc',
  SC = 'sc',
  ST = 'st',
  EWS = 'ews',
}

// ─── Gender ───────────────────────────────────────────────────────────────────

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  TRANSGENDER = 'transgender',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

// ─── Consent ──────────────────────────────────────────────────────────────────

export enum ConsentType {
  DATA_STORAGE = 'data_storage',
  PROFILE_SHARING = 'profile_sharing',
  SCHEME_NOTIFICATIONS = 'scheme_notifications',
  ANALYTICS = 'analytics',
  THIRD_PARTY_SHARING = 'third_party_sharing',
}

// ─── Media ────────────────────────────────────────────────────────────────────

export enum MediaType {
  IMAGE_JPEG = 'image/jpeg',
  IMAGE_PNG = 'image/png',
  IMAGE_PDF = 'application/pdf',
  AUDIO_OGG = 'audio/ogg',
  AUDIO_MP3 = 'audio/mpeg',
  AUDIO_WAV = 'audio/wav',
}

// ─── Notification ─────────────────────────────────────────────────────────────

export enum NotificationType {
  SCHEME_MATCH = 'scheme_match',
  APPLICATION_UPDATE = 'application_update',
  DOCUMENT_VALIDATED = 'document_validated',
  SESSION_REMINDER = 'session_reminder',
  SCHEME_DEADLINE = 'scheme_deadline',
  PROFILE_INCOMPLETE = 'profile_incomplete',
}

// ─── Consent Purpose (granular PDPB consent purposes) ─────────────────────────

export enum ConsentPurpose {
  PROFILE_DATA       = 'profile_data',
  DOCUMENT_STORAGE   = 'document_storage',
  SCHEME_MATCHING    = 'scheme_matching',
  NOTIFICATIONS      = 'notifications',
  ANALYTICS          = 'analytics',
  THIRD_PARTY_SHARING = 'third_party_sharing',
}

export enum ConsentStatus {
  ACTIVE     = 'active',
  REVOKED    = 'revoked',
  SUPERSEDED = 'superseded',
  PENDING    = 'pending',
}

// ─── Deletion ─────────────────────────────────────────────────────────────────

export enum DeletionStatus {
  SCHEDULED  = 'scheduled',
  BLOCKED    = 'blocked',
  PROCESSING = 'processing',
  COMPLETED  = 'completed',
  PARTIAL    = 'partial',
  FAILED     = 'failed',
}
