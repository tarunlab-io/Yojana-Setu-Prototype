import { describe, it, expect } from '@jest/globals';
import { buildValidationResult, checkSchemeDocumentReadiness } from '../../validation/document-validator';
import {
  DocumentType,
  DocumentStatus,
  type ExtractedData,
  type QualityAssessment,
} from '@yojana-setu/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const goodQuality: QualityAssessment = {
  overallScore: 0.92,
  isAcceptable: true,
  issues: [],
  recommendations: [],
};

const poorQuality: QualityAssessment = {
  overallScore: 0.3,
  isAcceptable: false,
  issues: [{ issueType: 'blur', severity: 'high', description: 'Blurry image', userGuidance: 'Retake photo' }],
  recommendations: ['Retake photo'],
};

function makeAadhaarData(overrides: Partial<{
  aadhaarNumber: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  confidence: number;
}> = {}): ExtractedData {
  const confidence = overrides.confidence ?? 0.95;
  return {
    documentType: DocumentType.AADHAAR,
    fields: [
      { fieldName: 'aadhaarNumber', value: overrides.aadhaarNumber ?? '1234 5678 9012', confidence },
      { fieldName: 'fullName', value: overrides.fullName ?? 'Ramesh Kumar', confidence },
      { fieldName: 'dateOfBirth', value: overrides.dateOfBirth ?? '01/01/1990', confidence },
      { fieldName: 'gender', value: overrides.gender ?? 'MALE', confidence },
    ],
    rawText: 'Sample raw text from OCR',
    extractionConfidence: confidence,
    extractedAt: new Date(),
  };
}

function makePANData(overrides: Partial<{
  panNumber: string;
  fullName: string;
  confidence: number;
}> = {}): ExtractedData {
  const confidence = overrides.confidence ?? 0.92;
  return {
    documentType: DocumentType.PAN,
    fields: [
      { fieldName: 'panNumber', value: overrides.panNumber ?? 'ABCDE1234F', confidence },
      { fieldName: 'fullName', value: overrides.fullName ?? 'Ramesh Kumar', confidence },
      { fieldName: 'dateOfBirth', value: '01/01/1990', confidence },
    ],
    rawText: 'PAN card OCR text',
    extractionConfidence: confidence,
    extractedAt: new Date(),
  };
}

// ─── buildValidationResult Tests ──────────────────────────────────────────────

describe('buildValidationResult', () => {
  it('returns VALID status for complete Aadhaar with good quality', () => {
    const result = buildValidationResult(
      'doc-1', DocumentType.AADHAAR, makeAadhaarData(), goodQuality,
      'aadhaar.jpg', 500_000, 1200,
    );
    expect(result.status).toBe(DocumentStatus.VALID);
    expect(result.isValid).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.missingFields).toHaveLength(0);
  });

  it('returns UNCLEAR status when image quality is high-severity bad', () => {
    const result = buildValidationResult(
      'doc-2', DocumentType.AADHAAR, makeAadhaarData(), poorQuality,
      'aadhaar.jpg', 500_000, 800,
    );
    expect(result.status).toBe(DocumentStatus.UNCLEAR);
    expect(result.isValid).toBe(false);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('returns INVALID status when required Aadhaar field is missing', () => {
    const dataWithoutNumber = makeAadhaarData({ aadhaarNumber: '' });
    // Remove the aadhaar number field
    dataWithoutNumber.fields = dataWithoutNumber.fields.filter(
      (f) => f.fieldName !== 'aadhaarNumber',
    );

    const result = buildValidationResult(
      'doc-3', DocumentType.AADHAAR, dataWithoutNumber, goodQuality,
      'aadhaar.jpg', 500_000, 1500,
    );
    expect(result.status).toBe(DocumentStatus.INVALID);
    expect(result.missingFields).toContain('Aadhaar Number');
  });

  it('validates PAN number pattern correctly', () => {
    // Valid PAN
    const validResult = buildValidationResult(
      'doc-4', DocumentType.PAN, makePANData({ panNumber: 'ABCDE1234F' }), goodQuality,
      'pan.jpg', 300_000, 900,
    );
    expect(validResult.status).toBe(DocumentStatus.VALID);

    // Invalid PAN format (lowercase)
    const invalidResult = buildValidationResult(
      'doc-5', DocumentType.PAN, makePANData({ panNumber: 'abcde1234f' }), goodQuality,
      'pan.jpg', 300_000, 900,
    );
    expect(invalidResult.status).toBe(DocumentStatus.INVALID);
  });

  it('includes processing metadata', () => {
    const result = buildValidationResult(
      'doc-6', DocumentType.AADHAAR, makeAadhaarData(), goodQuality,
      'test_aadhaar.jpg', 450_000, 1350,
    );
    expect(result.metadata.originalFilename).toBe('test_aadhaar.jpg');
    expect(result.metadata.fileSizeBytes).toBe(450_000);
    expect(result.metadata.processingTimeMs).toBe(1350);
    expect(result.metadata.ocrEngine).toBe('aws_textract');
  });

  it('confidence is always between 0 and 1', () => {
    const result = buildValidationResult(
      'doc-7', DocumentType.AADHAAR, makeAadhaarData({ confidence: 0.55 }), goodQuality,
      'aadhaar.jpg', 500_000, 1000,
    );
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('deduplicates recommendation messages', () => {
    const result = buildValidationResult(
      'doc-8', DocumentType.AADHAAR, makeAadhaarData(), goodQuality,
      'aadhaar.jpg', 500_000, 1000,
    );
    const unique = new Set(result.recommendations);
    expect(result.recommendations.length).toBe(unique.size);
  });
});

// ─── checkSchemeDocumentReadiness Tests ───────────────────────────────────────

describe('checkSchemeDocumentReadiness', () => {
  const makeResult = (
    type: DocumentType,
    isValid: boolean,
    status = isValid ? DocumentStatus.VALID : DocumentStatus.INVALID,
  ) => ({
    documentId: `doc-${type}`,
    documentType: type,
    status,
    isValid,
    confidence: isValid ? 0.9 : 0.4,
    extractedFields: {},
    missingFields: [],
    qualityIssues: [],
    recommendations: isValid ? [] : ['Retake photo'],
    isExpired: false,
    metadata: { originalFilename: 'x.jpg', fileSizeBytes: 100000, processingTimeMs: 900, ocrEngine: 'aws_textract' },
  });

  it('returns isReady=true when all required documents are valid', () => {
    const results = [
      makeResult(DocumentType.AADHAAR, true),
      makeResult(DocumentType.PAN, true),
    ];
    const readiness = checkSchemeDocumentReadiness(results, [DocumentType.AADHAAR, DocumentType.PAN]);
    expect(readiness.isReady).toBe(true);
    expect(readiness.missingDocumentTypes).toHaveLength(0);
    expect(readiness.invalidDocuments).toHaveLength(0);
  });

  it('returns missing document types when required doc is absent', () => {
    const results = [makeResult(DocumentType.AADHAAR, true)];
    const readiness = checkSchemeDocumentReadiness(
      results,
      [DocumentType.AADHAAR, DocumentType.INCOME_CERTIFICATE],
    );
    expect(readiness.isReady).toBe(false);
    expect(readiness.missingDocumentTypes).toContain(DocumentType.INCOME_CERTIFICATE);
  });

  it('returns invalid documents when required doc is present but invalid', () => {
    const results = [
      makeResult(DocumentType.AADHAAR, true),
      makeResult(DocumentType.PAN, false),
    ];
    const readiness = checkSchemeDocumentReadiness(
      results,
      [DocumentType.AADHAAR, DocumentType.PAN],
    );
    expect(readiness.isReady).toBe(false);
    expect(readiness.invalidDocuments.some((d) => d.documentType === DocumentType.PAN)).toBe(true);
  });

  it('returns isReady=true for empty required document list', () => {
    const readiness = checkSchemeDocumentReadiness([], []);
    expect(readiness.isReady).toBe(true);
  });
});
