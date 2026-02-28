import type { DocumentType, DocumentStatus } from '../enums';

// ─── Quality Assessment ───────────────────────────────────────────────────────

export interface QualityIssue {
  issueType: 'blur' | 'low_resolution' | 'glare' | 'partial' | 'rotated' | 'dark';
  severity: 'low' | 'medium' | 'high';
  description: string;
  /** Suggested action for the user */
  userGuidance: string;
}

export interface QualityAssessment {
  overallScore: number; // 0–1
  isAcceptable: boolean;
  issues: QualityIssue[];
  recommendations: string[];
}

// ─── Extracted Data ───────────────────────────────────────────────────────────

export interface ExtractedField {
  fieldName: string;
  value: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ExtractedData {
  documentType: DocumentType;
  fields: ExtractedField[];
  rawText: string;
  extractionConfidence: number;
  extractedAt: Date;
}

// ─── Validation Result ────────────────────────────────────────────────────────

export interface ValidationResult {
  documentId: string;
  documentType: DocumentType;
  status: DocumentStatus;
  isValid: boolean;
  /** 0–1 overall validation confidence */
  confidence: number;
  extractedFields: Record<string, string>;
  missingFields: string[];
  qualityIssues: QualityIssue[];
  recommendations: string[];
  /** Whether document is within its validity period */
  isExpired: boolean;
  expiryDate?: Date;
  metadata: {
    originalFilename: string;
    fileSizeBytes: number;
    processingTimeMs: number;
    ocrEngine: string;
  };
}

// ─── Validation Report ────────────────────────────────────────────────────────

export interface ValidationReport {
  reportId: string;
  userId: string;
  schemeId: string;
  documents: ValidationResult[];
  overallStatus: 'complete' | 'incomplete' | 'issues_found';
  readyForSubmission: boolean;
  missingDocumentTypes: DocumentType[];
  summary: string;
  generatedAt: Date;
}

// ─── Document Storage ─────────────────────────────────────────────────────────

export interface StoredDocument {
  documentId: string;
  userId: string;
  documentType: DocumentType;
  /** S3 or compatible object storage key */
  storageKey: string;
  /** Encrypted storage key for sensitive docs */
  encryptedKey?: string;
  status: DocumentStatus;
  validationResult?: ValidationResult;
  uploadedAt: Date;
  expiresAt?: Date;
}
