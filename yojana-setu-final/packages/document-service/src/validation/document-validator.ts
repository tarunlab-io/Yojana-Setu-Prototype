/**
 * Document Validator
 *
 * Pure validation functions — no DB, no OCR calls.
 * Takes extracted data + schema and produces a ValidationResult.
 *
 * Separated from OCR to enable thorough unit and property testing
 * without mocking any external services.
 */

import {
  type ExtractedData,
  type ExtractedField,
  type ValidationResult,
  type QualityAssessment,
  type QualityIssue,
  DocumentType,
  DocumentStatus,
  DocumentExpiredError,
} from '@yojana-setu/shared';
import { DOCUMENT_SCHEMAS, type FieldSchema } from './document-schemas';
import { generateUUID } from '@yojana-setu/shared';

// ─── Field Validation ─────────────────────────────────────────────────────────

interface FieldValidationResult {
  fieldName: string;
  isPresent: boolean;
  isValid: boolean;
  value?: string;
  confidence: number;
  issues: string[];
}

function validateField(
  schema: FieldSchema,
  extracted: ExtractedField | undefined,
): FieldValidationResult {
  if (!extracted || !extracted.value.trim()) {
    return {
      fieldName: schema.name,
      isPresent: false,
      isValid: false,
      confidence: 0,
      issues: schema.required
        ? [`Required field "${schema.label}" is missing`]
        : [],
    };
  }

  const issues: string[] = [];
  let isValid = true;

  // Pattern validation
  if (schema.pattern && !schema.pattern.test(extracted.value.trim())) {
    isValid = false;
    issues.push(
      `"${schema.label}" format is invalid.${schema.example ? ` Expected format: ${schema.example}` : ''}`,
    );
  }

  // Low confidence warning (not a failure — just flagged)
  if (extracted.confidence < 0.7) {
    issues.push(`"${schema.label}" was extracted with low confidence — please verify it is correct`);
  }

  return {
    fieldName: schema.name,
    isPresent: true,
    isValid,
    value: extracted.value.trim(),
    confidence: extracted.confidence,
    issues,
  };
}

// ─── Expiry Validation ────────────────────────────────────────────────────────

/**
 * Parses a date string in common Indian formats:
 * DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD MMM YYYY
 */
function parseIndianDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const cleaned = dateStr.trim();

  // ISO format: 2024-01-15
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`);

  // DD MMM YYYY (e.g. 15 Jan 2024)
  const ddmmmyyyy = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (ddmmmyyyy) return new Date(`${ddmmmyyyy[1]} ${ddmmmyyyy[2]} ${ddmmmyyyy[3]}`);

  return null;
}

interface ExpiryCheckResult {
  isExpired: boolean;
  expiryDate?: Date;
  daysUntilExpiry?: number;
}

function checkExpiry(
  extractedFields: Record<string, string>,
  documentType: DocumentType,
): ExpiryCheckResult {
  const schema = DOCUMENT_SCHEMAS[documentType];
  if (!schema.hasExpiry) return { isExpired: false };

  // Look for expiry date in extracted fields
  const expiryValue =
    extractedFields['expiryDate'] ??
    extractedFields['validityDate'] ??
    extractedFields['validUntil'];

  // If explicit expiry date found
  if (expiryValue) {
    const expiryDate = parseIndianDate(expiryValue);
    if (expiryDate) {
      const now = new Date();
      const daysUntilExpiry = Math.floor(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return {
        isExpired: expiryDate < now,
        expiryDate,
        daysUntilExpiry,
      };
    }
  }

  // No explicit expiry — calculate from issue date + validity period
  if (schema.validityYears) {
    const issueDateValue = extractedFields['issueDate'];
    if (issueDateValue) {
      const issueDate = parseIndianDate(issueDateValue);
      if (issueDate) {
        const expiryDate = new Date(issueDate);
        expiryDate.setFullYear(expiryDate.getFullYear() + schema.validityYears);
        const now = new Date();
        const daysUntilExpiry = Math.floor(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        return {
          isExpired: expiryDate < now,
          expiryDate,
          daysUntilExpiry,
        };
      }
    }
  }

  // Can't determine expiry — assume valid
  return { isExpired: false };
}

// ─── Core Validation Function ─────────────────────────────────────────────────

export function buildValidationResult(
  documentId: string,
  documentType: DocumentType,
  extractedData: ExtractedData,
  qualityAssessment: QualityAssessment,
  originalFilename: string,
  fileSizeBytes: number,
  processingTimeMs: number,
): ValidationResult {
  const schema = DOCUMENT_SCHEMAS[documentType];

  // Build lookup map from extracted fields
  const fieldMap = new Map<string, ExtractedField>();
  for (const field of extractedData.fields) {
    fieldMap.set(field.fieldName, field);
  }

  // Validate each field against its schema
  const fieldResults: FieldValidationResult[] = schema.fields.map((schemaField) =>
    validateField(schemaField, fieldMap.get(schemaField.name)),
  );

  // Collect missing required fields
  const missingFields = fieldResults
    .filter((r) => !r.isPresent && schema.fields.find((f) => f.name === r.fieldName)?.required)
    .map((r) => schema.fields.find((f) => f.name === r.fieldName)?.label ?? r.fieldName);

  // Collect field-level issues
  const fieldIssues = fieldResults.flatMap((r) => r.issues);

  // Build extracted fields record for expiry check
  const extractedRecord: Record<string, string> = {};
  for (const result of fieldResults) {
    if (result.value) extractedRecord[result.fieldName] = result.value;
  }

  // Check expiry
  const expiryCheck = checkExpiry(extractedRecord, documentType);

  // Determine overall status
  const hasHighQualityIssues = qualityAssessment.issues.some((i) => i.severity === 'high');
  const hasMissingRequired = missingFields.length > 0;

  let status: DocumentStatus;
  if (hasHighQualityIssues) {
    status = DocumentStatus.UNCLEAR;
  } else if (expiryCheck.isExpired) {
    status = DocumentStatus.EXPIRED;
  } else if (hasMissingRequired) {
    status = DocumentStatus.INVALID;
  } else {
    status = DocumentStatus.VALID;
  }

  // Build overall confidence
  const fieldConfidences = fieldResults
    .filter((r) => r.isPresent)
    .map((r) => r.confidence);
  const avgFieldConfidence =
    fieldConfidences.length > 0
      ? fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length
      : 0;
  const overallConfidence =
    (avgFieldConfidence * 0.7 + qualityAssessment.overallScore * 0.3) *
    (expiryCheck.isExpired ? 0 : 1);

  // Build recommendations
  const recommendations: string[] = [];
  if (missingFields.length > 0) {
    recommendations.push(
      `The following required fields could not be read: ${missingFields.join(', ')}. Please retake the photo ensuring these are clearly visible.`,
    );
  }
  if (expiryCheck.isExpired) {
    recommendations.push(
      `This document has expired${expiryCheck.expiryDate ? ` (expired on ${expiryCheck.expiryDate.toLocaleDateString('en-IN')})` : ''}. Please obtain a renewed document.`,
    );
  }
  if (
    expiryCheck.daysUntilExpiry !== undefined &&
    expiryCheck.daysUntilExpiry > 0 &&
    expiryCheck.daysUntilExpiry < 30
  ) {
    recommendations.push(
      `⚠️ This document expires in ${expiryCheck.daysUntilExpiry} days. Consider renewing it soon.`,
    );
  }
  recommendations.push(...qualityAssessment.recommendations);
  recommendations.push(...fieldIssues);

  return {
    documentId,
    documentType,
    status,
    isValid: status === DocumentStatus.VALID,
    confidence: Math.round(overallConfidence * 1000) / 1000,
    extractedFields: extractedRecord,
    missingFields,
    qualityIssues: qualityAssessment.issues,
    recommendations: [...new Set(recommendations)], // deduplicate
    isExpired: expiryCheck.isExpired,
    expiryDate: expiryCheck.expiryDate,
    metadata: {
      originalFilename,
      fileSizeBytes,
      processingTimeMs,
      ocrEngine: 'aws_textract',
    },
  };
}

// ─── Scheme Readiness Check ───────────────────────────────────────────────────

/**
 * Given a list of validation results and required document types for a scheme,
 * returns which documents are still missing or invalid.
 */
export function checkSchemeDocumentReadiness(
  validationResults: ValidationResult[],
  requiredDocumentTypes: DocumentType[],
): {
  isReady: boolean;
  missingDocumentTypes: DocumentType[];
  invalidDocuments: Array<{ documentType: DocumentType; reason: string }>;
} {
  const providedAndValid = new Set(
    validationResults
      .filter((r) => r.isValid)
      .map((r) => r.documentType),
  );

  const missingDocumentTypes = requiredDocumentTypes.filter(
    (type) => !providedAndValid.has(type),
  );

  const invalidDocuments = validationResults
    .filter((r) => !r.isValid)
    .map((r) => ({
      documentType: r.documentType,
      reason: r.recommendations[0] ?? `Document status: ${r.status}`,
    }));

  return {
    isReady: missingDocumentTypes.length === 0 && invalidDocuments.length === 0,
    missingDocumentTypes,
    invalidDocuments,
  };
}
