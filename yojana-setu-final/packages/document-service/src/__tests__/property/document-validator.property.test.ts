/**
 * Property-based tests for the Document Validation Service.
 *
 * Feature: yojana-setu
 * Property 4: Document Validation Accuracy
 *   For any Indian government document image, the system should correctly
 *   extract required fields, verify authenticity markers, and provide
 *   meaningful feedback when validation fails.
 *   Validates: Requirements 4.1, 4.2, 4.3, 4.4
 *
 * Property 6: Document Expiry and Version Management
 *   For any document submission, the system should correctly identify expired
 *   documents, notify users, and maintain valid versions.
 *   Validates: Requirements 4.3, 6.3
 */

import * as fc from 'fast-check';
import { describe, it, expect } from '@jest/globals';
import { buildValidationResult, checkSchemeDocumentReadiness } from '../../validation/document-validator';
import { DOCUMENT_SCHEMAS } from '../../validation/document-schemas';
import {
  DocumentType,
  DocumentStatus,
  type ExtractedData,
  type QualityAssessment,
  type ValidationResult,
} from '@yojana-setu/shared';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const documentTypeArb = fc.constantFrom(...Object.values(DocumentType));

const qualityScoreArb = fc.double({ min: 0, max: 1, noNaN: true });

const qualityAssessmentArb: fc.Arbitrary<QualityAssessment> = fc.record({
  overallScore: qualityScoreArb,
  isAcceptable: fc.boolean(),
  issues: fc.array(
    fc.record({
      issueType: fc.constantFrom('blur', 'low_resolution', 'partial', 'glare', 'shadow'),
      severity: fc.constantFrom('low', 'medium', 'high'),
      description: fc.string({ minLength: 5, maxLength: 80 }),
      userGuidance: fc.string({ minLength: 5, maxLength: 100 }),
    }),
    { maxLength: 4 },
  ),
  recommendations: fc.array(fc.string({ minLength: 5, maxLength: 100 }), { maxLength: 4 }),
});

const extractedFieldArb = (fieldName: string) =>
  fc.record({
    fieldName: fc.constant(fieldName),
    value: fc.string({ minLength: 0, maxLength: 50 }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  });

/** Generates an ExtractedData for any supported document type */
const extractedDataArb: fc.Arbitrary<ExtractedData> = documentTypeArb.chain((docType) => {
  const schema = DOCUMENT_SCHEMAS[docType];
  return fc.record({
    documentType: fc.constant(docType),
    fields: fc.tuple(...schema.fields.map((f) => extractedFieldArb(f.name))).map(
      (fields) => fields as ExtractedData['fields'],
    ),
    rawText: fc.string({ minLength: 0, maxLength: 200 }),
    extractionConfidence: qualityScoreArb,
    extractedAt: fc.constant(new Date()),
  });
});

// ─── Property 4: Document Validation Accuracy ─────────────────────────────────

describe('Property 4: Document Validation Accuracy', () => {
  /**
   * buildValidationResult is TOTAL: it never throws for any combination of
   * extracted data and quality assessment. The function must always return
   * a structured ValidationResult.
   */
  it('buildValidationResult never throws for any extracted data and quality assessment', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        documentTypeArb,
        extractedDataArb,
        qualityAssessmentArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1000, max: 10_000_000 }),
        fc.integer({ min: 100, max: 10_000 }),
        (docId, docType, extracted, quality, filename, fileSize, processingTime) => {
          let result: ValidationResult | undefined;
          expect(() => {
            result = buildValidationResult(
              docId, docType, { ...extracted, documentType: docType },
              quality, filename, fileSize, processingTime,
            );
          }).not.toThrow();
          expect(result).toBeDefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * The validation status must always be a valid DocumentStatus enum value.
   * The status must be one of: VALID, INVALID, UNCLEAR, EXPIRED.
   */
  it('validation status is always a valid DocumentStatus for any input', () => {
    const validStatuses = new Set(Object.values(DocumentStatus));
    fc.assert(
      fc.property(
        fc.uuid(),
        extractedDataArb,
        qualityAssessmentArb,
        (docId, extracted, quality) => {
          const result = buildValidationResult(
            docId, extracted.documentType, extracted, quality,
            'test.jpg', 500_000, 1000,
          );
          expect(validStatuses.has(result.status)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * isValid is CONSISTENT with status:
   * isValid === true if and only if status === VALID.
   * These two fields must always agree.
   */
  it('isValid is always consistent with status === VALID', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        extractedDataArb,
        qualityAssessmentArb,
        (docId, extracted, quality) => {
          const result = buildValidationResult(
            docId, extracted.documentType, extracted, quality,
            'test.jpg', 500_000, 1000,
          );
          expect(result.isValid).toBe(result.status === DocumentStatus.VALID);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Confidence score is always in [0, 1] — never NaN, never negative,
   * never above 1. This is a numerical invariant critical for sorting matches.
   */
  it('confidence score is always in range [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        extractedDataArb,
        qualityAssessmentArb,
        (docId, extracted, quality) => {
          const result = buildValidationResult(
            docId, extracted.documentType, extracted, quality,
            'test.jpg', 500_000, 1000,
          );
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
          expect(Number.isNaN(result.confidence)).toBe(false);
          expect(Number.isFinite(result.confidence)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Recommendations are always deduplicated — no duplicate strings.
   * Users must not see the same guidance twice in one report.
   */
  it('recommendations list never contains duplicate messages', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        extractedDataArb,
        qualityAssessmentArb,
        (docId, extracted, quality) => {
          const result = buildValidationResult(
            docId, extracted.documentType, extracted, quality,
            'test.jpg', 500_000, 1000,
          );
          const unique = new Set(result.recommendations);
          expect(result.recommendations.length).toBe(unique.size);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * A high-severity quality issue always results in UNCLEAR status (never VALID).
   * Poor image quality must block document acceptance.
   */
  it('high-severity quality issues always prevent VALID status', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        extractedDataArb,
        (docId, extracted) => {
          const highSeverityQuality: QualityAssessment = {
            overallScore: 0.2,
            isAcceptable: false,
            issues: [{
              issueType: 'blur',
              severity: 'high',
              description: 'Image is too blurry',
              userGuidance: 'Please retake in better light',
            }],
            recommendations: ['Please retake in better light'],
          };

          const result = buildValidationResult(
            docId, extracted.documentType, extracted, highSeverityQuality,
            'test.jpg', 500_000, 1000,
          );

          expect(result.status).toBe(DocumentStatus.UNCLEAR);
          expect(result.isValid).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 6: Document Expiry and Version Management ──────────────────────

describe('Property 6: Document Expiry and Version Management', () => {
  /**
   * checkSchemeDocumentReadiness is MONOTONE:
   * providing MORE valid documents can never make isReady go from true→false.
   */
  it('providing additional valid documents never reduces readiness', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...Object.values(DocumentType)), { minLength: 1, maxLength: 5 }),
        (requiredTypes) => {
          const uniqueRequired = [...new Set(requiredTypes)];

          // Subset of documents (may not be ready)
          const partialDocs = uniqueRequired.slice(0, Math.ceil(uniqueRequired.length / 2));
          const partialResults: ValidationResult[] = partialDocs.map((type) => ({
            documentId: `doc-${type}`,
            documentType: type,
            status: DocumentStatus.VALID,
            isValid: true,
            confidence: 0.9,
            extractedFields: {},
            missingFields: [],
            qualityIssues: [],
            recommendations: [],
            isExpired: false,
            metadata: { originalFilename: 'x.jpg', fileSizeBytes: 100000, processingTimeMs: 900, ocrEngine: 'aws_textract' },
          }));

          // Full set of documents (must be at least as ready)
          const fullResults: ValidationResult[] = uniqueRequired.map((type) => ({
            documentId: `doc-${type}`,
            documentType: type,
            status: DocumentStatus.VALID,
            isValid: true,
            confidence: 0.9,
            extractedFields: {},
            missingFields: [],
            qualityIssues: [],
            recommendations: [],
            isExpired: false,
            metadata: { originalFilename: 'x.jpg', fileSizeBytes: 100000, processingTimeMs: 900, ocrEngine: 'aws_textract' },
          }));

          const partialReadiness = checkSchemeDocumentReadiness(partialResults, uniqueRequired);
          const fullReadiness = checkSchemeDocumentReadiness(fullResults, uniqueRequired);

          // Full set should be at least as ready as partial
          if (!partialReadiness.isReady) {
            expect(fullReadiness.missingDocumentTypes.length).toBeLessThanOrEqual(
              partialReadiness.missingDocumentTypes.length,
            );
          }

          // Full set of all valid documents must always be ready
          expect(fullReadiness.isReady).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * checkSchemeDocumentReadiness is IDEMPOTENT:
   * running it twice with the same inputs always gives the same result.
   */
  it('checkSchemeDocumentReadiness is idempotent', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...Object.values(DocumentType)), { minLength: 0, maxLength: 4 }),
        fc.array(fc.constantFrom(...Object.values(DocumentType)), { minLength: 0, maxLength: 4 }),
        (docTypes, requiredTypes) => {
          const makeResult = (type: DocumentType, valid: boolean): ValidationResult => ({
            documentId: `doc-${type}`,
            documentType: type,
            status: valid ? DocumentStatus.VALID : DocumentStatus.INVALID,
            isValid: valid,
            confidence: valid ? 0.9 : 0.3,
            extractedFields: {},
            missingFields: valid ? [] : ['Some Field'],
            qualityIssues: [],
            recommendations: [],
            isExpired: false,
            metadata: { originalFilename: 'x.jpg', fileSizeBytes: 100000, processingTimeMs: 900, ocrEngine: 'aws_textract' },
          });

          const results = docTypes.map((t) => makeResult(t, true));
          const unique = [...new Set(requiredTypes)];

          const first = checkSchemeDocumentReadiness(results, unique);
          const second = checkSchemeDocumentReadiness(results, unique);

          expect(first.isReady).toBe(second.isReady);
          expect(first.missingDocumentTypes).toEqual(second.missingDocumentTypes);
          expect(first.invalidDocuments.length).toBe(second.invalidDocuments.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * isExpired and status === EXPIRED are always consistent.
   * These two flags must always agree.
   */
  it('isExpired flag is always consistent with EXPIRED status', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        extractedDataArb,
        qualityAssessmentArb,
        (docId, extracted, quality) => {
          const result = buildValidationResult(
            docId, extracted.documentType, extracted, quality,
            'test.jpg', 500_000, 1000,
          );
          // If expired, status must reflect it
          if (result.isExpired) {
            expect(result.status).toBe(DocumentStatus.EXPIRED);
            expect(result.isValid).toBe(false);
          }
          // If status is EXPIRED, isExpired must be true
          if (result.status === DocumentStatus.EXPIRED) {
            expect(result.isExpired).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
