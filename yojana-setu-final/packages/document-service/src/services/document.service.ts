import {
  type IDocumentValidatorService,
  type ValidationResult,
  type ValidationReport,
  type StoredDocument,
  type DocumentType,
  DocumentStatus,
  DocumentQualityError,
  UnsupportedDocumentError,
  DocumentExpiredError,
  generateUUID,
} from '@yojana-setu/shared';
import { assessImageQuality, extractDocumentData } from '../clients/textract.client';
import { uploadDocument, downloadDocument, deleteDocument } from '../clients/s3.client';
import { buildValidationResult, checkSchemeDocumentReadiness } from '../validation/document-validator';
import { DOCUMENT_SCHEMAS } from '../validation/document-schemas';
import { DocumentRepository } from '../db/document.repository';
import { logger } from '../config/logger';

// ─── Accepted MIME Types ──────────────────────────────────────────────────────

const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ─── Service ──────────────────────────────────────────────────────────────────

export class DocumentService implements IDocumentValidatorService {
  private readonly repo: DocumentRepository;

  constructor(repo?: DocumentRepository) {
    this.repo = repo ?? new DocumentRepository();
  }

  // ─── Upload & Validate ────────────────────────────────────────────────────
  // Requirement 4.1–4.5: Image quality check, OCR, field validation, storage

  async uploadAndValidate(
    fileBuffer: Buffer,
    mimeType: string,
    originalFilename: string,
    documentType: DocumentType,
    userId: string,
  ): Promise<ValidationResult> {
    const startTime = Date.now();

    // 1. Validate file type
    if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
      throw new UnsupportedDocumentError(
        mimeType,
        [...ACCEPTED_MIME_TYPES],
      );
    }

    // 2. Validate file size
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new DocumentQualityError(
        `File size ${Math.round(fileBuffer.length / 1024 / 1024)}MB exceeds the 10MB limit. Please compress the image.`,
      );
    }

    // 3. Validate document type is supported
    if (!DOCUMENT_SCHEMAS[documentType]) {
      throw new UnsupportedDocumentError(documentType, Object.keys(DOCUMENT_SCHEMAS));
    }

    // 4. Assess image quality (cheap check before expensive OCR)
    const qualityAssessment = await assessImageQuality(fileBuffer, documentType);
    const highSeverityIssues = qualityAssessment.issues.filter((i) => i.severity === 'high');

    if (!qualityAssessment.isAcceptable && highSeverityIssues.length > 0) {
      const guidance = highSeverityIssues[0]?.userGuidance ?? 'Please retake the photo in better lighting.';
      throw new DocumentQualityError(guidance, { issues: qualityAssessment.issues });
    }

    const documentId = generateUUID();

    // 5. Upload encrypted file to S3
    const uploadResult = await uploadDocument(fileBuffer, userId, documentType, mimeType);

    // 6. Run OCR extraction
    const extractedData = await extractDocumentData(fileBuffer, documentType);

    // 7. Build validation result (pure function)
    const processingTimeMs = Date.now() - startTime;
    const validationResult = buildValidationResult(
      documentId,
      documentType,
      extractedData,
      qualityAssessment,
      originalFilename,
      fileBuffer.length,
      processingTimeMs,
    );

    // 8. Check for expiry and throw dedicated error
    if (validationResult.isExpired) {
      throw new DocumentExpiredError(
        documentType,
        validationResult.expiryDate,
      );
    }

    // 9. Persist to database
    await this.repo.create({
      documentId,
      userId,
      documentType,
      storageKey: uploadResult.storageKey,
      encryptedKey: uploadResult.encryptedKey,
      status: validationResult.status,
      validationResult,
      fileSizeBytes: fileBuffer.length,
      mimeType,
      originalFilename,
    });

    logger.info('Document uploaded and validated', {
      documentId,
      userId,
      documentType,
      status: validationResult.status,
      confidence: validationResult.confidence,
      processingTimeMs,
    });

    return validationResult;
  }

  // ─── Re-validate ──────────────────────────────────────────────────────────
  // Called when a document is re-uploaded after being flagged as unclear

  async reValidate(documentId: string, userId: string): Promise<ValidationResult> {
    const doc = await this.repo.findById(documentId);
    if (!doc || doc.userId !== userId) {
      throw new Error(`Document ${documentId} not found for user ${userId}`);
    }

    const fileBuffer = await downloadDocument(doc.storageKey, doc.encryptedKey);
    const qualityAssessment = await assessImageQuality(fileBuffer, doc.documentType);
    const extractedData = await extractDocumentData(fileBuffer, doc.documentType);

    const validationResult = buildValidationResult(
      documentId,
      doc.documentType,
      extractedData,
      qualityAssessment,
      doc.originalFilename,
      fileBuffer.length,
      0,
    );

    await this.repo.updateStatus(documentId, validationResult.status, validationResult);

    return validationResult;
  }

  // ─── Get Document ─────────────────────────────────────────────────────────

  async getDocument(documentId: string, userId: string): Promise<StoredDocument | null> {
    return this.repo.findByIdForUser(documentId, userId);
  }

  async getDocumentsByUser(userId: string): Promise<StoredDocument[]> {
    return this.repo.findAllForUser(userId);
  }

  // ─── Scheme Readiness Check ───────────────────────────────────────────────
  // Requirement 4.5: Tell user which documents are still missing/invalid

  async checkSchemeReadiness(
    userId: string,
    requiredDocumentTypes: DocumentType[],
  ): Promise<{
    isReady: boolean;
    missingDocumentTypes: DocumentType[];
    invalidDocuments: Array<{ documentType: DocumentType; reason: string }>;
    validDocuments: DocumentType[];
  }> {
    const userDocs = await this.repo.findAllForUser(userId);
    const validationResults = userDocs
      .filter((d) => d.validationResult !== null)
      .map((d) => d.validationResult!);

    const readiness = checkSchemeDocumentReadiness(validationResults, requiredDocumentTypes);
    const validDocuments = validationResults
      .filter((r) => r.isValid)
      .map((r) => r.documentType);

    return { ...readiness, validDocuments };
  }

  // ─── Delete ───────────────────────────────────────────────────────────────
  // Hard delete — used when consent is withdrawn (Req 9.5)

  async deleteDocument(documentId: string, userId: string): Promise<void> {
    const doc = await this.repo.findByIdForUser(documentId, userId);
    if (!doc) return; // Already deleted — idempotent

    await deleteDocument(doc.storageKey);
    await this.repo.delete(documentId);

    logger.info('Document deleted', { documentId, userId });
  }

  async deleteAllDocumentsForUser(userId: string): Promise<void> {
    const docs = await this.repo.findAllForUser(userId);
    await Promise.all(docs.map((d) => this.deleteDocument(d.documentId, userId)));
    logger.info('All documents deleted for user', { userId, count: docs.length });
  }

  // ─── Validation Report (Req 4.4) ──────────────────────────────────────────

  buildValidationReport(results: ValidationResult[]): ValidationReport {
    const total = results.length;
    const valid = results.filter((r) => r.isValid).length;
    const expired = results.filter((r) => r.isExpired).length;
    const unclear = results.filter((r) => r.status === DocumentStatus.UNCLEAR).length;

    return {
      totalDocuments: total,
      validDocuments: valid,
      invalidDocuments: total - valid,
      expiredDocuments: expired,
      unclearDocuments: unclear,
      overallReadiness: total > 0 ? Math.round((valid / total) * 100) : 0,
      results,
      generatedAt: new Date(),
    };
  }
}
